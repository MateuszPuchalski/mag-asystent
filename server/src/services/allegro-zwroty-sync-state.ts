import { config } from "../config.js";
import type { Db } from "../db/db.js";
import {
  PROG_ALARMU,
  type StatusSynchronizacji,
} from "./allegro-inbox-sync-state.js";

/* ── Stan synchronizatora zwrotów (0.150.0) ──────────────────────────────────
   Osobny wiersz od skrzynki, bo to osobna rodzina końcówek: własny limit
   Allegro, własny kursor i własny rytm. Wspólny zostaje SŁOWNIK statusów
   i próg alarmu — agent ma czytać „rate_limited" tak samo na obu ekranach,
   a dwie definicje tego samego słowa rozjechałyby się przy pierwszej
   poprawce jednej z nich.

   Różnica wobec skrzynki jest jedna i wynika z natury zwrotu: NIE MA tu
   licznika wątków z błędem. Zwrot przyjeżdża w całości jednym rekordem
   listy, więc nie ma czego dociągać osobno ani na czym się wywalić po
   jednym elemencie.                                                        */

export interface AllegroZwrotySyncState {
  cursorId: string | null;
  cursorAt: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastErrorCode: number | null;
  errorCount: number;
  nextAttemptAt: string | null;
  /**
   * Ile zwrotów Allegro miało jeszcze do oddania po ostatnim przebiegu.
   *
   * `null` znaczy „nie wiem" — albo przebiegu jeszcze nie było, albo Allegro
   * nie podało `count`. Zero znaczy „lista skończyła się sama". Różnica jest
   * ważna: liczba to jedyny ślad po zwrotach, które bezpiecznik stron zostawił
   * po tamtej stronie, choć kursor i tak przesunął się naprzód.
   */
  pozostalo: number | null;
}

const PUSTY: AllegroZwrotySyncState = {
  cursorId: null, cursorAt: null, lastSuccessAt: null, lastAttemptAt: null,
  lastErrorCode: null, errorCount: 0, nextAttemptAt: null, pozostalo: null,
};

export function stanZwrotow(db: Db): AllegroZwrotySyncState {
  const row = db.prepare(`SELECT cursor_id, cursor_at, last_success_at, last_attempt_at,
    last_error_code, error_count, next_attempt_at, pozostalo
    FROM allegro_zwroty_sync_state WHERE id=1`).get() as Record<string, unknown> | undefined;
  if (!row) return PUSTY;
  return {
    cursorId: (row.cursor_id as string) ?? null,
    cursorAt: (row.cursor_at as string) ?? null,
    lastSuccessAt: (row.last_success_at as string) ?? null,
    lastAttemptAt: (row.last_attempt_at as string) ?? null,
    lastErrorCode: row.last_error_code == null ? null : Number(row.last_error_code),
    errorCount: Number(row.error_count ?? 0),
    nextAttemptAt: (row.next_attempt_at as string) ?? null,
    pozostalo: row.pozostalo == null ? null : Number(row.pozostalo),
  };
}

/** Status z §7, liczony ze stanu — nigdy zapamiętany osobno. */
export function statusZwrotow(
  s: AllegroZwrotySyncState,
  teraz = Date.now(),
  interwalMs = config.allegro.zwrotySyncMs,
): StatusSynchronizacji {
  if (s.errorCount > 0) {
    if (s.lastErrorCode === 401 || s.lastErrorCode === 403) return "authentication_error";
    if (s.lastErrorCode === 429) return "rate_limited";
    return s.errorCount >= PROG_ALARMU ? "failed" : "delayed";
  }
  if (!s.lastAttemptAt) return "current";
  if (!s.lastSuccessAt) return "delayed";
  return teraz - Date.parse(s.lastSuccessAt) > 2 * interwalMs ? "delayed" : "current";
}

/** Blok dla `/api/health` i dla panelu — kształt lustrzany do skrzynki. */
export function stanZwrotowHealth(
  db: Db,
  teraz = Date.now(),
  interwalMs = config.allegro.zwrotySyncMs,
) {
  const s = stanZwrotow(db);
  return {
    status: statusZwrotow(s, teraz, interwalMs),
    alarm: s.errorCount >= PROG_ALARMU,
    ostatniaProba: s.lastAttemptAt,
    ostatniaUdanaSynchronizacja: s.lastSuccessAt,
    kodOstatniegoBledu: s.lastErrorCode,
    liczbaBledow: s.errorCount,
    opoznienieMs: s.lastSuccessAt ? Math.max(0, teraz - Date.parse(s.lastSuccessAt)) : null,
    nastepnaProba: s.nextAttemptAt,
    interwalMs,
    /* Ogon ostatniego przebiegu (0.209.0). Stoi obok błędów, bo znaczy to samo
       co one — kolejka NIE JEST kompletna — tylko że synchronizacja o tym nie
       wie, bo skończyła się sukcesem. */
    pozostaloDoPobrania: s.pozostalo,
  };
}
