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
process.env.WYMIARY_POLE_DLUGOSC = "pwd_Tekst03";
process.env.WYMIARY_POLE_SZEROKOSC = "pwd_Tekst02";
process.env.WYMIARY_POLE_WYSOKOSC = "pwd_Tekst01";
process.env.TLO_URL = "";

type S = typeof import("../services/wymiary.js");

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let config: typeof import("../config.js").config;
let ustawZrodla: S["ustawZrodlaWymiarow"];

/** Udawana kartoteka Subiekta. Towar 2 ma wagę, ale nie ma wymiarów. */
const KARTOTEKA = [
  { twId: 1, symbol: "A-01", nazwa: "Kosa", ean: "590123", stan: 4, sprzedaz: 7, lokalizacja: "A01-02-03",
    brutto: null, netto: null, dlugosc: null, szerokosc: null, wysokosc: null },
  { twId: 2, symbol: "B-02", nazwa: "Grabie", ean: null, stan: 0, sprzedaz: 0, lokalizacja: null,
    brutto: 1.4, netto: 1.2, dlugosc: "150", szerokosc: null, wysokosc: null },
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
  for (const t of ["sfera_queue", "device_session", "app_user", "events", "wymiary_pilne"]) d.prepare(`DELETE FROM ${t}`).run();
  ustawZrodla(
    async (z) => ({ razem: KARTOTEKA.length, pozycje: KARTOTEKA.slice(z.offset, z.offset + z.limit) }),
    async (twId) => KARTOTEKA.find((t) => t.twId === twId) ?? null
  );
});

afterEach(() => {
  ustawZrodla(null);
  config.wymiary.poleDlugosc = "pwd_Tekst03";
  config.wymiary.poleSzerokosc = "pwd_Tekst02";
  config.wymiary.poleWysokosc = "pwd_Tekst01";
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
    pilneRazem: 0,
  });
});

test("magazynier z kolektora widzi listę i zapisuje — mierzy ten, kto stoi przy wadze", async () => {
  const h = sesja("magazynier");
  assert.equal((await lista(h)).statusCode, 200);
  assert.equal((await zapisz(h, 1, { bruttoKg: 1 })).statusCode, 200);
  assert.equal(zadania().length, 1);
});

