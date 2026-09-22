import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Szablony odpowiedzi odeszły (22 września 2026) ──────────────────────────
   Decyzja właściciela. Szkic Copilota czeka przy każdej wiadomości klienta
   i niesie te same zdania razem z faktami, więc szablon był drugą drogą do
   tego samego pola edytora.

   TEN PLIK JEST STRAŻNIKIEM WSKRZESZENIA, tym samym wzorem co
   `kasata-spraw.test.ts`. Tabela dopisana z powrotem do `schema.sql`
   powstawałaby przy starcie i znikała sekundę później, po cichu.           */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

const istnieje = (d: DatabaseSync, tabela: string) =>
  Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela));

test("świeży schemat nie ma tabeli szablonów, a drugi start nie wywraca migracji", () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  assert.equal(istnieje(d, "szablon_odpowiedzi"), false);
  assert.doesNotThrow(() => migrate(d));
  d.close();
});

test("baza klienta z szablonami traci je przy aktualizacji", () => {
  /* Baza SPRZED zmiany: tabela stoi i ma wiersz. Bez tego kasata przechodziłaby
     na zielono na świeżym schemacie, nie dotykając prawdziwej instalacji. */
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec(`
    CREATE TABLE szablon_odpowiedzi (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nazwa TEXT NOT NULL UNIQUE,
      tresc TEXT NOT NULL, archiwalny INTEGER NOT NULL DEFAULT 0,
      utworzono TEXT NOT NULL DEFAULT '2026-09-01T00:00:00Z',
      utworzyl TEXT NOT NULL DEFAULT '', zmieniono TEXT, zmienil TEXT);
    INSERT INTO szablon_odpowiedzi(nazwa, tresc) VALUES ('Wymiana przez paczkomat', 'Dzień dobry');`);
  migrate(d);
  assert.equal(istnieje(d, "szablon_odpowiedzi"), false);
  d.close();
});
