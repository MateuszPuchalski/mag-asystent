import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Znaczniki pomiaru w księdze Copilota: kolumny na istniejącej bazie ─────
   Księga stoi na produkcji od etapu F, więc znaczniki dochodzą migracją.
   Stary wiersz ma dostać NULL, czyli „nie wiemy”: zero w licznikach
   twierdzeń udawałoby, że model żadnego nie złożył. */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

const NOWE = [
  "kod_bledu", "wersja_instrukcji", "zrodlo", "rund", "narzedzi", "twierdzen",
  "twierdzen_obnizonych", "twierdzen_spoza_faktow", "kategoria",
];

test("stara księga dostaje znaczniki pomiaru, a stary wiersz zostaje z NULL", () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  /* Tabela w kształcie sprzed znaczników, z jednym wierszem. */
  d.exec("DROP TABLE copilot_wywolanie");
  d.exec(`CREATE TABLE copilot_wywolanie (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    zadanie         TEXT NOT NULL,
    conversation_id INTEGER REFERENCES conversation(id) ON DELETE SET NULL,
    model           TEXT NOT NULL,
    tokeny_wej      INTEGER NOT NULL DEFAULT 0,
    tokeny_wyj      INTEGER NOT NULL DEFAULT 0,
    tokeny_cache_zapis  INTEGER NOT NULL DEFAULT 0,
    tokeny_cache_odczyt INTEGER NOT NULL DEFAULT 0,
    ms              INTEGER,
    wynik           TEXT NOT NULL CHECK (wynik IN ('ok','blad')),
    blad            TEXT,
    przez_user_id   INTEGER REFERENCES app_user(user_id),
    at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  d.prepare("INSERT INTO copilot_wywolanie(zadanie,model,wynik) VALUES ('szkic','m','ok')").run();

  migrate(d);
  migrate(d);

  const kolumny = (d.prepare("PRAGMA table_info(copilot_wywolanie)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  for (const k of NOWE) assert.ok(kolumny.includes(k), `brak ${k}`);
  const w = d.prepare(`SELECT ${NOWE.join(",")} FROM copilot_wywolanie`).get() as Record<string, unknown>;
  assert.deepEqual({ ...w }, Object.fromEntries(NOWE.map((k) => [k, null])));
  d.close();
});

test("świeża baza ze schematu ma znaczniki, a migracja niczego do niej nie dokłada", () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  const przed = (d.prepare("PRAGMA table_info(copilot_wywolanie)").all() as Array<{ name: string }>).map((c) => c.name);
  for (const k of NOWE) assert.ok(przed.includes(k), `schema.sql nie ma ${k}`);
  migrate(d);
  const po = (d.prepare("PRAGMA table_info(copilot_wywolanie)").all() as Array<{ name: string }>).map((c) => c.name);
  assert.deepEqual(po, przed);
  d.close();
});
