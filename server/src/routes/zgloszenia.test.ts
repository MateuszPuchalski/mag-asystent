import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zgloszenia-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* ── Zgłoszenia pracowników przez HTTP ──────────────────────────────────────
   Panel i kolektor logują się tą samą sesją w `x-session`. Kolektor dokłada
   `x-device`, panel nie. Admin czyta, reszta dostaje 403, także biuro. */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  for (const t of ["zgloszenie_zdjecie", "zgloszenie_pracownika", "events", "device_session", "app_user"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
});

function login(role: Rola, name: string, urzadzenie: string | null = null) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,device_id,created_at,last_seen) VALUES(?,?,?,?,?)")
    .run(token, u.userId, urzadzenie, n, n);
  return { "x-session": token };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]).toString("base64");
const zgl = (o: Record<string, unknown> = {}) => ({
  rodzaj: "blad", opis: "Skaner nie łapie kodu", ekran: "/kolektor/odkladanie", zrodlo: "kolektor", ...o,
});

test("kolektor składa zgłoszenie, urządzenie bierze się z nagłówka, nie z ciała", async () => {
  const m = login("magazynier", "Marek");
  const r = await app.inject({
    method: "POST", url: "/api/zgloszenia", headers: { ...m, "x-device": "TC21-03" },
    payload: zgl({ urzadzenie: "podrobione", wersja: "0.618.0", zdjecia: [JPEG] }),
  });
  assert.equal(r.statusCode, 200, r.body);
  const z = r.json().zgloszenie;
  assert.equal(z.urzadzenie, "TC21-03");
  assert.equal(z.autor, "Marek");
  assert.equal(z.zrodlo, "kolektor");
  assert.equal(z.zdjecia.length, 1);
  const e = db().prepare("SELECT user_id, payload FROM events WHERE type='zgloszenie_pracownika'").get() as
    { user_id: string; payload: string };
  assert.equal(e.user_id, "Marek");
  assert.deepEqual(JSON.parse(e.payload), { id: z.id, rodzaj: "blad", zrodlo: "kolektor" });
});

test("bez nagłówka x-device urządzenie przychodzi z sesji", async () => {
  const m = login("magazynier", "Marek", "TC21-07");
  const r = await app.inject({ method: "POST", url: "/api/zgloszenia", headers: m, payload: zgl() });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().zgloszenie.urzadzenie, "TC21-07");
});

test("panel składa zgłoszenie, a ekran traci zapytanie", async () => {
  const b = login("biuro", "Anna");
  const r = await app.inject({
    method: "POST", url: "/api/zgloszenia", headers: b,
    payload: zgl({ zrodlo: "panel", rodzaj: "pomysl", ekran: "/obsluga/zwroty?szukaj=Kowalski#x" }),
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().zgloszenie.ekran, "/obsluga/zwroty");
  assert.equal(r.json().zgloszenie.urzadzenie, null);
  const surowe = db().prepare("SELECT ekran FROM zgloszenie_pracownika").get() as { ekran: string };
  assert.equal(surowe.ekran, "/obsluga/zwroty", "zapytanie nie trafia do bazy");
});

test("bez sesji zgłoszenia nie ma", async () => {
  const r = await app.inject({ method: "POST", url: "/api/zgloszenia", payload: zgl() });
  assert.equal(r.statusCode, 401);
});

test("pięć zdjęć i zdjęcie ponad 1024 kB odpadają kodem 400 ze zdaniem", async () => {
  const m = login("magazynier", "Marek");
  let r = await app.inject({ method: "POST", url: "/api/zgloszenia", headers: m, payload: zgl({ zdjecia: Array(5).fill(JPEG) }) });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /najwyżej 4/);
  const duze = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1100 * 1024 - 3, 1)]).toString("base64");
  r = await app.inject({ method: "POST", url: "/api/zgloszenia", headers: m, payload: zgl({ zdjecia: [duze] }) });
  assert.equal(r.statusCode, 400, "ciało mieści się w 6 MiB, więc odmawia serwis, nie limit trasy");
  assert.match(r.json().error, /1024 kB/);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM zgloszenie_pracownika").get() as { n: number }).n, 0);
});

