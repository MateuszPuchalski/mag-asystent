import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── POST /api/products/:twId/location ──────────────────────────────────────
   Jedyna trasa, którą magazynier zmienia lokalizację w Subiekcie. Ma testy
   jako pierwsza, bo jest jednocześnie najczęściej używana i najbardziej
   kosztowna przy pomyłce: zapisuje do kartoteki firmy przez kolejkę.

   Pierwszy test tego pliku jest regresją na błąd, który TE testy znalazły:
   żądanie bez pola `action` kończyło się 500, bo `computeNewLocs` zwracał
   `undefined`, a trasa robiła na tym `.join()`. TypeScript uznawał `switch`
   za wyczerpujący — bo typ opisywał KONTRAKT ciała żądania, a nie to, co
   faktycznie przychodzi po sieci.                                            */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-lok-")), "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let token: string;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  db().prepare("DELETE FROM events").run();
  db().prepare("DELETE FROM sfera_queue").run();
  db().prepare("DELETE FROM device_session").run();
  db().prepare("DELETE FROM app_user").run();
  db()
    .prepare(
      "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1,'W32-0203','Testowy towar','5901234567890','')"
    )
    .run();

  const u = createUser("Jan Testowy", "magazynier");
  token = "tok-lok";
  const teraz = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    )
    .run(token, u.userId, "test-device", teraz, teraz);
});

/** Żądanie zmiany lokalizacji zalogowanym kolektorem. */
const zmien = (payload: unknown) =>
  app.inject({
    method: "POST",
    url: "/api/products/1/location",
    headers: { "x-session": token },
    payload: payload as Record<string, unknown>,
  });

const lokalizacja = () =>
  (db().prepare("SELECT lokalizacja FROM sgt_towar WHERE tw_id = 1").get() as { lokalizacja: string })
    .lokalizacja;

const zadania = () =>
  db().prepare("SELECT type, payload FROM sfera_queue ORDER BY id").all() as unknown as Array<{
    type: string;
    payload: string;
  }>;

// ── Walidacja ───────────────────────────────────────────────────────────────

test("brak pola action to 400, nie 500", async () => {
  const r = await zmien({ value: "A01-02-03" });
  assert.equal(r.statusCode, 400);
  assert.equal(zadania().length, 0); // nic nie poszło do kolejki
});

test("nieznana akcja to 400", async () => {
  const r = await zmien({ action: "skasuj_wszystko", value: "A01-02-03" });
  assert.equal(r.statusCode, 400);
  assert.equal(zadania().length, 0);
});

test("kod ze spacją odpada — spacja rozdziela lokalizacje w polu Subiekta", async () => {
  const r = await zmien({ action: "replace", value: "A01 02 03" });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /spacj/i);
});

test("pusty kod odpada", async () => {
  assert.equal((await zmien({ action: "replace", value: "" })).statusCode, 400);
});

test("przekroczenie limitu pola to TWARDY błąd, nie ciche ucięcie", async () => {
  /* Ucięcie w połowie dałoby adres, który wskazuje na inny regał — a magazynier
     zobaczyłby zieleń. Limit to rozmiar kolumny w Subiekcie (varchar(50)). */
  db()
    .prepare("UPDATE sgt_towar SET lokalizacja = ? WHERE tw_id = 1")
    .run("A01-02-03 B01-02-03 C01-02-03 D01-02-03 E01-02-03");

  const r = await zmien({ action: "add", value: "F01-02-03" });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /limit/i);
  assert.equal(zadania().length, 0);
});

// ── Ścieżka poprawna ────────────────────────────────────────────────────────

test("replace kolejkuje zadanie set_location z nową wartością", async () => {
  const r = await zmien({ action: "replace", value: "A01-02-03" });
  assert.equal(r.statusCode, 200);

  const q = zadania();
  assert.equal(q.length, 1);
  assert.equal(q[0].type, "set_location");
  assert.match(q[0].payload, /A01-02-03/);

  /* Read-model NIE zmienia się od razu — to robi dopiero worker po udanym
     zapisie do Subiekta. Gdyby zmieniał się tutaj, kolektor pokazywałby adres,
     którego w Subiekcie jeszcze nie ma (i może nigdy nie być). */
  assert.equal(lokalizacja(), "");
});

