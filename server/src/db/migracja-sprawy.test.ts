import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Sprawa przeżywa własną migrację (0.161.0) ───────────────────────────────
   Ta mina wybuchła podczas pisania tego wydania. Tabela nazwana wprost
   `sprawa` powstała ze `schema.sql` i ZNIKAŁA sekundę później: `migrate()`
   kasuje ją razem z resztą nakładek po starej implementacji, bo bazy klientów
   wciąż je mają. Bez błędu i bez wyjątku — jedynym objawem był test, który
   nagle nie widział własnej tabeli.

   Stąd `sprawa_klienta`, tym samym ruchem, którym zwroty wróciły w 0.150.0
   jako `zwrot_klienta`. Ten plik pilnuje obu połów umowy naraz.             */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function poMigracji() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  return d;
}

const istnieje = (d: DatabaseSync, tabela: string) =>
  Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela));

test("tabele sprawy przeżywają kasatę nakładek", () => {
  const d = poMigracji();
  for (const tabela of ["sprawa_klienta", "sprawa_klienta_rozmowa"]) {
    assert.equal(istnieje(d, tabela), true, `${tabela} musi przeżyć migrate()`);
  }
  d.close();
});

test("stare nazwy sprawy nadal znikają — lista kasowania jest nietknięta", () => {
  /* Druga połowa umowy: strażnik wyżej nie ma prawa kupić sobie zieleni przez
     wykreślenie nazwy z listy dropów. Baza klienta ma te tabele stracić. */
  const d = poMigracji();
  for (const tabela of ["sprawa", "sprawa_tag", "sprawa_zdarzenie", "sprawa_zrodlo"]) {
    assert.equal(istnieje(d, tabela), false, `${tabela} to nazwa spalona — ma nie istnieć`);
  }
  d.close();
});

test("sprawa nie ma statusu ani własnej osi — to klamra, nie byt z historią", () => {
  /* §7 nie zna statusów sprawy, a blizna 0.130.0 mówi, że zdarzenia wiszą
     przy ŹRÓDLE. Kolumna statusu albo tabela zdarzeń sprawy byłaby pierwszym
     krokiem z powrotem ku czterem tabelom nakładki. */
  const d = poMigracji();
  const kolumny = (d.prepare("PRAGMA table_info(sprawa_klienta)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  assert.deepEqual(kolumny, ["id", "tytul", "utworzyl", "created_at"]);
  d.close();
});

test("rozmowa nie da się wpisać do dwóch spraw naraz — pilnuje tego klucz", () => {
  /* Reguła stoi w KSZTAŁCIE tabeli, nie w dyscyplinie serwisu: `conversation_id`
     jest kluczem głównym, więc druga sprawa odbija się o SQL nawet wtedy, gdy
     ktoś ominie `dolaczRozmowe`. */
  const d = poMigracji();
  d.exec(`INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a');
    INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,'w-1');
    INSERT INTO sprawa_klienta(tytul) VALUES ('Szarpak');
    INSERT INTO sprawa_klienta(tytul) VALUES ('Filtr');
    INSERT INTO sprawa_klienta_rozmowa(conversation_id,sprawa_id) VALUES (1,1);`);
  assert.throws(() => d.exec(
    "INSERT INTO sprawa_klienta_rozmowa(conversation_id,sprawa_id) VALUES (1,2)"), /UNIQUE|PRIMARY/);
  d.close();
});
