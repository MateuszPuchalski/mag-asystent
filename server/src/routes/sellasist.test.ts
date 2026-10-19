import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* Serwisy dynamicznie — powód przy `dyskusje.test.ts`: statyczny import
   biegnie przed ustawieniem `DB_PATH`. Sellasist celowo WYŁĄCZONY: trasa
   bez klucza nie ma prawa wyjść do sieci, a test tego pilnuje. */
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-sellasist-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";
delete process.env.SELLASIST_KONTO;
delete process.env.SELLASIST_API_KEY;

/* ── Trasy Sellasist ─────────────────────────────────────────────────────────
   Bramka biura (401 przed 403, także na odczycie), 400 przy treści innej niż
   tekst, odmowa serwisu przekładana na jej kod i zero sieci bez integracji. */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { "x-session": token };
}

const ODCZYTY = ["/api/biuro/sellasist/stan", "/api/obsluga/sellasist/zamowienie/ord-1"];
const NOTATKA = "/api/obsluga/sellasist/zamowienie/ord-1/notatka";

test("bez sesji 401, hala 403 — na odczycie i przy notatce", async () => {
  const hala = login("magazynier", "Hala");
  for (const url of ODCZYTY) {
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 401, url);
    assert.equal((await app.inject({ method: "GET", url, headers: hala })).statusCode, 403, url);
  }
  assert.equal((await app.inject({ method: "POST", url: NOTATKA, payload: { tekst: "x" } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: NOTATKA, headers: hala, payload: { tekst: "x" } })).statusCode, 403);
});

test("biuro bez integracji: stan i wgląd mówią „wyłączone” bez sieci, notatka to 409, zła treść to 400", async () => {
  const biuro = login("biuro", "Ola");
  const fetchBylo = globalThis.fetch;
  let siec = 0;
  globalThis.fetch = (async () => { siec++; throw new Error("sieć zakazana"); }) as typeof fetch;
  try {
    const stan = await app.inject({ method: "GET", url: ODCZYTY[0], headers: biuro });
    assert.equal(stan.statusCode, 200);
    assert.equal(stan.json().wlaczony, false);
    assert.deepEqual(stan.json().dni, []);
    const widok = await app.inject({ method: "GET", url: ODCZYTY[1], headers: biuro });
    assert.deepEqual(widok.json(), { wlaczony: false, zamowienie: null, notatki: [], notatkiBlad: null });
    const wyl = await app.inject({ method: "POST", url: NOTATKA, headers: biuro, payload: { tekst: "Dosłać pasek" } });
    assert.equal(wyl.statusCode, 409);
    assert.equal(wyl.json().error, "Integracja z Sellasist nie jest włączona.");
    const zla = await app.inject({ method: "POST", url: NOTATKA, headers: biuro, payload: { tekst: 5 } });
    assert.equal(zla.statusCode, 400);
    assert.equal(siec, 0);
  } finally {
    globalThis.fetch = fetchBylo;
  }
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'sellasist_notatka'").get()!.n, 0);
});
