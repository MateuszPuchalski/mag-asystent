import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";
import { rozpoznajMime } from "../adapters/zdjecia.sgt.js";
import { typPodgladu } from "../services/skrzynka.js";

process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wertis-reklamacje-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* Trasy reklamacji pilnują tu czterech rzeczy, z których żadna nie mieszka
   w serwisie:

   1. BRAMKA ROLI TAKŻE NA ODCZYCIE. Reklamacja niesie login kupującego, treść
      jego zgłoszenia i numer zamówienia — dane biura, nie hali. Trasa odczytu
      bez bramki wygląda niewinnie i przecieka po cichu.
   2. ZERO ZAPISU PRZY PATRZENIU (blizna 0.18.0). Otwarcie kolejki i otwarcie
      sprawy nie mają prawa dołożyć ani jednego wiersza.
   3. LICZNIK ZAPISÓW JEST UMOWĄ. Przyrost pierwszy ma DWA zapisy, oba
      wyłącznie u nas: „prowadzę" i notatka. Do Allegro nie wychodzi stąd nic —
      odpowiedź w czacie i werdykt to dwa następne przyrosty.
   4. 401 PRZED 403. Brak sesji to inna naprawa niż zła rola.               */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let reklamacja = 0;
let zalacznik = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["reklamacja_zalacznik", "reklamacja_wiadomosc", "reklamacja_klienta",
    "allegro_reklamacja", "allegro_reklamacje_sync_state", "message", "conversation",
    "channel_account", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  reklamacja = Number(d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,
    reference_number,order_id,kupujacy_login,prawo,powod_typ,status_allegro,decyzja_do,
    ostatnia_wiadomosc_status,wiadomosci_ile,otwarto_at,synced_at)
    VALUES (?,'i-1','123/2026','ord-1','kupujacy1','COMPLAINT','DEFECT_FOUND_DURING_USE',
      'CLAIM_SUBMITTED','2126-09-20T10:00:00Z','BUYER_REPLIED',2,
      '2026-09-06T10:00:00Z','2026-09-07T10:00:00Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO reklamacja_wiadomosc(reklamacja_id,external_id,autor_login,autor_rola,
    tresc,utworzono_at) VALUES (?,'w-1','kupujacy1','BUYER','Kosiarka przestała ciąć',
    '2026-09-06T10:01:00Z')`).run(reklamacja);
  zalacznik = Number(d.prepare(
    "INSERT INTO reklamacja_zalacznik(reklamacja_id,wiadomosc_id,nazwa,url) VALUES (?,NULL,?,?)")
    .run(reklamacja, "paragon.pdf",
      "https://api.allegro.pl/sale/issues/attachments/a-2").lastInsertRowid);
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { naglowki: { "x-session": token } };
}

const TRASY = () => [
  { method: "GET" as const, url: "/api/obsluga/reklamacje" },
  { method: "GET" as const, url: `/api/obsluga/reklamacje/${reklamacja}` },
  { method: "GET" as const, url: `/api/obsluga/reklamacje/${reklamacja}/zalaczniki/${zalacznik}` },
  { method: "GET" as const, url: `/api/obsluga/reklamacje/${reklamacja}/zalaczniki/${zalacznik}/podglad` },
  { method: "POST" as const, url: "/api/obsluga/reklamacje/synchronizuj" },
  { method: "POST" as const, url: `/api/obsluga/reklamacje/${reklamacja}/prowadze` },
  { method: "POST" as const, url: `/api/obsluga/reklamacje/${reklamacja}/notatka` },
];

test("bez sesji żadna trasa reklamacji nie odpowiada danymi", async () => {
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url });
    assert.equal(r.statusCode, 401, `${t.method} ${t.url} przepuścił brak sesji`);
  }
});

test("hala nie widzi reklamacji — bramka roli stoi też na odczycie", async () => {
  const { naglowki } = login("magazynier", "Magazynier Marek");
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, headers: naglowki });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url} wpuścił halę`);
    assert.match(r.json().error, /biuro/, "odmowa mówi, kto to prowadzi");
  }
});

test("DWA ZAPISY w przyroście pierwszym — licznik jest umową", () => {
  /* Ta liczba jest kontraktem, nie obserwacją. Rośnie razem z przyrostem
     drugim (odpowiedź w czacie) i trzecim (werdykt), a każdy z nich dostaje
     zdanie w uzasadnieniu. `synchronizuj` NIE JEST zapisem do Allegro: to
     odczyt na żądanie, który zapisuje wynik u nas. */
  const zapisy = TRASY().filter((t) => t.method === "POST" && !t.url.endsWith("synchronizuj"));
  assert.equal(zapisy.length, 2,
    "prowadzę i notatka — oba wyłącznie u nas, żaden nie wychodzi do Allegro");
});

