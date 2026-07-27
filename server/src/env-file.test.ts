import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvFile } from "./env-file.js";

/* Plik `wertis.env` jest wczytywany DWIEMA drogami: `source` w bashu (tak stoi
   w dokumentacji) i tym parserem. Rozjazd między nimi dałby aplikacji inne
   hasło niż to, które widzi człowiek w konsoli — i nikt by nie zgadł dlaczego.
   Te testy pilnują, żeby obie drogi dawały to samo.                           */

test("czyta składnię, którą ma dziś wertis.env.example", () => {
  const v = parseEnvFile(`
# komentarz
export SGT_MODE=mssql
export MSSQL_SERVER=localhost
MSSQL_USER=wertis
`);
  assert.equal(v.SGT_MODE, "mssql");
  assert.equal(v.MSSQL_SERVER, "localhost");
  assert.equal(v.MSSQL_USER, "wertis", "postać bez `export` też musi działać");
});

test("ucina komentarz doklejony na końcu linii", () => {
  // realna linia z wertis.env.example
  const v = parseEnvFile("export MSSQL_INSTANCE=INSERTGT      # albo MSSQL_PORT=1433");
  assert.equal(v.MSSQL_INSTANCE, "INSERTGT");
});

test("HASŁO Z KRZYŻYKIEM NIE JEST OBCINANE", () => {
  /* Sedno tego pliku. Bash ucina komentarz dopiero po BIAŁYM ZNAKU, więc
     `haslo#7` to całe hasło. Gdyby parser ucinał na każdym `#`, aplikacja
     logowałaby się hasłem „haslo" i dostawała odmowę z MSSQL — przy
     jednoczesnym `source wertis.env` działającym poprawnie w konsoli. */
  assert.equal(parseEnvFile("export MSSQL_PASSWORD=haslo#7").MSSQL_PASSWORD, "haslo#7");
  assert.equal(parseEnvFile('export MSSQL_PASSWORD="haslo # z krzyzykiem"').MSSQL_PASSWORD, "haslo # z krzyzykiem");
});

test("zdejmuje cudzysłowy, zachowuje spacje w środku", () => {
  assert.equal(parseEnvFile('A="ze spacja"').A, "ze spacja");
  assert.equal(parseEnvFile("A='ze spacja'").A, "ze spacja");
  // spacja w haśle rozbijała komendę NSSM — tu ma przejść bez szwanku
  assert.equal(parseEnvFile('export MSSQL_PASSWORD="a b c"').MSSQL_PASSWORD, "a b c");
});

test("wartość może zawierać znak równości", () => {
  // MSSQL_BUFFER_EXPR to surowy SQL: CASE WHEN d.dok_Status = 3 THEN 1 ELSE 0 END
  const v = parseEnvFile('export MSSQL_BUFFER_EXPR="CASE WHEN d.dok_Status = 3 THEN 1 ELSE 0 END"');
  assert.equal(v.MSSQL_BUFFER_EXPR, "CASE WHEN d.dok_Status = 3 THEN 1 ELSE 0 END");
});

test("pomija puste linie, komentarze i śmieci", () => {
  const v = parseEnvFile("\n\n# tylko komentarz\n   \nto nie jest przypisanie\nA=1\n");
  assert.deepEqual(v, { A: "1" });
});

test("pusta wartość jest wartością, nie brakiem klucza", () => {
  // `MSSQL_PASSWORD=` ma znaczyć „puste hasło", a nie „nie ustawiono"
  assert.deepEqual(parseEnvFile("MSSQL_PASSWORD="), { MSSQL_PASSWORD: "" });
});
