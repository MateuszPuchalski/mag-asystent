import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-ean-trasy-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* ── Bramka roli przy rozstrzyganiu kolizji kodu ─────────────────────────────
   `services/ean.test.ts` pilnuje LOGIKI: dwóch rodzajów, nadpisywania decyzji
   i licznika trafień po niej. Nie dotyka jednak bramki roli, bo ta stoi na
   trasie — a bramka bez testu to bramka, która znika po cichu przy pierwszym
   refaktorze i nikt się nie dowie, dopóki magazynier nie zamknie sprawy
   o danych w Subiekcie.

   Wyszło to przy próbie na żywym serwerze: chciałem sprawdzić 403 i zobaczyłem,
   że nie ma czego zepsuć — testu nie było wcale.
   
   Rozstrzyganie należy do BIURA nie z hierarchii, tylko z natury rzeczy:
   kolizja to zły stan kartotek w Subiekcie, a hala zgłasza ją samym skanem
   i nie ma czego rozstrzygać.                                                */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const m = await import("../index.js");
  app = await m.buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["ean_rozstrzygniecie", "ean_conflict", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare("INSERT INTO ean_conflict(ean,tw_ids,auto,seen_at) VALUES (?,?,0,?)")
    .run("5901234567890", "[900001,900002]", new Date().toISOString());
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { "x-session": token };
}

const URL = "/api/ean-conflicts/5901234567890/rozstrzygnij";

test("kolizję rozstrzyga biuro, nie hala", async () => {
  const magazynier = login("magazynier", "Marek");
  let r = await app.inject({ method: "POST", url: URL, headers: magazynier,
    payload: { rodzaj: "dopuszczone" } });
  assert.equal(r.statusCode, 403, r.body);
  assert.match(r.json().error, /biuro/i);
  assert.equal((db().prepare("SELECT count(*) n FROM ean_rozstrzygniecie").get() as { n: number }).n, 0,
    "odmowa NIE zostawia decyzji w bazie");

  const biuro = login("biuro", "Anna");
  r = await app.inject({ method: "POST", url: URL, headers: biuro,
    payload: { rodzaj: "dopuszczone", notatka: "Zestaw i sztuka luzem." } });
  assert.equal(r.statusCode, 200, r.body);

  /* Decyzja wraca w raporcie, który czyta i biuro, i kolektor. */
  r = await app.inject({ method: "GET", url: "/api/ean-conflicts", headers: biuro });
  const k = r.json().conflicts.find((x: { ean: string }) => x.ean === "5901234567890");
  assert.equal(k.rozstrzygniecie.rodzaj, "dopuszczone");
  assert.equal(k.rozstrzygniecie.przez, "Anna");
  assert.equal(k.trafienPoDecyzji, 0);
});

test("bez sesji nie da się rozstrzygnąć niczego", async () => {
  /* 401, nie 403: brak sesji to inna sprawa niż zła rola, a komunikat mówi,
     co zrobić. Trasa jest w LAN-ie firmy, więc `curl` z hali trafia wprost
     tutaj — reguły kolektora są uprzejmością, nie zabezpieczeniem. */
  const r = await app.inject({ method: "POST", url: URL, payload: { rodzaj: "poprawione" } });
  assert.equal(r.statusCode, 401, r.body);
});

test("rodzaj spoza listy odpada na trasie, nie w bazie", async () => {
  const biuro = login("biuro", "Anna");
  const r = await app.inject({ method: "POST", url: URL, headers: biuro,
    payload: { rodzaj: "naprawimy kiedyś" } });
  assert.equal(r.statusCode, 400, r.body);
  assert.match(r.json().error, /poprawione.*dopuszczone/);
});

test("kodu, którego nikt nie spotkał, nie ma po co rozstrzygać", async () => {
  /* Inaczej lista decyzji zapełniłaby się kodami, których hala nigdy nie
     widziała — a ta lista ma mówić, co ZATRZYMAŁO pracę w alejce. */
  const biuro = login("biuro", "Anna");
  const r = await app.inject({ method: "POST", headers: biuro,
    url: "/api/ean-conflicts/5900000000000/rozstrzygnij", payload: { rodzaj: "poprawione" } });
  assert.equal(r.statusCode, 400, r.body);
  assert.match(r.json().error, /nie zatrzymał/);
});
