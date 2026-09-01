import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-skrzynka-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* Trasy skrzynki nie miały testu do 0.145.1. Pilnują tu dwóch rzeczy, których
   test serwisu nie złapie, bo obie żyją na granicy HTTP:

   1. BRAMKA ROLI TAKŻE NA ODCZYCIE. Polityka danych skrzynki mówi wprost, że
      rozmowy z klientami są danymi biura, a hala widzi wyłącznie zadanie.
      Trasa odczytu bez bramki wyglądałaby na niewinną i przeciekłaby cicho.
   2. ZERO ZAPISU PRZY PATRZENIU. Reguła z 0.18.0 obowiązuje też panel obsługi,
      choć licznik `method:` w `biuro.test.ts` obejmuje wyłącznie `biuro.html`. */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let rozmowa = 0;
let pytanie = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["conversation_mention", "conversation_comment", "conversation_draft",
    "conversation_assignment", "conversation_event", "message", "conversation",
    "channel_account", "zadanie_terenowe", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'w-1','Kupujący 44300444')`)
    .run(konto).lastInsertRowid);
  pytanie = Number(d.prepare(`INSERT INTO message(conversation_id,channel_account_id,
    external_message_id,direction,body,sent_at) VALUES (?,?,'m-1','incoming',?,?)`)
    .run(rozmowa, konto, "Czy ten szarpak pasuje do NAC LS 46-450?",
      "2026-09-01T07:12:00.000Z").lastInsertRowid);
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { naglowki: { "x-session": token }, userId: u.userId };
}

const liczbaZdarzen = () =>
  (db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n;

/** Komplet tras skrzynki — lista rośnie razem z nimi i tak ma być. */
const TRASY = () => [
  { method: "GET" as const, url: "/api/obsluga/rozmowy" },
  { method: "GET" as const, url: `/api/obsluga/rozmowy/${rozmowa}` },
  { method: "POST" as const, url: "/api/obsluga/zadania/pomiar",
    payload: { rozmowaId: rozmowa, wiadomoscId: pytanie, instrukcja: "Zmierz rozstaw." } },
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/claim`, payload: { expectedVersion: 1 } },
  { method: "PUT" as const, url: `/api/conversations/${rozmowa}/draft`,
    payload: { body: "Szkic", expectedLastMessageId: null, expectedVersion: null } },
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/comments`, payload: { body: "Uwaga" } },
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/presence`, payload: { typing: true } },
  { method: "GET" as const, url: "/api/conversations/events" },
  { method: "POST" as const, url: "/api/obsluga/synchronizuj" },
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/assign`,
    payload: { doUserId: null, powod: "urlop", expectedVersion: 1 } },
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/oferta`,
    payload: { ofertaId: "14892374512" } },
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/send`,
    payload: { body: "Odpowiedź", expectedVersion: 1, expectedLastMessageId: null } },
  /* Status rozmowy (0.157.0): trzy trasy zapisu więcej. Każda jest DECYZJĄ
     człowieka — odłożenie z terminem, załatwienie jednym kliknięciem i reszta
     razem z powrotem do `open`. Automat swoje statusy zapisuje przy okazji
     faktów (wysyłka, pomiar, wynik z hali), bez własnej trasy. */
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/snooze`,
    payload: { do: "2027-01-04T08:00:00.000Z", expectedVersion: 1 } },
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/resolve`,
    payload: { expectedVersion: 1 } },
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/status`,
    payload: { status: "spam", expectedVersion: 1 } },
];

test("bez sesji żadna trasa skrzynki nie odpowiada danymi", async () => {
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, payload: t.payload });
    assert.equal(r.statusCode, 401, `${t.method} ${t.url} przepuścił brak sesji`);
  }
});

