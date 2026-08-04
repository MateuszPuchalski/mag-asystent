import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { symbolTypu, etykietyDostaw, nienazwaneTypyDostaw } from "./typy-dokumentow.js";

/* ── Kody typów dokumentów a ich symbole ─────────────────────────────────────
   Ten plik pilnuje jednej rzeczy: żeby dokument nigdy nie pokazał się pod
   CUDZĄ nazwą. Do 0.22.1 importer miał gałąź `else` („co nie FZ, to PZ"),
   a odczyt filtr („co nie FZ ani PZ, tego nie ma") — dwa różne błędy na tym
   samym tłumaczeniu, więc dopisanie typu do konfiguracji dawało dokumenty
   z fałszywym symbolem.                                                      */

const zTypami = <T>(kody: number[], f: () => T): T => {
  const orig = config.mssql.dokTypyDostaw;
  config.mssql.dokTypyDostaw = kody;
  try {
    return f();
  } finally {
    config.mssql.dokTypyDostaw = orig;
  }
};

test("kody z konfiguracji dostają swoje symbole", () => {
  assert.equal(symbolTypu(config.mssql.dokTypFZ), "FZ");
  assert.equal(symbolTypu(config.mssql.dokTypPZ), "PZ");
  assert.equal(symbolTypu(config.mssql.dokTypZD), "ZD");
});

test("kod bez nazwy nie udaje sąsiada", () => {
  // najważniejsza asercja w tym pliku: NIE "PZ"
  assert.equal(symbolTypu(77), "TYP-77");
});

test("lista etykiet jest lustrem ustawienia, nie jego poprawioną wersją", () => {
  /* Kod nienazwany ZOSTAJE na liście. Wypadał do 0.22.1 i to był gorszy błąd
     niż brzydka nazwa: lista dostaw pustoszała bez powodu widocznego dla
     kogokolwiek. */
  assert.deepEqual(zTypami([config.mssql.dokTypFZ, 77], etykietyDostaw), ["FZ", "TYP-77"]);
});

test("nienazwany kod dostawy wypływa w /api/health", () => {
  assert.equal(zTypami([config.mssql.dokTypFZ], nienazwaneTypyDostaw), null);
  const uwaga = zTypami([config.mssql.dokTypFZ, 77], nienazwaneTypyDostaw);
  assert.match(uwaga ?? "", /77/);
  assert.match(uwaga ?? "", /TYP-77/, "powie też, jak dokument wygląda na ekranie");
});

test("zamówienie do dostawcy wpisane jako dostawa to osobna uwaga", () => {
  /* Kod ZD nazwać umiemy, więc gałąź „bez nazwy" go nie złapie — a to
     pomyłka co do znaczenia, nie co do nazwy: zamówienia nie ma czego
     rozkładać, bo towar jeszcze nie przyjechał. */
  const uwaga = zTypami([config.mssql.dokTypFZ, config.mssql.dokTypZD], nienazwaneTypyDostaw);
  assert.match(uwaga ?? "", /zamówienia do dostawcy/);
});
