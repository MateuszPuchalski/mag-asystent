import { db } from "../db/db.js";
import { currentUserRef } from "../context.js";
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
  sessionId?: number | null;
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
      `INSERT INTO sfera_queue(type, payload, status, label, detail, tw_id, source_doc_id, session_id, created_by, created_by_ref, next_attempt_at)
       VALUES (?,?, 'pending', ?,?,?,?,?,?,?,?)`
    )
    .run(
      type,
      JSON.stringify(payload),
      base.label,
      base.detail,
      base.twId ?? null,
      base.sourceDocId ?? null,
      base.sessionId ?? null,
      base.createdBy,
      base.createdByRef ?? currentUserRef(),
      null
    );
  return Number(res.lastInsertRowid);
}

/** Zadanie zmiany lokalizacji (spec §5.2). */
export function enqueueSetLocation(
  twId: number,
  newValue: string,
  base: EnqueueBase
): number {
  return insert("set_location", { twId, newValue }, base);
}

/**
 * Zadanie ustawienia flagi sprawdzenia na fakturze dostawy.
 *
 * To ŚWIADOME zawężone złamanie §16 („zero zapisu do SGT poza tw_Lokalizacja"):
 * w tej firmie rozkładanie jest sprawdzaniem faktury, więc bez tego zapisu biuro
 * musiałoby pytać magazyn o stan każdej dostawy. Zapis idzie tą samą drogą co
 * lokalizacja — kolejka → worker → adapter — więc kolektor nigdy nie czeka na COM.
 */
export function enqueueDocFlag(
  dokId: number,
  /** Klucz stanu — do audytu i czytelnych logów. */
  flaga: string,
  /** Surowa wartość dla Subiekta (flagi wbudowane = id koloru), patrz config.docFlag. */
  wartosc: string,
  base: EnqueueBase
): number {
  return insert("set_doc_flag", { dokId, flaga, wartosc }, base);
}

/** Zadanie MM (spec §5.3). items: przesunięcie MGP→MAG. */
export function enqueueMM(
  magFrom: number,
  magTo: number,
  items: MmItem[],
  base: EnqueueBase
): number {
  return insert("mm", { magFrom, magTo, items }, base);
}