test("biuro dostaje kolejkę z kubełkiem, terminem, sygnałami i licznikami", async () => {
  const { naglowki } = login("biuro", "Ala z biura");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/reklamacje", headers: naglowki });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.reklamacje.length, 1);
  const k = body.reklamacje[0];
  assert.equal(k.externalId, "i-1");
  assert.equal(k.numer, "123/2026");
  assert.equal(k.kubelek, "decyzja", "sprawa przed werdyktem czeka na decyzję");
  assert.equal(typeof k.dniDoTerminu, "number");
  assert.deepEqual(k.sygnaly, ["klient_czeka"], "termin daleki, więc milczy");
  assert.equal(body.liczniki.decyzja, 1);
  assert.ok(body.stan.status, "stan synchronizacji jedzie razem z kolejką");
});

test("szczegół niesie czat i załączniki sprawy", async () => {
  const { naglowki } = login("biuro", "Ala druga");
  const r = await app.inject({
    method: "GET", url: `/api/obsluga/reklamacje/${reklamacja}`, headers: naglowki });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.czat.length, 1);
  assert.equal(body.czat[0].tresc, "Kosiarka przestała ciąć");
  assert.deepEqual(body.zalaczniki.map((z: { nazwa: string }) => z.nazwa), ["paragon.pdf"]);
});

test("reklamacja spoza bazy to 404, nie pusty obiekt", async () => {
  const { naglowki } = login("biuro", "Ala trzecia");
  const r = await app.inject({
    method: "GET", url: "/api/obsluga/reklamacje/99999", headers: naglowki });
  assert.equal(r.statusCode, 404);
});

test("otwarcie kolejki i otwarcie sprawy nie zapisują NICZEGO", async () => {
  /* Umowa z 0.18.0. Liczymy wiersze we WSZYSTKICH tabelach, których ten ekran
     dotyka — nie tylko w dzienniku, bo zapis potrafi wylądować obok. */
  const { naglowki } = login("biuro", "Ala czwarta");
  const licz = () => {
    const d = db();
    return ["events", "reklamacja_klienta", "reklamacja_wiadomosc", "reklamacja_zalacznik",
      "allegro_reklamacja", "allegro_reklamacje_sync_state"]
      .map((t) => (d.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n)
      .join("/");
  };
  const przed = licz();
  await app.inject({ method: "GET", url: "/api/obsluga/reklamacje", headers: naglowki });
  await app.inject({
    method: "GET", url: `/api/obsluga/reklamacje/${reklamacja}`, headers: naglowki });
  assert.equal(licz(), przed, "patrzenie na reklamacje nie ma prawa niczego zapisać");
});

test("„prowadzę” zapisuje znacznik, a konflikt wersji wraca jako 409 z ładunkiem", async () => {
  const { naglowki } = login("biuro", "Ala piąta");
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/prowadze`,
    headers: naglowki, payload: { wersja: 1 } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().reklamacja.prowadzi, "Ala piąta");

  /* Ta sama wersja drugi raz: ekran kolegi ma dowiedzieć się, kto był szybszy,
     a nie po cichu nadpisać jego pracę. */
  const konflikt = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/notatka`,
    headers: naglowki, payload: { notatka: "moje ustalenia", wersja: 1 } });
  assert.equal(konflikt.statusCode, 409);
  assert.equal(konflikt.json().prowadzi, "Ala piąta");
});