test("magazynier nie widzi rozmów — także na odczycie", async () => {
  const m = login("magazynier", "Marek");
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, headers: m.naglowki, payload: t.payload });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url} wpuścił halę`);
  }
});

test("patrzenie na skrzynkę niczego nie zapisuje", async () => {
  const b = login("biuro", "Anna");
  const przed = liczbaZdarzen();
  for (const url of ["/api/obsluga/rozmowy", `/api/obsluga/rozmowy/${rozmowa}`]) {
    const r = await app.inject({ method: "GET", url, headers: b.naglowki });
    assert.equal(r.statusCode, 200, r.body);
  }
  assert.equal(liczbaZdarzen(), przed, "odczyt dopisał zdarzenie");
  assert.equal((db().prepare("SELECT count(*) n FROM conversation_assignment").get() as {n:number}).n, 0);
});

test("przegrany wyścig o przejęcie dostaje 409 z właścicielem i wersją", async () => {
  const ala = login("biuro", "A. Lewandowska");
  const marek = login("biuro", "M. Wójcik");

  let r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/claim`,
    headers: ala.naglowki, payload: { expectedVersion: 1 } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().version, 2);

  r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/claim`,
    headers: marek.naglowki, payload: { expectedVersion: 1 } });
  assert.equal(r.statusCode, 409, "konflikt wersji ma być 409, nie 400");
  /* Te trzy pola rysuje ekran przegranego: kto prowadzi, pod jakim kontem
     i na której wersji stoi rozmowa. Bez nich zostaje goły komunikat błędu. */
  assert.equal(r.json().assignedUserId, ala.userId);
  assert.equal(r.json().assignedUserName, "A. Lewandowska");
  assert.equal(r.json().version, 2);
});

test("szkic pisany do starej osi odpada z 409, a zapisany zostaje", async () => {
  const b = login("biuro", "Anna");
  await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/claim`,
    headers: b.naglowki, payload: { expectedVersion: 1 } });
  let r = await app.inject({ method: "PUT", url: `/api/conversations/${rozmowa}/draft`,
    headers: b.naglowki, payload: { body: "Pierwsza wersja", expectedLastMessageId: pytanie, expectedVersion: null } });
  assert.equal(r.statusCode, 200, r.body);

  /* Klient dopisuje w trakcie redagowania — blizna 0.110.0. */
  const konto = (db().prepare("SELECT channel_account_id k FROM conversation WHERE id=?")
    .get(rozmowa) as { k: number }).k;
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,sent_at) VALUES (?,?,'m-2','incoming','Dopisuję: rocznik 2019.',?)`)
    .run(rozmowa, konto, "2026-09-01T09:38:00.000Z");

  r = await app.inject({ method: "PUT", url: `/api/conversations/${rozmowa}/draft`,
    headers: b.naglowki, payload: { body: "Druga wersja", expectedLastMessageId: pytanie, expectedVersion: 1 } });
  assert.equal(r.statusCode, 409, r.body);

  const szkic = db().prepare("SELECT body FROM conversation_draft WHERE conversation_id=?")
    .get(rozmowa) as { body: string };
  assert.equal(szkic.body, "Pierwsza wersja", "409 nie ma prawa skasować szkicu");
});

test("mutacje przez trasę zostawiają ślad w dzienniku", async () => {
  const b = login("biuro", "Anna");
  await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/claim`,
    headers: b.naglowki, payload: { expectedVersion: 1 } });
  await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/comments`,
    headers: b.naglowki, payload: { body: "Sprawdzić rozstaw." } });

  const typy = (db().prepare(
    "SELECT type FROM events WHERE type LIKE 'rozmowa_%' ORDER BY id").all() as Array<{type:string}>)
    .map((w) => w.type);
  assert.deepEqual(typy, ["rozmowa_przejeta", "rozmowa_komentarz"]);
});

test("wymuszone przekazanie wymaga administratora, nie samego biura", async () => {
  const b = login("biuro", "Anna");
  const r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/assign`,
    headers: b.naglowki, payload: { doUserId: null, powod: "urlop", expectedVersion: 1 } });
  assert.equal(r.statusCode, 403);
  assert.match(r.json().error, /administratora/);
});

