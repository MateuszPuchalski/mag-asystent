import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy spraw — jedna kolejka obsługi klienta ─────────────────────────────
   Logika jest przedmiotem `services/sprawy.test.ts`; tutaj bramka ról
   i kształt odpowiedzi przez HTTP. Najważniejsze do sprawdzenia: wszystkie
   trasy są ODCZYTEM za bramką biura, a zły parametr wraca jako 400 ze
   zdaniem, nie jako pusta lista udająca „nic nie ma".                        */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-sprr-")), "t.db");
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
  for (const t of [
    "dyskusja", "pytanie", "zwrot_pozycja", "zwrot",
    "events", "device_session", "app_user",
  ]) {
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

function daneSpraw(): { dyskusjaId: number } {
  const d = db();
  const teraz = new Date().toISOString();
  d.prepare(
    `INSERT INTO pytanie(zrodlo, kupujacy_login, tresc, otrzymano_at, status,
       produkty_json, utworzono_at, utworzono_przez)
     VALUES ('allegro', 'jan', 'Czy pasuje?', ?, 'nowe', '[]', ?, 'Test')`
  ).run(teraz, teraz);
  const z = d
    .prepare(
      `INSERT INTO zwrot(kupujacy_login, waybill, status, allegro_order_id,
         utworzono_allegro, utworzono_at, utworzono_przez)
       VALUES ('jan', 'WB-1', 'nowy', 'zam-1', ?, ?, 'Test')`
    )
    .run(teraz, teraz);
  d.prepare(
    `INSERT INTO zwrot_pozycja(zwrot_id, nazwa, ilosc, decyzja, decyzja_at, decyzja_przez)
     VALUES (?, 'Pęknięty nóż', 1, 'reklamacja', ?, 'Test')`
  ).run(Number(z.lastInsertRowid), teraz);
  const dy = d.prepare(
    `INSERT INTO dyskusja(allegro_id, typ, status, temat, kupujacy_login, order_id,
       utworzono_allegro, widziano_at, utworzono_at)
     VALUES ('iss-1', 'CLAIM', 'nowa', 'Pęknięta obudowa', 'jan', 'zam-1', ?, ?, ?)`
  ).run(teraz, teraz, teraz);
  /* Id z bazy, nie „1": rowid nie startuje od zera po DELETE w beforeEach. */
  return { dyskusjaId: Number(dy.lastInsertRowid) };
}

const TRASY = [
  "/api/biuro/sprawy",
  "/api/biuro/sprawy/licznik",
  "/api/biuro/sprawy/klient?login=jan",
  "/api/biuro/sprawy/powiazane?rodzaj=zwrot&id=1",
];

test("bez sesji 401, magazynier 403 — sprawy klientów prowadzi biuro", async () => {
  const token = zalogowany("magazynier");
  for (const url of TRASY) {
    const bez = await app.inject({ method: "GET", url });
    assert.equal(bez.statusCode, 401, url);
    const hala = await app.inject({ method: "GET", url, headers: { "x-session": token } });
    assert.equal(hala.statusCode, 403, url);
  }
});

test("kolejka: cztery rodzaje w jednej liście, filtr rodzaju, zły rodzaj = 400", async () => {
  daneSpraw();
  const naglowki = { "x-session": zalogowany("biuro") };

  const r = await app.inject({ method: "GET", url: "/api/biuro/sprawy", headers: naglowki });
  assert.equal(r.statusCode, 200);
  const rodzaje = r.json().sprawy.map((s: { rodzaj: string }) => s.rodzaj).sort();
  assert.deepEqual(rodzaje, ["dyskusja", "pytanie", "reklamacja", "zwrot"]);
  assert.ok("allegro" in r.json(), "stan połączenia dla banera zakładki");

  const filtr = await app.inject({
    method: "GET", url: "/api/biuro/sprawy?rodzaj=pytanie", headers: naglowki,
  });
  assert.deepEqual(filtr.json().sprawy.map((s: { rodzaj: string }) => s.rodzaj), ["pytanie"]);

  const zly = await app.inject({
    method: "GET", url: "/api/biuro/sprawy?rodzaj=faktura", headers: naglowki,
  });
  assert.equal(zly.statusCode, 400);
  assert.match(zly.json().error, /dozwolone/);
});

test("licznik: pigułka zgodna z długością kolejki", async () => {
  daneSpraw();
  const naglowki = { "x-session": zalogowany("biuro") };
  const licznik = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/licznik", headers: naglowki,
  });
  const kolejka = await app.inject({ method: "GET", url: "/api/biuro/sprawy", headers: naglowki });
  assert.equal(licznik.json().otwartych, kolejka.json().sprawy.length);
});

test("Klient 360 i powiązania: login z querystring, kubełek bez parametru", async () => {
  const { dyskusjaId } = daneSpraw();
  const naglowki = { "x-session": zalogowany("biuro") };

  const jan = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/klient?login=jan", headers: naglowki,
  });
  assert.equal(jan.json().login, "jan");
  assert.equal(jan.json().aktywne.length, 4);
  assert.ok(Array.isArray(jan.json().historia));

  const kubelek = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/klient", headers: naglowki,
  });
  assert.equal(kubelek.json().login, null);
  assert.deepEqual(kubelek.json().aktywne, [], "jan nie przecieka do kubełka");

  const powiazane = await app.inject({
    method: "GET", url: `/api/biuro/sprawy/powiazane?rodzaj=dyskusja&id=${dyskusjaId}`, headers: naglowki,
  });
  assert.equal(powiazane.statusCode, 200);
  assert.deepEqual(
    powiazane.json().zamowienie.map((s: { rodzaj: string }) => s.rodzaj).sort(),
    ["reklamacja", "zwrot"],
    "ciąg jednego zamówienia"
  );

  const bezId = await app.inject({
    method: "GET", url: "/api/biuro/sprawy/powiazane?rodzaj=dyskusja", headers: naglowki,
  });
  assert.equal(bezId.statusCode, 400);
});
