import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Import zdjęć z folderu (ekran biura) ────────────────────────────────────
   Dwie trasy. `dopasuj` mówi, który plik trafi w kartotekę, i niczego nie
   zapisuje. `gotowe` zapisuje obraz złożony w przeglądarce tą samą drogą
   co zatwierdzenie podglądu. Konfiguracja jak przy liście braków, bo
   dopasowanie czyta bazę firmy; samą bazę podmienia `ustawZrodloDopasowania`. */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdji-"));
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

type Zrodlo = Parameters<typeof import("../services/zdjecia-import.js").ustawZrodloDopasowania>[0];
type Wiersz = { twId: number; symbol: string; nazwa: string; maZdjecie: boolean; zablokowany: boolean };

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let config: typeof import("../config.js").config;
let ustawZrodlo: (fn: Zrodlo) => void;

/** Udawana kartoteka Subiekta. Symbol z białym znakiem, jak po imporcie bez przycięcia. */
const KARTOTEKA: Wiersz[] = [
  { twId: 1, symbol: "W08-0501", nazwa: "Kosa", maZdjecie: false, zablokowany: false },
  { twId: 2, symbol: "W08-0502 ", nazwa: "Grabie", maZdjecie: true, zablokowany: false },
  { twId: 3, symbol: "ŁOP-1", nazwa: "Łopata", maZdjecie: false, zablokowany: true },
  /* Ten sam symbol dwa razy: aktywna karta wygrywa z zablokowaną. */
  { twId: 4, symbol: "DUP-A", nazwa: "Stara", maZdjecie: false, zablokowany: true },
  { twId: 5, symbol: "DUP-A", nazwa: "Nowa", maZdjecie: false, zablokowany: false },
  /* Dwie aktywne: żadna nie dostaje zdjęcia przypadkiem. */
  { twId: 6, symbol: "DUP-B", nazwa: "Pierwsza", maZdjecie: false, zablokowany: false },
  { twId: 7, symbol: "DUP-B", nazwa: "Druga", maZdjecie: false, zablokowany: false },
];
let wywolania: string[][] = [];

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  ({ config } = await import("../config.js"));
  ({ ustawZrodloDopasowania: ustawZrodlo } = await import("../services/zdjecia-import.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zdjecie_wlasne", "sfera_queue", "device_session", "app_user", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1,'W08-0501','Kosa','590','')"
  ).run();
  d.prepare("DELETE FROM sgt_towar WHERE tw_id = 999").run();
  wywolania = [];
  /* Udaje kolację Subiekta: bez wielkości liter, kolumna przycięta. */
  ustawZrodlo(async (symbole) => {
    wywolania.push(symbole);
    const szukane = new Set(symbole.map((s) => s.toLocaleLowerCase("pl")));
    return KARTOTEKA.filter((t) => szukane.has(t.symbol.trim().toLocaleLowerCase("pl")));
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

const dopasuj = (headers: Record<string, string>, payload: unknown) =>
  app.inject({ method: "POST", url: "/api/zdjecia/dopasuj", headers, payload: payload as object });

const gotowe = (headers: Record<string, string>, payload: Record<string, unknown>, twId = 1) =>
  app.inject({ method: "POST", url: `/api/products/${twId}/zdjecie/gotowe`, headers, payload });

const zdarzen = (): number => (db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;

const dodanych = (): number =>
  (db().prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'zdjecie_dodane'").get() as { n: number }).n;

function czekajace(twId: number): void {
  db()
    .prepare(
      `INSERT INTO zdjecie_wlasne(tw_id, obraz, mime, bajtow, etag, tlo_usuniete, dodane_at, dodane_by, w_subiekcie_at)
       VALUES (?, x'ffd8ff', 'image/jpeg', 3, 'e', 0, ?, 'biuro', NULL)`
    )
    .run(twId, new Date().toISOString());
}

// ── POST /api/zdjecia/dopasuj ───────────────────────────────────────────────

test("dopasuj: jedna pozycja na symbol, w kolejności wejścia, w kształcie kontraktu", async () => {
  czekajace(1);
  const r = await dopasuj(sesja("biuro"), {
    symbole: ["w08-0502", " W08-0501 ", "NIE-MA", "łop-1", "DUP-A", "DUP-B"],
  });
  assert.equal(r.statusCode, 200, r.payload);
  assert.deepEqual(r.json(), {
    wlaczone: true,
    pozycje: [
      { symbol: "w08-0502", twId: 2, nazwa: "Grabie", maZdjecie: true, oczekuje: false, zablokowany: false },
      { symbol: "W08-0501", twId: 1, nazwa: "Kosa", maZdjecie: false, oczekuje: true, zablokowany: false },
      { symbol: "NIE-MA", twId: null, nazwa: null, maZdjecie: false, oczekuje: false, zablokowany: false },
      { symbol: "łop-1", twId: 3, nazwa: "Łopata", maZdjecie: false, oczekuje: false, zablokowany: true },
      { symbol: "DUP-A", twId: 5, nazwa: "Nowa", maZdjecie: false, oczekuje: false, zablokowany: false },
      {
        symbol: "DUP-B", twId: null, nazwa: null, maZdjecie: false, oczekuje: false, zablokowany: false,
        niejednoznaczny: true,
      },
    ],
  });
});

test("dopasuj: puste odrzucone, duplikaty scalone, do bazy jedzie każdy symbol raz", async () => {
  const r = await dopasuj(sesja("biuro"), { symbole: ["W08-0501", "", "   ", "W08-0501", " W08-0501"] });
  assert.equal(r.statusCode, 200, r.payload);
  assert.deepEqual(r.json().pozycje.map((p: { symbol: string }) => p.symbol), ["W08-0501"]);
  assert.deepEqual(wywolania, [["W08-0501"]]);
});

test("dopasuj: pusta lista nie pyta bazy", async () => {
  const r = await dopasuj(sesja("biuro"), { symbole: [] });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { wlaczone: true, pozycje: [] });
  assert.equal(wywolania.length, 0);
});

/* Symbol dłuższy niż parametr zapytania i tak nie istnieje, a ucięty dałby
   fałszywe trafienie. */
test("dopasuj: za długi symbol nie idzie do bazy i wraca bez trafienia", async () => {
  const dlugi = "W08-0501" + "x".repeat(200);
  const r = await dopasuj(sesja("biuro"), { symbole: [dlugi, "W08-0501"] });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(wywolania, [["W08-0501"]]);
  assert.equal(r.json().pozycje[0].twId, null);
  assert.equal(r.json().pozycje[1].twId, 1);
});

test("dopasuj: więcej niż 2000 symboli → 400, bez pytania bazy", async () => {
  const r = await dopasuj(sesja("biuro"), { symbole: Array.from({ length: 2001 }, (_, i) => `S${i}`) });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /2000/);
  assert.equal(wywolania.length, 0);
  const rowno = await dopasuj(sesja("biuro"), { symbole: Array.from({ length: 2000 }, (_, i) => `S${i}`) });
  assert.equal(rowno.statusCode, 200);
});

test("dopasuj: zły kształt ciała → 400", async () => {
  const h = sesja("biuro");
  assert.equal((await dopasuj(h, {})).statusCode, 400);
  assert.equal((await dopasuj(h, { symbole: "W08-0501" })).statusCode, 400);
  assert.equal((await dopasuj(h, { symbole: ["W08-0501", 12] })).statusCode, 400);
  assert.equal(wywolania.length, 0);
});

test("dopasuj: biuro i admin 200, magazynier 403, bez sesji 401", async () => {
  assert.equal((await dopasuj(sesja("biuro"), { symbole: ["W08-0501"] })).statusCode, 200);
  assert.equal((await dopasuj(sesja("admin"), { symbole: ["W08-0501"] })).statusCode, 200);
  const przed = wywolania.length;
  assert.equal((await dopasuj(sesja("magazynier"), { symbole: ["W08-0501"] })).statusCode, 403);
  assert.equal((await dopasuj({}, { symbole: ["W08-0501"] })).statusCode, 401);
  assert.equal(wywolania.length, przed, "odmowa nie ma prawa pytać bazy Subiekta");
});

test("dopasuj: wyłączone dodawanie i źródło inne niż blob → wlaczone=false z powodem", async () => {
  config.zdjecia.dodawanie = "";
  const r = await dopasuj(sesja("biuro"), { symbole: ["W08-0501"] });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().wlaczone, false);
  assert.match(r.json().powod, /ZDJECIA_DODAWANIE/);
  assert.deepEqual(r.json().pozycje, []);

  config.zdjecia.dodawanie = "wertis";
  config.zdjecia.zrodlo = "plik";
  const p = await dopasuj(sesja("biuro"), { symbole: ["W08-0501"] });
  assert.equal(p.json().wlaczone, false);
  assert.match(p.json().powod, /ZDJECIA_ZRODLO=blob/);
  assert.equal(wywolania.length, 0);
});

test("dopasuj: awaria bazy Subiekta to 503 z powodem", async () => {
  ustawZrodlo(async () => {
    throw new Error("Login failed for user 'wertis'");
  });
  const r = await dopasuj(sesja("biuro"), { symbole: ["W08-0501"] });
  assert.equal(r.statusCode, 503);
  assert.match(r.json().error, /Login failed/);
});

test("dopasuj: niczego nie zapisuje", async () => {
  const h = sesja("biuro");
  const przed = zdarzen();
  await dopasuj(h, { symbole: ["W08-0501", "NIE-MA"] });
  assert.equal(zdarzen(), przed);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM zdjecie_wlasne").get() as { n: number }).n, 0);
});

// ── POST /api/products/:twId/zdjecie/gotowe ─────────────────────────────────

const zapisane = () =>
  db().prepare("SELECT obraz, mime, tlo_usuniete, queue_id FROM zdjecie_wlasne WHERE tw_id = 1").get() as
    | { obraz: Uint8Array; mime: string; tlo_usuniete: number; queue_id: number | null }
    | undefined;

const zdarzenie = () =>
  JSON.parse(
    (db().prepare("SELECT payload FROM events WHERE type = 'zdjecie_dodane'").get() as { payload: string }).payload
  );

test("gotowe bez zapisu do Subiekta: zdjęcie w WERTIS, zdarzenie z nazwą pliku, bez kolejki", async () => {
  const r = await gotowe(sesja("biuro"), {
    gotowy: "data:image/jpeg;base64," + JPEG.toString("base64"),
    zrodlo: "import",
    plik: "W08-0501.jpg",
  });
  assert.equal(r.statusCode, 200, r.payload);
  const w = zapisane();
  assert.ok(w);
  assert.deepEqual(Buffer.from(w.obraz), JPEG);
  assert.equal(w.mime, "image/jpeg");
  assert.equal(w.tlo_usuniete, 0);
  assert.deepEqual(Object.keys(r.json()).sort(), ["bajtow", "etag", "queueId", "wSubiekcie"]);
  assert.equal(r.json().queueId, null);
  assert.equal(r.json().wSubiekcie, false);
  assert.equal(r.json().bajtow, JPEG.length);
  assert.deepEqual(zdarzenie(), {
    bajtow: JPEG.length, tloUsuniete: false, zrodlo: "import", queueId: null, plik: "W08-0501.jpg",
  });
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM sfera_queue").get() as { n: number }).n, 0);
});

test("gotowe z ZDJECIA_DODAWANIE=subiekt: zadanie set_zdjecie i audyt z plikiem", async () => {
  config.zdjecia.dodawanie = "subiekt";
  const r = await gotowe(sesja("admin"), { gotowy: JPEG.toString("base64"), plik: "W08-0501.jpg" });
  assert.equal(r.statusCode, 200, r.payload);
  const { queueId, wSubiekcie } = r.json();
  assert.equal(wSubiekcie, true);
  assert.ok(Number.isInteger(queueId));
  const z = db().prepare("SELECT type, payload, label, tw_id FROM sfera_queue WHERE id = ?").get(queueId) as {
    type: string; payload: string; label: string; tw_id: number;
  };
  assert.equal(z.type, "set_zdjecie");
  assert.deepEqual(JSON.parse(z.payload), { twId: 1 });
  assert.equal(z.label, "Zdjęcie · W08-0501");
  assert.equal(zapisane()!.queue_id, queueId);
  assert.deepEqual(zdarzenie(), {
    bajtow: JPEG.length, tloUsuniete: false, zrodlo: "import", queueId, plik: "W08-0501.jpg",
  });
});

test("gotowe: nazwa pliku w audycie przycięta do 120 znaków, brak nazwy = brak pola", async () => {
  await gotowe(sesja("biuro"), { gotowy: JPEG.toString("base64"), plik: "a".repeat(300) + ".jpg" });
  assert.equal(zdarzenie().plik, "a".repeat(120));
  db().prepare("DELETE FROM zdjecie_wlasne").run();
  db().prepare("DELETE FROM events").run();
  await gotowe(sesja("biuro"), { gotowy: JPEG.toString("base64") });
  assert.equal("plik" in zdarzenie(), false);
});

/* Ponowiony import nie może podmienić zdjęcia, które czeka w kolejce. */
test("gotowe: towar ze zdjęciem czekającym na Subiekt → 409, nic się nie zmienia", async () => {
  czekajace(1);
  const r = await gotowe(sesja("biuro"), { gotowy: JPEG.toString("base64"), plik: "W08-0501.jpg" });
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /W08-0501/);
  assert.deepEqual(Buffer.from(zapisane()!.obraz), Buffer.from([0xff, 0xd8, 0xff]));
  assert.equal(dodanych(), 0);
});

