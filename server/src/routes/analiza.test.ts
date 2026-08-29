import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── GET /api/analiza + /api/analiza/csv ─────────────────────────────────────
   Agregacje są przedmiotem `services/analiza.test.ts`; tutaj bramka i kształt.
   Bramka jest ważniejsza niż zwykle: odpowiedź niesie raport per osoba, czyli
   monitoring pracowniczy — magazynier nie ma prawa czytać zestawień o sobie
   i kolegach, dokładnie jak przy śladzie audytowym.                          */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-anlr-")), "t.db");
process.env.LOG_LEVEL = "silent";

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
  for (const t of ["events", "device_session", "app_user"]) {
    db().prepare(`DELETE FROM ${t}`).run();
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
    .run(token, u.userId, "kolektor-7", teraz, teraz);
  return token;
}

/* Analiza dostaw (0.100.0) dzieli tę bramkę, choć jej dane nie są imienne.
   Powód jest inny i wypisany przy trasie: karta odpowiada na „u którego
   dostawcy jest problem", a to ocena kontrahenta, nie stan magazynu. */
const CHRONIONE = ["/api/analiza", "/api/analiza/csv", "/api/biuro/dostawy/analiza"];

test("bez sesji 401 — dane o ludziach nie mają prawa być otwarte", async () => {
  for (const url of CHRONIONE) {
    const r = await app.inject({ method: "GET", url });
    assert.equal(r.statusCode, 401, url);
  }
});

test("magazynier dostaje 403 — analiza jest dla biura", async () => {
  const token = zalogowany("magazynier");
  for (const url of CHRONIONE) {
    const r = await app.inject({ method: "GET", url, headers: { "x-session": token } });
    assert.equal(r.statusCode, 403, url);
  }
});

test("biuro dostaje komplet sekcji", async () => {
  const token = zalogowany("biuro");
  const r = await app.inject({
    method: "GET",
    url: "/api/analiza?days=30",
    headers: { "x-session": token },
  });
  assert.equal(r.statusCode, 200);
  const a = r.json();
  assert.equal(a.days, 30);
  assert.equal(a.dni.length, 30);
  assert.equal(a.godziny.length, 24);
  assert.ok(a.rytm);
  assert.ok(a.szukania);
  assert.ok(Array.isArray(a.urzadzenia));
  assert.match(a.wydajnosc.podstawaPrawna, /Kodeks pracy/, "podstawa prawna jedzie z danymi");
});

test("analiza dostaw: komplet sekcji i własny zbiór okien", async () => {
  const token = zalogowany("biuro");
  const czytaj = async (q: string) =>
    (
      await app.inject({
        method: "GET",
        url: `/api/biuro/dostawy/analiza${q}`,
        headers: { "x-session": token },
      })
    ).json().analiza;

  const a = await czytaj("?dni=30");
  assert.equal(a.dni, 30);
  assert.ok(Array.isArray(a.dostawcy));
  assert.ok(Array.isArray(a.wyjatki));
  assert.ok(Array.isArray(a.tygodnie));
  assert.ok("udzialWyjatkow" in a && "medianaDni" in a && "pozaWertis" in a);

  /* Zbiór okien jest INNY niż przy śladzie audytowym i to jest cała treść tego
     sprawdzenia: 7 dni jest tu poprawnym wejściem, a nie ma go w zbiorze, więc
     trasa musi podstawić własne domyślne 90. Gdyby milcząco przyjęła 7, czip
     „7 dni" w pasku wyglądałby na wybrany przy liczbach z innego okna —
     dokładnie tak rozjechało się okno pytań w 0.96.0. */
  assert.equal((await czytaj("?dni=7")).dni, 90, "okno spoza zbioru wraca do 90");
  assert.equal((await czytaj("?dni=180")).dni, 180);
  assert.equal((await czytaj("")).dni, 90, "brak parametru to też 90");
});

test("śmieciowe okno wraca do 7 dni, nie wywraca", async () => {
  const token = zalogowany("biuro");
  for (const q of ["?days=999", "?days=abc", ""]) {
    const r = await app.inject({
      method: "GET",
      url: `/api/analiza${q}`,
      headers: { "x-session": token },
    });
    assert.equal(r.json().days, 7, `dla „${q}"`);
  }
});

test("CSV: BOM, sekcje i podstawa prawna nad danymi imiennymi", async () => {
  const token = zalogowany("biuro");
  const r = await app.inject({
    method: "GET",
    url: "/api/analiza/csv",
    headers: { "x-session": token },
  });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"] as string, /text\/csv/);
  assert.ok(r.body.startsWith("﻿"), "bez BOM Excel czyta UTF-8 jako ANSI");
  assert.match(r.body, /# OPERACJE PER DZIEN/);
  assert.match(r.body, /# SZUKANE BEZ WYNIKU/);
  const sekcjaImienna = r.body.indexOf("# WYDAJNOSC PER OSOBA");
  const podstawa = r.body.indexOf("Kodeks pracy");
  assert.ok(sekcjaImienna >= 0 && podstawa > sekcjaImienna, "podstawa prawna ma stać nad danymi");
});

test("eksport CSV zostawia ślad w audycie", async () => {
  // ta sama zasada co audyt_eksport: kto pobiera zestawienia o ludziach,
  // sam trafia do logu
  const token = zalogowany("biuro");
  await app.inject({ method: "GET", url: "/api/analiza/csv", headers: { "x-session": token } });
  const wpis = db()
    .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'analiza_eksport'")
    .get() as { n: number };
  assert.equal(wpis.n, 1);
});

test("czasy odpowiedzi: bramka biura, okno z listy i podstawa prawna (0.134.0)", async () => {
  const bez = await app.inject({ method: "GET", url: "/api/biuro/czasy-obslugi" });
  assert.equal(bez.statusCode, 401, "dane o ludziach nie mają prawa być otwarte");
  const hala = await app.inject({
    method: "GET",
    url: "/api/biuro/czasy-obslugi",
    headers: { "x-session": zalogowany("magazynier") },
  });
  assert.equal(hala.statusCode, 403);

  const token = zalogowany("biuro");
  const r = await app.inject({
    method: "GET",
    url: "/api/biuro/czasy-obslugi?days=30",
    headers: { "x-session": token },
  });
  assert.equal(r.statusCode, 200);
  const d = r.json();
  assert.equal(d.dni, 30);
  assert.deepEqual(
    d.odcinki.map((o: { klucz: string }) => o.klucz),
    ["wszystko", "pytanie", "dyskusja"]
  );
  /* Monitoring pracowniczy jedzie RAZEM z danymi imiennymi, nie obok nich. */
  assert.match(d.podstawaPrawna, /Kodeks pracy/);
  assert.ok(Array.isArray(d.teraz));

  /* Śmieciowe okno wraca do domyślnego, tak jak przy śladzie audytowym. */
  const smieci = await app.inject({
    method: "GET",
    url: "/api/biuro/czasy-obslugi?days=999",
    headers: { "x-session": token },
  });
  assert.equal(smieci.json().dni, 7);
});
