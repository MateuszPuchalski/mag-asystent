import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Alarm o dyskusjach bez odpowiedzi w /api/health ─────────────────────────
   Z tej trasy panel rysuje pasek na każdym ekranie. Test pilnuje trzech
   rzeczy: alarm pojawia się po progu, odpowiedź nie niesie danych klienta
   (trasa jest publiczna), a zdanie wchodzi do `problemy`, nie przerywając
   odpowiedzi. */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-health-dysk-")), "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;

before(async () => {
  ({ db } = await import("../db/db.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  for (const t of ["reklamacja_wiadomosc", "reklamacja_klienta", "channel_account"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
  db().prepare(
    "INSERT INTO channel_account(id, channel, external_account_id, display_name) VALUES (1,'allegro','k','WERTIS')",
  ).run();
});

const godzinTemu = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function dyskusja(id: string, ostatniaPrzedGodz: number, login = "tajny_kupiec_77"): void {
  db().prepare(
    `INSERT INTO reklamacja_klienta
      (channel_account_id, external_id, typ, order_id, kupujacy_login, temat, status_allegro,
       czat_aktywny, wiadomosci_ile, ostatnia_wiadomosc_status, ostatnia_wiadomosc_at, otwarto_at, synced_at)
     VALUES (1,?,'DISPUTE','ZAM-TAJNE-5',?, 'Nie dostałem', 'DISPUTE_ONGOING', 1, 2,
             'BUYER_REPLIED', ?, ?, ?)`,
  ).run(id, login, godzinTemu(ostatniaPrzedGodz), godzinTemu(ostatniaPrzedGodz + 1), godzinTemu(0));
}

const health = async () => (await app.inject({ method: "GET", url: "/api/health" })).json();

test("bez dyskusji i przy świeżej dyskusji nie ma alarmu ani zdania w problemach", async () => {
  dyskusja("d-swieza", 2);
  const h = await health();
  assert.equal(h.dyskusje.czekaNaNas, 1);
  assert.equal(h.dyskusje.alarm, null);
  assert.ok(!(h.problemy ?? []).some((z: string) => /dyskusj/i.test(z)), "świeża dyskusja nie woła");
});

test("dyskusja po progu zapala alarm i dopisuje zdanie do problemów", async () => {
  dyskusja("d-stara", 50);
  const h = await health();
  assert.equal(h.dyskusje.alarm.ile, 1);
  assert.equal(h.dyskusje.alarm.najstarszaGodzin, 50);
  assert.equal(h.dyskusje.alarm.progGodzin, 24);
  const zdanie = (h.problemy as string[]).find((z) => /dyskusj/i.test(z));
  assert.ok(zdanie, `brak zdania w problemach: ${JSON.stringify(h.problemy)}`);
  assert.equal(h.ok, false);
});

test("publiczna odpowiedź nie niesie loginu ani numeru zamówienia", async () => {
  dyskusja("d-prywatna", 50);
  const surowa = (await app.inject({ method: "GET", url: "/api/health" })).body;
  assert.ok(!surowa.includes("tajny_kupiec_77"), "login kupującego wyciekł do publicznej trasy");
  assert.ok(!surowa.includes("ZAM-TAJNE-5"), "numer zamówienia wyciekł do publicznej trasy");
});
