import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Lista towarów ZE zdjęciem (szukanie niewyraźnych) ───────────────────────
   Konfiguracja jak przy liście braków, bo obie czytają bazę firmy. Samej
   bazy tu nie ma, więc źródło podmienia `ustawZrodloZeZdjeciem`. Pilnujemy
   kontraktu z panelem: kształtu, stronicowania, `oczekuje` i odmów. */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdjz-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "mssql";
process.env.MSSQL_SERVER = "127.0.0.1";
process.env.MSSQL_DATABASE = "nieuzywana";
process.env.MSSQL_USER = "wertis";
process.env.MSSQL_PASSWORD = "nieuzywane";
process.env.ZDJECIA_ZRODLO = "blob";
process.env.ZDJECIA_TABELA = "tw_ZdjecieTw";
process.env.ZDJECIA_KOLUMNA_KLUCZA = "zd_IdTowar";
process.env.ZDJECIA_KOLUMNA = "zd_Zdjecie";
process.env.ZDJECIA_KOLUMNA_KOLEJNOSC = "zd_Id";
process.env.ZDJECIA_DODAWANIE = "wertis";
process.env.TLO_URL = "";

type Zrodlo = Parameters<typeof import("../services/zdjecia-ze.js").ustawZrodloZeZdjeciem>[0];

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let config: typeof import("../config.js").config;
let ustawZrodlo: (fn: Zrodlo) => void;

/** Udawana kartoteka Subiekta: to, co zwróciłby SELECT, w porządku sprzedaży. */
const KARTOTEKA = [
  { twId: 1, symbol: "A-01", nazwa: "Kosa", bajtow: 18_000 },
  { twId: 2, symbol: "B-02", nazwa: "Grabie", bajtow: null },
  { twId: 3, symbol: "C-03", nazwa: "Sekator", bajtow: 240_512 },
];
let wywolania: Array<{ limit: number; offset: number }> = [];

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  ({ config } = await import("../config.js"));
  ({ ustawZrodloZeZdjeciem: ustawZrodlo } = await import("../services/zdjecia-ze.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zdjecie_wlasne", "sfera_queue", "device_session", "app_user", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  wywolania = [];
  ustawZrodlo(async (z) => {
    wywolania.push(z);
    return { razem: KARTOTEKA.length, pozycje: KARTOTEKA.slice(z.offset, z.offset + z.limit) };
  });
});

afterEach(() => {
  ustawZrodlo(null);
  config.zdjecia.zrodlo = "blob";
  config.zdjecia.dodawanie = "wertis";
});

function sesja(rola: "biuro" | "admin" | "magazynier"): Record<string, string> {
  const u = createUser(`Osoba ${rola}`, rola);
  const token = `tok-${rola}-${Math.random()}`;
  const teraz = new Date().toISOString();
  db()
    .prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, u.userId, "panel", teraz, teraz);
  return { "x-session": token };
}

const lista = (headers: Record<string, string>, query = "") =>
  app.inject({ method: "GET", url: `/api/zdjecia/ze-zdjeciem${query}`, headers });

/** Wszystko, co trasa mogłaby zapisać: zdarzenia, kolejka i własne zdjęcia. */
const zapisy = (): number =>
  ["events", "sfera_queue", "zdjecie_wlasne"]
    .map((t) => (db().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n)
    .reduce((a, b) => a + b, 0);

test("biuro dostaje stronę w kształcie kontraktu, domyślnie 200 pozycji", async () => {
  const r = await lista(sesja("biuro"));
  assert.equal(r.statusCode, 200, r.payload);
  assert.deepEqual(r.json(), {
    wlaczone: true,
    razem: 3,
    pozycje: [
      { twId: 1, symbol: "A-01", nazwa: "Kosa", bajtow: 18_000, oczekuje: false },
      { twId: 2, symbol: "B-02", nazwa: "Grabie", bajtow: null, oczekuje: false },
      { twId: 3, symbol: "C-03", nazwa: "Sekator", bajtow: 240_512, oczekuje: false },
    ],
  });
  assert.deepEqual(wywolania, [{ limit: 200, offset: 0 }]);
});

test("admin też widzi listę — rola z ROLE_BIUROWE, nie z palca", async () => {
  assert.equal((await lista(sesja("admin"))).statusCode, 200);
});

test("magazynier dostaje 403, bez sesji 401, bez pytania bazy", async () => {
  assert.equal((await lista(sesja("magazynier"))).statusCode, 403);
  assert.equal((await lista({})).statusCode, 401);
  assert.equal(wywolania.length, 0);
});

test("limit przycięty do 1..200, śmieci dają wartości domyślne", async () => {
  const h = sesja("biuro");
  await lista(h, "?limit=5000&offset=1");
  await lista(h, "?limit=0&offset=-4");
  await lista(h, "?limit=abc&offset=xyz");
  await lista(h, "?limit=20&offset=40");
  assert.deepEqual(wywolania, [
    { limit: 200, offset: 1 },
    { limit: 1, offset: 0 },
    { limit: 200, offset: 0 },
    { limit: 20, offset: 40 },
  ]);
});

test("stronicowanie: razem liczy wszystko, pozycje tylko stronę", async () => {
  const r = await lista(sesja("biuro"), "?limit=1&offset=2");
  assert.equal(r.json().razem, 3);
  assert.deepEqual(r.json().pozycje.map((p: { twId: number }) => p.twId), [3]);
});

/* Zdjęcie czekające w kolejce zmieni kartotekę za chwilę. Mierzenie starego
   i ponowna zamiana dałyby Subiektowi dwa zadania na jeden towar. */
test("oczekuje = zdjęcie leży w WERTIS i czeka na Subiekt", async () => {
  db()
    .prepare(
      `INSERT INTO zdjecie_wlasne(tw_id, obraz, mime, bajtow, etag, tlo_usuniete, dodane_at, dodane_by, w_subiekcie_at)
       VALUES (3, x'ffd8ff', 'image/jpeg', 3, 'e', 0, ?, 'biuro', NULL)`
    )
    .run(new Date().toISOString());
  const r = await lista(sesja("biuro"));
  const flagi = r.json().pozycje.map((p: { twId: number; oczekuje: boolean }) => [p.twId, p.oczekuje]);
  assert.deepEqual(flagi, [[1, false], [2, false], [3, true]]);
});

test("otwarcie listy niczego nie zapisuje", async () => {
  const h = sesja("biuro");
  const przed = zapisy();
  await lista(h);
  await lista(h, "?limit=1&offset=1");
  assert.equal(zapisy(), przed);
});

test("wyłączone dodawanie albo źródło inne niż blob: wlaczone=false z powodem, bez bazy", async () => {
  config.zdjecia.dodawanie = "";
  const r = await lista(sesja("biuro"));
  assert.equal(r.statusCode, 200);
  const { powod, ...reszta } = r.json() as { powod: string };
  assert.deepEqual(reszta, { wlaczone: false, razem: 0, pozycje: [] });
  assert.match(powod, /ZDJECIA_DODAWANIE/);
  config.zdjecia.dodawanie = "wertis";
  config.zdjecia.zrodlo = "plik";
  assert.match((await lista(sesja("biuro"))).json().powod, /ZDJECIA_ZRODLO=blob/);
  assert.equal(wywolania.length, 0);
});

test("awaria bazy Subiekta to 503 z powodem, nie „wyłączone”", async () => {
  ustawZrodlo(async () => {
    throw new Error("Login failed for user 'wertis'");
  });
  const r = await lista(sesja("biuro"));
  assert.equal(r.statusCode, 503);
  assert.match(r.json().error, /Login failed/);
});
