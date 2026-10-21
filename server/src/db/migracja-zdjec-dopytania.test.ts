import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Zdjęcia agenta przy dopytaniu: tabela na istniejącej bazie ─────────────
   Instalacje sprzed tej funkcji dostają `copilot_pytanie_zdjecie` migracją.
   Stare wymiany zostają bez wierszy, bo agent nie mógł wtedy dołączyć zdjęcia.
   Ślad zdjęcia znika razem z wymianą, inaczej miniatura wisiałaby bez
   pytania, którego dotyczyła. */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const kolumny = (d: DatabaseSync) =>
  (d.prepare("PRAGMA table_info(copilot_pytanie_zdjecie)").all() as Array<{ name: string; type: string }>)
    .map((c) => `${c.name} ${c.type}`);

test("stara baza bez tabeli dostaje ją migracją, a stara wymiana zostaje bez zdjęć", () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec("DROP TABLE copilot_pytanie_zdjecie");
  const konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  const rozmowa = Number(d.prepare("INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (?,'w')")
    .run(konto).lastInsertRowid);
  const pytanie = Number(d.prepare("INSERT INTO copilot_pytanie(conversation_id,pytanie,odpowiedz,model,przez) VALUES (?,?,?,?,?)")
    .run(rozmowa, "Pasuje?", "Fakty tego nie rozstrzygają.", "m", "Ala").lastInsertRowid);

  migrate(d);
  migrate(d);

  assert.deepEqual(kolumny(d), ["id INTEGER", "pytanie_id INTEGER", "numer TEXT", "nazwa TEXT",
    "typ TEXT", "bajtow INTEGER", "miniatura BLOB"]);
  assert.equal((d.prepare("SELECT count(*) n FROM copilot_pytanie_zdjecie").get() as { n: number }).n, 0);

  d.exec("PRAGMA foreign_keys = ON");
  d.prepare("INSERT INTO copilot_pytanie_zdjecie(pytanie_id,numer,nazwa,typ,bajtow,miniatura) VALUES (?,?,?,?,?,?)")
    .run(pytanie, "Z1", "kartka.jpg", "image/jpeg", 100, Buffer.from([0xff, 0xd8, 0xff]));
  d.prepare("DELETE FROM copilot_pytanie WHERE id=?").run(pytanie);
  assert.equal((d.prepare("SELECT count(*) n FROM copilot_pytanie_zdjecie").get() as { n: number }).n, 0,
    "zdjęcie znika razem z wymianą");
});

test("świeża baza ze schematu ma tę samą tabelę, co migrowana", () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  const przed = kolumny(d);
  assert.ok(przed.length > 0, "schema.sql nie ma tabeli zdjęć dopytania");
  migrate(d);
  assert.deepEqual(kolumny(d), przed, "migracja nie zmienia świeżej bazy");
});
