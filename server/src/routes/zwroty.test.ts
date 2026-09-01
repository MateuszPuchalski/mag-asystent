import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zwroty-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* Trasy zwrotów pilnują tu trzech rzeczy, z których żadna nie mieszka
   w serwisie:

   1. BRAMKA ROLI TAKŻE NA ODCZYCIE. Zwrot niesie numer zamówienia i sprawę
      klienta — dane biura, nie hali. Trasa odczytu bez bramki wygląda
      niewinnie i przecieka po cichu.
   2. ZERO ZAPISU PRZY PATRZENIU. Reguła z 0.18.0 obowiązuje też panel
      obsługi, choć licznik `method:` w `biuro.test.ts` obejmuje wyłącznie
      `biuro.html`. Wydanie 0.150.0 ma SAME odczyty i ten test jest tego
      umową: pierwszy zapis podniesie tu liczbę i dostanie zdanie.
   3. 401 PRZED 403. Brak sesji to inna naprawa niż zła rola.              */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let zwrot = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zwrot_zdarzenie", "zwrot_klienta_pozycja", "zwrot_klienta", "allegro_zwrot",
    "channel_account", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  zwrot = Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,
    reference_number,order_id,created_at,paczka_at,synced_at)
    VALUES (?,'zw-1','REF-1','ord-1','2026-08-25T09:00:00Z','2026-08-28T09:00:00Z','2026-09-01T09:00:00Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,powod)
    VALUES (?,'111','Sekator NAC',1,4999,'PLN','DONT_LIKE_IT')`).run(zwrot);
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { naglowki: { "x-session": token } };
}

const TRASY = () => [
  { method: "GET" as const, url: "/api/obsluga/zwroty" },
  { method: "GET" as const, url: `/api/obsluga/zwroty/${zwrot}` },
];

test("bez sesji żadna trasa zwrotów nie odpowiada danymi", async () => {
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url });
    assert.equal(r.statusCode, 401, `${t.method} ${t.url} przepuścił brak sesji`);
  }
});

test("hala nie widzi zwrotów — bramka roli stoi też na odczycie", async () => {
  const { naglowki } = login("magazynier", "Magazynier Marek");
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, headers: naglowki });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url} wpuścił halę`);
    assert.match(r.json().error, /biuro/, "odmowa mówi, kto to prowadzi");
  }
});

test("biuro dostaje kolejkę z kubełkiem, terminem i licznikami", async () => {
  const { naglowki } = login("biuro", "Ala z biura");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/zwroty", headers: naglowki });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.zwroty.length, 1);
  const z = body.zwroty[0];
  assert.equal(z.externalId, "zw-1");
  assert.equal(z.kubelek, "decyzja", "zwrot bez werdyktu czeka na decyzję");
  assert.equal(z.sumaPozycjiGrosze, 4999);
  assert.equal(typeof z.dniDoTerminu, "number");
  assert.equal(body.liczniki.decyzja, 1);
  assert.ok(body.stan.status, "stan synchronizacji jedzie razem z kolejką");
});

test("zwrot spoza bazy to 404, nie pusty obiekt", async () => {
  const { naglowki } = login("biuro", "Ala druga");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/zwroty/99999", headers: naglowki });
  assert.equal(r.statusCode, 404);
});

test("otwarcie kolejki nie zapisuje NICZEGO", async () => {
  /* Umowa z 0.18.0. Liczymy wiersze we WSZYSTKICH tabelach, których ten
     ekran dotyka — nie tylko w dzienniku, bo zapis potrafi wylądować obok. */
  const { naglowki } = login("biuro", "Ala trzecia");
  const licz = () => {
    const d = db();
    return ["events", "zwrot_klienta", "zwrot_klienta_pozycja", "zwrot_zdarzenie",
      "allegro_zwrot", "allegro_zwroty_sync_state"]
      .map((t) => (d.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n)
      .join("/");
  };
  const przed = licz();
  for (const t of TRASY()) {
    await app.inject({ method: t.method, url: t.url, headers: naglowki });
    await app.inject({ method: t.method, url: t.url, headers: naglowki });
  }
  assert.equal(licz(), przed, "patrzenie na zwroty niczego nie mutuje");
});

test("wydanie 0.150.0 nie ma ani jednej trasy zapisu", async () => {
  /* Ta liczba jest UMOWĄ, jak licznik `method:` w `biuro.test.ts`. Pierwszy
     werdykt zapisywany z panelu (0.151.0) podniesie ją i dostanie tu zdanie
     mówiące, co wolno zapisać i dlaczego. */
  const zapisy = app.printRoutes({ commonPrefix: false })
    .split("\n")
    .filter((l) => /\/api\/obsluga\/zwroty/.test(l) && /POST|PUT|DELETE|PATCH/.test(l));
  assert.deepEqual(zapisy, [], "zwroty w tym wydaniu wyłącznie czytają");
});
