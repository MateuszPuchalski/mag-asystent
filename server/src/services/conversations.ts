import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import {
  jestStatusem, statusPoWiadomosciKlienta, zapiszStatusAutomatu, type StatusRozmowy,
} from "./statusy.js";

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
  /* Status przelicza się TYLKO przy nowym wierszu i tylko dla wiadomości od
     klienta. `changes === 0` znaczy „ta wiadomość już u nas była" — ponowna
     synchronizacja nie ma prawa otwierać zamkniętej rozmowy (blizna 0.128.0),
     a własna odpowiedź ustawia status w `wysylka.ts`, nie tutaj. */
  if (id !== null && dane.direction === "incoming") {
    statusPoWiadomosciKlienta(database, dane.conversationId);
  }
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
    /* Status idzie TYM SAMYM `UPDATE`-em co właściciel — osobny zapis mógłby
       trafić w rozmowę przejętą w międzyczasie przez kogoś innego. Przejęcie
       budzi też odłożoną rozmowę: ktoś przy niej właśnie usiadł. */
    const result = database.prepare(`UPDATE conversation
      SET assigned_user_id=?, status='open', snooze_do=NULL,
          version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND assigned_user_id IS NULL AND version=?`).run(userId, conversationId, expectedVersion);
    if (result.changes === 0) {
      /* Czas przejęcia bierze się z HISTORII przypisań, nie z `updated_at`
         rozmowy: ten drugi rusza się przy każdym zapisie szkicu i pokazywałby
         nie moment przejęcia, tylko ostatnią dowolną zmianę. */
      const winner = database.prepare(`SELECT c.version, u.user_id, u.name,
        (SELECT a.assigned_at FROM conversation_assignment a
          WHERE a.conversation_id=c.id AND a.unassigned_at IS NULL
          ORDER BY a.id DESC LIMIT 1) AS assigned_at
        FROM conversation c LEFT JOIN app_user u ON u.user_id=c.assigned_user_id
        WHERE c.id=?`).get(conversationId) as
        { version: number; user_id: number | null; name: string | null; assigned_at: string | null } | undefined;
      if (!winner) throw new Error("Nie znaleziono rozmowy");
      throw new ConversationConflict("Rozmowę przejął już inny agent", {
        assignedUserId: winner.user_id, assignedUserName: winner.name,
        assignedAt: winner.assigned_at, version: winner.version,
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

/**
 * Odebranie rozmowy agentowi, który ją prowadzi (§6.2, §19).
 *
 * Powód jest OBOWIĄZKOWY i to jest cała różnica między tą operacją a zwykłym
 * przejęciem. Rozmowa wraca do kolejki albo trafia do wskazanej osoby, a w
 * dzienniku zostaje kto, kiedy, z jakiej wersji na jaką i dlaczego.
 *
 * Bramkę roli trzyma trasa (`autoryzuj`), nie ten serwis — tak samo jak przy
 * domknięciu dostawy. Serwis pilnuje wersji i kompletu zapisu.
 */
export function przekazRozmowe(conversationId: number, autorId: number,
  doUserId: number | null, powod: string, expectedVersion: number,
  database: DatabaseSync = db()) {
  const uzasadnienie = (powod ?? "").trim();
  if (!uzasadnienie) throw new Error("Wymuszone przekazanie wymaga powodu");

  const wynik = transaction(database, () => {
    /* Przekazana rozmowa wraca do gry, więc dostaje `open` także wtedy, gdy
       idzie z powrotem do kolejki (`doUserId === null`) — nieprzypisana rozmowa
       w toku ma stać w kubełku nieprzypisanych, a nie zniknąć w załatwionych. */
    const result = database.prepare(`UPDATE conversation
      SET assigned_user_id=?, status='open', snooze_do=NULL,
          version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND version=?`).run(doUserId, conversationId, expectedVersion);
    if (result.changes === 0) {
      const teraz = database.prepare(`SELECT c.version, u.user_id, u.name FROM conversation c
        LEFT JOIN app_user u ON u.user_id=c.assigned_user_id WHERE c.id=?`).get(conversationId) as
        { version: number; user_id: number | null; name: string | null } | undefined;
      if (!teraz) throw new Error("Nie znaleziono rozmowy");
      throw new ConversationConflict("Rozmowa zmieniła się, zanim doszło przekazanie", {
        assignedUserId: teraz.user_id, assignedUserName: teraz.name, version: teraz.version,
      });
    }

    /* Poprzednie przypisanie się ZAMYKA, a nie znika: historia ma pokazać,
       komu sprawę odebrano, a nie tylko kto ma ją teraz. */
    database.prepare(`UPDATE conversation_assignment SET unassigned_at=
      strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE conversation_id=? AND unassigned_at IS NULL`)
      .run(conversationId);
    if (doUserId !== null) {
      database.prepare(`INSERT INTO conversation_assignment(conversation_id, assigned_to, assigned_by)
        VALUES (?,?,?)`).run(conversationId, doUserId, autorId);
    }

    const version = expectedVersion + 1;
    logEvent("rozmowa_przekazana_wymuszenie", imieAutora(database, autorId), null,
      { conversationId, doUserId, powod: uzasadnienie, wersjaPrzed: expectedVersion, wersjaPo: version },
      undefined, database);
    return { conversationId, assignedUserId: doUserId, version };
  })();

  publishConversationEvent("assignment.changed", conversationId,
    { assignedUserId: doUserId, version: wynik.version });
  return wynik;
}

/**
 * Ręczne wskazanie oferty przez agenta (makieta „brak powiązania z ofertą").
 *
 * Zapis idzie do `conversation_event`, NIE do `message.related_object_id`.
 * Tamto pole niesie fakt z Allegro; to jest wybór człowieka. §4.3 zabrania
 * mieszać źródła bez pokazania pochodzenia, a ekran ma umieć powiedzieć,
 * skąd wziął numer oferty.
 */
export function wskazOferte(conversationId: number, ofertaId: string, autorId: number,
  database: DatabaseSync = db()) {
  const numer = (ofertaId ?? "").trim();
  if (!/^\d{1,20}$/.test(numer)) throw new Error("Numer oferty Allegro to same cyfry");
  const autor = imieAutora(database, autorId);

  const wynik = transaction(database, () => {
    const jest = database.prepare("SELECT id FROM conversation WHERE id=?").get(conversationId);
    if (!jest) throw new Error("Nie znaleziono rozmowy");
    database.prepare(`INSERT INTO conversation_event(conversation_id, message_id, event_type, payload)
      VALUES (?, NULL, 'offer_linked_manually', json_object('ofertaId', ?, 'autor', ?))`)
      .run(conversationId, numer, autor);
    logEvent("rozmowa_oferta_wskazana", autor, null, { conversationId, ofertaId: numer },
      undefined, database);
    return { conversationId, ofertaId: numer, autor };
  })();

  publishConversationEvent("assignment.changed", conversationId, { ofertaId: numer });
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

/** Statusy, które wolno ustawić RĘKĄ. Reszta wynika z faktów (`statusy.ts`). */
const RECZNE: StatusRozmowy[] = ["open", "resolved", "closed", "spam"];

/**
 * Wspólne domknięcie zmiany statusu: wersja, audyt, zdarzenie do panelu.
 *
 * Ta sama kontrola wersji co przy przejęciu i przekazaniu — spóźniony agent
 * dostaje 409 z aktualnym stanem, zamiast po cichu nadpisać cudzą decyzję.
 * Zmiana ręczna PODBIJA `version`, w odróżnieniu od automatycznej: to jest
 * decyzja człowieka i ma unieważnić cudzą wysyłkę w toku.
 */
function zmienStatus(
  database: DatabaseSync, conversationId: number, autorId: number,
  status: StatusRozmowy, snoozeDo: string | null, powod: string | null,
  expectedVersion: number, zdarzenie: string,
) {
  const wynik = transaction(database, () => {
    const result = database.prepare(`UPDATE conversation
      SET status=?, snooze_do=?, version=version+1
      WHERE id=? AND version=?`).run(status, snoozeDo, conversationId, expectedVersion);
    if (result.changes === 0) {
      const teraz = database.prepare(`SELECT c.version, c.status, u.user_id, u.name
        FROM conversation c LEFT JOIN app_user u ON u.user_id=c.assigned_user_id
        WHERE c.id=?`).get(conversationId) as
        { version: number; status: string; user_id: number | null; name: string | null } | undefined;
      if (!teraz) throw new Error("Nie znaleziono rozmowy");
      throw new ConversationConflict("Rozmowa zmieniła się, zanim doszła zmiana statusu", {
        assignedUserId: teraz.user_id, assignedUserName: teraz.name,
        version: teraz.version, status: teraz.status,
      });
    }
    const version = expectedVersion + 1;
    logEvent(zdarzenie, imieAutora(database, autorId), null,
      { conversationId, status, snoozeDo, powod, wersjaPrzed: expectedVersion, wersjaPo: version },
      undefined, database);
    return { conversationId, status, snoozeDo, version };
  })();

  publishConversationEvent("assignment.changed", conversationId,
    { status: wynik.status, version: wynik.version });
  return wynik;
}

/**
 * Odłożenie rozmowy na później (§7 `snoozed`).
 *
 * Termin jest OBOWIĄZKOWY i musi być w przyszłości. Odłożenie bez terminu
 * byłoby ukrytym zamknięciem: rozmowa znika z kolejki i nie ma dnia, w którym
 * wraca. `snooze_do` w przeszłości znaczy dla odczytu „już wróciła", więc
 * przyjęcie takiego terminu dałoby przycisk, który nic nie robi.
 */
export function odlozRozmowe(conversationId: number, autorId: number, doKiedy: string,
  expectedVersion: number, database: DatabaseSync = db(), teraz = new Date()) {
  const kiedy = Date.parse(doKiedy ?? "");
  if (Number.isNaN(kiedy)) throw new Error("Odłożenie wymaga terminu powrotu");
  if (kiedy <= teraz.getTime()) throw new Error("Termin powrotu musi być w przyszłości");
  return zmienStatus(database, conversationId, autorId, "snoozed",
    new Date(kiedy).toISOString(), null, expectedVersion, "rozmowa_odlozona");
}

/**
 * Ręczna zmiana statusu: załatwione, zamknięte, spam i powrót do `open`.
 *
 * POWRÓT DO `open` JEST DROGĄ WYJŚCIA z każdej z tych decyzji i dlatego stoi
 * na tej samej trasie. Panel zwrotów kupił tę lekcję pierwszy: cofnięcie jest
 * tańsze od dialogu „czy na pewno", a dopóki nic nie poszło do Allegro, każdy
 * ruch ma mieć powrót.
 *
 * `new` i oba `waiting_*` są nie do ustawienia ręką — wynikają z faktów,
 * a wpisane z palca kłamałyby o tym, że coś się wydarzyło.
 */
export function ustawStatusRozmowy(conversationId: number, autorId: number,
  status: string, powod: string | null, expectedVersion: number,
  database: DatabaseSync = db()) {
  if (!jestStatusem(status) || !RECZNE.includes(status)) {
    throw new Error(`Statusu „${status}" nie ustawia się ręcznie`);
  }
  return zmienStatus(database, conversationId, autorId, status, null,
    (powod ?? "").trim() || null, expectedVersion, "rozmowa_status");
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
  /* Wynik z hali ZDEJMUJE `waiting_for_internal`: to na niego rozmowa czekała.
     Bez tego jedyne wyjście z tego statusu byłoby ręczne, a agent musiałby
     pamiętać o kliknięciu, którego nikt od niego nie oczekuje. */
  zapiszStatusAutomatu(database, conversationId, "open");
  publishConversationEvent("warehouse.result", conversationId, { taskId: zadanieId, result: wynik });
}
