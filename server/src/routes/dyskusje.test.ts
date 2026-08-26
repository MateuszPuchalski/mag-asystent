import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy dyskusji Allegro ──────────────────────────────────────────────────
   Logika jest przedmiotem `services/dyskusje.test.ts`; tutaj bramka ról
   i pełny przepływ przez HTTP na adapterze dev: pobierz → lista → status →
   notatka → licznik. Prowadzenie spraw klienckich to robota biura.          */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-dyskr-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

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
  const d = db();
  for (const t of ["dyskusja", "zwrot", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
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
    .run(token, u.userId, "biurko-1", teraz, teraz);
  return token;
}

const TRASY = [
  { method: "GET" as const, url: "/api/biuro/dyskusje" },
  { method: "GET" as const, url: "/api/biuro/dyskusje/licznik" },
  { method: "POST" as const, url: "/api/biuro/dyskusje/odswiez", body: {} },
  { method: "GET" as const, url: "/api/biuro/dyskusje/1" },
  { method: "POST" as const, url: "/api/biuro/dyskusje/1/status", body: { status: "w_toku" } },
  { method: "PUT" as const, url: "/api/biuro/dyskusje/1/notatka", body: { notatka: "x" } },
];

test("bez sesji 401 na każdej trasie", async () => {
  for (const t of TRASY) {
    const r = await app.inject({ method: t.method, url: t.url, payload: t.body });
    assert.equal(r.statusCode, 401, t.url);
  }
});

test("magazynier dostaje 403 — dyskusje prowadzi biuro", async () => {
  const token = zalogowany("magazynier");
  for (const t of TRASY) {
    const r = await app.inject({
      method: t.method, url: t.url, payload: t.body, headers: { "x-session": token },
    });
    assert.equal(r.statusCode, 403, t.url);
  }
});

test("pełny przepływ: pobierz → lista → status → notatka → licznik", async () => {
  const biuro = { "x-session": zalogowany("biuro") };

  let r = await app.inject({ method: "POST", url: "/api/biuro/dyskusje/odswiez", payload: {}, headers: biuro });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().nowych, 3, "adapter dev daje trzy sprawy");
  assert.equal(r.json().zamknietychPrzezAllegro, 1, "sprawa CLOSED schodzi w tym samym przebiegu");

  r = await app.inject({ method: "GET", url: "/api/biuro/dyskusje", headers: biuro });
  assert.equal(r.statusCode, 200);
  const lista = r.json().dyskusje;
  assert.equal(lista.length, 2, "worklista bez sprawy zamkniętej w panelu");
  assert.equal(lista[0].typ, "CLAIM", "sprawa z terminem ustawowym na górze");
  assert.ok(r.json().synchronizacja, "ślad pobrania jedzie z listą");

  const sprawa = lista[0];
  r = await app.inject({
    method: "POST", url: `/api/biuro/dyskusje/${sprawa.id}/status`,
    payload: { status: "w_toku" }, headers: biuro,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().dyskusja.status, "w_toku");

  r = await app.inject({
    method: "PUT", url: `/api/biuro/dyskusje/${sprawa.id}/notatka`,
    payload: { notatka: "uznajemy, korekta pójdzie ze zwrotem" }, headers: biuro,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().dyskusja.prowadzi, "Ktoś biuro", "notatka bierze sprawę na piszącego");

  // szczegół niesie kontekst klienta — trzy rejestry jednym zapytaniem
  r = await app.inject({ method: "GET", url: `/api/biuro/dyskusje/${sprawa.id}`, headers: biuro });
  assert.equal(r.statusCode, 200);
  assert.ok("klient" in r.json());

  r = await app.inject({ method: "GET", url: "/api/biuro/dyskusje/licznik", headers: biuro });
  const licznik = r.json();
  assert.equal(licznik.nowe, 1);
  assert.equal(licznik.wToku, 1);

  // guardy przez HTTP: nieznana sprawa to 404, drugi klik zamknięcia to 409
  r = await app.inject({
    method: "POST", url: "/api/biuro/dyskusje/999999/status",
    payload: { status: "w_toku" }, headers: biuro,
  });
  assert.equal(r.statusCode, 404);
  await app.inject({
    method: "POST", url: `/api/biuro/dyskusje/${sprawa.id}/status`,
    payload: { status: "zamknieta" }, headers: biuro,
  });
  r = await app.inject({
    method: "POST", url: `/api/biuro/dyskusje/${sprawa.id}/status`,
    payload: { status: "zamknieta" }, headers: biuro,
  });
  assert.equal(r.statusCode, 409);
});
