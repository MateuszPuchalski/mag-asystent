import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── GET /api/analiza + /api/analiza/csv ─────────────────────────────────────
   Agregacje są przedmiotem `services/analiza.test.ts`; tutaj bramka i kształt.
   Bramka jest ważniejsza niż zwykle: odpowiedź niesie raport per osoba, czyli
   monitoring pracowniczy — magazynier nie ma prawa czytać zestawień o sobie
   i kolegach, dokładnie jak przy śladzie audytowym.                          */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-anlr-")), "t.db");
process.env.LOG_LEVEL = "silent";

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
  for (const t of ["events", "device_session", "app_user"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
});

function zalogowany(rola: Rola): string {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    )
    .run(token, u.userId, "kolektor-7", teraz, teraz);
  return token;
}

test("bez sesji 401 — dane o ludziach nie mają prawa być otwarte", async () => {
  for (const url of ["/api/analiza", "/api/analiza/csv"]) {
    const r = await app.inject({ method: "GET", url });
    assert.equal(r.statusCode, 401, url);
  }
});

test("magazynier dostaje 403 — analiza jest dla biura", async () => {
  const token = zalogowany("magazynier");
  for (const url of ["/api/analiza", "/api/analiza/csv"]) {
    const r = await app.inject({ method: "GET", url, headers: { "x-session": token } });
    assert.equal(r.statusCode, 403, url);
  }
});

test("biuro dostaje komplet sekcji", async () => {
  const token = zalogowany("biuro");
  const r = await app.inject({
    method: "GET",
    url: "/api/analiza?days=30",
    headers: { "x-session": token },
  });
  assert.equal(r.statusCode, 200);
  const a = r.json();
  assert.equal(a.days, 30);
  assert.equal(a.dni.length, 30);
  assert.equal(a.godziny.length, 24);
  assert.ok(a.rytm);
  assert.ok(a.szukania);
  assert.ok(Array.isArray(a.urzadzenia));
  assert.match(a.wydajnosc.podstawaPrawna, /Kodeks pracy/, "podstawa prawna jedzie z danymi");
});

test("śmieciowe okno wraca do 7 dni, nie wywraca", async () => {
  const token = zalogowany("biuro");
  for (const q of ["?days=999", "?days=abc", ""]) {
    const r = await app.inject({
      method: "GET",
      url: `/api/analiza${q}`,
      headers: { "x-session": token },
    });
    assert.equal(r.json().days, 7, `dla „${q}"`);
  }
});

test("CSV: BOM, sekcje i podstawa prawna nad danymi imiennymi", async () => {
  const token = zalogowany("biuro");
  const r = await app.inject({
    method: "GET",
    url: "/api/analiza/csv",
    headers: { "x-session": token },
  });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"] as string, /text\/csv/);
  assert.ok(r.body.startsWith("﻿"), "bez BOM Excel czyta UTF-8 jako ANSI");
  assert.match(r.body, /# OPERACJE PER DZIEN/);
  assert.match(r.body, /# SZUKANE BEZ WYNIKU/);
  const sekcjaImienna = r.body.indexOf("# WYDAJNOSC PER OSOBA");
  const podstawa = r.body.indexOf("Kodeks pracy");
  assert.ok(sekcjaImienna >= 0 && podstawa > sekcjaImienna, "podstawa prawna ma stać nad danymi");
});

test("eksport CSV zostawia ślad w audycie", async () => {
  // ta sama zasada co audyt_eksport: kto pobiera zestawienia o ludziach,
  // sam trafia do logu
  const token = zalogowany("biuro");
  await app.inject({ method: "GET", url: "/api/analiza/csv", headers: { "x-session": token } });
  const wpis = db()
    .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'analiza_eksport'")
    .get() as { n: number };
  assert.equal(wpis.n, 1);
});
