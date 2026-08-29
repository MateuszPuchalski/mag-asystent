import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy szablonów ─────────────────────────────────────────────────────────
   Logika jest przedmiotem `services/szablony.test.ts`; tutaj bramka ról
   i to, że WSTAWIENIE szablonu do odpowiedzi niczego nie zapisuje.          */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-szr-")), "t.db");
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
  for (const t of ["szablon", "pytanie", "events", "device_session", "app_user"]) {
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
    .run(token, u.userId, "biurko-1", teraz, teraz);
  return token;
}

function pytanieTestowe(): number {
  const teraz = new Date().toISOString();
  return Number(
    db()
      .prepare(
        `INSERT INTO pytanie(zrodlo, thread_id, kupujacy_login, oferta_tytul, tresc, otrzymano_at,
                             status, produkty_json, utworzono_at, utworzono_przez)
         VALUES ('allegro', 'w-1', 'jan_wraca', 'Kosiarka T375', 'Czy pasuje?', ?, 'nowe', '[]', ?, 'test')`
      )
      .run(teraz, teraz).lastInsertRowid
  );
}

test("szablony są dla biura — hala dostaje 403 na każdej trasie", async () => {
  const hala = zalogowany("magazynier");
  const proby: Array<[string, string, unknown]> = [
    ["GET", "/api/biuro/szablony", undefined],
    ["POST", "/api/biuro/szablony", { nazwa: "x", kanal: "dowolny", tresc: "y" }],
    ["PUT", "/api/biuro/szablony/1", { nazwa: "x", kanal: "dowolny", tresc: "y" }],
    ["DELETE", "/api/biuro/szablony/1", undefined],
  ];
  for (const [method, url, payload] of proby) {
    const bez = await app.inject({ method: method as "GET", url, payload: payload as object });
    assert.equal(bez.statusCode, 401, `${method} ${url} bez sesji`);
    const z = await app.inject({
      method: method as "GET",
      url,
      headers: { "x-session": hala },
      payload: payload as object,
    });
    assert.equal(z.statusCode, 403, `${method} ${url} dla hali`);
  }
});

test("pełne życie szablonu: dodanie, edycja, lista, skasowanie", async () => {
  const naglowki = { "x-session": zalogowany("biuro") };
  const dodany = await app.inject({
    method: "POST",
    url: "/api/biuro/szablony",
    headers: naglowki,
    payload: { nazwa: "Zwrot przyjęty", kanal: "dyskusja", tresc: "Zwrot {{zwrot}} przyjęty" },
  });
  assert.equal(dodany.statusCode, 200);
  const id = dodany.json().id as number;

  const pusty = await app.inject({
    method: "POST",
    url: "/api/biuro/szablony",
    headers: naglowki,
    payload: { nazwa: "Bez treści", kanal: "dowolny", tresc: "  " },
  });
  assert.equal(pusty.statusCode, 400, "pusty szablon to odmowa ze zdaniem");

  const zmieniony = await app.inject({
    method: "PUT",
    url: `/api/biuro/szablony/${id}`,
    headers: naglowki,
    payload: { nazwa: "Zwrot przyjęty", kanal: "dowolny", tresc: "Zwrot {{zwrot}} przyjęty. Dziękujemy" },
  });
  assert.equal(zmieniony.statusCode, 200);
  assert.equal(zmieniony.json().kanal, "dowolny");

  const lista = await app.inject({ method: "GET", url: "/api/biuro/szablony", headers: naglowki });
  assert.equal(lista.json().szablony.length, 1);

  const brak = await app.inject({
    method: "PUT",
    url: "/api/biuro/szablony/999999",
    headers: naglowki,
    payload: { nazwa: "x", kanal: "dowolny", tresc: "y" },
  });
  assert.equal(brak.statusCode, 404);

  const skasowany = await app.inject({
    method: "DELETE",
    url: `/api/biuro/szablony/${id}`,
    headers: naglowki,
  });
  assert.equal(skasowany.statusCode, 200);
  const poKasacji = await app.inject({ method: "GET", url: "/api/biuro/szablony", headers: naglowki });
  assert.equal(poKasacji.json().szablony.length, 0);
});

test("szablon dla sprawy wypełnia się danymi i NICZEGO nie zapisuje", async () => {
  const naglowki = { "x-session": zalogowany("biuro") };
  const pytanieId = pytanieTestowe();
  const dodany = await app.inject({
    method: "POST",
    url: "/api/biuro/szablony",
    headers: naglowki,
    payload: { nazwa: "Dobór", kanal: "pytanie", tresc: "Dzień dobry {{klient}}, {{oferta}} — {{zamowienie}}" },
  });
  const id = dodany.json().id as number;
  const przed = (db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;

  const r = await app.inject({
    method: "GET",
    url: `/api/biuro/szablony/${id}/dla?rodzaj=pytanie&id=${pytanieId}`,
    headers: naglowki,
  });
  assert.equal(r.statusCode, 200);
  const d = r.json();
  assert.match(d.tresc, /jan_wraca/);
  assert.match(d.tresc, /Kosiarka T375/);
  /* Pytanie nie ma zamówienia — klamra zostaje, a panel to zgłasza. */
  assert.match(d.tresc, /\{\{zamowienie\}\}/);
  assert.deepEqual(d.brakujace, ["zamowienie"]);

  const po = (db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  assert.equal(po, przed, "wstawienie szablonu to ODCZYT — żadnego zdarzenia w dzienniku");

  const zly = await app.inject({
    method: "GET",
    url: `/api/biuro/szablony/${id}/dla?rodzaj=wymyslony&id=1`,
    headers: naglowki,
  });
  assert.equal(zly.statusCode, 400);
});
