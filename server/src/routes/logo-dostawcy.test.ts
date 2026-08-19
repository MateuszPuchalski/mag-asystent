import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Trasy logo dostawcy ─────────────────────────────────────────────────────
   Dwie rzeczy naraz, bo ta funkcja ma dwóch różnych czytelników.

   Biuro WGRYWA — i tam liczy się bramka roli: logo widzi cały magazyn, więc
   podmienić je ma prawo tylko biuro.

   Kolektor CZYTA — i tam liczy się koszt. Wiersz listy dostaw pyta o logo przy
   każdym rysowaniu, a większość dostawców go nie ma. Dlatego 304 musi działać,
   a 404 NIE MOŻE iść do audytu: analiza produkcyjnego dziennika pokazała 355
   wpisów „brak zdjęcia" na tysiąc, które przykryły pięć prawdziwych odmów.  */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-logor-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let L: typeof import("../services/logo-dostawcy.js");

/** Najmniejszy poprawny PNG — 1×1, przezroczysty. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const tokeny: Record<string, string> = {};

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  L = await import("../services/logo-dostawcy.js");
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["dostawca_logo", "sgt_dokument", "device_session", "app_user", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const teraz = new Date().toISOString();
  for (const rola of ["magazynier", "biuro", "admin"] as const) {
    const u = createUser(`Ktoś ${rola}`, rola);
    tokeny[rola] = `tok-${rola}`;
    d.prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    ).run(tokeny[rola], u.userId, "test-device", teraz, teraz);
  }
});

const naglowki = (rola: string) => ({ "x-session": tokeny[rola] });

// ── Bramka roli ─────────────────────────────────────────────────────────────

test("magazynier nie wgra logo — to zapis widoczny dla całego magazynu", async () => {
  const r = await app.inject({
    method: "PUT",
    url: "/api/biuro/dostawcy/500/logo",
    headers: naglowki("magazynier"),
    payload: { nazwa: "GEKO", logoBase64: PNG },
  });
  assert.equal(r.statusCode, 403);
  assert.equal(L.logo(500), null);
});

test("biuro wgrywa, admin też", async () => {
  for (const [rola, khId] of [
    ["biuro", 501],
    ["admin", 502],
  ] as const) {
    const r = await app.inject({
      method: "PUT",
      url: `/api/biuro/dostawcy/${khId}/logo`,
      headers: naglowki(rola),
      payload: { nazwa: "GEKO", logoBase64: PNG },
    });
    assert.equal(r.statusCode, 200, `${rola} ma móc wgrać`);
    assert.ok(L.logo(khId));
  }
});

test("bez sesji 401 — także na liście dostawców", async () => {
  const r = await app.inject({ method: "GET", url: "/api/biuro/dostawcy" });
  assert.equal(r.statusCode, 401);
});

test("odmowa formatu wraca jako 400 z powodem, nie jako 500", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64");
  const r = await app.inject({
    method: "PUT",
    url: "/api/biuro/dostawcy/503/logo",
    headers: naglowki("biuro"),
    payload: { nazwa: "X", logoBase64: svg },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /PNG/);
});

test("kasowanie działa, a kasowanie nieistniejącego to 404", async () => {
  L.zapiszLogo(504, "X", PNG, "Ewa z biura");
  const ok = await app.inject({
    method: "DELETE",
    url: "/api/biuro/dostawcy/504/logo",
    headers: naglowki("biuro"),
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(L.logo(504), null);

  const znowu = await app.inject({
    method: "DELETE",
    url: "/api/biuro/dostawcy/504/logo",
    headers: naglowki("biuro"),
  });
  assert.equal(znowu.statusCode, 404);
});

// ── Odczyt przez kolektor ───────────────────────────────────────────────────

test("zwraca PNG z ETagiem, typem i długością", async () => {
  const zapis = L.zapiszLogo(505, "GEKO", PNG, "Ewa z biura");
  assert.ok(zapis.ok);
  const r = await app.inject({
    method: "GET",
    url: "/api/dostawcy/505/logo",
    headers: naglowki("magazynier"),
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["content-type"], "image/png");
  assert.equal(r.headers["etag"], `"${zapis.etag}"`);
  assert.equal(r.rawPayload.length, Buffer.from(PNG, "base64").length);
  assert.equal(r.headers["content-length"], String(r.rawPayload.length));
});

test("znany ETag → 304 i puste ciało", async () => {
  const zapis = L.zapiszLogo(506, "GEKO", PNG, "Ewa z biura");
  assert.ok(zapis.ok);
  const r = await app.inject({
    method: "GET",
    url: "/api/dostawcy/506/logo",
    headers: { ...naglowki("magazynier"), "if-none-match": `"${zapis.etag}"` },
  });
  assert.equal(r.statusCode, 304);
  assert.equal(r.rawPayload.length, 0);
});

test("logo zostaje za sesją", async () => {
  L.zapiszLogo(507, "GEKO", PNG, "Ewa z biura");
  const r = await app.inject({ method: "GET", url: "/api/dostawcy/507/logo" });
  assert.equal(r.statusCode, 401);
});

// ── Audyt ───────────────────────────────────────────────────────────────────

test("404 po logo NIE zaśmieca audytu", async () => {
  const r = await app.inject({
    method: "GET",
    url: "/api/dostawcy/999/logo",
    headers: naglowki("magazynier"),
  });
  assert.equal(r.statusCode, 404);
  const ile = db()
    .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'http_rejected'")
    .get() as { n: number };
  assert.equal(ile.n, 0, "brak logo jest normalny i nie jest odrzuceniem");
});

test("ale 404 z INNEJ trasy nadal trafia do audytu", async () => {
  // Strażnik przed zbyt szerokim wyciszeniem: gdyby wzorzec objął więcej,
  // niż powinien, ten test padnie zamiast czekać na czyjeś oko.
  const r = await app.inject({
    method: "GET",
    url: "/api/dostawcy/999/logo/cos-jeszcze",
    headers: naglowki("magazynier"),
  });
  assert.equal(r.statusCode, 404);
  const ile = db()
    .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'http_rejected'")
    .get() as { n: number };
  assert.equal(ile.n, 1);
});

// ── Lista dla biura ─────────────────────────────────────────────────────────

test("lista dostawców wraca z flagą maLogo", async () => {
  db()
    .prepare(
      `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, kh_id, w_buforze)
       VALUES (9101,'FZ','FZ 9101/MAG/08/2026','2026-08-19',1,'GEKO',600,0)`
    )
    .run();
  L.zapiszLogo(600, "GEKO", PNG, "Ewa z biura");

  const r = await app.inject({
    method: "GET",
    url: "/api/biuro/dostawcy",
    headers: naglowki("biuro"),
  });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().dostawcy, [
    { khId: 600, nazwa: "GEKO", dokumentow: 1, maLogo: true },
  ]);
});
