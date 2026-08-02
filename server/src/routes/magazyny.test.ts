import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* Widoczność magazynów jest USTAWIENIEM GLOBALNYM — jedna osoba przestawia je
   wszystkim kolektorom naraz. Dlatego bramka jest tu taka sama jak przy
   zakładaniu kont: rola `biuro`. Ten plik pilnuje, że magazynier z ważną
   sesją tego nie ruszy — sama sesja nie jest uprawnieniem.                 */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-magr-")), "t.db");
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

/** Konto + sesja; zwraca token. */
function zaloguj(rola: "magazynier" | "biuro"): string {
  const u =
    rola === "biuro"
      ? createUser("Biuro Testowe", rola, "biuro", "tajnehaslo")
      : createUser("Jan Testowy", rola, "jtestowy", "tajnehaslo");
  const token = `tok-${u.userId}`;
  const teraz = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    )
    .run(token, u.userId, "test", teraz, teraz);
  return token;
}

let tokenBiura: string;
let tokenMagazyniera: string;

beforeEach(() => {
  const d = db();
  d.prepare("DELETE FROM events").run();
  d.prepare("DELETE FROM device_session").run();
  d.prepare("DELETE FROM app_user").run();
  d.prepare("DELETE FROM magazyn_widocznosc").run();
  d.prepare("DELETE FROM sgt_magazyn").run();

  const insMag = d.prepare("INSERT INTO sgt_magazyn(mag_id, kod, nazwa) VALUES (?,?,?)");
  insMag.run(1, "MAG", "Magazyn główny");
  insMag.run(2, "MGP", "Strefa przyjęć");
  insMag.run(3, "ZWROTY", "Zwroty od klientów");
  insMag.run(91, "SERWIS", "Serwis");

  tokenBiura = zaloguj("biuro");
  tokenMagazyniera = zaloguj("magazynier");
});

const ukryj = (token: string, body: unknown) =>
  app.inject({
    method: "POST",
    url: "/api/magazyny/widocznosc",
    headers: { "x-session": token },
    payload: body as Record<string, unknown>,
  });

// ── Odczyt ──────────────────────────────────────────────────────────────────

test("lista magazynów jest dostępna dla zalogowanego magazyniera", () => {
  // ekran ustawień jej nie pokaże, ale sama lista magazynów firmy nie jest
  // tajemnicą — w odróżnieniu od kodów badge'ów
  return app
    .inject({ url: "/api/magazyny", headers: { "x-session": tokenMagazyniera } })
    .then((r) => {
      assert.equal(r.statusCode, 200);
      assert.equal(r.json().magazyny.length, 4);
    });
});

test("bez sesji nie ma listy — bramka globalna działa też tutaj", async () => {
  assert.equal((await app.inject({ url: "/api/magazyny" })).statusCode, 401);
});

// ── Zapis ───────────────────────────────────────────────────────────────────

test("biuro ukrywa magazyn", async () => {
  const r = await ukryj(tokenBiura, { ukryte: [91] });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().ukryte, [91]);
});

test("magazynier nie ukryje magazynu, choćby był zalogowany", async () => {
  const r = await ukryj(tokenMagazyniera, { ukryte: [91] });
  assert.equal(r.statusCode, 403);
});

test("bez sesji odpada", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/magazyny/widocznosc",
    payload: { ukryte: [91] },
  });
  assert.equal(r.statusCode, 401);
});

// ── Walidacja ───────────────────────────────────────────────────────────────

test("próba ukrycia magazynu z rolą to 400 z powodem", async () => {
  const r = await ukryj(tokenBiura, { ukryte: [2] });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /MGP/);
});

test("ciało bez listy to 400, nie 500", async () => {
  assert.equal((await ukryj(tokenBiura, {})).statusCode, 400);
  assert.equal(
    (await ukryj(tokenBiura, { ukryte: "wszystkie" })).statusCode,
    400
  );
});
