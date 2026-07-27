import { test } from "node:test";
import assert from "node:assert/strict";
import { config, bledyKonfiguracji } from "./config.js";

/* Kody Subiekta jako test, nie jako komentarz.
   ─────────────────────────────────────────────────────────────────────────
   Te liczby były wcześniej zgadywane i jedna z nich była błędna: `DOK_TYP_PZ`
   wynosiło 5, czyli KFZ — korektę faktury zakupu. Na prawdziwej bazie aplikacja
   listowałaby korekty jako dostawy i nie zobaczyła ani jednego PZ, a objawiłoby
   się to dopiero na wdrożeniu, w postaci „pustej listy dostaw".

   Teraz pochodzą wprost z oficjalnego opisu struktury InsERT GT dla wersji bazy
   1.8731.31.6933 (docs/subiekt-gt-struktura.md):
     1-FZ  2-FS  3-RZ  4-RS  5-KFZ  6-KFS  9-MM  10-PZ  11-WZ  12-PW
     13-RW  14-ZW  15-ZD  16-ZK  21-PA  29-IW
   i `dok_Status`: {0-wycofany, 1-wykonany, 2-unieważniony, 3-odłożony, …}.

   Test pilnuje, żeby nikt ich po cichu nie „poprawił" z powrotem.            */

test("dok_Typ dostaw: FZ=1, PZ=10 (5 to KFZ, nie PZ)", () => {
  assert.equal(config.mssql.dokTypFZ, 1);
  assert.equal(config.mssql.dokTypPZ, 10);
  assert.notEqual(config.mssql.dokTypPZ, 5);
});

test("dok_Typ zwrotów: ZW=14", () => {
  assert.deepEqual(config.mssql.dokTypyZwroty, [14]);
});

test("bufor to dokument ODŁOŻONY (3), nie wycofany (0)", () => {
  assert.match(config.mssql.bufferExpr, /dok_Status\s*=\s*3/);
  assert.doesNotMatch(config.mssql.bufferExpr, /dok_Status\s*=\s*0/);
});

test("limit lokalizacji = realny rozmiar tw_Pole1..8 (varchar(50))", () => {
  assert.equal(config.locFieldLimit, 50);
});

test("flagi bez konfiguracji grupy/typu — brak domysłu, zadanie ma paść", () => {
  // Pary (grupa flag, typ obiektu) nie da się odczytać z dokumentacji struktury,
  // więc domyślnej NIE MA. Zero znaczy „nieskonfigurowane" i adapter odmawia
  // zapisu, zamiast wpisać flagę w losową grupę.
  assert.equal(config.mssql.flagGrupa, 0);
  assert.equal(config.mssql.flagTypObiektu, 0);
});

test("bez konfiguracji grupy flag nie ma dokąd wysyłać — flagi wyłączone", async () => {
  const { docFlagAvailable } = await import("./services/delivery-flag.js");
  // tryb seeded pisze do sgt_dokument adapterem dev i działa zawsze
  assert.equal(config.sferaMode, "dev");
  assert.equal(docFlagAvailable(), true);
  // w trybie sql bez MSSQL_FLAG_* zadanie skończyłoby się błędem po 3 próbach,
  // więc nie ma go po co tworzyć — patrz komentarz przy docFlagAvailable()
  assert.equal(config.mssql.flagGrupa && config.mssql.flagTypObiektu ? "on" : "off", "off");
});

test("magazyny rozstrzygają o trybie, więc muszą być różne", () => {
  const { MAG, MGP, ZWROTY } = config.magId;
  assert.equal(new Set([MAG, MGP, ZWROTY]).size, 3);
});

/* ── Walidacja konfiguracji wdrożenia ────────────────────────────────────────
   Te reguły istniały wcześniej wyłącznie w głowie autora dokumentacji albo jako
   test na wartościach domyślnych. Teraz pracują na produkcji, więc muszą mieć
   pokrycie na wartościach BŁĘDNYCH — bo to one są tym, przed czym bronią.     */

test("te same id magazynow to blad, nie ostrzezenie", () => {
  // magazyn skutku rozstrzyga, którym trybem idzie dokument; dwa te same id
  // znaczą, że dostawa i kontener trafiają do jednej zakładki — a wygląda to
  // jak „brakuje dostaw", nie jak literówka w wertis.env
  const zly = { ...config, magId: { MAG: 1, MGP: 1, ZWROTY: 3 } };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  assert.match(bledy[0], /muszą być różne/);
  assert.match(bledy[0], /sl_Magazyn/, "komunikat ma prowadzić do zapytania, nie tylko stwierdzać fakt");
});

test("SGT_MODE=mssql bez danych logowania nie przechodzi startu", () => {
  // wcześniej puste dane przechodziły, a awaria wychodziła przy pierwszym
  // zapytaniu — czyli PO tym, jak instalator uznał, że skończył
  const zly = {
    ...config,
    sgtMode: "mssql" as const,
    mssql: { ...config.mssql, database: "", user: "", password: "" },
  };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  for (const k of ["MSSQL_DATABASE", "MSSQL_USER", "MSSQL_PASSWORD"]) {
    assert.match(bledy[0], new RegExp(k), `${k} ma być wymienione z nazwy`);
  }
});

test("tryb seeded nie wymaga danych logowania", () => {
  // demo ma działać bez niczego — to jest cała jego wartość
  const demo = { ...config, sgtMode: "seeded" as const, mssql: { ...config.mssql, database: "", user: "", password: "" } };
  assert.deepEqual(bledyKonfiguracji(demo as typeof config), []);
});

test("zepsuty wzorzec lokalizacji wychodzi przy starcie, nie przy skanie", () => {
  const zly = { ...config, locPatterns: ["^[A-Z\\d{2}$"] };
  const bledy = bledyKonfiguracji(zly as typeof config);
  assert.equal(bledy.length, 1);
  assert.match(bledy[0], /wyrażeniem regularnym/);
});

test("wszystkie problemy naraz, nie po jednym na restart", () => {
  // naprawianie konfiguracji metodą „restart po każdym błędzie" to najgorszy
  // możliwy sposób spędzania czasu przy wdrożeniu
  const zly = {
    ...config,
    sgtMode: "mssql" as const,
    magId: { MAG: 2, MGP: 2, ZWROTY: 2 },
    mssql: { ...config.mssql, database: "", user: "", password: "" },
    locPatterns: ["("],
  };
  assert.equal(bledyKonfiguracji(zly as typeof config).length, 3);
});

test("domyslna konfiguracja jest poprawna", () => {
  assert.deepEqual(bledyKonfiguracji(), []);
});