test("wymuszone przekazanie bez powodu nie przechodzi", async () => {
  const a = login("admin", "Admin");
  const r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/assign`,
    headers: a.naglowki, payload: { doUserId: null, powod: "   ", expectedVersion: 1 } });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /powodu/);
});

test("wymuszone przekazanie zamyka stare przypisanie i zapisuje powód", async () => {
  const ala = login("biuro", "A. Lewandowska");
  const admin = login("admin", "Admin");
  await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/claim`,
    headers: ala.naglowki, payload: { expectedVersion: 1 } });

  const r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/assign`,
    headers: admin.naglowki, payload: { doUserId: null, powod: "A. Lewandowska na urlopie", expectedVersion: 2 } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().assignedUserId, null, "rozmowa wraca do kolejki");
  assert.equal(r.json().version, 3);

  /* Historia ma pokazać, komu sprawę odebrano — nie tylko kto ma ją teraz. */
  const przypisania = db().prepare(`SELECT assigned_to, unassigned_at
    FROM conversation_assignment WHERE conversation_id=?`).all(rozmowa) as
    Array<{ assigned_to: number; unassigned_at: string | null }>;
  assert.equal(przypisania.length, 1);
  assert.ok(przypisania[0].unassigned_at, "poprzednie przypisanie zostało zamknięte");

  const wpis = db().prepare(
    "SELECT payload FROM events WHERE type='rozmowa_przekazana_wymuszenie'").get() as { payload: string };
  const p = JSON.parse(wpis.payload);
  assert.equal(p.powod, "A. Lewandowska na urlopie");
  assert.equal(p.wersjaPrzed, 2);
  assert.equal(p.wersjaPo, 3);
});

test("ręcznie wskazana oferta ląduje na osi jako wybór agenta, nie fakt z Allegro", async () => {
  const b = login("biuro", "Anna");
  const r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/oferta`,
    headers: b.naglowki, payload: { ofertaId: "14892374512" } });
  assert.equal(r.statusCode, 200, r.body);

  const zd = db().prepare(`SELECT event_type, payload FROM conversation_event
    WHERE conversation_id=?`).get(rozmowa) as { event_type: string; payload: string };
  assert.equal(zd.event_type, "offer_linked_manually");
  assert.equal(JSON.parse(zd.payload).autor, "Anna", "ekran ma umieć powiedzieć, kto wskazał");

  /* Pole `message.related_object_id` niesie fakt z Allegro i ma zostać puste. */
  const m = db().prepare("SELECT related_object_id r FROM message WHERE id=?")
    .get(pytanie) as { r: string | null };
  assert.equal(m.r, null, "wybór agenta nie podszywa się pod dane kanału");
});

