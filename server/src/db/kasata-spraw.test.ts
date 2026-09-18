import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Nakładka spraw odeszła (0.388.0) ────────────────────────────────────────
   Plik nazywał się `migracja-sprawy.test.ts` i pilnował rzeczy odwrotnej:
   żeby `sprawa_klienta` PRZEŻYŁA kasatę nakładek. Zostaje na tym samym
   miejscu z odwróconą treścią, bo pytanie jest to samo — co `migrate()` robi
   z tabelami sprawy — a odpowiedź zmieniła się na przeciwną.

   Sprawa była klamrą nad rozmowami: tytułem i listą wątków, bez statusu, bez
   osi, bez terminu. Od 0.387.0 na jej pytanie odpowiada DROGA ZAKUPU, po
   numerze zamówienia i przez cztery kolejki. Decyzja właściciela z 18 września
   2026: martwy kod, usunąć.

   TEN PLIK JEST STRAŻNIKIEM WSKRZESZENIA. Tabela dopisana z powrotem do
   `schema.sql` powstawałaby przy starcie i znikała sekundę później, po cichu
   i bez błędu — dokładnie ta mina, którą opisywał poprzednik tego pliku,
   tylko z drugiej strony.                                                   */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function poMigracji() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  return d;
}

const istnieje = (d: DatabaseSync, tabela: string) =>
  Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela));

test("po migracji nie ma ANI JEDNEJ tabeli sprawy — także starych nazw", () => {
  const d = poMigracji();
  for (const tabela of ["sprawa_klienta", "sprawa_klienta_rozmowa",
    "sprawa", "sprawa_tag", "sprawa_zdarzenie", "sprawa_zrodlo"]) {
    assert.equal(istnieje(d, tabela), false, `${tabela} to nazwa spalona — ma nie istnieć`);
  }
  d.close();
});

test("kasata przeżywa drugi start — `migrate()` chodzi przy każdym uruchomieniu", () => {
  /* `DROP TABLE IF EXISTS` na nieistniejącej tabeli ma być no-opem, a nie
     wyjątkiem wywracającym start serwera u klienta, który zaktualizował się
     wczoraj. */
  const d = poMigracji();
  assert.doesNotThrow(() => migrate(d));
  d.close();
});

test("baza klienta ze SPRAWAMI traci je przy aktualizacji, razem z wiązaniami", () => {
  /* Ten test odtwarza bazę SPRZED 0.388.0: tabele stoją i mają dane. Po
     `migrate()` obu nie ma. Bez tego kasata przechodziłaby na zielono na
     świeżym schemacie, nie dotykając ani jednej prawdziwej instalacji. */
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec(`
    CREATE TABLE sprawa_klienta (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tytul TEXT NOT NULL,
      utworzyl INTEGER, created_at TEXT NOT NULL DEFAULT '2026-09-01T00:00:00Z');
    CREATE TABLE sprawa_klienta_rozmowa (
      conversation_id INTEGER PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
      sprawa_id INTEGER NOT NULL REFERENCES sprawa_klienta(id) ON DELETE CASCADE,
      dolaczyl INTEGER, created_at TEXT NOT NULL DEFAULT '2026-09-01T00:00:00Z');
    INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a');
    INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,'w-1');
    INSERT INTO sprawa_klienta(tytul) VALUES ('Szarpak do NAC LS 46-450');
    INSERT INTO sprawa_klienta_rozmowa(conversation_id,sprawa_id) VALUES (1,1);`);

  migrate(d);

  assert.equal(istnieje(d, "sprawa_klienta"), false);
  assert.equal(istnieje(d, "sprawa_klienta_rozmowa"), false);
  /* Rozmowa ZOSTAJE. Kasujemy klamrę, nie to, co spinała — klucz obcy
     z `ON DELETE CASCADE` szedł w drugą stronę i nie ma prawa zabrać wątku. */
  assert.equal(
    Number(d.prepare("SELECT COUNT(*) AS n FROM conversation").get()!.n), 1);
  d.close();
});

test("ślad sklejania zostaje w dzienniku audytu, choć klamry już nie ma", () => {
  /* Zdarzenia wiszą przy ŹRÓDLE (blizna 0.130.0), a `conversation_event` nie
     ma retencji. „Kto i kiedy sklejał te rozmowy" ma zostać pytaniem, na które
     da się odpowiedzieć po latach — panel przestał je rysować, baza pamięta. */
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec(`
    INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a');
    INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,'w-1');
    INSERT INTO conversation_event(conversation_id,event_type,payload)
      VALUES (1,'sprawa_dolaczona','{"tytul":"Szarpak","autor":"A. Lewandowska"}');`);

  migrate(d);

  assert.equal(Number(d.prepare(
    "SELECT COUNT(*) AS n FROM conversation_event WHERE event_type='sprawa_dolaczona'")
    .get()!.n), 1);
  d.close();
});
