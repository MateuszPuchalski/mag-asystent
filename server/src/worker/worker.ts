import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";
import { makeSferaAdapter } from "../adapters/index.js";
import type { MmItem } from "../adapters/sfera.js";
import { cofnijFlage } from "../services/delivery-flag.js";
import { zamelduj } from "../services/process-state.js";

/**
 * Worker Sfery (spec §9). Jeden proces, pętla poll, przetwarzanie sekwencyjne
 * (COM Sfery nie jest thread-safe). Retry 3× z backoffem; po wyczerpaniu status
 * 'error'. Dokument w buforze → 'waiting_for_doc' i ponawianie.
 * DEV: zapis realizuje DevSferaAdapter (mutacja sgt_*).
 */
const sfera = makeSferaAdapter();

interface Task {
  id: number;
  type: string;
  payload: string;
  attempts: number;
  source_doc_id: number | null;
}

const inBuffer = (docId: number): boolean => {
  const r = db().prepare("SELECT w_buforze FROM sgt_dokument WHERE dok_id = ?").get(docId) as
    | { w_buforze: number }
    | undefined;
  return !!r && r.w_buforze === 1;
};

function pickTask(): Task | undefined {
  const now = nowIso();
  // najpierw waiting_for_doc gotowe do ponowienia
  const waiting = db()
    .prepare(
      `SELECT id,type,payload,attempts,source_doc_id FROM sfera_queue
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
      `SELECT id,type,payload,attempts,source_doc_id FROM sfera_queue
       WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY id LIMIT 1`
    )
    .get(now) as Task | undefined;
}

function fail(task: Task, msg: string) {
  const attempts = task.attempts + 1;
  if (attempts < config.worker.maxAttempts) {
    const backoff = config.worker.backoffMs[Math.min(attempts - 1, config.worker.backoffMs.length - 1)];
    db()
      .prepare("UPDATE sfera_queue SET status='pending', attempts=?, error_msg=?, next_attempt_at=? WHERE id=?")
      .run(attempts, msg, new Date(Date.now() + backoff).toISOString(), task.id);
    console.log(`[worker] #${task.id} błąd (próba ${attempts}/${config.worker.maxAttempts}), retry za ${backoff}ms: ${msg}`);
  } else {
    db()
      .prepare("UPDATE sfera_queue SET status='error', attempts=?, error_msg=?, processed_at=? WHERE id=?")
      .run(attempts, msg, nowIso(), task.id);
    // Zadanie flagi, które ostatecznie nie poszło, MUSI cofnąć `flaga_wyslana`
    // — inaczej dedupe w `syncFlag` nigdy go nie ponowi i faktura zostanie
    // nieoznaczona bez śladu.
    if (task.type === "set_doc_flag" && task.source_doc_id != null) {
      cofnijFlage(task.source_doc_id, `zadanie #${task.id} zakończone błędem`);
    }
    console.log(`[worker] #${task.id} ERROR (wyczerpano próby): ${msg}`);
  }
}

async function process(task: Task): Promise<void> {
  const payload = JSON.parse(task.payload);

  // dokument w buforze → czekaj (spec §8 D8). Nie zajmuje slotu workera —
  // `busy` nie jest tu ustawiane, więc następny tick weźmie inne zadanie.
  if (task.type === "mm" && task.source_doc_id && inBuffer(task.source_doc_id)) {
    db()
      .prepare("UPDATE sfera_queue SET status='waiting_for_doc', next_attempt_at=? WHERE id=?")
      .run(new Date(Date.now() + config.worker.waitingRetryMs).toISOString(), task.id);
    console.log(`[worker] #${task.id} czeka na wyjście dok. ${task.source_doc_id} z bufora`);
    return;
  }

  db().prepare("UPDATE sfera_queue SET status='processing' WHERE id=?").run(task.id);

  // slot zajęty na czas realnego zapisu — zapis do SGT musi iść sekwencyjnie
  // (COM Sfery nie jest thread-safe, spec §9)
  busy = true;
  try {
    if (config.worker.simErrors && Math.random() < 0.45) {
      throw new Error("Zapis Sfery nieudany — kartoteka w edycji (Subiekt)");
    }
    let docNo: string | null = null;
    if (task.type === "set_location") {
      await sfera.applySetLocation(payload.twId, payload.newValue);
    } else if (task.type === "set_doc_flag") {
      await sfera.applyDocFlag(payload.dokId, payload.wartosc, payload.flaga);
    } else if (task.type === "mm") {
      docNo = await sfera.createMM(payload.magFrom, payload.magTo, payload.items as MmItem[]);
    } else {
      throw new Error("Nieznany typ zadania: " + task.type);
    }
    db()
      .prepare("UPDATE sfera_queue SET status='done', sgt_doc_number=?, processed_at=? WHERE id=?")
      .run(docNo, nowIso(), task.id);
    console.log(`[worker] #${task.id} OK ${task.type}${docNo ? " · MM " + docNo : ""}`);
  } catch (e) {
    fail(task, e instanceof Error ? e.message : String(e));
  } finally {
    busy = false;
  }
}

let busy = false;
function tick() {
  if (busy) return;
  const task = pickTask();
  if (!task) return;
  // błąd przed ustawieniem `busy` (np. zepsuty payload) też musi oznaczyć zadanie
  void process(task).catch((e) => {
    busy = false;
    fail(task, e instanceof Error ? e.message : String(e));
  });
}

/* Meldunek trybu przy starcie i w pętli. Bez tego jedynym śladem po tym, w
   jakim trybie pracuje worker, była ta linia w logu — a rozjazd z API nie miał
   żadnego objawu poza brakiem zmian w Subiekcie. Teraz widzi go /api/health. */
zamelduj("worker");

console.log(`[worker] start · poll ${config.worker.pollMs}ms · simErrors=${config.worker.simErrors} · SGT_MODE=${config.sgtMode} · zapis=${config.sferaMode}`);
setInterval(() => {
  zamelduj("worker");
  tick();
}, config.worker.pollMs);
