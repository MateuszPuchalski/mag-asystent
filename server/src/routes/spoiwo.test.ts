import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* Serwisy dynamicznie — powód przy `dyskusje.test.ts`: statyczny import
   biegnie przed ustawieniem `DB_PATH`. */
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-spoiwo-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* ── Trasy ponad kolejkami (23 września 2026) ────────────────────────────────
   Szukanie Ctrl+K i historia ze zwrotu albo sprawy: bramka biura także na
   odczycie, 401 przed 403, i ani jednego zapisu przy patrzeniu. */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let zwrot = 0;
let sprawa = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
  const d = db();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')").run().lastInsertRowid);
  zwrot = Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,order_id,
    kupujacy_login,created_at,synced_at) VALUES (?,'z-1','ZW-1','ord-1','kupujacy1','2026-09-05T10:00:00Z','x')`)
    .run(konto).lastInsertRowid);
  sprawa = Number(d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,typ,order_id,
    kupujacy_login,otwarto_at,synced_at) VALUES (?,'r-1','CLAIM','ord-1','kupujacy1','2026-09-06T10:00:00Z','x')`)
    .run(konto).lastInsertRowid);
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { "x-session": token };
}

const TRASY = () => ["/api/obsluga/szukaj?q=kupujacy1", `/api/obsluga/zwroty/${zwrot}/klient`,
  `/api/obsluga/sprawy/${sprawa}/klient`];

test("bez sesji 401, hala 403 — także na odczycie", async () => {
  const hala = login("magazynier", "Hala");
  for (const url of TRASY()) {
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 401, url);
    assert.equal((await app.inject({ method: "GET", url, headers: hala })).statusCode, 403, url);
  }
});

test("biuro czyta szukanie i historię, a patrzenie niczego nie zapisuje", async () => {
  const b = login("biuro", "Ola");
  const przed = (db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  const zmiany = (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const s = await app.inject({ method: "GET", url: TRASY()[0], headers: b });
  assert.equal(s.statusCode, 200, s.body);
  assert.ok(s.json<{ trafienia: Array<{ rodzaj: string }> }>().trafienia.some((t) => t.rodzaj === "zwrot"));
  const h = await app.inject({ method: "GET", url: TRASY()[1], headers: b });
  assert.equal(h.json<{ login: string }>().login, "kupujacy1");
  const r = await app.inject({ method: "GET", url: TRASY()[2], headers: b });
  assert.ok(r.json<{ wpisy: Array<{ rodzaj: string }> }>().wpisy.some((w) => w.rodzaj === "zwrot"));
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n, przed);
  assert.equal((db().prepare("SELECT total_changes() AS n").get() as { n: number }).n, zmiany);
});

test("nieistniejący zwrot to 404 z treścią, nie 500", async () => {
  const b = login("biuro", "Ola2");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/zwroty/999999/klient", headers: b });
  assert.equal(r.statusCode, 404);
});
