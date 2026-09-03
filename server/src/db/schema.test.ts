import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/* Strażnik podwójnej definicji tabeli.
 *
 * Przy `CREATE TABLE IF NOT EXISTS` druga definicja tej samej tabeli NIE jest
 * błędem składni — jest cichą podmianą schematu. Wygrywa ta wcześniejsza
 * w pliku, późniejsza zostaje pominięta bez słowa.
 *
 * To nie jest hipoteza. W 0.142.0 gałąź odbita od starego `main` dopisała
 * własną `zadanie_terenowe` z kolumnami `opis` i `completed_at`, a git scalił
 * to BEZ JEDNEGO ZNACZNIKA KONFLIKTU — obie definicje wylądowały w pliku,
 * atrapa wcześniej. Na świeżej bazie powstałaby tabela bez `rodzaj`, `tytul`
 * i `instrukcja`, więc trasy zadań i ekran kolektora przestałyby działać.
 * Zielone CI tego nie widziało, bo żaden test nie czytał samego schematu.
 *
 * Ten strażnik czyta plik i nie dotyka bazy — kosztuje milisekundy, a pilnuje
 * klasy błędu, którą automatyczne scalanie wpuściłoby wprost na produkcję.
 */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

test("żadna tabela nie jest zdefiniowana dwa razy", () => {
  const nazwy = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)]
    .map((m) => m[1].toLowerCase());
  const widziane = new Set<string>();
  const duplikaty = nazwy.filter((n) => (widziane.has(n) ? true : (widziane.add(n), false)));
  assert.deepEqual(
    [...new Set(duplikaty)], [],
    "Tabela zdefiniowana dwa razy: przy IF NOT EXISTS wygrywa definicja wcześniejsza, "
      + "a późniejsza znika bez błędu. Zostaw jedną i przenieś do niej brakujące kolumny.",
  );
  assert.ok(nazwy.length > 30, "schema.sql wygląda na obcięty — strażnik nie miałby czego pilnować");
});

/* Ta sama pułapka dotyczy indeksów: drugi `CREATE INDEX IF NOT EXISTS` o tej
   samej nazwie jest pomijany, więc indeks opisany w kodzie może nie istnieć. */
test("żaden indeks nie jest zdefiniowany dwa razy", () => {
  const nazwy = [...schema.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+(\w+)/gi)]
    .map((m) => m[1].toLowerCase());
  const widziane = new Set<string>();
  const duplikaty = nazwy.filter((n) => (widziane.has(n) ? true : (widziane.add(n), false)));
  assert.deepEqual([...new Set(duplikaty)], [], "Indeks o tej nazwie stoi w schemacie dwa razy");
});
