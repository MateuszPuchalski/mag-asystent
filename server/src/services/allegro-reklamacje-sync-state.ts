import { config } from "../config.js";
import type { Db } from "../db/db.js";
import {
  PROG_ALARMU,
  type StatusSynchronizacji,
} from "./allegro-inbox-sync-state.js";

/* ── Stan synchronizatora reklamacji (0.222.0) ───────────────────────────────
   Osobny wiersz od zwrotów i od skrzynki, bo to osobna rodzina końcówek:
   własny limit Allegro i własny rytm. Wspólny zostaje SŁOWNIK statusów
   i próg alarmu — agent ma czytać „rate_limited" tak samo na każdym ekranie,
   a trzy definicje tego samego słowa rozjechałyby się przy pierwszej
   poprawce jednej z nich.

   DWIE RÓŻNICE WOBEC ZWROTÓW, obie wymuszone przez API:

   1. NIE MA KURSORA. `getListOfIssuesUsingGET` nie przyjmuje ani `from`, ani
      granicy dat — wyłącznie `offset`, `limit`, `status` i `checkoutForm.id`.
      Każdy przebieg czyta listę od początku, więc nie ma czego zapamiętać.
   2. JEST LICZNIK ODSIANYCH. Ta sama lista niesie dyskusje, których panel nie
      prowadzi (decyzja właściciela). Bez tej liczby ktoś szukałby kiedyś
      „zaginionych" reklamacji, które nigdy reklamacjami nie były.          */

export interface AllegroReklamacjeSyncState {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastErrorCode: number | null;
  errorCount: number;
  nextAttemptAt: string | null;
  /**
   * Ile spraw Allegro miało jeszcze do oddania po ostatnim przebiegu.
   *
   * `null` znaczy „nie wiem" — albo przebiegu jeszcze nie było, albo Allegro
   * nie podało `count`. Zero znaczy „lista skończyła się sama". Różnica jest
   * ważna: liczba to jedyny ślad po sprawach, które bezpiecznik stron zostawił
   * po tamtej stronie.
   */
  pozostalo: number | null;
  /** Ile spraw z ostatniego przebiegu było dyskusjami. Nie jest to błąd. */
  dyskusji: number | null;
}

const PUSTY: AllegroReklamacjeSyncState = {
  lastSuccessAt: null, lastAttemptAt: null, lastErrorCode: null,
  errorCount: 0, nextAttemptAt: null, pozostalo: null, dyskusji: null,
};

export function stanReklamacji(db: Db): AllegroReklamacjeSyncState {
  const row = db.prepare(`SELECT last_success_at, last_attempt_at, last_error_code,
    error_count, next_attempt_at, pozostalo, dyskusji
    FROM allegro_reklamacje_sync_state WHERE id=1`).get() as Record<string, unknown> | undefined;
  if (!row) return PUSTY;
  return {
    lastSuccessAt: (row.last_success_at as string) ?? null,
    lastAttemptAt: (row.last_attempt_at as string) ?? null,
    lastErrorCode: row.last_error_code == null ? null : Number(row.last_error_code),
    errorCount: Number(row.error_count ?? 0),
    nextAttemptAt: (row.next_attempt_at as string) ?? null,
    pozostalo: row.pozostalo == null ? null : Number(row.pozostalo),
    dyskusji: row.dyskusji == null ? null : Number(row.dyskusji),
  };
}

/** Status z §7, liczony ze stanu — nigdy zapamiętany osobno. */
export function statusReklamacji(
  s: AllegroReklamacjeSyncState,
  teraz = Date.now(),
  interwalMs = config.allegro.reklamacjeSyncMs,
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

/** Blok dla panelu — kształt lustrzany do zwrotów i do skrzynki. */
export function stanReklamacjiHealth(
  db: Db,
  teraz = Date.now(),
  interwalMs = config.allegro.reklamacjeSyncMs,
) {
  const s = stanReklamacji(db);
  return {
    status: statusReklamacji(s, teraz, interwalMs),
    alarm: s.errorCount >= PROG_ALARMU,
    ostatniaProba: s.lastAttemptAt,
    ostatniaUdanaSynchronizacja: s.lastSuccessAt,
    kodOstatniegoBledu: s.lastErrorCode,
    liczbaBledow: s.errorCount,
    opoznienieMs: s.lastSuccessAt ? Math.max(0, teraz - Date.parse(s.lastSuccessAt)) : null,
    nastepnaProba: s.nextAttemptAt,
    interwalMs,
    pozostaloDoPobrania: s.pozostalo,
    dyskusjiPominietych: s.dyskusji,
  };
}
