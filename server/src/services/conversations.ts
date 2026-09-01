import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { publishConversationEvent } from "./conversation-realtime.js";

/**
 * Imię do dziennika bierzemy z konta, nie z parametru.
 *
 * `events.user_id` jest tekstem i do lipca 2026 przyjmował dowolny łańcuch
 * z nagłówka — stąd literówki i warianty tej samej osoby w audycie. Odczyt
 * z `app_user` zamyka tę drogę: mutacja i jej wpis mówią o tym samym koncie.
 */
function imieAutora(database: DatabaseSync, userId: number): string {
  const u = database.prepare("SELECT name FROM app_user WHERE user_id=?").get(userId) as
    { name: string } | undefined;
  return u?.name ?? `konto ${userId}`;
}

export class ConversationConflict extends Error {
  constructor(message: string, public readonly details: Record<string, unknown>) { super(message); }
}

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
  const id = wynik.changes === 0 ? null : Number(wynik.lastInsertRowid);
  if (id !== null) publishConversationEvent("message.created", dane.conversationId, { messageId: id });
  return id;
}

/**
 * Atomowe przejęcie: tylko jedna instrukcja UPDATE może zmienić wolny wiersz.
 *
 * Całość idzie transakcją, bo od 0.145.1 przejęcie zapisuje TRZY rzeczy naraz:
 * właściciela na rozmowie, wiersz historii przypisań i zdarzenie audytu.
 * Rozjazd między nimi znaczyłby rozmowę z właścicielem, którego nikt nie
 * przydzielił — a to dokładnie ten rodzaj ciszy, który kosztował 0.137.1.
 */
export function przejmijRozmowe(conversationId: number, userId: number, expectedVersion: number,
  database: DatabaseSync = db()) {
  const wynik = transaction(database, () => {
    const result = database.prepare(`UPDATE conversation
      SET assigned_user_id=?, version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND assigned_user_id IS NULL AND version=?`).run(userId, conversationId, expectedVersion);
    if (result.changes === 0) {
      const winner = database.prepare(`SELECT c.version, u.user_id, u.name FROM conversation c
        LEFT JOIN app_user u ON u.user_id=c.assigned_user_id WHERE c.id=?`).get(conversationId) as
        { version: number; user_id: number | null; name: string | null } | undefined;
      if (!winner) throw new Error("Nie znaleziono rozmowy");
      throw new ConversationConflict("Rozmowę przejął już inny agent", {
        assignedUserId: winner.user_id, assignedUserName: winner.name, version: winner.version,
      });
    }

    /* Historia przypisań jest osobnym bytem od pola `assigned_user_id`: pole
       mówi, KTO prowadzi teraz, a ta tabela — od kiedy i z czyjej ręki.
       Bez niej ekran przegranego wyścigu nie ma skąd wziąć czasu przejęcia. */
    database.prepare(`INSERT INTO conversation_assignment(conversation_id, assigned_to, assigned_by)
      VALUES (?,?,?)`).run(conversationId, userId, userId);

    const version = expectedVersion + 1;
    logEvent("rozmowa_przejeta", imieAutora(database, userId), null,
      { conversationId, wersjaPrzed: expectedVersion, wersjaPo: version }, undefined, database);
    return { conversationId, assignedUserId: userId, version };
  })();

  /* Zdarzenie do panelu leci PO transakcji: gdyby zapis się wycofał, panel
     dostałby wiadomość o przejęciu, którego nie ma w bazie. */
  publishConversationEvent("assignment.changed", conversationId,
    { assignedUserId: userId, version: wynik.version });
  return wynik;
}

export function zapiszSzkic(conversationId: number, userId: number, body: string,
  expectedLastMessageId: number | null, expectedVersion: number | null, database: DatabaseSync = db()) {
  return transaction(database, () => {
    const last = database.prepare("SELECT id FROM message WHERE conversation_id=? ORDER BY id DESC LIMIT 1")
      .get(conversationId) as { id: number } | undefined;
    if ((last?.id ?? null) !== expectedLastMessageId) throw new ConversationConflict(
      "Szkic powstał dla nieaktualnej osi rozmowy", { lastMessageId: last?.id ?? null });
    let result;
    if (expectedVersion === null) result = database.prepare(`INSERT INTO conversation_draft
      (conversation_id,body,expected_last_message_id,version,updated_by) VALUES (?,?,?,?,?)
      ON CONFLICT(conversation_id) DO NOTHING`).run(conversationId, body, expectedLastMessageId, 1, userId);
    else result = database.prepare(`UPDATE conversation_draft SET body=?, expected_last_message_id=?,
      version=version+1, updated_by=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE conversation_id=? AND version=?`).run(body, expectedLastMessageId, userId, conversationId, expectedVersion);
    if (result.changes === 0) {
      const current = database.prepare("SELECT version, updated_by FROM conversation_draft WHERE conversation_id=?")
        .get(conversationId) as { version: number; updated_by: number };
      throw new ConversationConflict("Szkic został zmieniony przez innego agenta", current);
    }
    const version = expectedVersion === null ? 1 : expectedVersion + 1;
    /* Do dziennika idzie DŁUGOŚĆ szkicu, nigdy jego treść: §19 zabrania
       wpuszczać treść wiadomości do ogólnego logu zdarzeń. Sam szkic i tak
       stoi w `conversation_draft`, więc audyt niczego tu nie traci. */
    logEvent("rozmowa_szkic_zapisany", imieAutora(database, userId), null,
      { conversationId, wersjaSzkicu: version, znakow: body.length }, undefined, database);
    return { conversationId, version, expectedLastMessageId };
  })();
}

export function dodajKomentarz(conversationId: number, authorUserId: number, body: string,
  mentionedUserIds: number[], database: DatabaseSync = db()) {
  if (!body.trim()) throw new Error("Komentarz nie może być pusty");
  return transaction(database, () => {
    const id = Number(database.prepare(`INSERT INTO conversation_comment(conversation_id,author_user_id,body)
      VALUES (?,?,?)`).run(conversationId, authorUserId, body.trim()).lastInsertRowid);
    const insert = database.prepare("INSERT OR IGNORE INTO conversation_mention(comment_id,user_id) VALUES (?,?)");
    const wzmianki = new Set(mentionedUserIds);
    for (const userId of wzmianki) insert.run(id, userId);
    /* Znowu bez treści — komentarz bywa równie wrażliwy co wiadomość klienta,
       a dziennik zdarzeń czyta się przy zupełnie innych sprawach. */
    logEvent("rozmowa_komentarz", imieAutora(database, authorUserId), null,
      { conversationId, komentarzId: id, znakow: body.trim().length, wzmianek: wzmianki.size },
      undefined, database);
    return { id, conversationId, authorUserId, body: body.trim(), mentionedUserIds: [...wzmianki] };
  })();
}

/** Granica adaptera: komentarze nie mogą zostać pomylone z wiadomością. */
export function payloadAllegroWiadomosci(messageId: number, database: DatabaseSync = db()) {
  const row = database.prepare("SELECT body FROM message WHERE id=? AND direction='outgoing'").get(messageId) as
    { body: string } | undefined;
  if (!row) throw new Error("Do Allegro można wysłać wyłącznie wiadomość wychodzącą");
  return { text: row.body };
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
  publishConversationEvent("warehouse.result", conversationId, { taskId: zadanieId, result: wynik });
}
