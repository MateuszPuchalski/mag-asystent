import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-ustawienia-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* ── Ustawienia obsługi (0.169.0) ────────────────────────────────────────────
   Ekran ustawień pokazuje pokrycie sygnatur, czyli mówi o kartotekach
   i zamówieniach. To są dane biura, więc bramka roli stoi także na odczycie —
   ta sama zasada co przy skrzynce i zwrotach.                              */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zamowienie_klienta_pozycja", "zamowienie_klienta", "sgt_towar",
    "channel_account", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (11,'W27-0521','Nóż')").run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const zam = Number(d.prepare(`INSERT INTO zamowienie_klienta
    (channel_account_id,external_id,synced_at) VALUES (?,'ord-1','2026-09-02T09:00:00Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja
    (zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (?,'o1','Nóż 51','W27-0521',1,1000,'PLN')`).run(zam);
});

function login(role: Rola) {
  const u = createUser(`Ktoś ${role}`, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { "x-session": token };
}

test("bez sesji pokrycie sygnatur nie odpowiada danymi", async () => {
  const r = await app.inject({ method: "GET", url: "/api/obsluga/sygnatury" });
  assert.equal(r.statusCode, 401, "401 przed 403 — brak sesji to inna naprawa niż zła rola");
});

test("hala nie widzi pokrycia — to dane biura", async () => {
  const r = await app.inject({
    method: "GET", url: "/api/obsluga/sygnatury", headers: login("magazynier"),
  });
  assert.equal(r.statusCode, 403);
});

test("biuro dostaje liczby, nie sam procent", async () => {
  const r = await app.inject({
    method: "GET", url: "/api/obsluga/sygnatury", headers: login("biuro"),
  });
  assert.equal(r.statusCode, 200);
  const body = r.json() as { pozycji: number; trafia: number; bezSygnatury: number;
    sygnatur: number; pudla: unknown[]; zdublowane: unknown[] };
  assert.equal(body.pozycji, 1);
  assert.equal(body.trafia, 1);
  assert.equal(body.bezSygnatury, 0);
  assert.deepEqual(body.pudla, [], "nic nie pudłuje, bo symbol stoi w kartotece");
});

test("ZERO TRAS ZAPISU i to jest umowa", async () => {
  /* Ta sama umowa co licznik `method:` w `biuro.test.ts` i licznik POST-ów
     w `zwroty.test.ts`: ustawienia obsługi opisują TŁO pracy. Gdy kiedyś
     dojdzie tu zapis, podniesie tę liczbę i dostanie zdanie w uzasadnieniu. */
  const zrodlo = fs.readFileSync(new URL("./ustawienia.ts", import.meta.url), "utf8");
  for (const metoda of ["post", "put", "delete", "patch"]) {
    assert.equal((zrodlo.match(new RegExp(`app\\.${metoda}[<(]`, "g")) ?? []).length, 0,
      `ustawienia obsługi dostały trasę ${metoda.toUpperCase()}`);
  }
});
