import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy szukania kolektora ────────────────────────────────────────────────
   Logika siedzi w `services/szukanie-kolektora.test.ts`. Tu to, czego test
   serwisu nie widzi:
   - trasy działają na roli MAGAZYNIER — kolektora szuka kolega z hali;
   - oba zapisy są BEZ CIAŁA i przechodzą bez typu treści;
   - kolektor zna siebie po `x-device`, a audyt po nim odróżnia odnalezienie
     od odwołania;
   - bez sesji nic tu nie działa — lista `BEZ_SESJI` zostaje zamknięta. */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kolr-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let wyczyscSzukanie: typeof import("../services/szukanie-kolektora.js").wyczyscSzukanie;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  ({ wyczyscSzukanie } = await import("../services/szukanie-kolektora.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  for (const t of ["events", "device_session", "app_user"]) db().prepare(`DELETE FROM ${t}`).run();
  wyczyscSzukanie();
});

/** Zalogowany kolektor (albo panel, gdy `device` = null). */
function zalogowany(rola: Rola, login: string, device: string | null): Record<string, string> {
  const u = createUser(`Osoba ${login}`, rola, login, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, u.userId, device, teraz, teraz);
  return device ? { "x-session": token, "x-device": device } : { "x-session": token };
}

const typy = () => (db().prepare("SELECT type FROM events ORDER BY id").all() as Array<{ type: string }>)
  .map((e) => e.type);

test("bez sesji wszystkie cztery trasy odmawiają", async () => {
  zalogowany("magazynier", "jan", "kol-zgubiony");
  for (const [method, url] of [
    ["GET", "/api/kolektory"],
    ["POST", "/api/kolektory/kol-zgubiony/wezwij"],
    ["POST", "/api/kolektory/kol-zgubiony/odwolaj"],
    ["GET", "/api/kolektor/wezwanie"],
  ] as const) {
    const r = await app.inject({ method, url, headers: { "x-device": "kol-zgubiony" } });
    assert.equal(r.statusCode, 401, `${method} ${url}`);
  }
});

test("magazynier wzywa cudzy kolektor bez ciała, a ten przy następnym pytaniu dzwoni", async () => {
  const zgubiony = zalogowany("magazynier", "jan", "kol-zgubiony-a3f9");
  const szuka = zalogowany("magazynier", "ola", "kol-oli-0001");

  let r = await app.inject({ method: "GET", url: "/api/kolektory", headers: szuka });
  assert.equal(r.statusCode, 200);
  const lista = r.json() as { kolektory: Array<{ deviceId: string; etykieta: string }>; ten: string };
  assert.equal(lista.ten, "kol-oli-0001", "kolektor dowiaduje się, który wiersz jest nim samym");
  assert.ok(lista.kolektory.some((k) => k.etykieta === "#A3F9"));

  r = await app.inject({ method: "POST", url: "/api/kolektory/kol-zgubiony-a3f9/wezwij", headers: szuka });
  assert.equal(r.statusCode, 200, r.body);

  r = await app.inject({ method: "GET", url: "/api/kolektor/wezwanie", headers: zgubiony });
  assert.equal(r.statusCode, 200);
  assert.equal((r.json() as { wezwanie: { przez: string } }).wezwanie.przez, "Osoba ola");

  // pytający kolektor, którego nikt nie woła, dostaje ciszę
  r = await app.inject({ method: "GET", url: "/api/kolektor/wezwanie", headers: szuka });
  assert.equal((r.json() as { wezwanie: unknown }).wezwanie, null);
});

test("ZNALAZŁEM z samego kolektora to odnalezienie, a przycisk szukającego — odwołanie", async () => {
  const zgubiony = zalogowany("magazynier", "jan", "kol-a");
  const biuro = zalogowany("biuro", "ewa", null);
  zalogowany("magazynier", "piotr", "kol-b");

  await app.inject({ method: "POST", url: "/api/kolektory/kol-a/wezwij", headers: biuro });
  await app.inject({ method: "POST", url: "/api/kolektory/kol-b/wezwij", headers: biuro });

  let r = await app.inject({ method: "POST", url: "/api/kolektory/kol-a/odwolaj", headers: zgubiony });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((r.json() as { bylo: boolean }).bylo, true);
  r = await app.inject({ method: "POST", url: "/api/kolektory/kol-b/odwolaj", headers: biuro });
  assert.equal(r.statusCode, 200, r.body);

  assert.deepEqual(typy(), [
    "kolektor_wezwany",
    "kolektor_wezwany",
    "kolektor_odnaleziony",
    "kolektor_wezwanie_odwolane",
  ]);
});

test("nieznany kolektor — 404 ze zdaniem", async () => {
  const biuro = zalogowany("admin", "adm", null);
  const r = await app.inject({ method: "POST", url: "/api/kolektory/nie-ma/wezwij", headers: biuro });
  assert.equal(r.statusCode, 404);
  assert.match((r.json() as { error: string }).error, /Nie znam/);
});

test("pytanie o wezwanie bez x-device — 400, nie cudze wezwanie", async () => {
  const biuro = zalogowany("biuro", "ewa", null);
  const r = await app.inject({ method: "GET", url: "/api/kolektor/wezwanie", headers: biuro });
  assert.equal(r.statusCode, 400);
});
