import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Zdjęcie dodane z panelu biura ───────────────────────────────────────────
   Panel bierze podgląd, obraca go, przycina i wyrównuje w przeglądarce,
   a potem przysyła GOTOWY obraz. Pilnujemy trzech rzeczy:
     1. Zapisują się bajty z panelu, nie z podglądu. Inaczej w kartotece
        ląduje wersja, której człowiek nie zatwierdził.
     2. Gotowy obraz przechodzi tę samą bramkę bajtów i rozmiaru co kolektor.
     3. Sesja biura wchodzi na wszystkie trzy trasy zdjęcia, nie tylko hala. */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdjp-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.LOG_LEVEL = "silent";
process.env.ZDJECIA_DODAWANIE = "wertis";
process.env.TLO_URL = "";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let token: string;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
/** Inny obraz niż podgląd — po nim widać, CO się zapisało. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zdjecie_wlasne", "zdjecie_podglad", "zdjecie_cache", "device_session", "app_user", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1,'W32-0203','Kosa','590','')"
  ).run();
  const u = createUser("Anna Biurowa", "biuro");
  token = "tok-panel";
  const teraz = new Date().toISOString();
  d.prepare(
    "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
  ).run(token, u.userId, "panel", teraz, teraz);
});

const naglowki = () => ({ "x-session": token });

async function podgladId(): Promise<string> {
  const r = await app.inject({
    method: "POST",
    url: "/api/products/1/zdjecie/wstepne",
    headers: naglowki(),
    payload: { zdjecie: JPEG.toString("base64") },
  });
  assert.equal(r.statusCode, 200, r.payload);
  return r.json().podgladId as string;
}

const zatwierdz = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/products/1/zdjecie", headers: naglowki(), payload });

const zapisane = () =>
  db().prepare("SELECT obraz, mime, tlo_usuniete FROM zdjecie_wlasne WHERE tw_id = 1").get() as
    | { obraz: Uint8Array; mime: string; tlo_usuniete: number }
    | undefined;

test("gotowy obraz z panelu zapisuje się zamiast podglądu", async () => {
  const r = await zatwierdz({
    podgladId: await podgladId(),
    zTlem: true,
    zrodlo: "panel",
    gotowy: "data:image/png;base64," + PNG.toString("base64"),
  });
  assert.equal(r.statusCode, 200, r.payload);
  const w = zapisane();
  assert.ok(w);
  assert.deepEqual(Buffer.from(w.obraz), PNG);
  assert.equal(w.mime, "image/png");
  assert.equal(w.tlo_usuniete, 0, "zTlem=true znaczy, że tła nie usunięto");
  assert.equal(r.json().bajtow, PNG.length);
});

test("zdarzenie niesie zrodlo=panel", async () => {
  await zatwierdz({ podgladId: await podgladId(), zTlem: true, zrodlo: "panel", gotowy: PNG.toString("base64") });
  const e = db().prepare("SELECT payload FROM events WHERE type = 'zdjecie_dodane'").get() as { payload: string };
  assert.equal(JSON.parse(e.payload).zrodlo, "panel");
});

test("bez gotowego obrazu droga kolektora zostaje bez zmian", async () => {
  const r = await zatwierdz({ podgladId: await podgladId(), zTlem: true, zrodlo: "aparat" });
  assert.equal(r.statusCode, 200, r.payload);
  assert.deepEqual(Buffer.from(zapisane()!.obraz), JPEG);
});

test("gotowy, który nie jest obrazem, odpada 400 i nic nie zapisuje", async () => {
  const id = await podgladId();
  const r = await zatwierdz({ podgladId: id, zTlem: true, gotowy: Buffer.from("tekst").toString("base64") });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /JPEG ani PNG/);
  assert.equal(zapisane(), undefined);
  /* Podgląd zostaje: człowiek poprawia kadr i zatwierdza jeszcze raz,
     bez ponownego wysyłania zdjęcia. */
  const drugie = await zatwierdz({ podgladId: id, zTlem: true, gotowy: PNG.toString("base64") });
  assert.equal(drugie.statusCode, 200, drugie.payload);
});

test("gotowy innego typu niż tekst odpada 400", async () => {
  const r = await zatwierdz({ podgladId: await podgladId(), zTlem: true, gotowy: 12 });
  assert.equal(r.statusCode, 400);
});

test("za duży gotowy obraz: 400 ze wskazówką dla panelu", async () => {
  const wielki = Buffer.concat([JPEG, Buffer.alloc(600 * 1024)]);
  const r = await zatwierdz({ podgladId: await podgladId(), zTlem: true, gotowy: wielki.toString("base64") });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /maksimum to 512 kB/);
  assert.match(r.json().error, /Zmniejsz kadr/);
  assert.equal(zapisane(), undefined);
});

test("gotowy bez ważnego podglądu → 410", async () => {
  const r = await zatwierdz({ podgladId: "nie-ma", gotowy: PNG.toString("base64") });
  assert.equal(r.statusCode, 410);
  assert.equal(zapisane(), undefined);
});

test("sesja biura może porzucić podgląd", async () => {
  const id = await podgladId();
  const r = await app.inject({ method: "DELETE", url: `/api/products/1/zdjecie/wstepne/${id}`, headers: naglowki() });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().usunieto, true);
});
