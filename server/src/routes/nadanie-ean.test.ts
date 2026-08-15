import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── POST /api/products/:twId/ean ────────────────────────────────────────────
   Trasa istniała od 0.37.0 bez własnego testu; ten plik powstał przy zdjęciu
   wymogu potwierdzenia podmiany (0.49.0), bo zmiana zachowania bez testu
   byłaby niewidzialna dla CI w obie strony.

   Sedno: podmiana przechodzi JEDNYM żądaniem, a jedyną twardą odmową zostaje
   kod należący do innej kartoteki.                                           */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-ean-")), "t.db");
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
  const d = db();
  for (const t of ["events", "sfera_queue", "ean_alias", "ean_conflict", "device_session", "app_user", "sgt_towar"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    "INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1,'W32-0203','Kosa','5901234123457',''),(2,'50-111','Wal','','')"
  ).run();
});

function token(): string {
  const u = createUser("Jan Testowy", "magazynier", `jan${Math.random().toString(16).slice(2, 8)}`, "tajnehaslo");
  const t = `tok-${u.userId}`;
  const teraz = new Date().toISOString();
  db()
    .prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(t, u.userId, "dev", teraz, teraz);
  return t;
}

const nadaj = (twId: number, body: unknown, tok: string) =>
  app.inject({
    method: "POST",
    url: `/api/products/${twId}/ean`,
    headers: { "x-session": tok, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });

test("nadanie kodu kartotece bez kodu kolejkuje zapis", async () => {
  const r = await nadaj(2, { ean: "5900000000013" }, token());
  assert.equal(r.statusCode, 200);
  assert.ok(r.json().queueId > 0);
  const zadanie = db().prepare("SELECT type FROM sfera_queue").get() as { type: string };
  assert.equal(zadanie.type, "set_ean");
});

test("podmiana istniejącego kodu przechodzi BEZ potwierdzenia", async () => {
  /* Do 0.48.x ta próba kończyła się 409 „Podmiana wymaga potwierdzenia".
     Wymóg zdjęty na polecenie właściciela — to jest test na jego brak. */
  const r = await nadaj(1, { ean: "5900000000013" }, token());
  assert.equal(r.statusCode, 200);
  assert.ok(r.json().queueId > 0);
});

test("stary kod jedzie do audytu — podmiana bez potwierdzenia nie jest bez śladu", async () => {
  await nadaj(1, { ean: "5900000000013" }, token());
  const wpis = db()
    .prepare("SELECT payload FROM events WHERE type = 'ean_set'")
    .get() as { payload: string };
  assert.equal(JSON.parse(wpis.payload).eanPrzed, "5901234123457");
});

test("flaga potwierdzone ze starszego APK jest przyjmowana i ignorowana", async () => {
  const r = await nadaj(1, { ean: "5900000000013", potwierdzone: true }, token());
  assert.equal(r.statusCode, 200);
});

test("kod zajęty przez inną kartotekę to nadal twarda odmowa", async () => {
  // jedyna bramka, która została — i ma zostać: dwa towary z jednym kodem
  // zatrzymują pracę w alejce
  const r = await nadaj(2, { ean: "5901234123457" }, token());
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().powod, "zajety");
  const kolizja = db().prepare("SELECT COUNT(*) AS n FROM ean_conflict").get() as { n: number };
  assert.equal(kolizja.n, 1, "próba nadania zajętego kodu zapisuje się do rejestru kolizji");
});

test("kod o złym kształcie jest odrzucany przed kolejką", async () => {
  const r = await nadaj(2, { ean: "ABC-123" }, token());
  assert.equal(r.statusCode, 400);
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue").get() as { n: number }).n,
    0
  );
});

test("ten sam kod na tej samej kartotece to brak zmiany, nie zadanie", async () => {
  const r = await nadaj(1, { ean: "5901234123457" }, token());
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().bezZmian, true);
  assert.equal(
    (db().prepare("SELECT COUNT(*) AS n FROM sfera_queue").get() as { n: number }).n,
    0
  );
});
