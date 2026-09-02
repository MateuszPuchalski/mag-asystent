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
  /* Sprawy PRZED użytkownikami: `sprawa_klienta.utworzyl` wskazuje na
     `app_user` bez kaskady. Do 0.181.0 test spraw był ostatni w pliku, więc
     brak tych dwóch nazw nie wywracał niczego — każdy test dopisany po nim
     padał w `beforeEach` na kluczu obcym. */
  for (const t of ["sprawa_klienta_rozmowa", "sprawa_klienta",
    "conversation_mention", "conversation_comment", "conversation_draft",
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
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/kartoteka`,
    payload: { ofertaId: "14892374512", twId: null } },
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/send`,
    payload: { body: "Odpowiedź", expectedVersion: 1, expectedLastMessageId: null } },
  { method: "POST" as const, url: `/api/obsluga/rozmowy/${rozmowa}/status`,
    payload: { status: "resolved" } },
  { method: "POST" as const, url: `/api/obsluga/rozmowy/${rozmowa}/priorytet`,
    payload: { priorytet: "pilny" } },
  { method: "GET" as const, url: "/api/obsluga/wzmianki" },
  { method: "GET" as const, url: "/api/obsluga/sprawy" },
  { method: "POST" as const, url: "/api/obsluga/sprawy",
    payload: { tytul: "Szarpak", rozmowaId: rozmowa } },
  { method: "POST" as const, url: "/api/obsluga/sprawy/1/rozmowy", payload: { rozmowaId: rozmowa } },
  { method: "POST" as const, url: `/api/obsluga/rozmowy/${rozmowa}/odlacz` },
  { method: "POST" as const, url: "/api/obsluga/wzmianki/1/odhacz" },
  { method: "GET" as const, url: `/api/obsluga/rozmowy/${rozmowa}/dobor/kandydaci` },
  { method: "PUT" as const, url: `/api/obsluga/rozmowy/${rozmowa}/dobor/dane`,
    payload: { dane: { marka: "NAC" }, expectedVersion: 1 } },
  { method: "POST" as const, url: `/api/obsluga/rozmowy/${rozmowa}/dobor/status`,
    payload: { status: "searching" } },
  { method: "POST" as const, url: `/api/obsluga/rozmowy/${rozmowa}/dobor/wybor`,
    payload: { twId: null, droga: "oferta", expectedVersion: 1 } },
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
  /* `rozmowa_status` doszło w 0.158.0: przejęcie otwiera rozmowę, więc zostawia
     DWA ślady — o przejęciu i o zmianie stanu. Kolejność jest znacząca, bo
     audyt czyta się z góry na dół: status zmieniony przed przejęciem
     opowiadałby, że rozmowa otworzyła się sama. */
  assert.deepEqual(typy, ["rozmowa_przejeta", "rozmowa_status", "rozmowa_komentarz"]);
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
  /* Od 0.159.0 rozmowa NIEPRZYPISANA idzie do wysyłki bez osobnego przejęcia:
     przydziela ją sama odpowiedź. Blokadą zostaje trwały właściciel — gdy
     rozmowę prowadzi kto inny, odpowiedź nie wychodzi. */
  const ala = login("biuro", "A. Lewandowska");
  const marek = login("biuro", "M. Wójcik");
  const wersja = () => (db().prepare("SELECT version FROM conversation WHERE id=?")
    .get(rozmowa) as { version: number }).version;
  const przejecie = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/claim`,
    headers: ala.naglowki, payload: { expectedVersion: wersja() } });
  assert.equal(przejecie.statusCode, 200, przejecie.body);

  const r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/send`,
    headers: marek.naglowki,
    payload: { body: "Pasuje.", expectedVersion: wersja(), expectedLastMessageId: pytanie } });
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

