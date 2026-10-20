import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Lista towarów bez zdjęcia (ekran biura) ─────────────────────────────────
   Konfiguracja jak przy zapisie do Subiekta, bo lista czyta bazę firmy,
   a `blob` przy SGT_MODE=seeded nie przechodzi walidacji. Samej bazy tu nie
   ma, więc źródło podmienia `ustawZrodloBezZdjecia`. Pilnujemy kontraktu
   z panelem: kształtu, filtrowania, stronicowania, `oczekuje` i odmów. */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdjb-"));
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

type Zrodlo = Parameters<typeof import("../services/zdjecia-bez.js").ustawZrodloBezZdjecia>[0];

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let config: typeof import("../config.js").config;
let ustawZrodlo: (fn: Zrodlo) => void;

/** Udawana kartoteka Subiekta: to, co zwróciłby SELECT po filtrze. */
const KARTOTEKA = [
  { twId: 1, symbol: "A-01", nazwa: "Kosa", ean: "590123", stan: 4, sprzedaz: 7 },
  { twId: 2, symbol: "B-02", nazwa: "Grabie", ean: null, stan: 0, sprzedaz: 0 },
  { twId: 3, symbol: "C-03", nazwa: "Sekator", ean: "590777", stan: 12.5, sprzedaz: 2 },
];
let wywolania: Array<{ q: string; limit: number; offset: number; sortuj: string; naStanie: boolean; sprzedane: boolean }> = [];

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  ({ config } = await import("../config.js"));
  ({ ustawZrodloBezZdjecia: ustawZrodlo } = await import("../services/zdjecia-bez.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zdjecie_wlasne", "device_session", "app_user", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  wywolania = [];
  ustawZrodlo(async (z) => {
    wywolania.push(z);
    const q = z.q.toLowerCase();
    const pasuje = KARTOTEKA.filter(
      (t) => !q || [t.symbol, t.nazwa, t.ean ?? ""].some((v) => v.toLowerCase().includes(q))
    );
    return { razem: pasuje.length, pozycje: pasuje.slice(z.offset, z.offset + z.limit) };
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
  app.inject({ method: "GET", url: `/api/zdjecia/bez-zdjecia${query}`, headers });

const zapisy = (): number =>
  (db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;

test("biuro dostaje stronę w kształcie kontraktu", async () => {
  const r = await lista(sesja("biuro"));
  assert.equal(r.statusCode, 200, r.payload);
  assert.deepEqual(r.json(), {
    wlaczone: true,
    razem: 3,
    pozycje: [
      { twId: 1, symbol: "A-01", nazwa: "Kosa", ean: "590123", stan: 4, sprzedaz: 7, oczekuje: false },
      { twId: 2, symbol: "B-02", nazwa: "Grabie", ean: null, stan: 0, sprzedaz: 0, oczekuje: false },
      { twId: 3, symbol: "C-03", nazwa: "Sekator", ean: "590777", stan: 12.5, sprzedaz: 2, oczekuje: false },
    ],
  });
  assert.deepEqual(wywolania, [{ q: "", limit: 50, offset: 0, sortuj: "sprzedaz", naStanie: false, sprzedane: false }]);
});

test("admin też widzi listę — rola z ROLE_BIUROWE, nie z palca", async () => {
  assert.equal((await lista(sesja("admin"))).statusCode, 200);
});

test("magazynier dostaje 403, bez sesji 401", async () => {
  assert.equal((await lista(sesja("magazynier"))).statusCode, 403);
  assert.equal((await lista({})).statusCode, 401);
  assert.equal(wywolania.length, 0, "odmowa nie ma prawa pytać bazy Subiekta");
});

test("q filtruje i dochodzi do źródła przycięte", async () => {
  const r = await lista(sesja("biuro"), "?q=%20sekator%20");
  assert.equal(r.json().razem, 1);
  assert.equal(r.json().pozycje[0].twId, 3);
  assert.equal(wywolania[0].q, "sekator");
});

/* Domyślnie sprzedaż: zdjęcie chodliwego towaru pracuje na każdej ofercie.
   Nieznana nazwa ze starej zakładki wraca do domyślnej zamiast wywracać ekran. */
test("sortowanie i filtr stanu dochodzą do źródła, śmieci dają domyślne", async () => {
  const h = sesja("biuro");
  for (const s of ["sprzedaz", "stan", "symbol", "nazwa", "najnowsze", "DROP", ""]) {
    await lista(h, `?sortuj=${s}`);
  }
  await lista(h, "?naStanie=1");
  await lista(h, "?naStanie=0");
  assert.deepEqual(
    wywolania.map((w) => w.sortuj),
    ["sprzedaz", "stan", "symbol", "nazwa", "najnowsze", "sprzedaz", "sprzedaz", "sprzedaz", "sprzedaz"]
  );
  assert.deepEqual(wywolania.slice(-2).map((w) => w.naStanie), [true, false]);
  await lista(h, "?sprzedane=1");
  await lista(h, "?sprzedane=tak");
  assert.deepEqual(wywolania.slice(-2).map((w) => w.sprzedane), [true, false]);
});

test("limit przycięty do 1..200, śmieci dają wartości domyślne", async () => {
  const h = sesja("biuro");
  await lista(h, "?limit=5000&offset=1");
  await lista(h, "?limit=0&offset=-4");
  await lista(h, "?limit=abc&offset=xyz");
  assert.deepEqual(wywolania, [
    { q: "", limit: 200, offset: 1, sortuj: "sprzedaz", naStanie: false, sprzedane: false },
    { q: "", limit: 1, offset: 0, sortuj: "sprzedaz", naStanie: false, sprzedane: false },
    { q: "", limit: 50, offset: 0, sortuj: "sprzedaz", naStanie: false, sprzedane: false },
  ]);
});

test("stronicowanie: razem liczy wszystko, pozycje tylko stronę", async () => {
  const r = await lista(sesja("biuro"), "?limit=1&offset=1");
  assert.equal(r.json().razem, 3);
  assert.deepEqual(r.json().pozycje.map((p: { twId: number }) => p.twId), [2]);
});

/* Zdjęcie dodane u nas, którego Subiekt jeszcze nie ma, wciąż wychodzi
   w zapytaniu. Bez flagi biuro robiłoby to samo zdjęcie drugi raz. */
test("oczekuje = zdjęcie leży w WERTIS i czeka na Subiekt", async () => {
  const teraz = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO zdjecie_wlasne(tw_id, obraz, mime, bajtow, etag, tlo_usuniete, dodane_at, dodane_by, w_subiekcie_at)
       VALUES (2, x'ffd8ff', 'image/jpeg', 3, 'e', 0, ?, 'biuro', NULL)`
    )
    .run(teraz);
  const r = await lista(sesja("biuro"));
  const flagi = r.json().pozycje.map((p: { twId: number; oczekuje: boolean }) => [p.twId, p.oczekuje]);
  assert.deepEqual(flagi, [[1, false], [2, true], [3, false]]);
});

test("otwarcie listy niczego nie zapisuje", async () => {
  const h = sesja("biuro");
  const przed = zapisy();
  await lista(h, "?q=kosa");
  assert.equal(zapisy(), przed);
});

test("wyłączone dodawanie: 200, wlaczone=false i powód, bez pytania bazy", async () => {
  config.zdjecia.dodawanie = "";
  const r = await lista(sesja("biuro"));
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().wlaczone, false);
  assert.match(r.json().powod, /ZDJECIA_DODAWANIE/);
  assert.deepEqual(r.json().pozycje, []);
  assert.equal(r.json().razem, 0);
  assert.equal(wywolania.length, 0);
});

test("źródło inne niż blob: wlaczone=false z powodem", async () => {
  config.zdjecia.zrodlo = "plik";
  const r = await lista(sesja("biuro"));
  assert.equal(r.json().wlaczone, false);
  assert.match(r.json().powod, /ZDJECIA_ZRODLO=blob/);
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
