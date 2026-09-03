import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wiedza-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* ── Trasy bazy wiedzy (E2) — trzy umowy ─────────────────────────────────────
   1. Bramka roli na KAŻDEJ trasie, także na odczycie; 401 przed 403.
   2. Otwarcie ekranu niczego nie zapisuje; tras zapisu są CZTERY i licznik
      niżej jest umową — każdy nowy zapis podnosi liczbę i dostaje zdanie.
   3. Panel woła te same adresy: strażnik czyta `panel/src/api/wiedza.ts`,
      bo strażnik ze skrzynki czyta tylko `rozmowy.ts` (blizna 0.181.1).   */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let W: typeof import("../services/wiedza.js");
let propozycja = 0;
const SZR = 501;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  W = await import("../services/wiedza.js");
  app = await (await import("../index.js")).buildApp();
  db().prepare("INSERT OR IGNORE INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(SZR, "SZR-148/82", "Szarpak");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dowod_zastosowania", "zastosowanie", "model_urzadzenia", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const autor = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  propozycja = W.zaproponujZastosowanie({
    twId: SZR, model: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450" }, polaryzacja: "pasuje",
    zrodlo: "reczne", dowod: { rodzaj: "katalog_dostawcy", tresc: "katalog 2024" },
  }, { userId: autor, name: "A. Lewandowska" })!.id;
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { naglowki: { "x-session": token }, userId: u.userId };
}

const liczba = (tabela: string) => (db().prepare(`SELECT count(*) n FROM ${tabela}`).get() as { n: number }).n;

const TRASY = () => [
  { method: "GET" as const, url: "/api/obsluga/wiedza/kolejka" },
  { method: "GET" as const, url: "/api/obsluga/wiedza/modele?q=nac" },
  { method: "GET" as const, url: `/api/obsluga/wiedza/towar/${SZR}` },
  { method: "POST" as const, url: "/api/obsluga/wiedza/propozycje",
    payload: { twId: SZR, model: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 51" }, polaryzacja: "pasuje",
      dowod: { rodzaj: "producent", tresc: "x" } } },
  { method: "POST" as const, url: `/api/obsluga/wiedza/${propozycja}/rozstrzygnij`, payload: { decyzja: "zatwierdz" } },
  { method: "POST" as const, url: `/api/obsluga/wiedza/${propozycja}/wycofaj`, payload: { powod: "x" } },
  { method: "POST" as const, url: `/api/obsluga/wiedza/${propozycja}/dowody`, payload: { rodzaj: "producent", tresc: "x" } },
];

test("bez sesji żadna trasa wiedzy nie odpowiada danymi", async () => {
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, payload: t.payload });
    assert.equal(r.statusCode, 401, `${t.method} ${t.url} przepuścił brak sesji`);
  }
});

test("hala nie widzi wiedzy — także na odczycie", async () => {
  const m = login("magazynier", "Marek");
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, headers: m.naglowki, payload: t.payload });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url} wpuścił halę`);
  }
});

test("tras zapisu są cztery — licznik jest umową", () => {
  assert.equal(TRASY().filter((t) => t.method !== "GET").length, 4);
});

test("otwarcie wiedzy niczego nie zapisuje", async () => {
  const b = login("biuro", "Anna");
  const przed = [liczba("events"), liczba("zastosowanie"), liczba("dowod_zastosowania"), liczba("model_urzadzenia")];
  for (const t of TRASY().filter((t) => t.method === "GET")) {
    const r = await app.inject({ method: "GET", url: t.url, headers: b.naglowki });
    assert.equal(r.statusCode, 200, r.body);
  }
  assert.deepEqual([liczba("events"), liczba("zastosowanie"), liczba("dowod_zastosowania"), liczba("model_urzadzenia")], przed);
});

test("rozstrzygnięcie idzie z sesji; drugie dostaje 409 z tym, kto był pierwszy", async () => {
  const b = login("biuro", "Anna");
  let r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/${propozycja}/rozstrzygnij`,
    headers: b.naglowki, payload: { decyzja: "zatwierdz" } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json<{ rozstrzygnal: string }>().rozstrzygnal, "Anna");
  r = await app.inject({ method: "POST", url: `/api/obsluga/wiedza/${propozycja}/rozstrzygnij`,
    headers: login("biuro", "Ola").naglowki, payload: { decyzja: "odrzuc", powod: "nie" } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json<{ rozstrzygnal: string }>().rozstrzygnal, "Anna");
  /* Duplikat ręcznej propozycji to jawna odmowa, nie cichy sukces. */
  r = await app.inject({ method: "POST", url: "/api/obsluga/wiedza/propozycje", headers: b.naglowki,
    payload: { twId: SZR, model: { rodzaj: "maszyna", marka: "nac", nazwa: "ls46450" }, polaryzacja: "pasuje",
      dowod: { rodzaj: "producent", tresc: "x" } } });
  assert.equal(r.statusCode, 409);
});

test("każdy adres wołany z panel/src/api/wiedza.ts ma trasę na serwerze", async () => {
  const zrodlo = fs.readFileSync(path.resolve(import.meta.dirname, "../../../panel/src/api/wiedza.ts"), "utf8");
  const wywolania = [...zrodlo.matchAll(/api(?:<[^>]*>)?\(\s*`([^`]+)`(?:\s*,\s*\{[^}]*?method:\s*"(GET|POST|PUT|DELETE)")?/gs)];
  assert.ok(wywolania.length >= 7, `strażnik nie widzi hooków wiedzy (${wywolania.length})`);
  const b = login("biuro", "Biuro");
  const bledne: string[] = [];
  for (const [, adres, metoda] of wywolania) {
    const url = adres.replace(/\$\{[^}]+\}/g, "1").replace(/\?.*$/, "");
    const method = (metoda ?? "GET") as "GET" | "POST" | "PUT" | "DELETE";
    const r = await app.inject({ method, url, headers: b.naglowki, ...(method === "GET" ? {} : { payload: {} }) });
    const tresc = r.json<{ message?: string }>();
    if (r.statusCode === 404 && /^Route /.test(tresc.message ?? "")) bledne.push(`${method} ${adres}`);
  }
  assert.deepEqual(bledne, [], "panel woła adresy bez trasy na serwerze");
});
