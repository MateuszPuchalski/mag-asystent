import { db } from "../db/db.js";
import { currentUserRef } from "../context.js";
import { logEvent } from "./events.js";
import type { MmItem } from "../adapters/sfera.js";

export interface EnqueueBase {
  createdBy: string;
  /**
   * Konto autora. Puste = bierzemy z bieżącej sesji. Podaje się je wprost
   * tylko wtedy, gdy autor NIE jest właścicielem sesji — operacja odbuforowana
   * po zmianie zmiany (patrz `autorOperacji`).
   */
  createdByRef?: number | null;
  twId?: number | null;
  sourceDocId?: number | null;
  label: string;
  detail: string;
}

function insert(
  type: string,
  payload: unknown,
  base: EnqueueBase
): number {
  /* `created_by_ref` obok `created_by`: nazwa to snapshot z chwili zapisu,
     konto to tożsamość. Worker działa POZA żądaniem — nie ma tam sesji ani
     `currentUserRef()` — więc bez tej kolumny zdarzenia „zapis wszedł/nie
     wszedł" umiałyby podać wyłącznie łańcuch znaków, a audyt wiąże po koncie. */
  // `next_attempt_at` zostaje NULL — zadanie jest do wzięcia od razu. Kolumnę
  // wypełnia dopiero worker: backoff przy retry i `waiting_for_doc`.
  const res = db()
    .prepare(
      `INSERT INTO sfera_queue(type, payload, status, label, detail, tw_id, source_doc_id, created_by, created_by_ref, next_attempt_at)
       VALUES (?,?, 'pending', ?,?,?,?,?,?,?)`
    )
    .run(
      type,
      JSON.stringify(payload),
      base.label,
      base.detail,
      base.twId ?? null,
      base.sourceDocId ?? null,
      base.createdBy,
      base.createdByRef ?? currentUserRef(),
      null
    );
  return Number(res.lastInsertRowid);
}

/**
 * Dane audytowe zmiany lokalizacji. Parametr WYMAGANY — i to jest cały sens.
 *
 * Do sierpnia 2026 zdarzenie o zmianie lokalizacji emitowała wyłącznie trasa
 * karty towaru. Pozostałe ścieżki — rozkładanie linii dostawy i przesunięcie
 * stanu — kolejkują ten sam zapis i logują własne zdarzenia dziedzinowe, które
 * o zawartości pola nie mówią nic. Historia na karcie milczałaby więc
 * o zmianach, których nie zrobiono z niej samej.
 */
export interface AudytLokalizacji {
  /**
   * Zawartość pola PRZED zmianą. **Surowa, nie przepuszczona przez
   * `parseLocs`.**
   *
   * Wycofanie zmiany polega na wpisaniu z powrotem dokładnie tego, co tam
   * stało. Wartość znormalizowana byłaby rekonstrukcją, nie zapisem — i przy
   * pierwszej rozbieżności formatowania cofnęłaby coś innego, niż było.
   */
  locsPrzed: string;
  /** Z którego ekranu wyszła zmiana. Pierwsze pytanie przy analizie. */
  zrodlo: "karta" | "dostawa" | "przesuniecie";
  /** Intencja człowieka — tylko z karty towaru (`add` | `replace` | `remove`). */
  akcja?: string;
  /** Kod, który człowiek podał — tylko z karty towaru. */
  wartosc?: string;
  /** Nazwa osoby, która operację WYSŁAŁA, gdy różni się od autora. */
  wyslanePrzez?: string | null;
}

/**
 * Zadanie zmiany lokalizacji (spec §5.2) wraz z wpisem do audytu.
 *
 * Zdarzenie powstaje TUTAJ, a nie w miejscach wywołania, i to jest decyzja
 * strukturalna: zapisu lokalizacji nie da się zakolejkować bez śladu. Czwarta
 * ścieżka, dopisana za pół roku, dostanie wpis bez pamiętania o tym.
 */
export function enqueueSetLocation(
  twId: number,
  newValue: string,
  base: EnqueueBase,
  audyt: AudytLokalizacji
): number {
  const queueId = insert("set_location", { twId, newValue }, base);
  /* Oba typy muszą przetrwać: `productHistory` po nich filtruje, a w bazie leżą
     już wiersze historyczne. Klucze `action`, `value` i `result` zostają
     w dotychczasowym kształcie — zmiana ich nazw unieważniłaby stare wpisy. */
  logEvent(
    audyt.akcja === "remove" ? "location_removed" : "location_set",
    base.createdBy,
    twId,
    {
      locsPrzed: audyt.locsPrzed,
      result: newValue,
      zrodlo: audyt.zrodlo,
      queueId,
      ...(audyt.akcja ? { action: audyt.akcja } : {}),
      ...(audyt.wartosc ? { value: audyt.wartosc } : {}),
      ...(audyt.wyslanePrzez ? { wyslanePrzez: audyt.wyslanePrzez } : {}),
    },
    base.createdByRef ?? currentUserRef()
  );
  return queueId;
}

/** Zadanie MM (spec §5.3): przesunięcie stanu między dowolną parą magazynów. */
export function enqueueMM(
  magFrom: number,
  magTo: number,
  items: MmItem[],
  base: EnqueueBase
): number {
  return insert("mm", { magFrom, magTo, items }, base);
}