test("notatka innego typu niż tekst to 400 ze zdaniem, nie 500", async () => {
  const { naglowki } = login("biuro", "Ala szósta");
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/reklamacje/${reklamacja}/notatka`,
    headers: naglowki, payload: { notatka: 42 } });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /tekstem/);
});

test("załącznik cudzej sprawy nie wychodzi tą trasą", async () => {
  /* Bez tego znajomość samego identyfikatora załącznika wystarczałaby za
     uprawnienie do cudzej reklamacji. */
  const { naglowki } = login("biuro", "Ala siódma");
  const obca = Number(db().prepare(`INSERT INTO reklamacja_klienta(channel_account_id,
    external_id,otwarto_at,synced_at)
    SELECT channel_account_id,'i-2','2026-09-06T10:00:00Z','2026-09-07T10:00:00Z'
      FROM reklamacja_klienta WHERE id=?`).run(reklamacja).lastInsertRowid);
  const r = await app.inject({
    method: "GET", url: `/api/obsluga/reklamacje/${obca}/zalaczniki/${zalacznik}`,
    headers: naglowki });
  assert.equal(r.statusCode, 404);
});

test("synchronizacja bez sparowanego konta mówi zdaniem, a nie kodem", async () => {
  /* Testy chodzą bez `ALLEGRO_CLIENT_ID`, więc to jest ścieżka, którą zobaczy
     każdy, kto włączy panel przed sparowaniem konta. */
  const { naglowki } = login("biuro", "Ala ósma");
  const r = await app.inject({
    method: "POST", url: "/api/obsluga/reklamacje/synchronizuj", headers: naglowki });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /sparowane/);
});

test("podgląd rozstrzygają BAJTY, nie pole, którego Allegro nie przysyła", () => {
  /* `PostPurchaseIssueAttachment` ma dwa pola — `fileName` i `url` — więc
     bramki `SAFE` ze skrzynki nie da się tu powtórzyć. Powtarzamy jej SKUTEK:
     na oś idą wyłącznie typy, które przeglądarka narysuje, a rozpoznaje je
     sygnatura pliku.

     Przechodzą TRZY, bo tyle jest we wspólnej części tego, co Allegro przy
     tym zasobie przyjmuje (png, gif, bmp, tiff, jpeg, pdf) i co rysuje
     przeglądarka (`TYPY_PODGLADU`). */
  const sygnatura = (b: number[]) => typPodgladu(rozpoznajMime(Buffer.from(b)));
  assert.equal(sygnatura([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg");
  assert.equal(sygnatura([0x89, 0x50, 0x4e, 0x47]), "image/png");
  assert.equal(sygnatura([0x47, 0x49, 0x46, 0x38]), "image/gif");

  /* BMP i TIFF Allegro przyjmuje, a przeglądarki rysują je nierówno albo
     wcale — zostają przy pobieraniu i to jest odpowiedź, nie awaria. */
  assert.equal(sygnatura([0x42, 0x4d, 0x00, 0x00]), null, "BMP nie idzie na oś");
  assert.equal(sygnatura([0x49, 0x49, 0x2a, 0x00]), null, "TIFF nie idzie na oś");
  /* PDF to najczęstszy załącznik niebędący zdjęciem — paragon albo faktura. */
  assert.equal(sygnatura([0x25, 0x50, 0x44, 0x46]), null, "PDF nie idzie na oś");
  /* Plik nazwany `usterka.jpg`, który obrazem nie jest, dostaje 415: nazwa
     decyduje o UKŁADZIE, bajty o wydaniu. */
  assert.equal(sygnatura([0x3c, 0x73, 0x76, 0x67]), null, "SVG też nie — to dokument ze skryptem");
});

test("podgląd cudzej sprawy nie wychodzi tą trasą", async () => {
  const { naglowki } = login("biuro", "Ala dziewiąta");
  const obca = Number(db().prepare(`INSERT INTO reklamacja_klienta(channel_account_id,
    external_id,otwarto_at,synced_at)
    SELECT channel_account_id,'i-3','2026-09-06T10:00:00Z','2026-09-07T10:00:00Z'
      FROM reklamacja_klienta WHERE id=?`).run(reklamacja).lastInsertRowid);
  const r = await app.inject({
    method: "GET", url: `/api/obsluga/reklamacje/${obca}/zalaczniki/${zalacznik}/podglad`,
    headers: naglowki });
  assert.equal(r.statusCode, 404);
});

test("ETag odpowiada 304 PRZED pójściem do Allegro", async () => {
  /* Bez tego oś ciągnęłaby te same megabajty przy każdym przerysowaniu.
     Że 304 wraca bez sieci, widać po tym, że test przechodzi bez konta
     Allegro — gdyby trasa pytała Allegro, poleciałby błąd. */
  const { naglowki } = login("biuro", "Ala dziesiąta");
  const r = await app.inject({
    method: "GET", url: `/api/obsluga/reklamacje/${reklamacja}/zalaczniki/${zalacznik}/podglad`,
    headers: { ...naglowki, "if-none-match": `"rekl-zal-${zalacznik}"` } });
  assert.equal(r.statusCode, 304);
});