test("numer oferty spoza cyfr odpada", async () => {
  const b = login("biuro", "Anna");
  const r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/oferta`,
    headers: b.naglowki, payload: { ofertaId: "szarpak do NAC" } });
  assert.equal(r.statusCode, 400);
});

test("ręczna synchronizacja bez sparowanego konta mówi wprost, czego brakuje", async () => {
  const b = login("biuro", "Anna");
  const r = await app.inject({ method: "POST", url: "/api/obsluga/synchronizuj", headers: b.naglowki });
  /* W testach konto Allegro nie jest sparowane, więc trasa ma odpaść PRZED
     jakimkolwiek zapytaniem do sieci — testy tras nie strzelają do Allegro. */
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /nie jest sparowane/);
});

/* Trasa wysyłki jest sprawdzana WYŁĄCZNIE na ścieżkach konfliktu: wszystkie
   odpadają, zanim cokolwiek poleci do Allegro. Udaną wysyłkę pokrywa
   `services/wysylka.test.ts` z podstawionym adapterem — testy tras nie
   strzelają do Allegro. */
test("nie wyśle ten, kto nie prowadzi rozmowy", async () => {
  /* Od 0.158.0 rozmowa NIEPRZYPISANA idzie do wysyłki bez osobnego przejęcia
     (przydziela ją sama odpowiedź). Blokadą zostaje trwały właściciel: gdy
     rozmowę prowadzi kto inny, odpowiedź nie wychodzi. */
  const ala = login("biuro", "A. Lewandowska");
  const marek = login("biuro", "M. Wójcik");
  const przejecie = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/claim`,
    headers: ala.naglowki, payload: { expectedVersion: 1 } });
  assert.equal(przejecie.statusCode, 200, przejecie.body);

  const r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/send`,
    headers: marek.naglowki,
    payload: { body: "Pasuje.", expectedVersion: 2, expectedLastMessageId: pytanie } });
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /najpierw ją przejmij/);
});

test("dopisek klienta zatrzymuje wysyłkę i oddaje panelowi wszystko, czego trzeba", async () => {
  const b = login("biuro", "Anna");
  await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/claim`,
    headers: b.naglowki, payload: { expectedVersion: 1 } });

  const konto = (db().prepare("SELECT channel_account_id k FROM conversation WHERE id=?")
    .get(rozmowa) as { k: number }).k;
  const dopisek = Number(db().prepare(`INSERT INTO message(conversation_id,channel_account_id,
    external_message_id,direction,body,sent_at) VALUES (?,?,'m-88903','incoming',?,?)`)
    .run(rozmowa, konto, "Dopisuję: rocznik 2019.", "2026-09-01T09:38:00.000Z").lastInsertRowid);

  const r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/send`,
    headers: b.naglowki,
    payload: { body: "Pasuje.", expectedVersion: 2, expectedLastMessageId: pytanie } });
  assert.equal(r.statusCode, 409, r.body);

  /* Dokładnie te pola rysują dialog konfliktu z makiety. */
  const d = r.json();
  assert.equal(d.lastMessageId, dopisek);
  assert.equal(d.nowaWiadomosc.tresc, "Dopisuję: rocznik 2019.");
  assert.match(d.kluczIdempotencji, /^snd-/);
  assert.equal((db().prepare("SELECT count(*) n FROM outbox").get() as {n:number}).n, 0,
    "odrzucona wysyłka nie zostawia wiersza w kolejce");
});

test("konflikt świeżości zostawia ślad w dzienniku", async () => {
  const b = login("biuro", "Anna");
  await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/claim`,
    headers: b.naglowki, payload: { expectedVersion: 1 } });
  const konto = (db().prepare("SELECT channel_account_id k FROM conversation WHERE id=?")
    .get(rozmowa) as { k: number }).k;
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,sent_at) VALUES (?,?,'m-88903','incoming','Dopisek',?)`)
    .run(rozmowa, konto, "2026-09-01T09:38:00.000Z");

  await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/send`,
    headers: b.naglowki,
    payload: { body: "Pasuje.", expectedVersion: 2, expectedLastMessageId: pytanie } });

  /* §19 wymienia konflikt świeżości wśród operacji objętych audytem. */
  const n = (db().prepare(
    "SELECT count(*) n FROM events WHERE type='rozmowa_wysylka_konflikt'").get() as {n:number}).n;
  assert.equal(n, 1);
});

test("pobranie załącznika: rola, stan i nieznane id", async () => {
  /* Trzy odmowy, każda z innego powodu i każda z innym kodem — bo agent
     czytający ekran ma odróżnić „nie wolno ci" od „nie ma czego pobrać". */
  const d = db();
  const zal = Number(d.prepare(`INSERT INTO message_attachment
    (message_id,file_name,mime_type,url,status)
    VALUES (?,?,?,?,?)`).run(pytanie, "wirus.exe", "application/octet-stream",
      "https://upload.allegro.pl/a", "UNSAFE").lastInsertRowid);

  const bezSesji = await app.inject({ method: "GET", url: `/api/obsluga/zalaczniki/${zal}` });
  assert.equal(bezSesji.statusCode, 401);

  const hala = login("magazynier", "Hala");
  const zHali = await app.inject({ method: "GET", url: `/api/obsluga/zalaczniki/${zal}`,
    headers: hala.naglowki });
  assert.equal(zHali.statusCode, 403, "rozmowy z klientami nie są dla hali");

  const biuro = login("biuro", "Biuro");
  const niebezpieczny = await app.inject({ method: "GET",
    url: `/api/obsluga/zalaczniki/${zal}`, headers: biuro.naglowki });
  assert.equal(niebezpieczny.statusCode, 409, "UNSAFE nie ma prawa się pobrać");
  assert.match(niebezpieczny.json().error, /UNSAFE/);

  const nieznany = await app.inject({ method: "GET",
    url: "/api/obsluga/zalaczniki/99999", headers: biuro.naglowki });
  assert.equal(nieznany.statusCode, 404);
});

