import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Zdjęcia kartotek z naszych ofert Allegro (trasy) ────────────────────────
   Atrapa Allegro i CDN-u przez `ustawZaleznosciZdjecAllegro`, bez sieci.
   Pilnujemy kształtu odpowiedzi, przekładu błędów na kody HTTP, ról biura
   i źródła `allegro` w audycie zapisu gotowego zdjęcia. */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdjal-"));
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

type Deps = NonNullable<Parameters<typeof import("../services/zdjecia-allegro.js").ustawZaleznosciZdjecAllegro>[0]>;

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let config: typeof import("../config.js").config;
let ustaw: (d: Deps | null) => void;
let BladLimituAllegro: typeof import("../adapters/allegro.js").BladLimituAllegro;

let adresy: string[] = [];
let pobrania: string[] = [];
let odpowiedz: (url: string) => unknown = () => ({ offers: [] });

const ZDJ = "https://a.allegroimg.com/original/abc/zdjecie.jpg";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  ({ config } = await import("../config.js"));
  ({ ustawZaleznosciZdjecAllegro: ustaw } = await import("../services/zdjecia-allegro.js"));
  ({ BladLimituAllegro } = await import("../adapters/allegro.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zdjecie_oferty_wybor", "offer_snapshot", "zdjecie_wlasne", "sfera_queue", "device_session", "app_user", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1,'W08-0501','Kosa','590','')"
  ).run();
  adresy = [];
  pobrania = [];
  odpowiedz = () => ({ offers: [] });
  ustaw({
    apiUrl: "https://api.test",
    query: async (url) => { adresy.push(url); return odpowiedz(url); },
    pobierz: async (url) => { pobrania.push(url); return { bajty: JPEG, mime: "image/jpeg" }; },
    /* Subiekt atrapą: żadna sygnatura nie jest symbolem innej kartoteki. */
    towary: async () => [],
  });
});

afterEach(() => {
  ustaw(null);
  config.zdjecia.dodawanie = "wertis";
  config.allegro.clientId = "";
  db().prepare("DELETE FROM allegro_token").run();
});

/* Indeks wymaga połączonego konta, więc jego testy stawiają token jak skrzynka. */
function polacz(): void {
  config.allegro.clientId = "klient-testowy";
  db().prepare(`INSERT OR REPLACE INTO allegro_token(id,access_token,refresh_token,wygasa_at,srodowisko,
    polaczono_at,polaczono_przez) VALUES (1,'tok','ref',?,?,'2026-09-01T00:00:00Z','test')`)
    .run(new Date(Date.now() + 86_400_000).toISOString(), config.allegro.sandbox ? "sandbox" : "prod");
}

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
  app.inject({ method: "POST", url: "/api/zdjecia/allegro/dopasuj", headers, payload: payload as object });

const duze = (headers: Record<string, string>, offerId: string) =>
  app.inject({ method: "GET", url: `/api/zdjecia/allegro/oferta/${offerId}/zdjecie`, headers });

const oferta = (id: string, sygnatura: string, status = "ACTIVE") => ({
  id, name: `Oferta ${id}`, external: { id: sygnatura },
  publication: { status, startedAt: "2026-01-01T00:00:00Z" },
  primaryImage: { url: ZDJ },
});

// ── POST /api/zdjecia/allegro/dopasuj ───────────────────────────────────────

test("dopasuj: jedna pozycja na symbol, w kształcie kontraktu", async () => {
  odpowiedz = () => ({ offers: [oferta("10", "w08-0501"), oferta("11", "W08-0501", "ENDED")] });
  const r = await dopasuj(sesja("biuro"), { symbole: [" W08-0501 ", "NIE-MA", "W08-0501"] });
  assert.equal(r.statusCode, 200, r.payload);
  assert.deepEqual(r.json(), {
    wlaczone: true,
    pozycje: [
      { symbol: "W08-0501", ofert: 2, oferta: {
        id: "10", nazwa: "Oferta 10", status: "ACTIVE", startedAt: "2026-01-01T00:00:00Z", zdjecie: true }, po: "sygnatura", niejednoznaczny: false },
      { symbol: "NIE-MA", ofert: 0, oferta: null, po: null, niejednoznaczny: false },
    ],
  });
  assert.equal(adresy.length, 1);
  const wpis = db().prepare("SELECT user_id FROM events WHERE type='zdjecia_allegro_dopasowane'").get() as
    { user_id: string } | undefined;
  assert.equal(wpis?.user_id, "Osoba biuro");
});

test("dopasuj: ponad sto symboli to 400 bez żądania do Allegro", async () => {
  const r = await dopasuj(sesja("biuro"), { symbole: Array.from({ length: 101 }, (_, i) => `S-${i}`) });
  assert.equal(r.statusCode, 400);
  assert.equal(adresy.length, 0);
});