test("bez sesji 401 — na liście, przy towarze i przy zapisie", async () => {
  assert.equal((await lista({})).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/api/wymiary/1" })).statusCode, 401);
  assert.equal((await zapisz({}, 1, { bruttoKg: 1 })).statusCode, 401);
  assert.equal(zadania().length, 0);
});

test("jeden towar dla karty w kolektorze: obecne wartości, oczekiwanie i 404", async () => {
  const h = sesja("magazynier");
  const jeden = (id: number | string) => app.inject({ method: "GET", url: `/api/wymiary/${id}`, headers: h });
  const r = await jeden(2);
  assert.equal(r.statusCode, 200, r.payload);
  assert.deepEqual(r.json(), { wlaczone: true, towar: KARTOTEKA[1], oczekuje: false });
  await zapisz(h, 2, { wysokosc: 3 });
  assert.equal((await jeden(2)).json().oczekuje, true);
  assert.equal((await jeden(99)).statusCode, 404);
  assert.equal((await jeden("x")).statusCode, 400);
  assert.equal(zadania().length, 1, "odczyt towaru niczego nie kolejkuje");
});

test("bez kluczy WYMIARY_POLE_* ekran mówi, co ustawić, a zapis dostaje 409", async () => {
  config.wymiary.poleWysokosc = "";
  const h = sesja("biuro");
  const r = (await lista(h)).json();
  assert.equal(r.wlaczone, false);
  assert.match(r.powod, /WYMIARY_POLE_DLUGOSC/);
  assert.equal((await zapisz(h, 1, { bruttoKg: 1 })).statusCode, 409);
  assert.equal(zadania().length, 0);
});

test("pomiar idzie do kolejki z opisem i audytem „przed”; lista widzi go jako oczekujący", async () => {
  const h = sesja("biuro");
  const r = await zapisz(h, 2, { bruttoKg: "", dlugosc: "150", szerokosc: "12,5", wysokosc: 8 });
  assert.equal(r.statusCode, 200, r.payload);
  const z = zadania();
  assert.equal(z.length, 1);
  assert.equal(z[0].type, "set_wymiary");
  assert.equal(z[0].tw_id, 2);
  assert.equal(z[0].label, "Wymiary · B-02");
  assert.equal(z[0].detail, "150 × 12,5 × 8 cm");
  assert.deepEqual(JSON.parse(z[0].payload), {
    twId: 2, pomiar: { bruttoKg: null, nettoKg: null, dlugosc: 150, szerokosc: 12.5, wysokosc: 8 },
  });
  const zdarzenie = db().prepare("SELECT type, payload FROM events WHERE type = 'wymiary_set'").get() as
    { type: string; payload: string };
  assert.deepEqual(JSON.parse(zdarzenie.payload).przed, { brutto: 1.4, netto: 1.2, dlugosc: "150", szerokosc: null, wysokosc: null });

  const po = (await lista(h)).json();
  assert.deepEqual(po.pozycje.map((p: { twId: number; oczekuje: boolean }) => [p.twId, p.oczekuje]), [[1, false], [2, true]]);
});

test("zły pomiar to 400, nieznany towar 404, zły numer 400 — i nic w kolejce", async () => {
  const h = sesja("biuro");
  const zly = await zapisz(h, 1, { dlugosc: "dużo" });
  assert.equal(zly.statusCode, 400);
  assert.match(zly.json().error, /Długość/);
  assert.equal((await zapisz(h, 99, { bruttoKg: 1 })).statusCode, 404);
  assert.equal((await zapisz(h, "abc", { bruttoKg: 1 })).statusCode, 400);
  assert.equal(zadania().length, 0);
});

test("awaria bazy Subiekta to 503 z powodem, nie pusta lista", async () => {
  ustawZrodla(async () => { throw new Error("timeout"); }, async () => { throw new Error("timeout"); });
  const h = sesja("biuro");
  const r = await lista(h);
  assert.equal(r.statusCode, 503);
  assert.match(r.json().error, /timeout/);
  assert.equal((await zapisz(h, 1, { bruttoKg: 1 })).statusCode, 503);
  assert.equal(zadania().length, 0);
});

/* ── Lista pilnych ── */

const pilne = (headers: Record<string, string>, payload?: unknown) =>
  payload === undefined
    ? app.inject({ method: "GET", url: "/api/wymiary/pilne", headers })
    : app.inject({ method: "PUT", url: "/api/wymiary/pilne", headers, payload: payload as object });

test("biuro wkleja listę pilnych: oczyszczona, podmieniona w całości i w dzienniku", async () => {
  const h = sesja("biuro");
  const r = await pilne(h, { symbole: ["Wertis NO.\nw37-0401\nW09-1304", "W37-0401;  b-02 "] });
  assert.equal(r.statusCode, 200, r.payload);
  assert.deepEqual(r.json().symbole, ["WERTIS", "NO.", "W37-0401", "W09-1304", "B-02"]);
  await pilne(h, { symbole: ["A-01"] });
  assert.deepEqual((await pilne(sesja("magazynier"))).json(), { symbole: ["A-01"] }, "nowa lista zastępuje starą");
  const wpisy = db().prepare("SELECT payload FROM events WHERE type = 'wymiary_pilne'").all() as Array<{ payload: string }>;
  assert.equal(wpisy.length, 2);
  assert.deepEqual(JSON.parse(wpisy[1].payload).przed, ["WERTIS", "NO.", "W37-0401", "W09-1304", "B-02"]);
});

test("listę pilnych ustala biuro; magazynier i zły kształt dostają odmowę bez zapisu", async () => {
  assert.equal((await pilne(sesja("magazynier"), { symbole: ["A-01"] })).statusCode, 403);
  assert.equal((await pilne(sesja("biuro"), { symbole: "A-01" })).statusCode, 400);
  const zaDuzo = Array.from({ length: 501 }, (_, i) => `X-${i}`);
  assert.equal((await pilne(sesja("biuro"), { symbole: zaDuzo })).statusCode, 400);
  assert.equal((await pilne({}, { symbole: ["A-01"] })).statusCode, 401);
  assert.deepEqual((await pilne(sesja("biuro"))).json(), { symbole: [] });
});

test("lista podaje źródłu symbole pilnych i liczy pilne bez pozostałych filtrów", async () => {
  const widziane: Array<string[] | undefined> = [];
  ustawZrodla(async (z) => {
    widziane.push(z.pilne);
    const pasuje = KARTOTEKA.filter((t) => !z.pilne || z.pilne.includes(t.symbol));
    return { razem: pasuje.length, pozycje: pasuje.slice(z.offset, z.offset + z.limit) };
  });
  const h = sesja("biuro");
  await pilne(h, { symbole: ["B-02", "W-99"] });
  const wszystko = (await lista(h)).json();
  assert.equal(wszystko.razem, 2);
  assert.equal(wszystko.pilneRazem, 1, "W-99 nie ma w kartotece braków");
  const tylko = (await app.inject({ method: "GET", url: "/api/wymiary/bez-wymiarow?pilne=1&naStanie=1", headers: h })).json();
  assert.deepEqual(tylko.pozycje.map((p: { symbol: string }) => p.symbol), ["B-02"]);
  assert.deepEqual(widziane, [undefined, ["B-02", "W-99"], ["B-02", "W-99"], ["B-02", "W-99"]]);
});
