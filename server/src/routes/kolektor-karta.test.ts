import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* `GET /api/biuro/kolektor` (0.496.0): adresy serwera dla karty „Nowy
   kolektor". Biuro i admin tak, hala nie, bez sesji nie — w odróżnieniu od
   samego APK, który pobiera się bez logowania. */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kolektor-"));
process.env.DB_PATH = path.join(dir, "t.db");
process.env.WERTIS_ENV_FILE = path.join(dir, "brak.env");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

let kolejny = 0;
function jako(rola: "admin" | "biuro" | "magazynier") {
  const u = createUser(`Ktoś ${rola}`, rola, `kk${rola}-${++kolejny}`, "tajnehaslo");
  const token = `tok-${u.userId}-${kolejny}`;
  const teraz = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, u.userId, "biuro-pc", teraz, teraz);
  return { "x-session": token };
}

test("biuro i admin widzą adresy i port; brak APK to null, nie błąd", async () => {
  for (const rola of ["biuro", "admin"] as const) {
    const r = await app.inject({ method: "GET", url: "/api/biuro/kolektor", headers: jako(rola) });
    assert.equal(r.statusCode, 200, r.body);
    const j = r.json() as { adresy: string[]; port: number; apk: unknown };
    assert.ok(Array.isArray(j.adresy));
    assert.equal(typeof j.port, "number");
    assert.equal(j.apk, null);
  }
});

test("hala i brak sesji — odmowa", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/biuro/kolektor" })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/api/biuro/kolektor", headers: jako("magazynier") })).statusCode, 403);
});
