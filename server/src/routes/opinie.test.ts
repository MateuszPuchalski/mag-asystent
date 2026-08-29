import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy opinii ────────────────────────────────────────────────────────────
   Logika jest przedmiotem `services/opinie.test.ts`; tutaj bramka ról i to,
   czego tu NIE MA: trasy odpowiadania na opinię. Końcówka odpowiedzi jest
   niezweryfikowana, więc jej brak jest decyzją i test ją pilnuje.           */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-opr-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";

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
  for (const t of ["sprawa_zdarzenie", "sprawa_zrodlo", "sprawa", "opinia", "events",
                   "device_session", "app_user"]) {
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

test("opinie są dla biura — hala dostaje 403 na każdej trasie", async () => {
  const hala = zalogowany("magazynier");
  const proby: Array<[string, string, unknown]> = [
    ["GET", "/api/biuro/opinie", undefined],
    ["POST", "/api/biuro/opinie/odswiez", undefined],
    ["POST", "/api/biuro/opinie/1/status", { status: "przejrzana" }],
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

test("pobranie zakłada rejestr, a status przestawia się jednym POST-em", async () => {
  const naglowki = { "x-session": zalogowany("biuro") };
  const sync = await app.inject({
    method: "POST",
    url: "/api/biuro/opinie/odswiez",
    headers: naglowki,
  });
  assert.equal(sync.statusCode, 200);
  assert.equal(sync.json().nowych, 3);

  const lista = await app.inject({ method: "GET", url: "/api/biuro/opinie", headers: naglowki });
  assert.equal(lista.json().opinie.length, 3);
  assert.equal(lista.json().licznik.nowe, 3);
  /* Stan połączenia jedzie z listą — pusty rejestr po awarii tokena wygląda
     inaczej niż pusty rejestr bez opinii (wzorzec dyskusji). */
  assert.ok(lista.json().allegro);

  const zla = (lista.json().opinie as Array<{ id: number; ocena: number }>).find(
    (o) => o.ocena === 1
  )!;
  const zmiana = await app.inject({
    method: "POST",
    url: `/api/biuro/opinie/${zla.id}/status`,
    headers: naglowki,
    payload: { status: "zalatwiona" },
  });
  assert.equal(zmiana.statusCode, 200);
  assert.equal(zmiana.json().status, "zalatwiona");

  const zly = await app.inject({
    method: "POST",
    url: `/api/biuro/opinie/${zla.id}/status`,
    headers: naglowki,
    payload: { status: "wymyslony" },
  });
  assert.equal(zly.statusCode, 400);
  const brak = await app.inject({
    method: "POST",
    url: "/api/biuro/opinie/999999/status",
    headers: naglowki,
    payload: { status: "przejrzana" },
  });
  assert.equal(brak.statusCode, 404);

  /* Filtr statusu zawęża listę — czipy w rejestrze stoją na nim. */
  const zalatwione = await app.inject({
    method: "GET",
    url: "/api/biuro/opinie?status=zalatwiona",
    headers: naglowki,
  });
  assert.equal(zalatwione.json().opinie.length, 1);
});

test("opinia wchodzi do kolejki spraw jako piąte źródło", async () => {
  const naglowki = { "x-session": zalogowany("biuro") };
  await app.inject({ method: "POST", url: "/api/biuro/opinie/odswiez", headers: naglowki });

  const kolejka = await app.inject({
    method: "GET",
    url: "/api/biuro/sprawy?rodzaj=opinia",
    headers: naglowki,
  });
  assert.equal(kolejka.statusCode, 200);
  assert.equal(kolejka.json().sprawy.length, 3);

  const licznik = await app.inject({
    method: "GET",
    url: "/api/biuro/sprawy/licznik",
    headers: naglowki,
  });
  assert.equal(licznik.json().opinieNowe, 3);
  assert.equal(licznik.json().opinieZle, 1);
});

test("odpowiadania na opinię przez API tu NIE MA — to decyzja, nie brak", async () => {
  const naglowki = { "x-session": zalogowany("biuro") };
  await app.inject({ method: "POST", url: "/api/biuro/opinie/odswiez", headers: naglowki });
  const id = (
    (await app.inject({ method: "GET", url: "/api/biuro/opinie", headers: naglowki })).json()
      .opinie as Array<{ id: number }>
  )[0].id;
  /* Końcówka odpowiedzi Allegro jest [WERYFIKUJ]; do czasu potwierdzenia
     odpowiada się w panelu Allegro, a rejestr trzyma status. */
  const proba = await app.inject({
    method: "POST",
    url: `/api/biuro/opinie/${id}/odpowiedz`,
    headers: naglowki,
    payload: { tresc: "Dziękujemy" },
  });
  assert.equal(proba.statusCode, 404, "trasy nie ma i ma nie być");
});
