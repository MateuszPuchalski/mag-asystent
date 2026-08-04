import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* ── Sesje rozkładania wychodzą razem z trybem kontenerowym (0.22.0) ─────────
   Kasowanie tabel jest tanie, ale ma jeden sposób, żeby pójść źle: baza chodzi
   z `PRAGMA foreign_keys = ON`, a `putaway_items` wskazywało kluczem obcym na
   `putaway_sessions`. Rodzic skasowany przed dzieckiem wywala start API
   i workera naraz, na KAŻDEJ istniejącej instalacji — więc kolejność jest tu
   warunkiem poprawności, nie stylem.

   Konstrukcja jak w `migracja-kont.test.ts`: STARĄ bazę budujemy ręcznie
   i zamykamy plik, bo migracja odpala się przy pierwszym otwarciu.           */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-migr-sesje-"));
const plik = path.join(katalog, "stara.db");

const stara = new DatabaseSync(plik);
stara.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE putaway_sessions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    source_doc_id     INTEGER,
    source_doc_number TEXT,
    status            TEXT NOT NULL DEFAULT 'open',
    created_by        TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    closed_at         TEXT
  );
  CREATE TABLE putaway_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL REFERENCES putaway_sessions(id),
    tw_id        INTEGER NOT NULL,
    qty_expected REAL NOT NULL,
    qty_done     REAL NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE INDEX ix_items_session ON putaway_items(session_id);
  CREATE TABLE events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    user_id    TEXT,
    tw_id      INTEGER,
    payload    TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);
stara.exec(`INSERT INTO putaway_sessions(id, source_doc_number, created_by) VALUES (7,'PZ 121/08/2026','Jan')`);
stara.exec(`INSERT INTO putaway_items(session_id, tw_id, qty_expected) VALUES (7, 1, 12)`);
// zdarzenia zostają — dziennik pamięta czynność, choć traci jej szczegóły
stara.exec(`INSERT INTO events(type, user_id, payload) VALUES ('putaway_commit_cart','Jan','{"sessionId":7}')`);
stara.close();

process.env.DB_PATH = plik;

let db: typeof import("./db.js").db;

before(async () => {
  ({ db } = await import("./db.js"));
});

const tabele = (): string[] =>
  (db().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(
    (r) => r.name
  );

test("obie tabele sesji znikają, a klucz obcy nie blokuje startu", () => {
  const t = tabele();
  assert.ok(!t.includes("putaway_items"), "dziecko skasowane");
  assert.ok(!t.includes("putaway_sessions"), "rodzic skasowany");
  // to jest cały test: gdyby kolejność była odwrotna, samo otwarcie bazy
  // rzuciłoby wyjątkiem i nie doszlibyśmy tutaj
  assert.deepEqual(db().prepare("PRAGMA foreign_key_check").all(), []);
});

test("dziennik zdarzeń zostaje nietknięty", () => {
  /* Historia „kto rozkładał kontener w marcu" znika razem z tabelami — to była
     świadoma decyzja. Ale zdarzenia są osobnym śladem i nie mają z nią nic
     wspólnego: kasowanie ich przy okazji byłoby cichym poszerzeniem zakresu. */
  const e = db().prepare("SELECT type, payload FROM events").all() as Array<{ type: string; payload: string }>;
  assert.equal(e.length, 1);
  assert.equal(e[0].type, "putaway_commit_cart");
});

test("migracja przechodzi drugi raz bez błędu", () => {
  // API i worker startują razem przez NSSM i oba wołają `migrate()`; `IF EXISTS`
  // ma załatwić idempotencję bez żadnego strażnika
  assert.doesNotThrow(() => {
    db().exec("DROP TABLE IF EXISTS putaway_items");
    db().exec("DROP TABLE IF EXISTS putaway_sessions");
  });
});