test("zmiana statusu: nieznana nazwa i odłożenie bez terminu odpadają", async () => {
  /* Dwa różne błędy o tym samym kodzie, bo oba są pomyłką wołającego, nie
     stanem rozmowy. Trasa sprawdza NAZWĘ (lista §7 jest zamknięta), a serwis
     TERMIN — i tylko test przez HTTP pokazuje, że obie bramki naprawdę stoją
     na drodze żądania, a nie tylko w kodzie obok. */
  const b = login("biuro", "Anna");

  const zmyslony = await app.inject({ method: "POST",
    url: `/api/obsluga/rozmowy/${rozmowa}/status`, headers: b.naglowki,
    payload: { status: "zalatwione" } });
  assert.equal(zmyslony.statusCode, 400);
  assert.match(zmyslony.json().error, /waiting_for_customer/, "błąd ma wymienić dozwolone stany");

  const bezTerminu = await app.inject({ method: "POST",
    url: `/api/obsluga/rozmowy/${rozmowa}/status`, headers: b.naglowki,
    payload: { status: "snoozed" } });
  assert.equal(bezTerminu.statusCode, 400);

  const stan = db().prepare("SELECT status FROM conversation WHERE id=?").get(rozmowa) as
    { status: string };
  assert.equal(stan.status, "new", "odrzucone żądanie nie ma prawa ruszyć rozmowy");

  const dobre = await app.inject({ method: "POST",
    url: `/api/obsluga/rozmowy/${rozmowa}/status`, headers: b.naglowki,
    payload: { status: "snoozed", doKiedy: "2026-09-08T07:00:00.000Z" } });
  assert.equal(dobre.statusCode, 200, dobre.body);
  assert.equal(dobre.json().snoozedUntil, "2026-09-08T07:00:00.000Z");
});

test("skrzynka wzmianek pokazuje swoje, nie cudze, i odhacza jawnym kliknięciem", async () => {
  /* Trzy granice naraz, bo wszystkie trzy żyją na styku sesji z serwisem:
     adresat bierze się z SESJI, odczyt niczego nie zapisuje, a odhaczenie
     cudzej wzmianki nie przechodzi nawet z ważną sesją biura. */
  const { dodajKomentarz } = await import("../services/conversations.js");
  const ala = login("biuro", "A. Lewandowska");
  const bogdan = login("biuro", "B. Nowak");
  const k = dodajKomentarz(rozmowa, ala.userId, "@Bogdan zerkniesz?", [bogdan.userId]);

  const przed = liczbaZdarzen();
  const moje = await app.inject({ method: "GET", url: "/api/obsluga/wzmianki",
    headers: bogdan.naglowki });
  assert.equal(moje.statusCode, 200, moje.body);
  assert.equal(moje.json().nowe, 1);
  assert.equal(moje.json().wzmianki[0].autor, "A. Lewandowska");
  assert.equal(liczbaZdarzen(), przed, "odczyt wzmianek dopisał zdarzenie");

  const cudze = await app.inject({ method: "GET", url: "/api/obsluga/wzmianki",
    headers: ala.naglowki });
  assert.deepEqual(cudze.json().wzmianki, [], "autorka nie wzmiankowała siebie");

  const nieswoja = await app.inject({ method: "POST",
    url: `/api/obsluga/wzmianki/${k.id}/odhacz`, headers: ala.naglowki });
  assert.equal(nieswoja.statusCode, 400);
  assert.match(nieswoja.json().error, /Nie znaleziono wzmianki/);

  const swoja = await app.inject({ method: "POST",
    url: `/api/obsluga/wzmianki/${k.id}/odhacz`, headers: bogdan.naglowki });
  assert.equal(swoja.statusCode, 200, swoja.body);

  const po = await app.inject({ method: "GET", url: "/api/obsluga/wzmianki",
    headers: bogdan.naglowki });
  assert.equal(po.json().nowe, 0);
  assert.equal(po.json().wzmianki[0].odhaczona, true, "odhaczona zostaje na liście jako dowód");
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

test("sprawa skleja rozmowy, a rozmowa mówi wprost, do której już należy", async () => {
  const b = login("biuro", "Anna");
  const d = db();
  const druga = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject)
    SELECT channel_account_id,'w-2','Kupujący 44300444' FROM conversation WHERE id=?`)
    .run(rozmowa).lastInsertRowid);

  let r = await app.inject({ method: "POST", url: "/api/obsluga/sprawy", headers: b.naglowki,
    payload: { tytul: "Szarpak do NAC LS 46-450", rozmowaId: rozmowa } });
  assert.equal(r.statusCode, 200, r.body);
  const sprawa = r.json().id;

  r = await app.inject({ method: "POST", url: `/api/obsluga/sprawy/${sprawa}/rozmowy`,
    headers: b.naglowki, payload: { rozmowaId: druga } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().rozmowy.length, 2);

  /* Rozmowa jedzie razem ze swoją sprawą — agent ma zobaczyć rodzeństwo,
     zanim zacznie pisać. */
  r = await app.inject({ method: "GET", url: `/api/obsluga/rozmowy/${druga}`,
    headers: b.naglowki });
  assert.equal(r.json().sprawa.tytul, "Szarpak do NAC LS 46-450");

  /* Rozmowa w drugiej sprawie odpada, a odmowa niesie TYTUŁ tej pierwszej —
     inaczej agent nie wie, co odkleić. */
  const trzecia = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject)
    SELECT channel_account_id,'w-3','Kupujący 44300444' FROM conversation WHERE id=?`)
    .run(rozmowa).lastInsertRowid);
  r = await app.inject({ method: "POST", url: "/api/obsluga/sprawy", headers: b.naglowki,
    payload: { tytul: "Filtr", rozmowaId: trzecia } });
  assert.equal(r.statusCode, 200, r.body);
  const inna = await app.inject({ method: "POST", url: `/api/obsluga/sprawy/${r.json().id}/rozmowy`,
    headers: b.naglowki, payload: { rozmowaId: druga } });
  assert.equal(inna.statusCode, 400);
  assert.match(inna.json().error, /Szarpak do NAC LS 46-450/);

  const odlacz = await app.inject({ method: "POST",
    url: `/api/obsluga/rozmowy/${druga}/odlacz`, headers: b.naglowki });
  assert.equal(odlacz.statusCode, 200, odlacz.body);
  r = await app.inject({ method: "GET", url: `/api/obsluga/rozmowy/${druga}`, headers: b.naglowki });
  assert.equal(r.json().sprawa, null);
});

