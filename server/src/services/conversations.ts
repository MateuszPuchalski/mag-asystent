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

    /* PRZEJĘCIE OTWIERA ROZMOWĘ (§7, 0.158.0). Rozmowa, którą ktoś wziął, nie
       jest już `new`; wymaganie osobnego kliknięcia w status robiłoby z niego
       biurokrację, którą agenci zaczną pomijać. Stany końcowe zostają
       nietknięte: przejęcie sprawy zamkniętej jej nie wskrzesza.

       Zapis idzie PO wpisie o przejęciu i to nie jest przypadek: audyt czyta
       się z góry na dół, a status zmieniony przed przejęciem opowiadałby, że
       rozmowa otworzyła się sama, zanim ktokolwiek ją wziął. */
    const przedPrzejeciem = statusRozmowy(database, conversationId);
    if (przedPrzejeciem === "new") {
      database.prepare("UPDATE conversation SET status='open' WHERE id=?").run(conversationId);
      zapiszZmianeStatusu(database, conversationId, przedPrzejeciem, "open",
        imieAutora(database, userId), userId);
    }
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
    const result = database.prepare(`UPDATE conversation
      SET assigned_user_id=?, version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
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
     pamiętać o kliknięciu, którego nikt od niego nie oczekuje.

     Bez własnej transakcji — `wykonajZadanie` stoi już w swojej, tak samo jak
     synchronizator przy `obudzPrzychodzaca`. Autorem jest HALA, nie agent:
     to jej pomiar zmienił stan sprawy. */
  const przedWynikiem = statusRozmowy(database, conversationId);
  if (przedWynikiem === "waiting_for_internal") {
    database.prepare("UPDATE conversation SET status='open', snoozed_until=NULL WHERE id=?")
      .run(conversationId);
    zapiszZmianeStatusu(database, conversationId, przedWynikiem, "open", "hala", undefined);
  }
  publishConversationEvent("warehouse.result", conversationId, { taskId: zadanieId, result: wynik });
}

/* ── Statusy rozmowy §7 (0.158.0) ────────────────────────────────────────────
   Do tego wydania `conversation` nie miała kolumny statusu. Kolejka nie
   odróżniała sprawy załatwionej od nietkniętej, a rozmowa raz otwarta rosła
   w nieskończoność — §26 pyta „kiedy zamykamy rozmowę", a nie było czego
   zamykać.

   Lista pochodzi wprost z §7 i jest ZAMKNIĘTA. Status spoza niej znaczyłby,
   że ktoś dołożył pojęcie, którego dokument nie zna.                        */

export const STATUSY_ROZMOWY = ["new", "open", "waiting_for_customer",
  "waiting_for_internal", "snoozed", "resolved", "closed", "spam"] as const;
export type StatusRozmowy = (typeof STATUSY_ROZMOWY)[number];

/**
 * Stany, z których PRZYCHODZĄCA wiadomość budzi rozmowę.
 *
 * To jest sedno całego wydania. Klient dopisuje pytanie do sprawy, którą biuro
 * uznało za załatwioną; bez tego przejścia rozmowa zostaje na liście
 * „rozwiązane" i nikt do niej nie zagląda. Status, który nie wraca sam, jest
 * gorszy od jego braku — wygląda jak porządek i nim nie jest.
 *
 * `closed` i `spam` NIE budzą się. To są jawne werdykty człowieka, a automat,
 * który je cofa, kazałby zamykać tę samą rozmowę w kółko.
 */
const BUDZONE: ReadonlySet<string> = new Set([
  "new", "open", "waiting_for_customer", "waiting_for_internal", "snoozed", "resolved",
]);

/**
 * Status WYLICZANY, nie tylko odczytany.
 *
 * Odłożenie kończy się samo po terminie i liczymy to przy odczycie, zamiast
 * budzić rozmowy tickerem. Stan wyliczalny nie potrzebuje procesu, który go
 * pilnuje — a ticker, który raz nie wstanie, zostawiłby rozmowy odłożone
 * na zawsze.
 */
export function statusRozmowy(
  database: DatabaseSync, conversationId: number, teraz = Date.now(),
): StatusRozmowy {
  const r = database.prepare("SELECT status, snoozed_until FROM conversation WHERE id=?")
    .get(conversationId) as { status: string; snoozed_until: string | null } | undefined;
  if (!r) throw new Error("Nie znaleziono rozmowy");
  if (r.status === "snoozed" && r.snoozed_until && Date.parse(r.snoozed_until) <= teraz) {
    return "open";
  }
  return r.status as StatusRozmowy;
}

/** Zmiana statusu ręką agenta. `doKiedy` wymagane wyłącznie przy odłożeniu. */
export function ustawStatus(
  database: DatabaseSync, conversationId: number, status: StatusRozmowy,
  userId: number, doKiedy: string | null, teraz = new Date(),
): { status: StatusRozmowy; snoozedUntil: string | null } {
  if (!STATUSY_ROZMOWY.includes(status)) {
    throw new Error(`Nieznany status rozmowy: ${status}. Lista stoi w §7 projektu panelu.`);
  }
  if (status === "snoozed") {
    if (!doKiedy || !Number.isFinite(Date.parse(doKiedy))) {
      throw new Error("Odłożenie wymaga terminu — §7 nie zna rozmowy odłożonej na zawsze.");
    }
  }
  return transaction(database, () =>
    zmienStatus(database, conversationId, status, userId, doKiedy, teraz))();
}

/**
 * Rdzeń zmiany statusu BEZ własnej transakcji.
 *
 * Rozdzielenie nie jest kosmetyką. Dwaj wołający — synchronizator i wysyłka —
 * pracują JUŻ WEWNĄTRZ transakcji, a `BEGIN` w `BEGIN` SQLite odrzuca. Przy
 * pierwszym podejściu ta funkcja otwierała transakcję zawsze i cała
 * synchronizacja przestała cokolwiek zapisywać: wyjątek wpadał w izolację
 * wątku z 0.149.2 i każdy wątek lądował jako „zepsuty".
 *
 * Kto woła spoza transakcji, bierze `ustawStatus`; kto z wewnątrz — to.
 */
export function zmienStatus(
  database: DatabaseSync, conversationId: number, status: StatusRozmowy,
  userId: number, doKiedy: string | null, teraz = new Date(),
): { status: StatusRozmowy; snoozedUntil: string | null } {
  const przed = statusRozmowy(database, conversationId, teraz.getTime());
  database.prepare("UPDATE conversation SET status=?, snoozed_until=? WHERE id=?")
    .run(status, status === "snoozed" ? doKiedy : null, conversationId);
  zapiszZmianeStatusu(database, conversationId, przed, status, imieAutora(database, userId), userId);
  return { status, snoozedUntil: status === "snoozed" ? doKiedy : null };
}

/**
 * Przychodząca wiadomość budzi rozmowę.
 *
 * Wołane przez synchronizator przy KAŻDEJ nowej wiadomości klienta. Gdy status
 * i tak jest budzący i już równy `open`, nie zapisujemy nic — inaczej oś
 * zapełniłaby się zmianami z niczego na nic.
 */
export function obudzPrzychodzaca(
  database: DatabaseSync, conversationId: number, teraz = new Date(),
): void {
  const przed = statusRozmowy(database, conversationId, teraz.getTime());
  if (!BUDZONE.has(przed) || przed === "open") return;
  /* BEZ własnej transakcji — woła to synchronizator, który stoi już w swojej
     (patrz `zmienStatus`). */
  database.prepare("UPDATE conversation SET status='open', snoozed_until=NULL WHERE id=?")
    .run(conversationId);
  /* Autorem jest KLIENT, nie agent: to jego wiadomość zmieniła stan sprawy.
     Podpisanie tego agentem kłamałoby w audycie o tym, kto co zrobił. */
  zapiszZmianeStatusu(database, conversationId, przed, "open", "klient", undefined);
}

function zapiszZmianeStatusu(
  database: DatabaseSync, conversationId: number, przed: string, po: string,
  autor: string, userId: number | undefined,
): void {
  if (przed === po) return;
  /* §10.3 wymienia zmianę statusu wśród rzeczy, które ma nieść oś rozmowy. */
  database.prepare(`INSERT INTO conversation_event(conversation_id, event_type, payload)
    VALUES (?, 'status_changed', ?)`).run(conversationId, JSON.stringify({ przed, po, autor }));
  logEvent("rozmowa_status", autor, null, { conversationId, przed, po }, userId, database);
}