test("dopasuj: 429 od Allegro to 429 z czasem przerwy", async () => {
  odpowiedz = () => { throw new BladLimituAllegro("limit", 12_000); };
  const r = await dopasuj(sesja("biuro"), { symbole: ["S-1"] });
  assert.equal(r.statusCode, 429);
  assert.equal(r.json().poIluMs, 12_000);
  assert.equal(typeof r.json().error, "string");
});

test("dopasuj: inny błąd Allegro to 502", async () => {
  odpowiedz = () => { throw new Error("ECONNRESET"); };
  const r = await dopasuj(sesja("biuro"), { symbole: ["S-1"] });
  assert.equal(r.statusCode, 502);
  assert.match(r.json().error, /ECONNRESET/);
});

test("dopasuj: wyłączone dodawanie to powód i zero żądań", async () => {
  config.zdjecia.dodawanie = "";
  const r = await dopasuj(sesja("biuro"), { symbole: ["S-1"] });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().wlaczone, false);
  assert.equal(typeof r.json().powod, "string");
  assert.deepEqual(r.json().pozycje, []);
  assert.equal(adresy.length, 0);
});

test("dopasuj i duże zdjęcie: magazynier dostaje 403", async () => {
  const h = sesja("magazynier");
  assert.equal((await dopasuj(h, { symbole: ["S-1"] })).statusCode, 403);
  assert.equal((await duze(h, "10")).statusCode, 403);
  assert.equal(adresy.length + pobrania.length, 0);
});

// ── Indeks kodów producenta ─────────────────────────────────────────────────

const indeks = (headers: Record<string, string>) =>
  app.inject({ method: "GET", url: "/api/zdjecia/allegro/indeks", headers });
const lista = (headers: Record<string, string>, payload: unknown) =>
  app.inject({ method: "POST", url: "/api/zdjecia/allegro/indeks/lista", headers, payload: payload as object });
const parametry = (headers: Record<string, string>) =>
  app.inject({ method: "POST", url: "/api/zdjecia/allegro/indeks/parametry", headers, payload: {} });

test("indeks: lista, parametry i stan w kształcie kontraktu", async () => {
  polacz();
  const h = sesja("biuro");
  odpowiedz = (url) => url.includes("/sale/product-offers/")
    ? { parameters: [{ id: "224017", name: "Kod producenta", values: ["W08-0501"] }] }
    : { offers: [oferta("30", "INNA")], totalCount: 1 };

  const l = await lista(h, { offset: 0 });
  assert.equal(l.statusCode, 200, l.payload);
  assert.deepEqual(l.json(), { ofert: 1, razem: 1, nastepny: null });

  const przed = await indeks(h);
  assert.equal(przed.statusCode, 200);
  assert.equal(przed.json().ofert, 1);
  assert.equal(przed.json().zKodem, 0);
  assert.equal(przed.json().doPobrania, 1);
  assert.equal(typeof przed.json().listaAt, "string");

  const p = await parametry(h);
  assert.equal(p.statusCode, 200, p.payload);
  assert.deepEqual(p.json(), { pobrano: 1, zostalo: 0 });
  assert.deepEqual({ ...((await indeks(h)).json() as object), listaAt: null }, { ofert: 1, zKodem: 1, doPobrania: 0, listaAt: null });

  /* Sygnatura INNA nie trafia, kod producenta tak. */
  const d = await dopasuj(h, { symbole: ["W08-0501"] });
  assert.equal(d.json().pozycje[0].po, "kod_producenta");
  assert.equal(d.json().pozycje[0].oferta.id, "30");

  const typy = (db().prepare("SELECT type FROM events ORDER BY id").all() as Array<{ type: string }>).map((z) => z.type);
  assert.deepEqual(typy, ["zdjecia_allegro_indeks_lista", "zdjecia_allegro_indeks_parametry", "zdjecia_allegro_dopasowane"]);
});

