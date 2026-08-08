import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── GET /api/products/:twId/zdjecie ─────────────────────────────────────────
   Cała historia offline stoi na tej trasie: zdjęcie ma pojechać przez Wi-Fi
   RAZ na towar, a każde kolejne wejście na kartę ma kosztować nagłówek.
   Dlatego testy tutaj patrzą głównie na 304 i na to, że trasa nie wypadła
   spoza sesji.

   Wpisy cache'u zakładamy wprost w bazie — źródło (MSSQL albo udział) jest
   przedmiotem `services/zdjecia.test.ts`, a tu chodzi o odcinek między
   cache'em a kolektorem.                                                      */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdjr-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.LOG_LEVEL = "silent";
process.env.ZDJECIA_ZRODLO = "plik";
process.env.ZDJECIA_KATALOG = path.join(katalog, "zrodlo");

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let katalogZdjec: typeof import("../services/zdjecia.js").katalogZdjec;
let token: string;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const ETAG = "abc123";

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  ({ katalogZdjec } = await import("../services/zdjecia.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zdjecie_cache", "device_session", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();
  d.prepare(
    "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1,'W32-0203','Kosa','590','')"
  ).run();

  const u = createUser("Jan Testowy", "magazynier");
  token = "tok-zdj";
  const teraz = new Date().toISOString();
  d.prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)").run(
    token,
    u.userId,
    "test-device",
    teraz,
    teraz
  );
});

/** Kładzie gotowe zdjęcie w cache'u — z pominięciem źródła. */
function wCache(twId: number, bajty = JPEG, etag = ETAG): void {
  const plik = `t${twId}.jpg`;
  fs.writeFileSync(path.join(katalogZdjec(), plik), bajty);
  const teraz = new Date().toISOString();
  db()
    .prepare(
      `INSERT OR REPLACE INTO zdjecie_cache(tw_id, plik, mime, bajtow, etag, pobrano_at, uzyto_at, blad)
       VALUES (?,?,?,?,?,?,?,NULL)`
    )
    .run(twId, plik, "image/jpeg", bajty.length, etag, teraz, teraz);
}

const zSesja = (naglowki: Record<string, string> = {}) => ({
  method: "GET" as const,
  url: "/api/products/1/zdjecie",
  headers: { "x-session": token, ...naglowki },
});

// ── Sesja ───────────────────────────────────────────────────────────────────

test("bez sesji 401 — zdjęcia zostają za logowaniem jak dowody", async () => {
  wCache(1);
  const r = await app.inject({ method: "GET", url: "/api/products/1/zdjecie" });
  assert.equal(r.statusCode, 401, "trasa nie ma prawa wpaść na listę BEZ_SESJI");
});

// ── Pobranie i rewalidacja ──────────────────────────────────────────────────

test("zwraca bajty z ETagiem, typem i długością", async () => {
  wCache(1);
  const r = await app.inject(zSesja());
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["etag"], `"${ETAG}"`);
  assert.equal(r.headers["content-type"], "image/jpeg");
  assert.equal(r.headers["content-length"], String(JPEG.length));
  assert.equal(r.rawPayload.length, JPEG.length);
});

test("znany ETag → 304 i PUSTE ciało", async () => {
  wCache(1);
  const r = await app.inject(zSesja({ "if-none-match": `"${ETAG}"` }));
  assert.equal(r.statusCode, 304);
  assert.equal(r.rawPayload.length, 0, "to jest cały zysk: kolejne wejście na kartę kosztuje nagłówek");
});

test("inny ETag → pełne 200", async () => {
  wCache(1);
  const r = await app.inject(zSesja({ "if-none-match": '"stare"' }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.rawPayload.length, JPEG.length);
});

// ── Brak zdjęcia ────────────────────────────────────────────────────────────

test("potwierdzony brak zdjęcia → 404, nie błąd serwera", async () => {
  const teraz = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO zdjecie_cache(tw_id, plik, mime, bajtow, etag, pobrano_at, uzyto_at, blad)
       VALUES (1,NULL,NULL,0,NULL,?,?,NULL)`
    )
    .run(teraz, teraz);
  const r = await app.inject(zSesja());
  assert.equal(r.statusCode, 404);
});

test("wpis wskazuje plik, którego nie ma → 404 zamiast urwanego strumienia", async () => {
  wCache(1);
  fs.unlinkSync(path.join(katalogZdjec(), "t1.jpg"));
  // wpis postarzamy, żeby nie próbował pobrać ze źródła (katalog źródła pusty)
  const r = await app.inject(zSesja());
  assert.equal(r.statusCode, 404);
});

test("nieznany towar → 404", async () => {
  const r = await app.inject({
    method: "GET",
    url: "/api/products/999/zdjecie",
    headers: { "x-session": token },
  });
  assert.equal(r.statusCode, 404);
});
