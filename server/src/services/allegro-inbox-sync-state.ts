import { config } from "../config.js";
import type { Db } from "../db/db.js";

/** Statusy synchronizacji z §7 projektu panelu. Niezależne od statusu rozmowy. */
export type StatusSynchronizacji =
  | "current" | "delayed" | "rate_limited" | "authentication_error" | "failed";

export interface AllegroInboxSyncState {
  cursorAt: string | null;
  cursorId: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastErrorCode: number | null;
  errorCount: number;
  errorThreadCount: number;
  nextAttemptAt: string | null;
}

const PUSTY: AllegroInboxSyncState = {
  cursorAt: null, cursorId: null, lastSuccessAt: null, lastAttemptAt: null,
  lastErrorCode: null, errorCount: 0, errorThreadCount: 0, nextAttemptAt: null,
};

export function stanSynchronizacji(db: Db): AllegroInboxSyncState {
  const row = db.prepare(`SELECT cursor_at, cursor_id, last_success_at, last_attempt_at,
    last_error_code, error_count, error_thread_count, next_attempt_at
    FROM allegro_inbox_sync_state WHERE id=1`).get() as Record<string, unknown> | undefined;
  if (!row) return PUSTY;
  return {
    cursorAt: (row.cursor_at as string) ?? null,
    cursorId: (row.cursor_id as string) ?? null,
    lastSuccessAt: (row.last_success_at as string) ?? null,
    lastAttemptAt: (row.last_attempt_at as string) ?? null,
    lastErrorCode: row.last_error_code == null ? null : Number(row.last_error_code),
    errorCount: Number(row.error_count ?? 0),
    errorThreadCount: Number(row.error_thread_count ?? 0),
    nextAttemptAt: (row.next_attempt_at as string) ?? null,
  };
}

/**
 * Ile nieudanych przebiegów Z RZĘDU uzasadnia trwały alarm.
 *
 * §21: „Panel pokazuje trwały alarm, gdy synchronizacja nie powiodła się przez
 * więcej niż dwa planowane interwały". Dwa to jeszcze potknięcie, trzy to stan.
 */
export const PROG_ALARMU = 3;

/**
 * Status z §7 wyliczony ze stanu, nie zapamiętany osobno.
 *
 * Osobna kolumna statusu rozjechałaby się z liczbami, z których wynika —
 * a wtedy ekran mówiłby „w porządku" nad danymi sprzed trzech godzin.
 */
export function statusSynchronizacji(
  s: AllegroInboxSyncState, teraz = Date.now(), interwalMs = config.allegro.inboxSyncMs,
): StatusSynchronizacji {
  if (s.errorCount > 0) {
    /* Kod porażki rozstrzyga przed jej liczbą: 401 znaczy „zawołaj admina",
       a 429 „poczekaj". Zlanie ich w `failed` kazałoby zgadywać, co robić. */
    if (s.lastErrorCode === 401 || s.lastErrorCode === 403) return "authentication_error";
    if (s.lastErrorCode === 429) return "rate_limited";
    return s.errorCount >= PROG_ALARMU ? "failed" : "delayed";
  }
  /* Brak jakiejkolwiek próby to NIE jest awaria: instalacja bez sparowanego
     konta Allegro byłaby wtedy czerwona od pierwszego uruchomienia. */
  if (!s.lastAttemptAt) return "current";
  if (!s.lastSuccessAt) return "delayed";
  return teraz - Date.parse(s.lastSuccessAt) > 2 * interwalMs ? "delayed" : "current";
}

/** Blok dla `/api/health` i dla panelu — kształt z §21. */
export function stanSynchronizacjiHealth(
  db: Db, teraz = Date.now(), interwalMs = config.allegro.inboxSyncMs,
) {
  const s = stanSynchronizacji(db);
  return {
    status: statusSynchronizacji(s, teraz, interwalMs),
    /* Alarm jest osobny od statusu: `rate_limited` po jednej odmowie nie jest
       jeszcze powodem, żeby przykryć kolejkę banerem na cały ekran. */
    alarm: s.errorCount >= PROG_ALARMU,
    ostatniaProba: s.lastAttemptAt,
    ostatniaUdanaSynchronizacja: s.lastSuccessAt,
    kodOstatniegoBledu: s.lastErrorCode,
    liczbaBledow: s.errorCount,
    watkiZBledem: s.errorThreadCount,
    opoznienieMs: s.lastSuccessAt ? Math.max(0, teraz - Date.parse(s.lastSuccessAt)) : null,
    nastepnaProba: s.nextAttemptAt,
    interwalMs,
  };
}