test("indeks: GET to sam odczyt, bez Allegro i bez zapisu", async () => {
  polacz();
  const h = sesja("biuro");
  const przed = (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const r = await indeks(h);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(Object.keys(r.json()).sort(), ["doPobrania", "listaAt", "ofert", "zKodem"]);
  assert.equal((db().prepare("SELECT total_changes() AS n").get() as { n: number }).n, przed);
  assert.equal(adresy.length, 0);
});

test("indeks: zły offset to 400, 429 z czasem przerwy, inny błąd 502", async () => {
  polacz();
  const h = sesja("biuro");
  assert.equal((await lista(h, { offset: -1 })).statusCode, 400);
  assert.equal((await lista(h, { offset: "10" })).statusCode, 400);
  assert.equal(adresy.length, 0);

  odpowiedz = () => { throw new BladLimituAllegro("limit", 9000); };
  const l = await lista(h, {});
  assert.equal(l.statusCode, 429);
  assert.equal(l.json().poIluMs, 9000);

  odpowiedz = () => ({ offers: [oferta("31", "X")] });
  await lista(h, {});
  odpowiedz = () => { throw new BladLimituAllegro("limit", 4000); };
  const p = await parametry(h);
  assert.equal(p.statusCode, 429);
  assert.equal(p.json().poIluMs, 4000);
  odpowiedz = () => { throw new Error("ECONNRESET"); };
  assert.equal((await parametry(h)).statusCode, 502);
});

test("indeks: wyłączone dodawanie albo niepołączone konto to 409 bez żądań do Allegro", async () => {
  const h = sesja("biuro");
  /* Konto niepołączone: client_id stoi, tokena nie ma. */
  config.allegro.clientId = "klient-testowy";
  for (const r of [await indeks(h), await lista(h, {}), await parametry(h)]) {
    assert.equal(r.statusCode, 409);
    assert.match(r.json().error, /niepołączone/);
  }
  polacz();
  config.zdjecia.dodawanie = "";
  assert.equal((await indeks(h)).statusCode, 409);
  assert.equal((await lista(h, {})).statusCode, 409);
  assert.equal((await parametry(h)).statusCode, 409);
  assert.equal(adresy.length, 0);
});

test("indeks: magazynier dostaje 403 na każdej trasie", async () => {
  const h = sesja("magazynier");
  assert.equal((await indeks(h)).statusCode, 403);
  assert.equal((await lista(h, {})).statusCode, 403);
  assert.equal((await parametry(h)).statusCode, 403);
  assert.equal(adresy.length, 0);
});

// ── GET /api/zdjecia/allegro/oferta/:offerId/zdjecie ───────────────────────

test("duże zdjęcie: wybrana oferta oddaje obraz z wariantu 1280 px", async () => {
  const h = sesja("biuro");
  odpowiedz = () => ({ offers: [oferta("10", "W08-0501")] });
  await dopasuj(h, { symbole: ["W08-0501"] });
  const r = await duze(h, "10");
  assert.equal(r.statusCode, 200, r.payload);
  assert.equal(r.headers["content-type"], "image/jpeg");
  assert.equal(r.headers["cache-control"], "private, max-age=3600");
  assert.deepEqual(r.rawPayload, JPEG);
  assert.deepEqual(pobrania, [ZDJ.replace("/original/", "/s1280/")]);
});

test("duże zdjęcie: oferta tylko ze snapshotu to 404 i zero wyjść do CDN-u", async () => {
  /* Zasada właściciela: zdjęcie wyłącznie z NASZEJ oferty. Snapshot zna też
     cudze aukcje z wiadomości, więc sam jego wiersz nie otwiera tej trasy. */
  const { kontoKanalu } = await import("../services/kanal-konto.js");
  const konto = kontoKanalu(db(), config.allegro.clientId);
  db().prepare(`INSERT OR REPLACE INTO offer_snapshot
      (channel_account_id, external_id, nazwa, status, primary_image_url, synced_at)
    VALUES (?, 'cudza', 'Cudza', 'ACTIVE', ?, '2026-10-21T10:00:00.000Z')`).run(konto, ZDJ);
  const r = await duze(sesja("biuro"), "cudza");
  assert.equal(r.statusCode, 404);
  assert.equal(typeof r.json().error, "string");
  assert.equal(pobrania.length, 0);
});

test("duże zdjęcie: CDN bez obrazu to 502", async () => {
  const h = sesja("biuro");
  odpowiedz = () => ({ offers: [oferta("10", "W08-0501")] });
  await dopasuj(h, { symbole: ["W08-0501"] });
  ustaw({ pobierz: async () => null });
  const r = await duze(h, "10");
  assert.equal(r.statusCode, 502);
});

// ── POST /api/products/:twId/zdjecie/gotowe ─────────────────────────────────

const gotowe = (headers: Record<string, string>, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/products/1/zdjecie/gotowe", headers, payload });

const zdarzenie = () =>
  JSON.parse(
    (db().prepare("SELECT payload FROM events WHERE type = 'zdjecie_dodane' ORDER BY id DESC LIMIT 1").get() as
      { payload: string }).payload
  );

test("gotowe: zrodlo allegro trafia do audytu z numerem oferty", async () => {
  const r = await gotowe(sesja("biuro"), { gotowy: JPEG.toString("base64"), zrodlo: "allegro", plik: "oferta 10" });
  assert.equal(r.statusCode, 200, r.payload);
  assert.deepEqual(zdarzenie(), {
    bajtow: JPEG.length, tloUsuniete: false, zrodlo: "allegro", queueId: null, plik: "oferta 10",
  });
});

test("gotowe: nieznane źródło zapisuje się jako import", async () => {
  const r = await gotowe(sesja("biuro"), { gotowy: JPEG.toString("base64"), zrodlo: "aparat" });
  assert.equal(r.statusCode, 200, r.payload);
  assert.equal(zdarzenie().zrodlo, "import");
});
