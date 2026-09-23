import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy danych firmy (0.444.0) ──────────────────────────────────────────
   Rachunek zapisu jest w `services/firma.test.ts`; tutaj bramka ról i ślad
   przez całą trasę. Dane firmy stoją na każdym protokole, który wychodzi do
   dostawcy — hala ich nie czyta i nie zmienia.                              */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-firma-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  for (const t of ["firma", "events", "device_session", "app_user"]) db().prepare(`DELETE FROM ${t}`).run();
});

function zalogowany(rola: Rola): string {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db().prepare(
    "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)",
  ).run(token, u.userId, "biurko-1", teraz, teraz);
  return token;
}

const TRASY = [
  { method: "GET" as const, url: "/api/biuro/firma" },
  { method: "PUT" as const, url: "/api/biuro/firma", body: { nazwa: "WERTIS" } },
];

test("bez sesji 401, magazynier 403 — i nic się nie zapisało", async () => {
  for (const t of TRASY) {
    const r = await app.inject({ method: t.method, url: t.url, payload: t.body });
    assert.equal(r.statusCode, 401, t.url);
  }
  const token = zalogowany("magazynier");
  for (const t of TRASY) {
    const r = await app.inject({ method: t.method, url: t.url, payload: t.body, headers: { "x-session": token } });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url}`);
  }
  assert.equal((db().prepare("SELECT COUNT(*) n FROM firma").get() as { n: number }).n, 0);
});

test("biuro zapisuje, drugie biurko czyta to samo, dziennik ma ślad z autorem", async () => {
  const pierwsze = zalogowany("biuro");
  const put = await app.inject({
    method: "PUT", url: "/api/biuro/firma", headers: { "x-session": pierwsze },
    payload: { nazwa: "WERTIS", nip: "1234567890", adres: "ul. Polna 1", miejscowosc: "Kraków", osoba: "Ala", telefon: "600" },
  });
  assert.equal(put.statusCode, 200);
  const drugie = zalogowany("admin");
  const get = await app.inject({ method: "GET", url: "/api/biuro/firma", headers: { "x-session": drugie } });
  assert.equal(get.statusCode, 200);
  assert.equal(get.json().dane.miejscowosc, "Kraków");
  assert.equal(get.json().zmieniono.przez, "Ktoś biuro");
  const ev = db().prepare("SELECT user_id FROM events WHERE type = 'firma_zapis'").all() as Array<{ user_id: string }>;
  assert.deepEqual(ev.map((e) => e.user_id), ["Ktoś biuro"]);
});

test("odczyt niczego nie zapisuje — pusta baza zostaje pusta", async () => {
  const token = zalogowany("biuro");
  const r = await app.inject({ method: "GET", url: "/api/biuro/firma", headers: { "x-session": token } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().zmieniono, null);
  assert.equal((db().prepare("SELECT COUNT(*) n FROM firma").get() as { n: number }).n, 0);
  assert.equal((db().prepare("SELECT COUNT(*) n FROM events WHERE type = 'firma_zapis'").get() as { n: number }).n, 0);
});

test("za długie pole to 400 z powodem, nie 500", async () => {
  const token = zalogowany("biuro");
  const r = await app.inject({
    method: "PUT", url: "/api/biuro/firma", headers: { "x-session": token }, payload: { adres: "x".repeat(300) },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /najwyżej 200/);
});