test("gotowe: wyłączone dodawanie → 409", async () => {
  config.zdjecia.dodawanie = "";
  const r = await gotowe(sesja("biuro"), { gotowy: JPEG.toString("base64") });
  assert.equal(r.statusCode, 409);
  assert.equal(zapisane(), undefined);
});

test("gotowe: nieznany towar → 404", async () => {
  const r = await gotowe(sesja("biuro"), { gotowy: JPEG.toString("base64") }, 999);
  assert.equal(r.statusCode, 404);
  assert.equal((await gotowe(sesja("biuro"), { gotowy: JPEG.toString("base64") }, Number.NaN)).statusCode, 404);
});

test("gotowe: zły obraz → 400 i nic nie zapisuje", async () => {
  const h = sesja("biuro");
  const tekst = await gotowe(h, { gotowy: Buffer.from("tekst").toString("base64") });
  assert.equal(tekst.statusCode, 400);
  assert.match(tekst.json().error, /JPEG ani PNG/);
  assert.equal((await gotowe(h, { gotowy: 12 })).statusCode, 400);
  assert.equal((await gotowe(h, {})).statusCode, 400);
  assert.equal(zapisane(), undefined);
  assert.equal(dodanych(), 0);
});

test("gotowe: za duży obraz → 400 z limitem ZDJECIA_UPLOAD_MAX_KB", async () => {
  const wielki = Buffer.concat([JPEG, Buffer.alloc(600 * 1024)]);
  const r = await gotowe(sesja("biuro"), { gotowy: wielki.toString("base64") });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /maksimum to 512 kB/);
  assert.equal(zapisane(), undefined);
});

test("gotowe: magazynier 403, bez sesji 401", async () => {
  assert.equal((await gotowe(sesja("magazynier"), { gotowy: JPEG.toString("base64") })).statusCode, 403);
  assert.equal((await gotowe({}, { gotowy: JPEG.toString("base64") })).statusCode, 401);
  assert.equal(zapisane(), undefined);
});
