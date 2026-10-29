import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Wymiary towarów (ekran biura) w trybie produkcyjnym ─────────────────────
   Bazy Subiekta tu nie ma, więc oba źródła podmienia `ustawZrodlaWymiarow`.
   Pilnujemy kontraktu z panelem, ról, odmów i tego, że pomiar ląduje
   w kolejce z audytem „przed", a nie od razu w bazie firmy. */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wymr-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "mssql";
process.env.MSSQL_SERVER = "127.0.0.1";
process.env.MSSQL_DATABASE = "nieuzywana";
process.env.MSSQL_USER = "wertis";
process.env.MSSQL_PASSWORD = "nieuzywane";
process.env.WYMIARY_POLE_DLUGOSC = "tw_Pole4";
process.env.WYMIARY_POLE_SZEROKOSC = "tw_Pole5";
process.env.WYMIARY_POLE_WYSOKOSC = "tw_Pole6";
process.env.TLO_URL = "";

type S = typeof import("../services/wymiary.js");

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let config: typeof import("../config.js").config;
let ustawZrodla: S["ustawZrodlaWymiarow"];

/** Udawana kartoteka Subiekta. Towar 2 ma wagę, ale nie ma wymiarów. */
const KARTOTEKA = [
  { twId: 1, symbol: "A-01", nazwa: "Kosa", ean: "590123", stan: 4, sprzedaz: 7,
    masa: null, dlugosc: null, szerokosc: null, wysokosc: null },
  { twId: 2, symbol: "B-02", nazwa: "Grabie", ean: null, stan: 0, sprzedaz: 0,
    masa: 1.4, dlugosc: "150", szerokosc: null, wysokosc: null },
];

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  ({ config } = await import("../config.js"));
  ({ ustawZrodlaWymiarow: ustawZrodla } = await import("../services/wymiary.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["sfera_queue", "device_session", "app_user", "events"]) d.prepare(`DELETE FROM ${t}`).run();
  ustawZrodla(
    async (z) => ({ razem: KARTOTEKA.length, pozycje: KARTOTEKA.slice(z.offset, z.offset + z.limit) }),
    async (twId) => KARTOTEKA.find((t) => t.twId === twId) ?? null
  );
});

afterEach(() => {
  ustawZrodla(null);
  config.wymiary.poleDlugosc = "tw_Pole4";
  config.wymiary.poleSzerokosc = "tw_Pole5";
  config.wymiary.poleWysokosc = "tw_Pole6";
});

function sesja(rola: "biuro" | "admin" | "magazynier"): Record<string, string> {
  const u = createUser(`Osoba ${rola}`, rola);
  const token = `tok-${rola}-${Math.random()}`;
  const teraz = new Date().toISOString();
  db()
    .prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, u.userId, "panel", teraz, teraz);
  return { "x-session": token };
}

const lista = (headers: Record<string, string>) =>
  app.inject({ method: "GET", url: "/api/wymiary/bez-wymiarow", headers });
const zapisz = (headers: Record<string, string>, twId: number | string, payload: unknown) =>
  app.inject({ method: "POST", url: `/api/wymiary/${twId}`, headers, payload: payload as object });
const zadania = () =>
  db().prepare("SELECT type, payload, tw_id, label, detail FROM sfera_queue").all() as Array<{
    type: string; payload: string; tw_id: number; label: string; detail: string;
  }>;

test("biuro dostaje stronę w kształcie kontraktu", async () => {
  const r = await lista(sesja("biuro"));
  assert.equal(r.statusCode, 200, r.payload);
  assert.deepEqual(r.json(), {
    wlaczone: true,
    razem: 2,
    pozycje: KARTOTEKA.map((t) => ({ ...t, oczekuje: false })),
  });
});

test("magazynier dostaje 403, bez sesji 401 — na liście i przy zapisie", async () => {
  assert.equal((await lista(sesja("magazynier"))).statusCode, 403);
  assert.equal((await lista({})).statusCode, 401);
  assert.equal((await zapisz(sesja("magazynier"), 1, { masaKg: 1 })).statusCode, 403);
  assert.equal(zadania().length, 0);
});

test("bez kluczy WYMIARY_POLE_* ekran mówi, co ustawić, a zapis dostaje 409", async () => {
  config.wymiary.poleWysokosc = "";
  const h = sesja("biuro");
  const r = (await lista(h)).json();
  assert.equal(r.wlaczone, false);
  assert.match(r.powod, /WYMIARY_POLE_DLUGOSC/);
  assert.equal((await zapisz(h, 1, { masaKg: 1 })).statusCode, 409);
  assert.equal(zadania().length, 0);
});

test("pomiar idzie do kolejki z opisem i audytem „przed”; lista widzi go jako oczekujący", async () => {
  const h = sesja("biuro");
  const r = await zapisz(h, 2, { masaKg: "", dlugosc: "150", szerokosc: "12,5", wysokosc: 8 });
  assert.equal(r.statusCode, 200, r.payload);
  const z = zadania();
  assert.equal(z.length, 1);
  assert.equal(z[0].type, "set_wymiary");
  assert.equal(z[0].tw_id, 2);
  assert.equal(z[0].label, "Wymiary · B-02");
  assert.equal(z[0].detail, "150 × 12,5 × 8 cm");
  assert.deepEqual(JSON.parse(z[0].payload), {
    twId: 2, pomiar: { masaKg: null, dlugosc: 150, szerokosc: 12.5, wysokosc: 8 },
  });
  const zdarzenie = db().prepare("SELECT type, payload FROM events WHERE type = 'wymiary_set'").get() as
    { type: string; payload: string };
  assert.deepEqual(JSON.parse(zdarzenie.payload).przed, { masa: 1.4, dlugosc: "150", szerokosc: null, wysokosc: null });

  const po = (await lista(h)).json();
  assert.deepEqual(po.pozycje.map((p: { twId: number; oczekuje: boolean }) => [p.twId, p.oczekuje]), [[1, false], [2, true]]);
});

test("zły pomiar to 400, nieznany towar 404, zły numer 400 — i nic w kolejce", async () => {
  const h = sesja("biuro");
  const zly = await zapisz(h, 1, { dlugosc: "dużo" });
  assert.equal(zly.statusCode, 400);
  assert.match(zly.json().error, /Długość/);
  assert.equal((await zapisz(h, 99, { masaKg: 1 })).statusCode, 404);
  assert.equal((await zapisz(h, "abc", { masaKg: 1 })).statusCode, 400);
  assert.equal(zadania().length, 0);
});

test("awaria bazy Subiekta to 503 z powodem, nie pusta lista", async () => {
  ustawZrodla(async () => { throw new Error("timeout"); }, async () => { throw new Error("timeout"); });
  const h = sesja("biuro");
  const r = await lista(h);
  assert.equal(r.statusCode, 503);
  assert.match(r.json().error, /timeout/);
  assert.equal((await zapisz(h, 1, { masaKg: 1 })).statusCode, 503);
  assert.equal(zadania().length, 0);
});
