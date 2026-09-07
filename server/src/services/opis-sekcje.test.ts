import { test } from "node:test";
import assert from "node:assert/strict";
import { KONIEC_SEKCJI, sekcjeZestawu, segmentyPoEtykiecie } from "./opis-sekcje.js";
import { modeleZOpisu } from "./identyfikatory.js";

/* ── Granica sekcji i zawartość zestawu ──────────────────────────────────────
   „W zestawie" bez dwukropka to JEDYNA etykieta bez dwukropka w parserze
   i te testy pilnują, żeby (1) cięła sekcję przed sobą, (2) nie rozluźniała
   reguły ogólnej na inne słowa, (3) `sekcjeZestawu` oddawała surowy tekst
   bez zgadywania kierunku ani roli.                                          */

const ZAM = /\bzamienni[a-ząćęłńóśźż]*\s*:?\s*/gi;

test("„W zestawie” bez dwukropka kończy sekcję stojącą przed nim", () => {
  assert.deepEqual(
    segmentyPoEtykiecie("Zamiennik: W09-0503 // 520070/1 W zestawie uszczelka - W53-0501", ZAM),
    ["W09-0503 // 520070/1 "]);
  assert.deepEqual(segmentyPoEtykiecie("Zamiennie: 95-001 Zawiera: 97-001", ZAM), ["95-001 "]);
  /* Symbole z cyframi, nie „A”/„B”: samotna litera przed „Zawartość:” wygląda
     dla `KONIEC_SEKCJI` jak pierwsze słowo dwuwyrazowej etykiety. */
  assert.deepEqual(segmentyPoEtykiecie("Zamiennie: 95-001 // 97-002 Zawartość: kolektor - 97-005", ZAM), ["95-001 // 97-002 "]);
});

test("reguła ogólna zostaje ścisła — zwykłe słowo bez dwukropka NIE jest granicą", () => {
  assert.deepEqual(segmentyPoEtykiecie("Zamiennik: 76-064 Pilarki marketowe", ZAM), ["76-064 Pilarki marketowe"]);
  assert.equal(KONIEC_SEKCJI.test(" Pilarki marketowe"), false);
});

test("sekcjeZestawu oddaje surowy tekst dla każdego kształtu etykiety", () => {
  assert.deepEqual(sekcjeZestawu("Zamiennik: X W zestawie uszczelka - W53-0501"), ["uszczelka - W53-0501"]);
  assert.deepEqual(sekcjeZestawu("W zestawie: 50-064 + 50-179"), ["50-064 + 50-179"]);
  assert.deepEqual(sekcjeZestawu("Zamiennie: 168F-M79851 // 06-02003 Do / W zestawie z: 10-02001 06111-ZH8-405"), ["10-02001 06111-ZH8-405"]);
  assert.deepEqual(sekcjeZestawu("uszczelka gaźnika Zawiera: 97-001"), ["97-001"]);
  assert.deepEqual(sekcjeZestawu("Zawartość: kolektor - 97-005 / uszczelki"), ["kolektor - 97-005 / uszczelki"]);
  assert.deepEqual(sekcjeZestawu("OEM: 123 Zamiennik: 456"), []);
});

test("zestaw kończy się na następnej etykiecie, a literówka „zestawiie:” to granica ogólna", () => {
  assert.deepEqual(sekcjeZestawu("W zestawie Uszczelka  Zamiennie: M831402 // 520003"), ["Uszczelka"]);
  assert.deepEqual(sekcjeZestawu("Stare SKU: FTC272 W zestawiie: 3 szt"), []);
  /* Sekcja „Modele:" też kończy się na zestawie — inaczej „uszczelka" byłaby modelem. */
  assert.deepEqual(modeleZOpisu("Modele: FS200 W zestawie uszczelka"), ["FS200"]);
});