test("odłożenie, załatwienie i powrót chodzą jedną drogą i pilnują wersji", async () => {
  const b = login("biuro", "Anna");
  const wersja = () => (db().prepare("SELECT version FROM conversation WHERE id=?")
    .get(rozmowa) as { version: number }).version;

  let r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/snooze`,
    headers: b.naglowki, payload: { do: "2027-01-04T08:00:00.000Z", expectedVersion: wersja() } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "snoozed");
  assert.equal(r.json().snoozeDo, "2027-01-04T08:00:00.000Z");

  r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/resolve`,
    headers: b.naglowki, payload: { expectedVersion: wersja() } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "resolved");

  /* POWRÓT do `open` idzie tą samą trasą co reszta — cofnięcie jest tańsze
     od dialogu „czy na pewno" i dlatego nie ma własnego przycisku-wyjątku. */
  r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/status`,
    headers: b.naglowki, payload: { status: "open", expectedVersion: wersja() } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "open");

  /* Spóźniony agent dostaje 409 ze stanem, a nie ciche nadpisanie cudzej
     decyzji — tak samo jak przy przejęciu i przy wysyłce. */
  r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/resolve`,
    headers: b.naglowki, payload: { expectedVersion: 1 } });
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().status, "open");
});

test("statusu automatu nie da się wpisać żądaniem", async () => {
  /* Trasa jest równie ważną granicą co serwis: `waiting_for_customer` wpisane
     żądaniem kłamałoby o tym, że odpowiedź poszła do klienta. */
  const b = login("biuro", "Anna");
  const wersja = (db().prepare("SELECT version FROM conversation WHERE id=?")
    .get(rozmowa) as { version: number }).version;
  const r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/status`,
    headers: b.naglowki, payload: { status: "waiting_for_customer", expectedVersion: wersja } });
  assert.equal(r.statusCode, 400, r.body);
  assert.match(r.json().error, /nie ustawia się ręcznie/);
});

test("wejście w rozmowę trzyma ją, ale nie zapisuje ani jednego wiersza", async () => {
  /* Sedno decyzji właściciela: wejście przydziela rozmowę NA CZAS SIEDZENIA.
     Cały uchwyt żyje w pamięci procesu (§6.3), więc mimo trasy `POST` do bazy
     nie idzie nic — „zero zapisu przy patrzeniu" zostaje nienaruszone. */
  const ala = login("biuro", "A. Lewandowska");
  const przed = liczbaZdarzen();

  let r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/presence`,
    headers: ala.naglowki, payload: {} });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().trzyma.userId, ala.userId);

  assert.equal(liczbaZdarzen(), przed, "wejście w rozmowę dopisało zdarzenie do dziennika");
  assert.equal((db().prepare("SELECT assigned_user_id FROM conversation WHERE id=?")
    .get(rozmowa) as { assigned_user_id: number | null }).assigned_user_id, null,
    "uchwyt nie ma prawa dotknąć kolumny właściciela");

  /* Widać go w kolejce — inaczej kolega nie miałby skąd wiedzieć, że ktoś
     już przy tym pytaniu siedzi. */
  r = await app.inject({ method: "GET", url: "/api/obsluga/rozmowy", headers: ala.naglowki });
  const wiersz = r.json().rozmowy.find((x: { id: number }) => x.id === rozmowa);
  assert.equal(wiersz.oglada.name, "A. Lewandowska");

  /* Wyjście puszcza uchwyt natychmiast, nie po czasie. */
  r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/presence`,
    headers: ala.naglowki, payload: { obecny: false } });
  assert.equal(r.json().trzyma, null);
});
