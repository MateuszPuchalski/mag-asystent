import type { DatabaseSync } from "node:sqlite";
import { db, nowIso, transaction } from "../db/db.js";

export interface NowaWiadomosc {
  conversationId: number;
  channelAccountId: number;
  externalMessageId: string;
  direction: "incoming" | "outgoing";
  body: string;
  sentAt: string;
}

/** Zapis z synchronizacji. Unikalny klucz robi z ponownego przebiegu no-op. */
export function zapiszWiadomosc(dane: NowaWiadomosc, database: DatabaseSync = db()): number | null {
  const wynik = database.prepare(`
    INSERT INTO message(
      conversation_id, channel_account_id, external_message_id, direction, body, sent_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_account_id, external_message_id) DO NOTHING
  `).run(
    dane.conversationId,
    dane.channelAccountId,
    dane.externalMessageId,
    dane.direction,
    dane.body,
    dane.sentAt,
  );
  return wynik.changes === 0 ? null : Number(wynik.lastInsertRowid);
}

/**
 * Kończy zadanie i dopisuje jego wynik do osi rozmowy atomowo.
 * `message_id` celowo jest puste: wynik pracownika nie jest wiadomością klienta.
 */
export function zapiszWynikZadania(
  zadanieId: number,
  wynik: string,
  database: DatabaseSync = db(),
): void {
  transaction(database, () => {
    const zadanie = database.prepare(
      "SELECT conversation_id FROM zadanie_terenowe WHERE id = ?",
    ).get(zadanieId) as { conversation_id: number | null } | undefined;
    if (!zadanie) throw new Error("Nie znaleziono zadania terenowego");

    database.prepare(`
      UPDATE zadanie_terenowe
         SET status = 'done', wynik = ?, completed_at = ?
       WHERE id = ?
    `).run(wynik, nowIso(), zadanieId);
    if (zadanie.conversation_id !== null) {
      database.prepare(`
        INSERT INTO conversation_event(conversation_id, message_id, event_type, payload)
        VALUES (?, NULL, 'field_task_result', json_object('taskId', ?, 'result', ?))
      `).run(zadanie.conversation_id, zadanieId, wynik);
    }
  })();
}
