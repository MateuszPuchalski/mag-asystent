import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";

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
 * Dopisuje wynik zadania terenowego na oś rozmowy.
 *
 * `message_id` celowo zostaje puste: wynik pracownika jest osobnym faktem,
 * a nie wiadomością klienta — treści klienta nic tu nie nadpisuje.
 *
 * Zapisem zadania steruje `wykonajZadanie` z `zadania-terenowe.ts` i to ono
 * woła tę funkcję wewnątrz swojej transakcji. Osobna ścieżka „zakończ zadanie"
 * istniała w pierwotnej wersji tej zmiany i została usunięta: omijała bramkę
 * własności (wynik mógł zapisać ktoś, kto zadania nie przejął) oraz `logEvent`,
 * którego CLAUDE.md wymaga od każdej mutacji.
 */
export function dopiszZdarzenieWyniku(
  conversationId: number,
  zadanieId: number,
  wynik: string,
  database: DatabaseSync = db(),
): void {
  database.prepare(`
    INSERT INTO conversation_event(conversation_id, message_id, event_type, payload)
    VALUES (?, NULL, 'field_task_result', json_object('taskId', ?, 'result', ?))
  `).run(conversationId, zadanieId, wynik);
}
