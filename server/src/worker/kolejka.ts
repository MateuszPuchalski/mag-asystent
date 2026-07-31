import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";
import type { MmItem, SferaAdapter } from "../adapters/sfera.js";
import { logEvent } from "../services/events.js";

/* ── Logika kolejki Sfery ───────────────────────────────────────────────────
   Wydzielone z `worker.ts`, bo tamten moduł przy imporcie startuje pętlę
   `setInterval` i melduje tryb procesu — czyli nie da się go dotknąć z testu,
   nie uruchamiając workera. A jest to jedyna logika sterująca ZAPISAMI DO
   BAZY FIRMY: wybór zadania, retry z backoffem i terminalny błąd.

   Adapter Sfery wchodzi PARAMETREM, nie importem. Dzięki temu test podstawia
   własny (padający na żądanie) zamiast czekać na prawdziwy COM albo losować
   przez `WORKER_SIM_ERRORS`.                                                 */

export interface Task {
  id: number;
  type: string;
  payload: string;
  attempts: number;
  source_doc_id: number | null;
  /* Poniższe trzy pola nie sterują niczym — służą WYŁĄCZNIE audytowi. Worker
     działa poza żądaniem, więc `currentUserRef()` i `currentDevice()` są tam
     puste; bez przeniesienia autora przez wiersz kolejki zdarzenie „zapis
     wszedł do Subiekta" nie miałoby do kogo się przypiąć. */
  tw_id: number | null;
  created_by: string;
  created_by_ref: number | null;
}

const inBuffer = (docId: number): boolean => {
  const r = db().prepare("SELECT w_buforze FROM sgt_dokument WHERE dok_id = ?").get(docId) as
    | { w_buforze: number }
    | undefined;
  return !!r && r.w_buforze === 1;
};

export function pickTask(): Task | undefined {
  const now = nowIso();
  // najpierw waiting_for_doc gotowe do ponowienia
  const waiting = db()
    .prepare(
      `SELECT id,type,payload,attempts,source_doc_id,tw_id,created_by,created_by_ref FROM sfera_queue
       WHERE status='waiting_for_doc' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY id LIMIT 1`
    )
    .get(now) as Task | undefined;
  if (waiting) {
    if (waiting.source_doc_id && inBuffer(waiting.source_doc_id)) {
      db()
        .prepare("UPDATE sfera_queue SET next_attempt_at=? WHERE id=?")
        .run(new Date(Date.now() + config.worker.waitingRetryMs).toISOString(), waiting.id);
      return undefined;
    }
    return waiting;
  }
  return db()
    .prepare(
      `SELECT id,type,payload,attempts,source_doc_id,tw_id,created_by,created_by_ref FROM sfera_queue
       WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY id LIMIT 1`
    )
    .get(now) as Task | undefined;
}

/**
 * Zdarzenie audytowe workera.
 *
 * Autor idzie z WIERSZA KOLEJKI, nie z sesji: worker pracuje poza żądaniem,
 * więc `currentUserRef()` jest tam puste, a zdarzenie bez autora nie odpowiada
 * na pytanie „kto to zrobił". `device_id` zostaje pusty i to jest poprawne —
 * zapisu do Subiekta nie wykonał żaden kolektor, tylko serwer.
 */
function zdarzenieZadania(task: Task, typ: string, dane: Record<string, unknown>): void {
  logEvent(typ, task.created_by, task.tw_id, { queueId: task.id, typ: task.type, ...dane }, task.created_by_ref);
}