/* ── Strażnik adresów panelu (0.181.1) ──────────────────────────────────────
   `TRASY()` wyżej pilnuje tras, które ISTNIEJĄ. Nie pilnuje tego, że panel
   woła te same adresy — i dokładnie tędy przeszło 404 komentarza: od 0.157.0
   do 0.181.0 hook wołał `/api/obsluga/rozmowy/:id/komentarz`, a serwer miał
   tylko `/api/conversations/:id/comments`. Oba zestawy testów były zielone.

   Ten test czyta źródło hooków panelu — tak samo jak `biuro.test.ts` czyta
   `biuro.html` — i pyta Fastify o KAŻDY adres, który tam stoi. Adres bez trasy
   wywraca test z nazwą hooka, zanim wywróci ekran u agenta.                 */
test("każdy adres wołany z panel/src/api/rozmowy.ts ma trasę na serwerze", async () => {
  const zrodlo = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src/api/rozmowy.ts"), "utf8");
  /* Para: `api(...)` z literałem adresu i — opcjonalnie — `method` w tym samym
     wywołaniu. Brak `method` to GET. `${...}` w adresie zastępujemy jedynką
     i puszczamy PRAWDZIWE żądanie przez router: `hasRoute` porównuje wzorzec
     `:id` z tekstem, więc każdy adres z parametrem wychodziłby jako brak.
     Brak TRASY poznajemy po domyślnym 404 Fastify („Route … not found");
     404 z treścią aplikacji („nie znaleziono rozmowy") to trasa, która jest. */
  const wywolania = [...zrodlo.matchAll(/api(?:<[^>]*>)?\(\s*`([^`]+)`(?:\s*,\s*\{[^}]*?method:\s*"(GET|POST|PUT|DELETE)")?/gs)];
  assert.ok(wywolania.length >= 15, `spodziewałem się kilkunastu wywołań api(), jest ${wywolania.length}`);
  const b = await login("biuro", "Biuro");
  const bledne: string[] = [];
  for (const [, adres, metoda] of wywolania) {
    const url = adres.replace(/\$\{[^}]+\}/g, "1").replace(/\?.*$/, "");
    const method = (metoda ?? "GET") as "GET" | "POST" | "PUT" | "DELETE";
    const r = await app.inject({ method, url, headers: b.naglowki,
      ...(method === "GET" ? {} : { payload: {} }) });
    const tresc = r.json<{ message?: string }>();
    if (r.statusCode === 404 && /^Route /.test(tresc.message ?? "")) bledne.push(`${method} ${adres}`);
  }
  assert.deepEqual(bledne, [], "panel woła adresy bez trasy na serwerze");
});

test("komentarz wewnętrzny ze skrzynki zapisuje się pod adresem, który panel woła", async () => {
  const b = await login("biuro", "Biuro");
  const r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/comments`,
    headers: b.naglowki, payload: { body: "to ten sam klient co wczoraj", mentionedUserIds: [] } });
  assert.equal(r.statusCode, 200, r.body);
  /* Stary adres NIE istnieje — nikt nie ma „naprawić" tego dublując trasę. */
  assert.equal(app.hasRoute({ method: "POST", url: "/api/obsluga/rozmowy/1/komentarz" }), false);
});

