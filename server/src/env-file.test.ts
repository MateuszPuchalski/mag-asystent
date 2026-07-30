import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvFile, problemPrzykrytejKonfiguracji } from "./env-file.js";

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

/* ── Przykryta konfiguracja ─────────────────────────────────────────────────
   POWSTAŁO PO WDROŻENIU, KTÓRE PRZESZŁO CAŁY KREATOR I WYLĄDOWAŁO NA DEMÓWCE.
   Instalator zapisał SGT_MODE=mssql, plik został wczytany, a proces pracował
   w trybie seeded — bo starsza instalacja zostawiła SGT_MODE w AppEnvironment
   usługi, a środowisko ma nad plikiem pierwszeństwo.

   Nic tego nie zgłaszało: `/api/health` mówił „seeded" jak o wyborze, a nie
   jak o sprzeczności. Lista przykrytych kluczy istniała i szła do kosza.

   Testy niżej pilnują OBU stron: że sprzeczność krzyczy i że cisza zostaje
   ciszą tam, gdzie nadpisywanie jest normalną drogą (dev, testy).            */

const plik = (over: string[], wart: Record<string, string> = {}) => ({
  path: "C:\\wertis\\wertis.env",
  applied: [],
  overridden: over,
  overriddenValues: wart,
});

test("SGT_MODE przykryty przez środowisko JEST problemem", () => {
  const p = problemPrzykrytejKonfiguracji(plik(["SGT_MODE"], { SGT_MODE: "mssql" }), "seeded");
  assert.ok(p, "przykryty tryb pracy musi trafić do problemów");
  assert.match(p, /SGT_MODE/);
  assert.match(p, /wertis\.env/, "zdanie ma nazwać plik, który przegrał");
  assert.match(p, /seeded/, "i tryb, w którym proces NAPRAWDĘ pracuje");
  assert.match(p, /AppEnvironment/, "oraz podać, czym to wyczyścić");
});

test("BEZ PLIKU nie ma o czym mówić — tak wygląda dev i każdy test", () => {
  // Alarm w tym miejscu uczyłby ignorować `problemy`, a wtedy bramka jest
  // gorsza niż jej brak.
  const p = problemPrzykrytejKonfiguracji(
    { path: null, applied: [], overridden: ["SGT_MODE"], overriddenValues: {} },
    "seeded"
  );
  assert.equal(p, null);
});

test("przykrycie klucza NIEKRYTYCZNEGO nie podnosi alarmu", () => {
  // LOG_LEVEL czy PORT z powłoki nikogo nie zaskoczą i nie zmieniają tego,
  // DOKĄD idą zapisy.
  assert.equal(problemPrzykrytejKonfiguracji(plik(["LOG_LEVEL", "PORT"]), "mssql"), null);
});

test("zdrowa instalacja — pusta lista, zero problemów", () => {
  assert.equal(problemPrzykrytejKonfiguracji(plik([]), "mssql"), null);
});

test("zgodny tryb nadal jest problemem, ale bez zdania o rozjeździe", () => {
  /* Przykryty MSSQL_DATABASE przy zgodnym SGT_MODE: aplikacja czyta INNĄ BAZĘ,
     niż mówi plik. Objawu nie ma żadnego — stany po prostu się nie zgadzają. */
  const p = problemPrzykrytejKonfiguracji(
    plik(["SGT_MODE", "MSSQL_DATABASE"], { SGT_MODE: "mssql" }),
    "mssql"
  );
  assert.ok(p);
  assert.match(p, /MSSQL_DATABASE/);
  assert.doesNotMatch(p, /NIE trafiają/, "tryby się zgadzają, więc nie ma rozjazdu do opisania");
});

test("HASŁO NIE WYCIEKA DO KOMUNIKATU", () => {
  /* Odpowiedź /api/health nie jest miejscem na hasło do bazy. Nazwa klucza
     owszem — jego wartość nigdy. */
  /* Wartości celowo NIEPODOBNE do ścieżki pliku: login „wertis" byłby
     nieodróżnialny od `wertis.env` w komunikacie i test przechodziłby
     przypadkiem. */
  const p = problemPrzykrytejKonfiguracji(
    plik(["MSSQL_PASSWORD", "MSSQL_USER", "MSSQL_DATABASE"], {
      MSSQL_PASSWORD: "Tajne-Haslo-123",
      MSSQL_USER: "konto-aplikacji",
      MSSQL_DATABASE: "PODMIOT_PRODUKCJA",
    }),
    "mssql"
  );
  assert.ok(p);
  assert.match(p, /MSSQL_PASSWORD/, "nazwa klucza ma być widoczna");
  assert.doesNotMatch(p, /Tajne-Haslo-123/, "wartość hasła NIE MOŻE trafić do komunikatu");
  assert.doesNotMatch(p, /konto-aplikacji/, "ani login");
  assert.doesNotMatch(p, /PODMIOT_PRODUKCJA/, "ani nazwa bazy");
});
