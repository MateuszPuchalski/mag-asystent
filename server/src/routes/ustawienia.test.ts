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

test("pokrycie wiedzy (E3) to liczby dla biura, bez zapisu i bez hali", async () => {
  let r = await app.inject({ method: "GET", url: "/api/obsluga/pokrycie-wiedzy" });
  assert.equal(r.statusCode, 401);
  r = await app.inject({ method: "GET", url: "/api/obsluga/pokrycie-wiedzy", headers: login("magazynier") });
  assert.equal(r.statusCode, 403);
  const zdarzen = () => (db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n;
  const przed = zdarzen();
  r = await app.inject({ method: "GET", url: "/api/obsluga/pokrycie-wiedzy", headers: login("biuro") });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json<{ kartotek: number; identyfikatorow: number; fts: { dostepne: boolean; wpisow: number };
    modeleZOpisu: { nowych: number } }>();
  assert.equal(typeof body.kartotek, "number");
  assert.equal(typeof body.identyfikatorow, "number");
  assert.equal(typeof body.modeleZOpisu.nowych, "number");
  assert.equal(body.fts.dostepne, true, "node:sqlite testów ma FTS5");
  assert.equal(zdarzen(), przed);
});

test("skuteczność doboru: liczby dla biura, oś osobowa z podstawą prawną, bez zapisu", async () => {
  /* Ta trasa niesie OŚ OSOBOWĄ, więc bramka roli znaczy tu więcej niż wygodę.
     Do tego zdanie o podstawie prawnej monitoringu musi dojechać w ładunku —
     panel, który go nie dostanie, nie ma jak go pokazać. */
  let r = await app.inject({ method: "GET", url: "/api/obsluga/skutecznosc-doboru" });
  assert.equal(r.statusCode, 401, "401 przed 403 — brak sesji to nie brak roli");
  r = await app.inject({ method: "GET", url: "/api/obsluga/skutecznosc-doboru", headers: login("magazynier") });
  assert.equal(r.statusCode, 403, "hala nie ogląda pracy biura");

  const zdarzen = () => (db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n;
  const przed = zdarzen();
  r = await app.inject({ method: "GET", url: "/api/obsluga/skutecznosc-doboru?dni=90", headers: login("biuro") });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json<{ dni: number; drogi: unknown[]; osoby: unknown[]; podstawaPrawna: string;
    progWiarygodnosci: number; naStole: { statusy: unknown[] } }>();
  assert.equal(body.dni, 90);
  assert.equal(body.drogi.length, 11, "jedenaście szczebli §11.2, także z zerami");
  assert.equal(body.naStole.statusy.length, 9, "dziewięć statusów §7, także z zerami");
  assert.match(body.podstawaPrawna, /Kodeks pracy art\. 22²/);
  assert.equal(body.progWiarygodnosci, 20);
  /* Okno spoza selektora spada na tydzień, nie na wartość z żądania. */
  r = await app.inject({ method: "GET", url: "/api/obsluga/skutecznosc-doboru?dni=9999", headers: login("biuro") });
  assert.equal(r.json<{ dni: number }>().dni, 7);
  assert.equal(zdarzen(), przed, "raport o zdarzeniach nie ma prawa dopisywać do zdarzeń");
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
