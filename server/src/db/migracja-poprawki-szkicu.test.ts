import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Poprawka szkicu z dopytania: kolumny na istniejącej bazie ──────────────
   Wersja szkicu mieszka w kolumnach wymiany `copilot_pytanie`. Instalacje
   z tą tabelą dostają je migracją, a stare wymiany mają zostać czytelne:
   NULL zamiast wersji i puste listy, bo model wtedy szkicu nie poprawiał. */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

const NOWE = ["szkic_przed", "szkic_po", "szkic_odrzucony", "szkic_twierdzenia", "szkic_zastrzezenia"];

test("stara tabela dopytania dostaje pięć kolumn poprawki, a stara wymiana zostaje bez wersji", () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  /* Tabela w kształcie sprzed poprawki szkicu, z jedną wymianą. */
  d.exec("DROP TABLE copilot_pytanie");
  d.exec(`CREATE TABLE copilot_pytanie (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    pytanie         TEXT NOT NULL,
    odpowiedz       TEXT NOT NULL,
    twierdzenia     TEXT NOT NULL DEFAULT '[]',
    model           TEXT NOT NULL,
    at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    przez           TEXT NOT NULL,
    przez_user_id   INTEGER REFERENCES app_user(user_id),
    narzedzia       TEXT NOT NULL DEFAULT '[]')`);
  const konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  const rozmowa = Number(d.prepare("INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (?,'w')")
    .run(konto).lastInsertRowid);
  d.prepare("INSERT INTO copilot_pytanie(conversation_id,pytanie,odpowiedz,model,przez) VALUES (?,?,?,?,?)")
    .run(rozmowa, "Pasuje?", "Fakty tego nie rozstrzygają.", "m", "Ala");

  migrate(d);
  migrate(d);

  const kolumny = (d.prepare("PRAGMA table_info(copilot_pytanie)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  for (const k of NOWE) assert.ok(kolumny.includes(k), `brak ${k}`);
  const w = d.prepare(`SELECT ${NOWE.join(",")} FROM copilot_pytanie`).get() as Record<string, unknown>;
  assert.deepEqual({ ...w }, {
    szkic_przed: null, szkic_po: null, szkic_odrzucony: null,
    szkic_twierdzenia: "[]", szkic_zastrzezenia: "[]",
  });
});

test("świeża baza ze schematu ma te same kolumny, co migrowana", () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  const przed = (d.prepare("PRAGMA table_info(copilot_pytanie)").all() as Array<{ name: string }>).map((c) => c.name);
  for (const k of NOWE) assert.ok(przed.includes(k), `schema.sql nie ma ${k}`);
  migrate(d);
  const po = (d.prepare("PRAGMA table_info(copilot_pytanie)").all() as Array<{ name: string }>).map((c) => c.name);
  assert.deepEqual(po, przed, "migracja nie dokłada niczego do świeżej bazy");
});
