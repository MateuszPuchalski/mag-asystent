import { after, before, beforeEach, mock, test } from "node:test";
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
/* Obecność żyje w PAMIĘCI procesu (§6.3), więc test stawia uchwyt wprost.
   Import dynamiczny jak reszta: `DB_PATH` musi stanąć przed pierwszym
   dotknięciem modułów serwera. */
let wejdzDoRozmowy: typeof import("../services/conversation-realtime.js").wejdzDoRozmowy;
let wyjdzZRozmowy: typeof import("../services/conversation-realtime.js").wyjdzZRozmowy;
let _wyczyscObecnosc: typeof import("../services/conversation-realtime.js")._wyczyscObecnosc;
let rozmowa = 0;
let pytanie = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  ({ wejdzDoRozmowy, wyjdzZRozmowy, _wyczyscObecnosc } =
    await import("../services/conversation-realtime.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["conversation_mention", "conversation_comment", "conversation_draft",
    "conversation_assignment", "conversation_event", "message", "conversation",
    "channel_account", "zadanie_terenowe", "events", "device_session",
    /* Sprawa klienta wskazuje prowadzącego bez kaskady — przed kontami. */
    "klient_prowadzenie", "app_user"]) {
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
  /* Zdjęcie oferty (0.213.0) stoi za tą samą bramką, co reszta skrzynki:
     obraz z oferty klienta nie jest daną dla hali. */
  { method: "GET" as const, url: "/api/obsluga/oferta/111/zdjecie" },
  /* Podgląd załącznika (0.218.0) — ta sama bramka: zdjęcie od klienta nie jest
     daną dla hali, tak samo jak zdjęcie z jego oferty. */
  { method: "GET" as const, url: "/api/obsluga/zalaczniki/1/podglad" },
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
  /* Wskazanie ZAMÓWIENIA (0.397.0) — ta sama bramka, co reszta skrzynki:
     powiązanie otwiera pozycje i kwoty cudzego zakupu, więc hala nie ma tu
     czego szukać. */
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/zamowienie`,
    payload: { externalId: "ord-1" } },
  /* Paczka zamówienia rozmowy (23 września 2026) — ta sama bramka: stan
     przesyłki należy do cudzego zakupu. */
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/przesylka` },
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/kartoteka`,
    payload: { ofertaId: "14892374512", twId: null } },
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/send`,
    payload: { body: "Odpowiedź", expectedVersion: 1, expectedLastMessageId: null } },
  /* Zakończ / Otwórz ponownie (23 września 2026) — ta sama bramka. */
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/zakoncz`, payload: {} },
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/otworz` },
  /* Odłóż do terminu (0.533.0) — ta sama bramka co Zakończ. */
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/odloz`,
    payload: { doKiedy: new Date(Date.now() + 86_400_000).toISOString() } },
  /* Cofnięta wysyłka (0.500.0) — sam wpis do pomiaru tarcia, ta sama bramka. */
  { method: "POST" as const, url: `/api/conversations/${rozmowa}/wysylka-cofnieta` },
  /* Pominięcie (0.532.0) — licznik bez człowieka, ale pisze go tylko biuro:
     hala rozmów nie widzi, więc nie ma czego pomijać. */
  { method: "POST" as const, url: "/api/obsluga/pominiecie", payload: { kategoria: "RETURN" } },
  { method: "POST" as const, url: `/api/obsluga/rozmowy/${rozmowa}/priorytet`,
    payload: { priorytet: "pilny" } },
  { method: "POST" as const, url: `/api/obsluga/rozmowy/${rozmowa}/reklamacyjna`,
    payload: { reklamacyjna: true } },
  /* Werdykt o propozycji przepływu — zgoda zleca hali zadanie i przestawia
     priorytet, więc ta sama bramka co reszta zapisów skrzynki. */
  { method: "POST" as const, url: `/api/obsluga/rozmowy/${rozmowa}/przeplyw/1`,
    payload: { werdykt: "zgoda" } },
  { method: "GET" as const, url: "/api/obsluga/wzmianki" },
  /* Jedno „Moje" ponad kolejkami (S4 spoiwa) — ta sama bramka, bo lista
     niesie tematy rozmów i spraw klientów. */
  { method: "GET" as const, url: "/api/obsluga/moje" },
  { method: "POST" as const, url: "/api/obsluga/wzmianki/1/odhacz" },
  /* Historia klienta niesie CUDZE ZAKUPY — bramka roli jest tu ostrzejszym
     wymogiem niż przy reszcie skrzynki, nie luźniejszym. */
  { method: "GET" as const, url: `/api/obsluga/rozmowy/${rozmowa}/klient` },
  /* Dokumenty sprzedaży zamówienia (0.499.0) — numery faktur i paragonów
     kupującego, więc ta sama bramka co historia klienta. */
  { method: "GET" as const, url: `/api/obsluga/rozmowy/${rozmowa}/dokumenty-sprzedazy` },
  /* Przekrój towaru (0.502.0) — zwroty i sprawy cudzych zakupów, ta sama bramka. */
  { method: "GET" as const, url: "/api/obsluga/towar/1/przekroj" },
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
  for (const url of ["/api/obsluga/rozmowy", `/api/obsluga/rozmowy/${rozmowa}`,
    `/api/obsluga/rozmowy/${rozmowa}/klient`]) {
    const r = await app.inject({ method: "GET", url, headers: b.naglowki });
    assert.equal(r.statusCode, 200, r.body);
  }
  assert.equal(liczbaZdarzen(), przed, "odczyt dopisał zdarzenie");
  assert.equal((db().prepare("SELECT count(*) n FROM conversation_assignment").get() as {n:number}).n, 0);
});

test("skrzynka i status konta Allegro mówią, że Problemy z zakupem nie dochodzą", async () => {
  /* Bez bety skrzynka czyta `public.v1` i wygląda zdrowo, więc wstrzymanie
     musi dojść do panelu obiema trasami, którymi panel o nie pyta. */
  const b = login("biuro", "Anna");
  const doKiedy = new Date(Date.now() + 3_600_000).toISOString();
  db().prepare(`INSERT INTO allegro_inbox_sync_state(id,beta_wstrzymana_do,beta_powod) VALUES (1,?,?)
    ON CONFLICT(id) DO UPDATE SET beta_wstrzymana_do=excluded.beta_wstrzymana_do,
    beta_powod=excluded.beta_powod`).run(doKiedy, "Allegro odmówiło (406/415)");
  try {
    const oczekiwane = { przyczyna: "wstrzymana", doKiedy, szczegol: "Allegro odmówiło (406/415)" };
    const lista = await app.inject({ method: "GET", url: "/api/obsluga/rozmowy", headers: b.naglowki });
    assert.equal(lista.statusCode, 200, lista.body);
    assert.deepEqual(lista.json().stan.problemyZakupu, oczekiwane);
    const konto = await app.inject({ method: "GET", url: "/api/biuro/allegro/status", headers: b.naglowki });
    assert.equal(konto.statusCode, 200, konto.body);
    assert.deepEqual(konto.json().problemyZakupu, oczekiwane);
  } finally {
    db().prepare("UPDATE allegro_inbox_sync_state SET beta_wstrzymana_do=NULL, beta_powod=NULL").run();
  }
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
  /* ZDANIE MÓWI, CO DA SIĘ ZROBIĆ (0.395.0). Do 0.394.0 stało tu „najpierw ją
     przejmij" i odsyłało do przycisku „PRZEJMIJ ROZMOWĘ"; przycisk zszedł
     z ekranu na zgłoszenie właściciela, więc rada odsyłałaby w próżnię. */
  assert.match(r.json().error, /poproś o przekazanie/);
  assert.doesNotMatch(r.json().error, /przejmij/);

  /* IMIĘ I CZAS W ŁADUNKU, bo od 0.395.0 to ten konflikt — a nie przegrany
     wyścig o przycisk — karmi jedyny dialog przekazania w panelu. Bez nich
     agent widzi, że nie wyszło, i nie wie, u kogo prosić. */
  const sz = r.json();
  assert.equal(sz.assignedUserName, "A. Lewandowska");
  assert.ok(sz.assignedAt, "czas prowadzenia musi przyjechać z historii przypisań");
  assert.equal(typeof sz.version, "number");
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

/* ── Podgląd na osi: bajty rozstrzygają, Allegro mówi zdaniem ─────────────────
   Od tego wydania trasa podglądu CIĄGNIE plik i czyta typ z SYGNATURY
   (port z reklamacji, 0.223.0), a odmowa Allegro wraca jako 502 ze zdaniem,
   nie jako 400 nierozróżnialne od „to nie obraz". Token w bazie, żeby
   `wazneBearer` nie szedł po sieć; `fetch` podstawiony — żaden test nie
   strzela do Allegro.                                                       */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const URL_ZAL = "https://upload.allegro.pl/message-center/message-attachments/97dc0b60-2da4-4247-92ba-b748630ba0f6";

function tokenAllegro(jest: boolean) {
  db().prepare("DELETE FROM allegro_token").run();
  if (jest) {
    db().prepare(`INSERT INTO allegro_token(id,access_token,refresh_token,wygasa_at,srodowisko,
      polaczono_at,polaczono_przez) VALUES (1,'tok','ref',?, 'prod','2026-09-01T00:00:00Z','test')`)
      .run(new Date(Date.now() + 86_400_000).toISOString());
  }
}

/** Podstawiony `fetch` do Allegro: liczy strzały, oddaje bajty albo kod. */
function allegroOddaje(odp: { status: number; bajty?: Buffer } | Error) {
  const s = { strzalow: 0 };
  mock.method(globalThis, "fetch", async () => {
    s.strzalow += 1;
    if (odp instanceof Error) throw odp;
    return new Response(odp.status === 200 ? new Uint8Array(odp.bajty ?? PNG) : JSON.stringify({ error: "nie" }),
      { status: odp.status, headers: { "content-type": odp.status === 200 ? "application/octet-stream" : "application/json" } });
  });
  return s;
}

const zalacznik = (nazwa: string, mime: string | null, status = "SAFE", url: string | null = URL_ZAL) =>
  Number(db().prepare(`INSERT INTO message_attachment(message_id,file_name,mime_type,url,status)
    VALUES (?,?,?,?,?)`).run(pytanie, nazwa, mime, url, status).lastInsertRowid);

after(() => mock.restoreAll());

test("podgląd na osi: stan przed ETagiem, 304 przed Allegro, typ z sygnatury bajtów", async () => {
  mock.restoreAll();
  tokenAllegro(true);
  const biuro = login("biuro", "Biuro");
  const podglad = (id: number, naglowki: Record<string, string> = {}) => app.inject({
    method: "GET", url: `/api/obsluga/zalaczniki/${id}/podglad`, headers: { ...biuro.naglowki, ...naglowki } });

  /* Obraz, ale Allegro uznało go za niebezpieczny: 415 BEZ strzału do Allegro
     i bez ETaga — stan sprawdza się przed obiema rzeczami. */
  const bez = allegroOddaje({ status: 200 });
  const brudny = zalacznik("zdjecie.jpeg", "image/jpeg", "UNSAFE");
  const odmowa = await podglad(brudny, { "if-none-match": `"zal-${brudny}"` });
  assert.equal(odmowa.statusCode, 415);
  assert.match(odmowa.json().error, /stan UNSAFE/);
  assert.equal(bez.strzalow, 0);

  /* 304 wypada PRZED pytaniem Allegro o plik i nie dopisuje zdarzenia. */
  const zdjecie = zalacznik("szarpak.jpeg", "image/jpeg");
  const przed = liczbaZdarzen();
  const swieze = await podglad(zdjecie, { "if-none-match": `"zal-${zdjecie}"` });
  assert.equal(swieze.statusCode, 304);
  assert.equal(bez.strzalow, 0, "304 ma oszczędzać łącze do Allegro, nie tylko do przeglądarki");
  assert.equal(liczbaZdarzen(), przed, "podgląd dopisał zdarzenie");

  /* Szczęśliwa droga: bajty PNG pod nazwą `.jpeg` i polem `image/jpeg` —
     nagłówek mówi PRAWDĘ o bajtach, nie o polu z Allegro. */
  const png = allegroOddaje({ status: 200, bajty: PNG });
  const ok = await podglad(zdjecie);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.headers["content-type"], "image/png");
  assert.equal(ok.headers["x-content-type-options"], "nosniff");
  assert.equal(ok.headers["content-disposition"], "inline");
  assert.equal(ok.headers.etag, `"zal-${zdjecie}"`);
  assert.equal(Number(ok.headers["content-length"]), PNG.byteLength);
  assert.equal(png.strzalow, 1, "droga API zadziałała za pierwszym strzałem");
  assert.equal(liczbaZdarzen(), przed, "podgląd nie zostawia śladu w dzienniku");

  /* `mimeType` PUSTE, nazwa `.jpg`: do tego wydania 415 bez pytania. Teraz
     rozstrzygają bajty. */
  allegroOddaje({ status: 200, bajty: JPEG });
  const bezTypu = await podglad(zalacznik("usterka.jpg", null));
  assert.equal(bezTypu.statusCode, 200);
  assert.equal(bezTypu.headers["content-type"], "image/jpeg");

  /* `.exe` z polem `image/png` (albo SVG, albo PDF): sygnatura nie jest
     obrazem z listy → 415, plik zostaje przy pobraniu. */
  allegroOddaje({ status: 200, bajty: Buffer.from("MZ\u0090\u0000\u0003\u0000\u0000\u0000", "latin1") });
  const exe = await podglad(zalacznik("instalator.exe", "image/png"));
  assert.equal(exe.statusCode, 415);
  assert.match(exe.json().error, /sygnatura pliku/);
  allegroOddaje({ status: 200, bajty: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });
  assert.equal((await podglad(zalacznik("rysunek.svg", "image/svg+xml"))).statusCode, 415,
    "SVG jest obrazem i dokumentem ze skryptem — nie przechodzi po bajtach");
});

test("odmowa Allegro wraca jako 502 ze zdaniem, awaria sieci i brak konta jako 503", async () => {
  mock.restoreAll();
  tokenAllegro(true);
  const biuro = login("biuro", "Biuro");
  const zdjecie = zalacznik("szarpak.jpeg", "image/jpeg");
  const podglad = () => app.inject({ method: "GET",
    url: `/api/obsluga/zalaczniki/${zdjecie}/podglad`, headers: biuro.naglowki });
  const pobranie = () => app.inject({ method: "GET",
    url: `/api/obsluga/zalaczniki/${zdjecie}`, headers: biuro.naglowki });

  /* 403 z KAŻDEJ drogi: zdanie wymienia próby, nie adresy. */
  const dwie = allegroOddaje({ status: 403 });
  const odmowa = await podglad();
  assert.equal(odmowa.statusCode, 502);
  assert.match(odmowa.json().error, /końcówka API.*403.*zapisany adres: 403/);
  assert.match(odmowa.json().error, /allegro:api:messaging/);
  assert.equal(/https?:\/\//.test(odmowa.json().error), false);
  assert.equal(dwie.strzalow, 2, "końcówka API bez Accept, zapisany adres — i koniec");
  assert.equal((await pobranie()).statusCode, 502, "pobranie na dysk mówi tym samym zdaniem");

  allegroOddaje(new Error("fetch failed: timeout"));
  const siec = await podglad();
  assert.equal(siec.statusCode, 503);
  assert.match(siec.json().error, /internet na serwerze/);

  tokenAllegro(false);
  const bezKonta = await podglad();
  assert.equal(bezKonta.statusCode, 503);
  assert.match(bezKonta.json().error, /niepołączone/);
  mock.restoreAll();
});

test("ręcznego statusu nie ma — trasa milczy, a rozmowa stoi", async () => {
  /* Decyzja właściciela z 22 września 2026: status wynika wyłącznie
     z faktów. Test pilnuje, żeby trasa nie wróciła po cichu razem z czyimś
     scaleniem — 404 zamiast 400, bo tej drogi nie ma, a nie jest zamknięta. */
  const b = login("biuro", "Anna");
  const r = await app.inject({ method: "POST",
    url: `/api/obsluga/rozmowy/${rozmowa}/status`, headers: b.naglowki,
    payload: { status: "resolved" } });
  assert.equal(r.statusCode, 404);
  const stan = db().prepare("SELECT status FROM conversation WHERE id=?").get(rozmowa) as
    { status: string };
  assert.equal(stan.status, "new", "żądanie do nieistniejącej trasy nie ma prawa ruszyć rozmowy");
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

/* ── Doboru części nie ma ───────────────────────────────────────────────── */

test("trasy doboru zniknęły, a rozmowa nie niesie stanu doboru", async () => {
  const b = login("biuro", "Anna");
  for (const [method, url] of [["GET", "/api/obsluga/rozmowy/:id/dobor/kandydaci"],
    ["PUT", "/api/obsluga/rozmowy/:id/dobor/dane"], ["PUT", "/api/obsluga/rozmowy/:id/dobor/wynik"],
    ["GET", "/api/obsluga/rozmowy/:id/dobor/wiedza"], ["POST", "/api/obsluga/rozmowy/:id/dobor/pomiar-do-wiedzy"]] as const) {
    assert.equal(app.hasRoute({ method, url }), false, `${method} ${url} wróciła`);
  }
  const os = await app.inject({ method: "GET", url: `/api/obsluga/rozmowy/${rozmowa}`, headers: b.naglowki });
  assert.equal(os.statusCode, 200, os.body);
  assert.equal("dobor" in os.json<Record<string, unknown>>(), false);
  assert.equal("dobor" in os.json<{ rozmowa: Record<string, unknown> }>().rozmowa, false);
});

/* ── Flagi jawnej zgody jadą CIAŁEM, więc trasa musi je wymienić (0.224.1) ───
   Blizna znaleziona przy rozpoznaniu do 0.224.0. `mimoObecnosci` istniał
   w serwisie od 0.159.0 razem z testem, panel wysyłał go od 0.190.0 — a trasa
   ani nie deklarowała pola w typie `Body`, ani nie podawała go niżej. Pole
   nieopisane w `Body` znika po cichu: miękka blokada obecności zachowywała się
   przez to jak twarda przez pełne TTL uchwytu.

   Przeszło niezauważone, bo test serwisu woła `wyslijOdpowiedz()` z pominięciem
   HTTP, a strażnik adresów niżej pilnuje ADRESÓW, nie pól ciała. Dlatego dowód
   idzie tu przez ZACHOWANIE na trasie, tak samo jak przy odpowiedzi
   w reklamacji (`routes/reklamacje.test.ts`).                               */
test("trasa wysyłki PRZEKAZUJE „mimo to” — inaczej jawna zgoda nie działa", async () => {
  _wyczyscObecnosc();
  const ala = login("biuro", "A. Lewandowska");
  const marek = login("biuro", "M. Wójcik");
  /* Ala weszła pierwsza i siedzi przy pytaniu — uchwyt żyje w pamięci procesu,
     nie w bazie, więc stawiamy go wprost. */
  wejdzDoRozmowy(rozmowa, ala.userId, "A. Lewandowska");

  const wersja = Number((db().prepare("SELECT version FROM conversation WHERE id=?")
    .get(rozmowa) as { version: number }).version);
  const cialo = (extra: Record<string, unknown>) => ({
    body: "Pasuje.", expectedVersion: wersja, expectedLastMessageId: pytanie, ...extra,
  });

  const bez = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/send`,
    headers: marek.naglowki, payload: cialo({}) });
  assert.equal(bez.statusCode, 409, bez.body);
  /* Ładunek jedzie PŁASKO obok `error` — panel czyta z niego nazwisko. */
  assert.equal(bez.json<{ trzymajacyName: string }>().trzymajacyName, "A. Lewandowska");

  /* Z flagą bramka obecności ma przepuścić. Dalej zatrzyma żądanie brak konta
     Allegro i to jest w porządku — pilnujemy tego, że zgoda dojechała. */
  const zFlaga = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/send`,
    headers: marek.naglowki, payload: cialo({ mimoObecnosci: true }) });
  assert.doesNotMatch(String(zFlaga.json<{ error?: string }>().error ?? ""), /siedzi/,
    "flaga z ciała musi dojechać do serwisu — inaczej jawna zgoda jest ścianą");

  wyjdzZRozmowy(rozmowa, ala.userId);
});

test("moje sprawy: tożsamość z sesji, nie z zapytania — cudzej listy nie ma jak poprosić", async () => {
  /* `?userId=` byłby monitoringiem pracowniczym pod inną nazwą: każdy z biura
     mógłby przejrzeć listę pracy kolegi. Trasa bierze tożsamość z sesji
     i parametru nie czyta wcale, więc podstawienie cudzego numeru nic nie robi. */
  const ala = login("biuro", "A. Lewandowska");
  const bob = login("biuro", "B. Nowak");
  const d = db();
  d.prepare("UPDATE conversation SET assigned_user_id=?, status='open' WHERE id=?")
    .run(ala.userId, rozmowa);

  const przed = liczbaZdarzen();
  const moja = await app.inject({ method: "GET", url: "/api/obsluga/moje", headers: ala.naglowki });
  assert.equal(moja.statusCode, 200, moja.body);
  assert.equal(moja.json<{ sprawy: unknown[] }>().sprawy.length, 1);

  const cudza = await app.inject({
    method: "GET", url: `/api/obsluga/moje?userId=${ala.userId}`, headers: bob.naglowki,
  });
  assert.equal(cudza.statusCode, 200, cudza.body);
  assert.deepEqual(cudza.json<{ sprawy: unknown[] }>().sprawy, [],
    "parametr z cudzym numerem nie ma prawa niczego pokazać");
  assert.equal(liczbaZdarzen(), przed, "odczyt listy pracy niczego nie mutuje");
});

test("sprawa klienta na „Moje” i w historii rozmowy: tylko prowadzącego, bez zapisu przy patrzeniu", async () => {
  /* Bliźniak testu wyżej dla sprawy klienta (0.535.0). Scalenie stoi
     w serwisie, ale tożsamość bierze TRASA — i tu się jej pilnuje. */
  const ala = login("biuro", "A. Lewandowska");
  const bob = login("biuro", "B. Nowak");
  const d = db();
  /* Wątek rozmowy z beforeEach dostaje rozmówcę — to czyni login znanym. */
  d.prepare(`INSERT OR REPLACE INTO allegro_inbox_thread(id,read,interlocutor_login,surowe_json,synced_at)
    VALUES ('w-1',1,'kupujacy44','{}','x')`).run();
  const zalozona = await app.inject({ method: "POST", url: "/api/obsluga/klient/kupujacy44/sprawa/krok",
    headers: ala.naglowki, payload: { krok: "dosłać nóż", wersja: 0, odcisk: "",
      krokDo: new Date(Date.now() + 2 * 86_400_000).toISOString() } });
  assert.equal(zalozona.statusCode, 200, zalozona.body);
  const id = zalozona.json<{ sprawa: { id: number } }>().sprawa.id;

  const przed = liczbaZdarzen();
  const zmiany = (d.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const moja = await app.inject({ method: "GET", url: "/api/obsluga/moje", headers: ala.naglowki });
  assert.equal(moja.statusCode, 200, moja.body);
  type Wiersz = { kolejka: string; id: number; czeka?: boolean; cel?: string };
  const odpowiedz = moja.json<{ sprawy: Wiersz[]; lista: Wiersz[] }>();
  const wiersz = odpowiedz.lista.find((s) => s.kolejka === "klient");
  assert.equal(wiersz?.id, id);
  assert.equal(wiersz?.czeka, true, "krok na pojutrze czeka");
  assert.equal(wiersz?.cel, "/obsluga/klient/kupujacy44");
  /* `sprawy` zostaje samymi kolejkami: karta panelu sprzed tego wydania
     wywraca się na wierszu, którego rodzaju nie zna. */
  assert.deepEqual(odpowiedz.sprawy.filter((s) => s.kolejka === "klient"), []);

  const cudza = await app.inject({
    method: "GET", url: `/api/obsluga/moje?userId=${ala.userId}`, headers: bob.naglowki,
  });
  assert.equal(cudza.statusCode, 200, cudza.body);
  assert.deepEqual(cudza.json<{ sprawy: unknown[]; lista: unknown[] }>().lista, [],
    "cudzej sprawy klienta nie ma jak poprosić");

  const h = await app.inject({ method: "GET", url: `/api/obsluga/rozmowy/${rozmowa}/klient`, headers: bob.naglowki });
  assert.equal(h.statusCode, 200, h.body);
  assert.equal(h.json<{ sprawa: { id: number; krok: string } | null }>().sprawa?.krok, "dosłać nóż",
    "z rozmowy widać sprawę klienta — wiązanie w drugą stronę");
  assert.equal(liczbaZdarzen(), przed);
  assert.equal((d.prepare("SELECT total_changes() AS n").get() as { n: number }).n, zmiany);
});

test("historia rozmowy bez loginu rozmówcy niesie `sprawa: null`, nie błąd", async () => {
  const b = login("biuro", "Anna");
  db().prepare("DELETE FROM allegro_inbox_thread WHERE id='w-1'").run();
  const h = await app.inject({ method: "GET", url: `/api/obsluga/rozmowy/${rozmowa}/klient`, headers: b.naglowki });
  assert.equal(h.statusCode, 200, h.body);
  assert.equal(h.json<{ sprawa: unknown }>().sprawa, null);
});

test("rozmowa bez rozmówcy, dowiązana numerem zamówienia, niesie sprawę kupującego", async () => {
  /* Wiązanie w obie strony (`CLAUDE.md`). Sprawa budzi się z rozmowy, do
     której klienta prowadzi tylko numer zamówienia, i odsyła do niej — więc
     ta rozmowa musi pokazać tę sprawę, choć wątek nie niesie loginu. */
  const ala = login("biuro", "A. Lewandowska");
  const d = db();
  const konto = (d.prepare("SELECT channel_account_id AS k FROM conversation WHERE id=?").get(rozmowa) as
    { k: number }).k;
  d.prepare("DELETE FROM allegro_inbox_thread WHERE id='w-1'").run();
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,status,kupujacy_login,kupiono_at,
      suma_grosze,waluta,synced_at) VALUES (?,'ord-55','READY_FOR_PROCESSING','Kupujacy55',?,5000,'PLN','x')`)
    .run(konto, "2026-09-01T07:00:00.000Z");
  try {
    d.prepare("UPDATE message SET related_order_id='ord-55' WHERE id=?").run(pytanie);
    const zalozona = await app.inject({ method: "POST", url: "/api/obsluga/klient/kupujacy55/sprawa/krok",
      headers: ala.naglowki, payload: { krok: "czekamy na zwrot", wersja: 0, odcisk: "",
        krokDo: new Date(Date.now() + 2 * 86_400_000).toISOString() } });
    assert.equal(zalozona.statusCode, 200, zalozona.body);

    const h = await app.inject({ method: "GET", url: `/api/obsluga/rozmowy/${rozmowa}/klient`,
      headers: ala.naglowki });
    assert.equal(h.statusCode, 200, h.body);
    const j = h.json<{ login: string | null; sprawa: { login: string; krok: string } | null }>();
    assert.equal(j.login, null, "historia dalej nie zgaduje klienta — wątek nie niesie loginu");
    assert.deepEqual([j.sprawa?.login, j.sprawa?.krok], ["Kupujacy55", "czekamy na zwrot"]);
  } finally {
    /* Zamówienie wskazuje konto kluczem obcym, a `beforeEach` kasuje konta. */
    d.prepare("DELETE FROM zamowienie_klienta WHERE external_id='ord-55'").run();
  }
});