test("add nie duplikuje adresu, który już jest", async () => {
  db().prepare("UPDATE sgt_towar SET lokalizacja = 'A01-02-03' WHERE tw_id = 1").run();
  const r = await zmien({ action: "add", value: "A01-02-03" });
  assert.equal(r.statusCode, 200);
  assert.match(zadania()[0].payload, /"newValue":"A01-02-03"/);
});

test("remove nie waliduje kodu — usuwa się też adres zapisany przed regułami", async () => {
  db().prepare("UPDATE sgt_towar SET lokalizacja = 'STARY_FORMAT' WHERE tw_id = 1").run();
  const r = await zmien({ action: "remove", value: "STARY_FORMAT" });
  assert.equal(r.statusCode, 200);
  assert.match(zadania()[0].payload, /"newValue":""/);
});

test("nieznany towar to 404, i to przed walidacją ciała", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/products/99999/location",
    headers: { "x-session": token },
    payload: { action: "replace", value: "A01-02-03" },
  });
  assert.equal(r.statusCode, 404);
});

// ── Audyt ───────────────────────────────────────────────────────────────────

test("każda zmiana zostawia wpis w events z autorem z sesji", async () => {
  await zmien({ action: "replace", value: "A01-02-03" });
  const ev = db()
    .prepare("SELECT type, user_id FROM events ORDER BY id DESC LIMIT 1")
    .get() as { type: string; user_id: string };
  assert.equal(ev.type, "location_set");
  assert.equal(ev.user_id, "Jan Testowy");
});

test("usunięcie ma własny typ zdarzenia — audyt musi je odróżniać", async () => {
  db().prepare("UPDATE sgt_towar SET lokalizacja = 'A01-02-03' WHERE tw_id = 1").run();
  await zmien({ action: "remove", value: "A01-02-03" });
  const ev = db().prepare("SELECT type FROM events ORDER BY id DESC LIMIT 1").get() as {
    type: string;
  };
  assert.equal(ev.type, "location_removed");
});

/* ── Ustawienie lokalizacji podstawowej (0.38.0) ─────────────────────────────
   Pickingową jest PIERWSZA lokalizacja z pola. Towar leżący w dwóch miejscach
   zmienia „główne" wraz z rotacją, a do 0.38.0 jedyną drogą było skasowanie
   adresu i nadanie go od nowa — czyli utrata informacji, że drugie miejsce
   w ogóle istnieje.                                                          */

/** Ustawia pole lokalizacji towaru 1 na podaną zawartość. */
const ustawPole = (v: string) =>
  db().prepare("UPDATE sgt_towar SET lokalizacja = ? WHERE tw_id = 1").run(v);

test("podniesienie adresu przestawia go na pierwsze miejsce", async () => {
  ustawPole("A01-02-03 B02-01-01 C03-01-01");
  const r = await zmien({ action: "promote", value: "B02-01-01" });
  assert.equal(r.statusCode, 200);
  assert.match(zadania()[0].payload, /"newValue":"B02-01-01 A01-02-03 C03-01-01"/);
});

test("podniesienie NIE gubi ani nie dopisuje adresów", async () => {
  // cała różnica względem `replace`: tamto zostawiłoby jeden adres
  ustawPole("A01-02-03 B02-01-01 C03-01-01");
  await zmien({ action: "promote", value: "C03-01-01" });
  const wynik = JSON.parse(zadania()[0].payload).newValue as string;
  assert.deepEqual(wynik.split(" ").sort(), ["A01-02-03", "B02-01-01", "C03-01-01"]);
});

test("podniesienie adresu, którego towar nie ma, to 400 z czytelnym powodem", async () => {
  /* Prośba „podnieś adres, którego tu nie ma" znaczy, że kolektor patrzy na
     inny stan niż baza. Ciche dopisanie zamieniłoby ten rozjazd w zapis do
     kartoteki firmy. */
  ustawPole("A01-02-03");
  const r = await zmien({ action: "promote", value: "Z09-09-09" });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /nie ma lokalizacji Z09-09-09/);
  assert.equal(zadania().length, 0, "odmowa nie ma prawa nic zakolejkować");
});

test("podniesienie już podstawowej nic nie psuje", async () => {
  ustawPole("A01-02-03 B02-01-01");
  const r = await zmien({ action: "promote", value: "A01-02-03" });
  assert.equal(r.statusCode, 200);
  assert.match(zadania()[0].payload, /"newValue":"A01-02-03 B02-01-01"/);
});
