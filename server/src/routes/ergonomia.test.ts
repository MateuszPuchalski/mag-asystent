import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasa ergonomii w liczbach ──────────────────────────────────────────────
   Ta sama bramka co reszta analizy: biuro i administrator czytają, magazynier
   nie. Raport nie niesie nazwisk, ale mówi, który kolektor gubi sieć i ile
   pracy się poprawia — to jest wgląd biura, nie ekran hali. Odczyt nie
   zapisuje niczego (zero zapisu przy patrzeniu). */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-ergr-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  for (const t of ["events", "device_session", "app_user"]) db().prepare(`DELETE FROM ${t}`).run();
});

function zalogowany(rola: Rola): Record<string, string> {
  const u = createUser(`Osoba ${rola}`, rola, `l-${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}`;
  const teraz = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token, user_id, created_at, last_seen) VALUES (?,?,?,?)")
    .run(token, u.userId, teraz, teraz);
  return { "x-session": token };
}

test("biuro czyta raport, magazynier dostaje 403, odczyt niczego nie zapisuje", async () => {
  db().prepare("INSERT INTO events(type, payload, user_id, device_id) VALUES ('czasy_zadan', ?, 'Jan', 'kol-a')")
    .run(JSON.stringify({ czasy: [{ ekran: "HOME", trasa: "/api/x", n: 1, kubelki: [1, 0, 0, 0, 0, 0] }] }));

  let r = await app.inject({ method: "GET", url: "/api/analiza/ergonomia?days=7", headers: zalogowany("magazynier") });
  assert.equal(r.statusCode, 403);

  const biuro = zalogowany("biuro");
  const przed = (db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  r = await app.inject({ method: "GET", url: "/api/analiza/ergonomia?days=30", headers: biuro });
  assert.equal(r.statusCode, 200, r.body);
  const b = r.json() as { days: number; progMs: number; czasy: { n: number; wgTrasy: Array<{ ekran: string }> } };
  assert.equal(b.days, 30);
  assert.equal(b.progMs, 300);
  assert.equal(b.czasy.n, 1);
  assert.equal(b.czasy.wgTrasy[0].ekran, "HOME");
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n, przed);
});