test("znacznik reklamacyjny jest PRZEŁĄCZNIKIEM i zostawia ślad w obie strony", async () => {
  /* Zgłoszenie właściciela: „chcę zaznaczyć, że to pytanie reklamacyjne i będzie
     traktowane jako reklamacja, ale nie będzie w allegrowych reklamacjach".

     Znacznik jest NASZ, bo sprawy posprzedażowej sprzedawca nie może założyć —
     `/sale/issues` w specyfikacji ma wyłącznie GET. Test pilnuje trzech rzeczy:
     że da się go nadać, że da się go ZDJĄĆ i że obie zmiany widać na osi. */
  const b = login("biuro", "Anna");

  let r = await app.inject({ method: "POST", url: `/api/obsluga/rozmowy/${rozmowa}/reklamacyjna`,
    headers: b.naglowki, payload: { reklamacyjna: true } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json<{ reklamacyjna: boolean }>().reklamacyjna, true);

  r = await app.inject({ method: "GET", url: "/api/obsluga/rozmowy", headers: b.naglowki });
  const wiersz = r.json<{ rozmowy: Array<{ id: number; reklamacyjna: boolean }> }>()
    .rozmowy.find((x) => x.id === rozmowa)!;
  assert.equal(wiersz.reklamacyjna, true, "kolejka musi to pokazać — inaczej znacznik nic nie zmienia");

  /* Zdjęcie: agent bierze pytanie za reklamacyjne po pierwszym zdaniu klienta,
     a po wyniku z hali okazuje się, że to pytanie o dobór. */
  r = await app.inject({ method: "POST", url: `/api/obsluga/rozmowy/${rozmowa}/reklamacyjna`,
    headers: b.naglowki, payload: { reklamacyjna: false } });
  assert.equal(r.statusCode, 200, r.body);

  const os = (await app.inject({ method: "GET", url: `/api/obsluga/rozmowy/${rozmowa}`,
    headers: b.naglowki })).json<{ os: Array<{ tresc: string }> }>().os;
  assert.ok(os.some((w) => w.tresc === "oznaczono jako sprawę reklamacyjną"), "nadanie na osi");
  assert.ok(os.some((w) => w.tresc === "zdjęto znacznik reklamacyjny"), "zdjęcie na osi");
});

test("ciało bez `reklamacyjna` odpada 400, zamiast po cichu zdejmować znacznik", async () => {
  /* Pole nieopisane w typie `Body` znika po cichu — blizna 0.224.1. Puste ciało
     nie ma prawa znaczyć „fałsz", bo to zdejmowałoby znacznik przez literówkę. */
  const b = login("biuro", "Anna");
  const r = await app.inject({ method: "POST", url: `/api/obsluga/rozmowy/${rozmowa}/reklamacyjna`,
    headers: b.naglowki, payload: {} });
  assert.equal(r.statusCode, 400, r.body);
});

test("odłóż: ciało bez `doKiedy` odpada 400; z terminem kolejka widzi odłożenie, null je zdejmuje", async () => {
  /* Ta sama blizna 0.224.1 co wyżej: puste ciało nie może znaczyć „zdejmij",
     bo budziłoby rozmowę przez literówkę. */
  const b = login("biuro", "Anna");
  let r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/odloz`,
    headers: b.naglowki, payload: {} });
  assert.equal(r.statusCode, 400, r.body);

  const doKiedy = new Date(Date.now() + 2 * 86_400_000).toISOString();
  r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/odloz`,
    headers: b.naglowki, payload: { doKiedy } });
  assert.equal(r.statusCode, 200, r.body);
  const wiersz = () => app.inject({ method: "GET", url: "/api/obsluga/rozmowy", headers: b.naglowki })
    .then((x) => x.json<{ rozmowy: Array<{ id: number; status: string; odlozoneDo: string | null }> }>()
      .rozmowy.find((w) => w.id === rozmowa)!);
  let w = await wiersz();
  assert.equal(w.status, "snoozed");
  assert.equal(w.odlozoneDo, doKiedy);

  r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/odloz`,
    headers: b.naglowki, payload: { doKiedy: null } });
  assert.equal(r.statusCode, 200, r.body);
  w = await wiersz();
  assert.equal(w.status, "waiting_for_us");
});

/* ── Pomiary pod decyzje (26 września 2026, 0.532.0) ─────────────────────── */

test("cofnięta wysyłka niesie czas od odłożenia; liczba spoza 0–60 s odpada, wpis zostaje", async () => {
  const b = login("biuro", "Anna");
  const wpisy = () => (db().prepare(`SELECT payload FROM events WHERE type='rozmowa_wysylka_cofnieta'
    ORDER BY id`).all() as Array<{ payload: string }>).map((w) => JSON.parse(w.payload));
  let r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/wysylka-cofnieta`,
    headers: b.naglowki, payload: { msOdKolejki: 2_345.6 } });
  assert.equal(r.statusCode, 200, r.body);
  r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/wysylka-cofnieta`,
    headers: b.naglowki, payload: { msOdKolejki: 999_999 } });
  assert.equal(r.statusCode, 200, "zła liczba nie odrzuca decyzji agenta");
  /* Stary panel woła bez ciała — tak ma zostać ważne. */
  r = await app.inject({ method: "POST", url: `/api/conversations/${rozmowa}/wysylka-cofnieta`,
    headers: b.naglowki });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(wpisy(), [
    { conversationId: rozmowa, msOdKolejki: 2_346 },
    { conversationId: rozmowa }, { conversationId: rozmowa }]);
});

test("pominięcie: sam licznik doby i klasy — bez wpisu w dzienniku, bez człowieka", async () => {
  db().prepare("DELETE FROM pominiecia_dzien").run();
  const b = login("biuro", "Anna");
  const przed = liczbaZdarzen();
  for (const payload of [{ kategoria: "RETURN" }, { kategoria: "RETURN" }, {}, undefined]) {
    const r = await app.inject({ method: "POST", url: "/api/obsluga/pominiecie", headers: b.naglowki, payload });
    assert.equal(r.statusCode, 200, r.body);
  }
  assert.equal(liczbaZdarzen(), przed, "wpis w dzienniku niósłby autora z milisekundą");
  const wiersze = db().prepare("SELECT * FROM pominiecia_dzien ORDER BY kategoria").all() as
    Array<Record<string, unknown>>;
  assert.deepEqual(wiersze.map((w) => [w.kategoria, w.ile]), [["RETURN", 2], ["bez rozpoznania", 2]]);
  assert.deepEqual(Object.keys(wiersze[0]!).sort(), ["dzien", "ile", "kategoria"]);
});

/* ── Werdykt o propozycji przepływu kategorii (tryb cienia) ─────────────────
   Trasa jest cienka, reguły pilnuje `services/przeplyw-kategorii.test.ts`.
   Tu sprawdzamy granicę HTTP: kody błędów i to, że zgoda naprawdę wykonuje
   krok, a werdykt drugi raz go nie powtarza. */
test("werdykt przepływu: 400, 404, 409, a zgoda ustawia pilne i zleca weryfikację", async () => {
  const b = login("biuro", "Anna");
  const d = db();
  d.prepare(`INSERT INTO decyzja_klasyfikacji(conversation_id,message_id,wersja,aktywna,zrodlo,status,
    kategoria,akcja,wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,pewnosc,
    taksonomia_wersja,polityka_wersja,at,przez)
    VALUES (?,?,1,1,'MODEL','SUCCESS','WRONG_PRODUCT','HUMAN_REVIEW',0,0,0,'wysoka','v2','p1',?,'automat')`)
    .run(rozmowa, pytanie, new Date().toISOString());
  const { zapiszPropozycje } = await import("../services/przeplyw-kategorii.js");
  assert.equal(zapiszPropozycje(d, [rozmowa]), 2);
  const os = await app.inject({ method: "GET", url: `/api/obsluga/rozmowy/${rozmowa}`, headers: b.naglowki });
  const lista = os.json().przeplyw as Array<{ id: number; rodzaj: string; werdykt: string | null }>;
  assert.deepEqual(lista.map((p) => p.rodzaj), ["krok", "pilne"]);
  const [krok, pilne] = lista;
  const werdykt = (id: number, tresc: unknown, rozmowaId = rozmowa) => app.inject({ method: "POST",
    url: `/api/obsluga/rozmowy/${rozmowaId}/przeplyw/${id}`, headers: b.naglowki, payload: tresc as object });

  assert.equal((await werdykt(pilne!.id, { werdykt: "moze" })).statusCode, 400);
  assert.equal((await werdykt(pilne!.id, {})).statusCode, 400);
  assert.equal((await werdykt(pilne!.id, { werdykt: "zgoda" }, rozmowa + 1000)).statusCode, 404);

  let r = await werdykt(pilne!.id, { werdykt: "zgoda" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().propozycja.werdykt, "zgoda");
  assert.equal(r.json().propozycja.werdyktPrzez, "Anna");
  assert.equal((d.prepare("SELECT priorytet FROM conversation WHERE id=?").get(rozmowa) as
    { priorytet: string }).priorytet, "pilny");

  r = await werdykt(krok!.id, { werdykt: "zgoda" });
  assert.equal(r.statusCode, 200, r.body);
  const z = d.prepare("SELECT rodzaj, conversation_id, message_id FROM zadanie_terenowe").all() as
    Array<{ rodzaj: string; conversation_id: number; message_id: number }>;
  assert.deepEqual(z.map((x) => ({ ...x })), [{ rodzaj: "weryfikacja", conversation_id: rozmowa, message_id: pytanie }]);

  r = await werdykt(krok!.id, { werdykt: "zgoda" });
  assert.equal(r.statusCode, 409, "drugi werdykt nie zleca drugiego zadania");
  assert.equal((d.prepare("SELECT count(*) n FROM zadanie_terenowe").get() as { n: number }).n, 1);
});