test("cztery zdjęcia po 1024 kB mieszczą się w ciele trasy", async () => {
  const m = login("magazynier", "Marek");
  const pelne = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1024 * 1024 - 3, 3)]).toString("base64");
  const r = await app.inject({ method: "POST", url: "/api/zgloszenia", headers: m, payload: zgl({ zdjecia: Array(4).fill(pelne) }) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().zgloszenie.zdjecia.length, 4);
});

test("moje zgłoszenia widzi autor, cudzych nie", async () => {
  const m = login("magazynier", "Marek"), b = login("biuro", "Anna");
  await app.inject({ method: "POST", url: "/api/zgloszenia", headers: m, payload: zgl() });
  await app.inject({ method: "POST", url: "/api/zgloszenia", headers: b, payload: zgl({ zrodlo: "panel" }) });
  const r = await app.inject({ method: "GET", url: "/api/zgloszenia/moje", headers: m });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().zgloszenia.map((z: { autor: string }) => z.autor), ["Marek"]);
});

test("trasy właściciela: biuro i magazyn dostają 403", async () => {
  const b = login("biuro", "Anna"), m = login("magazynier", "Marek");
  const id = (await app.inject({ method: "POST", url: "/api/zgloszenia", headers: m, payload: zgl({ zdjecia: [JPEG] }) }))
    .json().zgloszenie;
  for (const h of [b, m]) {
    const zadania = [
      { method: "GET" as const, url: "/api/obsluga/zgloszenia" },
      { method: "GET" as const, url: `/api/obsluga/zgloszenia/${id.id}/zdjecie/${id.zdjecia[0].id}` },
      { method: "POST" as const, url: `/api/obsluga/zgloszenia/${id.id}/status`, payload: { status: "przyjete" } },
    ];
    for (const z of zadania) {
      const r = await app.inject({ ...z, headers: h });
      assert.equal(r.statusCode, 403, `${z.method} ${z.url}`);
    }
  }
  const stan = db().prepare("SELECT status FROM zgloszenie_pracownika").get() as { status: string };
  assert.equal(stan.status, "nowe");
});

test("admin czyta listę z licznikami, ogląda zdjęcie i odpowiada", async () => {
  const a = login("admin", "Szef"), m = login("magazynier", "Marek");
  const z = (await app.inject({ method: "POST", url: "/api/zgloszenia", headers: m, payload: zgl({ zdjecia: [JPEG] }) }))
    .json().zgloszenie;

  let r = await app.inject({ method: "GET", url: "/api/obsluga/zgloszenia?status=nowe", headers: a });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().zgloszenia.length, 1);
  assert.deepEqual(r.json().liczniki, { nowe: 1, przyjete: 0, zrobione: 0, odrzucone: 0 });

  r = await app.inject({ method: "GET", url: `/api/obsluga/zgloszenia/${z.id}/zdjecie/${z.zdjecia[0].id}`, headers: a });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["content-type"], "image/jpeg");
  assert.equal(r.headers["cache-control"], "private, max-age=31536000, immutable");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.ok(r.rawPayload.equals(Buffer.from(JPEG, "base64")));
  r = await app.inject({ method: "GET", url: `/api/obsluga/zgloszenia/${z.id}/zdjecie/${z.zdjecia[0].id + 99}`, headers: a });
  assert.equal(r.statusCode, 404);

  r = await app.inject({
    method: "POST", url: `/api/obsluga/zgloszenia/${z.id}/status`, headers: a,
    payload: { status: "przyjete", odpowiedz: "Dziękuję, zamawiamy nowy skaner" },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().zgloszenie.status, "przyjete");
  assert.equal(r.json().zgloszenie.statusPrzez, "Szef");
  r = await app.inject({ method: "POST", url: `/api/obsluga/zgloszenia/${z.id + 50}/status`, headers: a, payload: { status: "nowe" } });
  assert.equal(r.statusCode, 404);
  r = await app.inject({ method: "GET", url: "/api/obsluga/zgloszenia?status=zgubione", headers: a });
  assert.equal(r.statusCode, 400);

  r = await app.inject({ method: "GET", url: "/api/zgloszenia/moje", headers: m });
  assert.equal(r.json().zgloszenia[0].odpowiedz, "Dziękuję, zamawiamy nowy skaner", "autor widzi odpowiedź");
});
