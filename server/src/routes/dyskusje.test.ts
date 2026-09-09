import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* WARTOŚCIOWYCH IMPORTÓW SERWISU NIE MA TU CELOWO — patrz `reklamacje.test.ts`:
   statyczny import biegnie PRZED ciałem modułu, więc `config` i `db` ładowały
   się zanim ta linia ustawiła `DB_PATH`, i cały plik pracował na prawdziwej
   bazie biura. Serwisy dociągamy dynamicznie w `before()`. */
process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wertis-dyskusje-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* Trasy dyskusji pilnują pięciu rzeczy, z których żadna nie mieszka w serwisie:

   1. BRAMKA ROLI TAKŻE NA ODCZYCIE. Dyskusja niesie login kupującego, treść
      jego zgłoszenia i numer zamówienia — dane biura, nie hali.
   2. ZERO ZAPISU PRZY PATRZENIU (blizna 0.18.0).
   3. LICZNIK ZAPISÓW JEST UMOWĄ — cztery, z czego jeden uprzywilejowany.
   4. STRAŻNIK ADRESÓW. Każdy adres z `panel/src/api/dyskusje.ts` ma trasę —
      ta sama blizna, którą skrzynka kupiła w 0.181.0, a reklamacje powtórzyły
      u siebie. Dokładając front, dokłada się jego strażnika.
   5. 401 PRZED 403. Brak sesji to inna naprawa niż zła rola.                */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let dyskusja = 0;
let reklamacja = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["reklamacja_outbox", "reklamacja_zalacznik", "reklamacja_wiadomosc",
    "reklamacja_klienta", "allegro_reklamacja", "allegro_reklamacje_sync_state",
    "message", "conversation", "channel_account", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  dyskusja = Number(d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,
    typ,order_id,kupujacy_login,temat,status_allegro,czat_aktywny,
    ostatnia_wiadomosc_status,ostatnia_wiadomosc_at,wiadomosci_ile,otwarto_at,synced_at)
    VALUES (?,'d-1','DISPUTE','ord-1','kupujacy1','Przesyłka nie dotarła',
      'DISPUTE_ONGOING',1,'BUYER_REPLIED','2026-09-06T10:01:00Z',1,
      '2026-09-06T10:00:00Z','2026-09-07T10:00:00Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO reklamacja_wiadomosc(reklamacja_id,external_id,autor_login,autor_rola,
    tresc,utworzono_at) VALUES (?,'w-1','kupujacy1','BUYER','Przesyłka nie dotarła',
    '2026-09-06T10:01:00Z')`).run(dyskusja);
  reklamacja = Number(d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,
    typ,order_id,kupujacy_login,status_allegro,decyzja_do,wiadomosci_ile,otwarto_at,synced_at)
    VALUES (?,'i-9','CLAIM','ord-1','kupujacy1','CLAIM_SUBMITTED','2126-09-20T10:00:00Z',0,
      '2026-09-06T10:00:00Z','2026-09-07T10:00:00Z')`).run(konto).lastInsertRowid);
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
  { method: "GET" as const, url: "/api/obsluga/dyskusje" },
  { method: "GET" as const, url: `/api/obsluga/dyskusje/${dyskusja}` },
  { method: "POST" as const, url: `/api/obsluga/dyskusje/${dyskusja}/prowadze` },
  { method: "POST" as const, url: `/api/obsluga/dyskusje/${dyskusja}/notatka` },
  { method: "POST" as const, url: `/api/obsluga/dyskusje/${dyskusja}/odpowiedz` },
  { method: "POST" as const, url: `/api/obsluga/dyskusje/${dyskusja}/zakoncz` },
];

test("bez sesji żadna trasa dyskusji nie odpowiada danymi", async () => {
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url });
    assert.equal(r.statusCode, 401, `${t.method} ${t.url} przepuścił brak sesji`);
  }
});