export function oznaczBlad(task: Task, msg: string): void {
  const attempts = task.attempts + 1;
  if (attempts < config.worker.maxAttempts) {
    const backoff = config.worker.backoffMs[Math.min(attempts - 1, config.worker.backoffMs.length - 1)];
    db()
      .prepare("UPDATE sfera_queue SET status='pending', attempts=?, error_msg=?, next_attempt_at=? WHERE id=?")
      .run(attempts, msg, new Date(Date.now() + backoff).toISOString(), task.id);
    /* Nieudana próba też jest faktem. Bez niej audyt pokazywałby wyłącznie
       skutek ostateczny, a pytanie „dlaczego to weszło dopiero po godzinie"
       zostawałoby bez odpowiedzi. Liczba wpisów jest ograniczona z góry przez
       `maxAttempts`, więc to nie jest źródło szumu. */
    zdarzenieZadania(task, "queue_retry", { proba: attempts, max: config.worker.maxAttempts, blad: msg });
    console.log(`[worker] #${task.id} błąd (próba ${attempts}/${config.worker.maxAttempts}), retry za ${backoff}ms: ${msg}`);
  } else {
    db()
      .prepare("UPDATE sfera_queue SET status='error', attempts=?, error_msg=?, processed_at=? WHERE id=?")
      .run(attempts, msg, nowIso(), task.id);
    /* NAJWAŻNIEJSZY wpis w całym audycie. Trwale nieudany zapis do Subiekta to
       najbardziej prawdopodobna odpowiedź na „aplikacja zjadła mi sztuki":
       magazynier zrobił swoje, kolektor przyjął, a do bazy firmy nic nie
       weszło. Do sierpnia 2026 ten fakt istniał wyłącznie jako `error_msg`
       w wierszu kolejki — czyli poza śladem, w którym ktokolwiek by go szukał. */
    zdarzenieZadania(task, "queue_failed", { proby: attempts, blad: msg });
    console.log(`[worker] #${task.id} ERROR (wyczerpano próby): ${msg}`);
  }
}

/**
 * Dokument w buforze → zadanie czeka (spec §8 D8).
 *
 * Zwraca `true`, gdy zadanie zostało odłożone. Wywołujący ma wtedy NIE zajmować
 * slotu workera — czekanie nie jest pracą, a następny tick ma wziąć inne
 * zadanie zamiast stać.
 */
export function czekaNaDokument(task: Task): boolean {
  if (task.type !== "mm" || !task.source_doc_id || !inBuffer(task.source_doc_id)) return false;
  db()
    .prepare("UPDATE sfera_queue SET status='waiting_for_doc', next_attempt_at=? WHERE id=?")
    .run(new Date(Date.now() + config.worker.waitingRetryMs).toISOString(), task.id);
  console.log(`[worker] #${task.id} czeka na wyjście dok. ${task.source_doc_id} z bufora`);
  return true;
}

/** Wykonanie jednego zadania. Błędy zamienia na status, nie rzuca dalej. */
export async function przetworzZadanie(task: Task, sfera: SferaAdapter): Promise<void> {
  const payload = JSON.parse(task.payload);
  db().prepare("UPDATE sfera_queue SET status='processing' WHERE id=?").run(task.id);

  try {
    if (config.worker.simErrors && Math.random() < 0.45) {
      throw new Error("Zapis Sfery nieudany — kartoteka w edycji (Subiekt)");
    }
    let docNo: string | null = null;
    if (task.type === "set_location") {
      await sfera.applySetLocation(payload.twId, payload.newValue);
    } else if (task.type === "mm") {
      docNo = await sfera.createMM(payload.magFrom, payload.magTo, payload.items as MmItem[]);
    } else {
      throw new Error("Nieznany typ zadania: " + task.type);
    }
    db()
      .prepare("UPDATE sfera_queue SET status='done', sgt_doc_number=?, processed_at=? WHERE id=?")
      .run(docNo, nowIso(), task.id);
    /* Sukces też jest zdarzeniem. `location_set` mówi tylko, że człowiek
       POPROSIŁ; dopiero to mówi, że zapis naprawdę wszedł do bazy firmy i o
       której. Bez tej pary audyt umie odpowiedzieć „chciał", ale nie „stało
       się" — a różnica między nimi jest właśnie tym, o co pyta reklamacja. */
    zdarzenieZadania(task, "queue_applied", { docNo, proby: task.attempts });
    console.log(`[worker] #${task.id} OK ${task.type}${docNo ? " · MM " + docNo : ""}`);
  } catch (e) {
    oznaczBlad(task, e instanceof Error ? e.message : String(e));
  }
}
