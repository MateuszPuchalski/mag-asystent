import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Wejście Copilota: tabela na istniejącej bazie ──────────────────────────
   Instalacje sprzed zapisu wejścia dostają `copilot_wejscie` migracją.
   Stare wywołania zostają bez wierszy, bo nikt wtedy wejścia nie zapisywał.
   Wejście znika razem z rozmową, a skasowana księga zostawia je bez
   wskazania, bo retencję wejścia liczy jego własny czas. */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const kolumny = (d: DatabaseSync) =>
  (d.prepare("PRAGMA table_info(copilot_wejscie)").all() as Array<{ name: string; type: string; notnull: number }>)
    .map((c) => `${c.name} ${c.type}${c.notnull ? " NOT NULL" : ""}`);
const indeksy = (d: DatabaseSync) =>
  (d.prepare("PRAGMA index_list(copilot_wejscie)").all() as Array<{ name: string }>).map((i) => i.name).sort();
const klucze = (d: DatabaseSync) =>
  (d.prepare("PRAGMA foreign_key_list(copilot_wejscie)").all() as Array<Record<string, string>>)
    .map((k) => `${k.from} -> ${k.table}.${k.to} ON DELETE ${k.on_delete}`).sort();

const KOLUMNY = [
  "id INTEGER", "wywolanie_id INTEGER", "conversation_id INTEGER", "message_id INTEGER",
  "zadanie TEXT NOT NULL", "zrodlo TEXT", "wersja_instrukcji TEXT", "model TEXT", "at TEXT NOT NULL",
  "watek TEXT NOT NULL", "fakty TEXT NOT NULL", "zdjecia TEXT NOT NULL", "wyniki_narzedzi TEXT NOT NULL",
  "pytanie TEXT", "szkic_wejscie TEXT", "historia TEXT", "wyjscie TEXT", "wynik_sit TEXT",
];
/* Kaskada po rozmowie kasuje wejście razem z nią. SET NULL po księdze, bo
   retencję wejścia liczy jego własny czas, nie los wiersza księgi. */
const KLUCZE = [
  "conversation_id -> conversation.id ON DELETE CASCADE",
  "wywolanie_id -> copilot_wywolanie.id ON DELETE SET NULL",
];
const INDEKSY = ["ix_copilot_wejscie_at", "ix_copilot_wejscie_rozmowa"];

test("stara baza bez tabeli dostaje ją migracją, z indeksem po czasie i kaskadą po rozmowie", () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec("DROP TABLE copilot_wejscie");
  const konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  const rozmowa = Number(d.prepare("INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (?,'w')")
    .run(konto).lastInsertRowid);

  migrate(d);
  migrate(d);

  assert.deepEqual(kolumny(d), KOLUMNY);
  assert.deepEqual(klucze(d), KLUCZE);
  assert.ok(indeksy(d).includes("ix_copilot_wejscie_at"), "retencja kasuje po indeksie");

  d.exec("PRAGMA foreign_keys = ON");
  const ksiega = Number(d.prepare("INSERT INTO copilot_wywolanie(zadanie,model,wynik) VALUES ('szkic','m','ok')")
    .run().lastInsertRowid);
  d.prepare(`INSERT INTO copilot_wejscie(wywolanie_id,conversation_id,zadanie,at,watek,fakty)
    VALUES (?,?,'szkic','2026-10-21T10:00:00.000Z','KLIENT: x','F1: y')`).run(ksiega, rozmowa);
  assert.throws(() => d.prepare(`INSERT INTO copilot_wejscie(wywolanie_id,zadanie,at,watek,fakty)
    VALUES (?,'szkic','2026-10-21T10:00:00.000Z','a','b')`).run(ksiega), /UNIQUE/, "jedno wejście na wywołanie");

  d.prepare("DELETE FROM copilot_wywolanie WHERE id=?").run(ksiega);
  assert.equal((d.prepare("SELECT wywolanie_id FROM copilot_wejscie").get() as { wywolanie_id: unknown }).wywolanie_id,
    null);
  d.prepare("DELETE FROM conversation WHERE id=?").run(rozmowa);
  assert.equal((d.prepare("SELECT count(*) n FROM copilot_wejscie").get() as { n: number }).n, 0,
    "wejście znika razem z rozmową");
});

test("świeża baza ze schematu i baza po migracji mają te same kolumny, klucze i indeksy", () => {
  /* Obie drogi porównane z JEDNĄ listą. Porównanie bazy z sobą samą
     przechodziłoby także wtedy, gdy schema.sql i migracja się rozjechały. */
  const swieza = new DatabaseSync(":memory:");
  swieza.exec(schema);
  const migrowana = new DatabaseSync(":memory:");
  migrowana.exec(schema);
  migrowana.exec("DROP TABLE copilot_wejscie");
  migrate(migrowana);
  for (const [nazwa, d] of [["schema.sql", swieza], ["migracja", migrowana]] as const) {
    assert.deepEqual(kolumny(d), KOLUMNY, `kolumny: ${nazwa}`);
    assert.deepEqual(klucze(d), KLUCZE, `klucze obce: ${nazwa}`);
    assert.deepEqual(indeksy(d).filter((i) => i.startsWith("ix_")), INDEKSY, `indeksy: ${nazwa}`);
  }
});
