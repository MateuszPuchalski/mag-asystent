import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-device-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* ── Telemetria urządzenia: lista dozwolonych typów (0.326.0) ────────────────
   `POST /api/device/event` przepuszcza WYŁĄCZNIE typy z listy — inaczej byłby
   otwartym wpisem do dziennika audytowego z dowolnego kolektora w sieci.

   Test istnieje, bo ta lista psuje się PO CICHU po stronie kolektora. Zgłoszenia
   idą tam w `runCatching`, więc odmowa 400 nie dociera do nikogo: nie ma ekranu,
   na którym by mignęła, a żądanie leci po fakcie, gdy człowiek patrzy już na co
   innego. Literówka w nazwie typu znaczyłaby dziennik pusty — najgorszy możliwy
   stan przy awarii, bo pusty dziennik wygląda dokładnie jak brak problemu.

   Serwer nie milczy o takiej odmowie: zapisuje ją jako `http_rejected`
   i to sprawdza test niżej. Szuka się tego jednak dopiero wtedy, gdy ktoś
   podejrzewa, że czegoś brakuje — a test wyłapie to przed wydaniem.

   Nazwa `siec_przerwa` stoi więc tu DOSŁOWNIE. Kolektor ma ją w
   `android/app/.../data/PrzerwyLog.kt` (`TYP_PRZERWY`) i te dwa ciągi muszą
   być identyczne.                                                            */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let naglowki: Record<string, string>;

before(async () => {
  ({ db } = await import("../db/db.js"));
  const { createUser } = await import("../services/users.js");
  app = await (await import("../index.js")).buildApp();
  /* Zgłoszenie idzie z ZALOGOWANEGO kolektora i to jest świadome: dziennik
     audytowy ma wiedzieć, przy kim urządzenie straciło łączność. Kolektor bez
     sesji i tak nie odpytuje kolejki, więc nie ma z czego zbudować przerwy. */
  const u = createUser("Magazynier testowy", "magazynier", `mag${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  naglowki = { "x-session": token, "x-device": "TC21-07" };
});

beforeEach(() => {
  db().exec("DELETE FROM events");
});

const wyslij = (body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/device/event", payload: body, headers: naglowki });

test("przerwa w łączności wchodzi do dziennika z całą treścią", async () => {
  const odp = await wyslij({
    type: "siec_przerwa",
    odKiedy: "2026-09-13T09:12:03.000Z",
    trwanieMs: 18_500,
    prob: 12,
    powod: "serwer nie odpowiedział w czasie",
    siec: "Wi-Fi",
    adres: "192.168.10.57",
    serwer: "http://192.168.1.49:3001",
  });
  assert.equal(odp.statusCode, 200);

  const w = db().prepare("SELECT type, payload, device_id FROM events").get() as
    { type: string; payload: string; device_id: string | null };
  assert.equal(w.type, "siec_przerwa");
  /* Urządzenie bierze się z nagłówka, nie z treści — „to jedno urządzenie czy
     wszystkie" jest pierwszym pytaniem przy takiej awarii. */
  assert.equal(w.device_id, "TC21-07");
  const p = JSON.parse(w.payload) as Record<string, unknown>;
  /* Czas trwania i liczba prób to CAŁA odpowiedź na pytanie „czy wróciła
     sama": bez nich wpis mówi tylko, że coś było. */
  assert.equal(p.trwanieMs, 18_500);
  assert.equal(p.prob, 12);
  assert.equal(p.adres, "192.168.10.57");
  /* `type` nie powtarza się w treści — stoi we własnej kolumnie. */
  assert.equal(p.type, undefined);
});

test("typ spoza listy dostaje 400 i NIE zostawia wpisu", async () => {
  /* Otwarta lista znaczyłaby dziennik audytowy zapisywalny dowolnym ciągiem
     z dowolnego urządzenia w sieci magazynu. */
  const odp = await wyslij({ type: "siec_przerwaa", trwanieMs: 1 });
  assert.equal(odp.statusCode, 400);
  const { n } = db().prepare(
    "SELECT COUNT(*) AS n FROM events WHERE type = 'siec_przerwaa'").get() as { n: number };
  assert.equal(n, 0);
  /* Sama odmowa ZOSTAJE w dzienniku jako `http_rejected` — dzięki temu
     literówka daje się znaleźć, choć kolektor się o niej nie dowie. */
  const odmowa = db().prepare(
    "SELECT payload FROM events WHERE type = 'http_rejected'").get() as
      { payload: string } | undefined;
  assert.match(String(odmowa?.payload), /Nieznany typ zdarzenia/);
});

test("żądanie bez typu też odpada", async () => {
  const odp = await wyslij({ trwanieMs: 1 });
  assert.equal(odp.statusCode, 400);
});

test("typy sprzed tej zmiany dalej przechodzą", async () => {
  /* Lista rośnie, nie podmienia się: upadki urządzeń jadą tą drogą od 0.31.0. */
  for (const type of ["device_drop", "battery_low", "scan_timing"]) {
    assert.equal((await wyslij({ type, ms: 120 })).statusCode, 200, type);
  }
});