/* ── Dobór części (§11, etap E1) ──────────────────────────────────────────── */

test("patrzenie na dobór niczego nie zapisuje — ani wiersza, ani zdarzenia", async () => {
  const b = login("biuro", "Anna");
  const przed = liczbaZdarzen();
  for (const url of [`/api/obsluga/rozmowy/${rozmowa}`, `/api/obsluga/rozmowy/${rozmowa}/dobor/kandydaci`]) {
    const r = await app.inject({ method: "GET", url, headers: b.naglowki });
    assert.equal(r.statusCode, 200, r.body);
  }
  const os = await app.inject({ method: "GET", url: `/api/obsluga/rozmowy/${rozmowa}`, headers: b.naglowki });
  assert.equal(os.json<{ dobor: { status: string } }>().dobor.status, "not_started");
  assert.equal(os.json<{ rozmowa: { dobor: string } }>().rozmowa.dobor, "not_started");
  assert.equal(liczbaZdarzen(), przed, "odczyt dopisał zdarzenie");
  assert.equal((db().prepare("SELECT count(*) n FROM dobor_rozmowy").get() as { n: number }).n, 0);
});

test("nieaktualna wersja doboru dostaje 409 z bieżącym stanem, zły status 400", async () => {
  const b = login("biuro", "Anna");
  let r = await app.inject({ method: "PUT", url: `/api/obsluga/rozmowy/${rozmowa}/dobor/dane`,
    headers: b.naglowki, payload: { dane: { marka: "NAC", model: "LS 46-450" }, expectedVersion: 1 } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json<{ wersja: number; status: string }>().wersja, 2);
  assert.equal(r.json<{ status: string }>().status, "searching");

  r = await app.inject({ method: "PUT", url: `/api/obsluga/rozmowy/${rozmowa}/dobor/dane`,
    headers: b.naglowki, payload: { dane: { model: "inny" }, expectedVersion: 1 } });
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json<{ wersja: number }>().wersja, 2);
  assert.equal(r.json<{ updatedBy: string }>().updatedBy, "Anna");

  r = await app.inject({ method: "POST", url: `/api/obsluga/rozmowy/${rozmowa}/dobor/status`,
    headers: b.naglowki, payload: { status: "extracting_data" } });
  assert.equal(r.statusCode, 400);
  assert.match(r.json<{ error: string }>().error, /Copilot/);

  /* Zatwierdzenie bez wyboru — 400 ze zdaniem, nie milczący sukces. */
  r = await app.inject({ method: "POST", url: `/api/obsluga/rozmowy/${rozmowa}/dobor/status`,
    headers: b.naglowki, payload: { status: "confirmed" } });
  assert.equal(r.statusCode, 400);
  assert.match(r.json<{ error: string }>().error, /wybranej kartoteki/);
});
