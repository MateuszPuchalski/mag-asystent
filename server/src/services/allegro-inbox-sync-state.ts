import type { Db } from "../db/db.js";

export interface AllegroInboxSyncState {
  cursorAt: string | null;
  cursorId: string | null;
  lastSuccessAt: string | null;
  errorCount: number;
  nextAttemptAt: string | null;
}

export function stanSynchronizacji(db: Db): AllegroInboxSyncState {
  const row = db.prepare(`SELECT cursor_at, cursor_id, last_success_at,
    error_count, next_attempt_at FROM allegro_inbox_sync_state WHERE id=1`).get() as
    | { cursor_at: string | null; cursor_id: string | null; last_success_at: string | null;
        error_count: number; next_attempt_at: string | null }
    | undefined;
  return row ? { cursorAt: row.cursor_at, cursorId: row.cursor_id,
    lastSuccessAt: row.last_success_at, errorCount: row.error_count,
    nextAttemptAt: row.next_attempt_at } : {
    cursorAt: null, cursorId: null, lastSuccessAt: null, errorCount: 0, nextAttemptAt: null,
  };
}

export function stanSynchronizacjiHealth(db: Db, teraz = Date.now()) {
  const s = stanSynchronizacji(db);
  return {
    ostatniaUdanaSynchronizacja: s.lastSuccessAt,
    liczbaBledow: s.errorCount,
    opoznienieMs: s.lastSuccessAt ? Math.max(0, teraz - Date.parse(s.lastSuccessAt)) : null,
    nastepnaProba: s.nextAttemptAt,
  };
}