test("hala nie widzi dyskusji — bramka roli stoi też na odczycie", async () => {
  const { naglowki } = login("magazynier", "Magazynier Marek");
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, headers: naglowki });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url} wpuścił halę`);
    assert.match(r.json().error, /biuro/, "odmowa mówi, kto to prowadzi");
  }
});

test("CZTERY ZAPISY — licznik jest umową", () => {
  /* Trzy zostają u nas albo są zwykłą pracą biura: „prowadzę", notatka
     i odpowiedź w rozmowie. Czwarty, PROŚBA O ZAKOŃCZENIE, wychodzi do
     kupującego i nie da się jej cofnąć — jako jedyny stoi za `autoryzuj()`
     z wpisem `privileged`. Każdy nowy zapis dostaje zdanie w uzasadnieniu.

     Trasy „synchronizuj" tu NIE MA i to jest decyzja: dyskusje i reklamacje
     przyjeżdżają jedną listą, więc drugi przycisk byłby drugą drogą w limit 429. */
  const zapisy = TRASY().filter((t) => t.method === "POST");
  assert.equal(zapisy.length, 4);
  assert.ok(!TRASY().some((t) => t.url.endsWith("synchronizuj")),
    "synchronizacja jest wspólna z reklamacjami");
});

test("otwarcie kolejki i sprawy NICZEGO nie zapisuje", async () => {
  const { naglowki } = login("biuro", "Ala patrzy");
  const ile = () => (db().prepare(
    "SELECT (SELECT COUNT(*) FROM events) AS e, (SELECT COUNT(*) FROM reklamacja_outbox) AS o")
    .get() as { e: number; o: number });
  const przed = { ...ile() };
  await app.inject({ method: "GET", url: "/api/obsluga/dyskusje", headers: naglowki });
  await app.inject({ method: "GET", url: `/api/obsluga/dyskusje/${dyskusja}`, headers: naglowki });
  assert.deepEqual({ ...ile() }, przed);
});

test("kolejka niesie kubełek, czekanie, sygnały i liczniki", async () => {
  const { naglowki } = login("biuro", "Ala z biura");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/dyskusje", headers: naglowki });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.dyskusje.length, 1, "reklamacja z tej samej tabeli tu nie wchodzi");
  const d = body.dyskusje[0];
  assert.equal(d.externalId, "d-1");
  assert.equal(d.kubelek, "odpowiedz");
  assert.ok(d.sygnaly.includes("klient_czeka"));
  assert.equal(typeof d.czekaOdDni, "number");
  assert.deepEqual(body.liczniki, { odpowiedz: 1, klient: 0, zamknieta: 0 });
  assert.ok(body.stan, "pasek synchronizacji jest wspólny z reklamacjami");
});

test("reklamacji nie da się otworzyć ekranem dyskusji ani odwrotnie", async () => {
  const { naglowki } = login("biuro", "Ala granica");
  const zla = await app.inject({
    method: "GET", url: `/api/obsluga/dyskusje/${reklamacja}`, headers: naglowki });
  assert.equal(zla.statusCode, 404);
  const odwrotnie = await app.inject({
    method: "GET", url: `/api/obsluga/reklamacje/${dyskusja}`, headers: naglowki });
  assert.equal(odwrotnie.statusCode, 404);
});

test("prośba o zakończenie: wersja obowiązkowa, wpis privileged, dziennik bez treści", async () => {
  const { naglowki } = login("biuro", "Ala kończy");
  const bez = await app.inject({
    method: "POST", url: `/api/obsluga/dyskusje/${dyskusja}/zakoncz`,
    headers: naglowki, payload: { tresc: "Dziękuję za rozmowę" } });
  assert.equal(bez.statusCode, 400, "prośba bez wersji sprawy to prośba w ciemno");
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM events WHERE type='privileged'")
    .get() as { n: number }).n, 0, "odrzucone ciało nie zostawia wpisu privileged");

  const r = await app.inject({
    method: "POST", url: `/api/obsluga/dyskusje/${dyskusja}/zakoncz`, headers: naglowki,
    payload: { tresc: "Adres: Kowalskiego 5", wersja: 1, expectedLastMessageId: null } });
  /* Bez sparowanego konta Allegro wysyłka pada — i to jest w porządku: ten test
     pilnuje BRAMEK i dziennika, nie szczęśliwej ścieżki (ta stoi w teście
     serwisu, gdzie adapter jest wstrzykiwany). */
  assert.ok([200, 400, 409, 502].includes(r.statusCode), String(r.statusCode));
  const wpisy = (db().prepare("SELECT type, payload FROM events ORDER BY id").all() as
    Array<{ type: string; payload: string | null }>);
  const priv = wpisy.find((w) => w.type === "privileged");
  assert.ok(priv, "prośba o zakończenie zostawia wpis privileged");
  assert.match(priv.payload ?? "", /dyskusja_zakonczenie/,
    "wpis niesie WŁASNĄ nazwę operacji, nie werdyktową");
  for (const w of wpisy) {
    assert.ok(!(w.payload ?? "").includes("Kowalskiego"), `treść wyciekła do ${w.type}`);
  }
});

test("notatka przyjmuje tekst i `null`, a liczby odrzuca zdaniem", async () => {
  const { naglowki } = login("biuro", "Ala notuje");
  const zla = await app.inject({
    method: "POST", url: `/api/obsluga/dyskusje/${dyskusja}/notatka`,
    headers: naglowki, payload: { notatka: 7 } });
  assert.equal(zla.statusCode, 400);
  const ok = await app.inject({
    method: "POST", url: `/api/obsluga/dyskusje/${dyskusja}/notatka`,
    headers: naglowki, payload: { notatka: "Kurier zgubił paczkę" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().dyskusja.notatka, "Kurier zgubił paczkę");
});

test("każdy adres wołany z panel/src/api/dyskusje.ts ma trasę na serwerze", async () => {
  const zrodlo = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../panel/src/api/dyskusje.ts"), "utf8");
  /* Adresy stoją w obu cudzysłowach: `"…"` bez parametru i `` `…` `` z `${id}`. */
  const wywolania = [...zrodlo.matchAll(
    /api(?:<[^>]*>)?\(\s*[`"]([^`"]+)[`"](?:\s*,\s*\{[^}]*?method:\s*"(GET|POST|PUT|DELETE)")?/gs)];
  assert.ok(wywolania.length >= 5,
    `spodziewałem się co najmniej pięciu wywołań api(), jest ${wywolania.length}`);
  const { naglowki } = login("biuro", "Strażnik adresów");
  const bledne: string[] = [];
  for (const [, adres, metoda] of wywolania) {
    const url = adres.replace(/\$\{[^}]+\}/g, "1").replace(/\?.*$/, "");
    const method = (metoda ?? "GET") as "GET" | "POST" | "PUT" | "DELETE";
    const r = await app.inject({ method, url, headers: naglowki,
      ...(method === "GET" ? {} : { payload: {} }) });
    const tresc = r.json<{ message?: string }>();
    if (r.statusCode === 404 && /^Route /.test(tresc.message ?? "")) bledne.push(`${method} ${adres}`);
  }
  assert.deepEqual(bledne, [], "panel woła adresy bez trasy na serwerze");
});
