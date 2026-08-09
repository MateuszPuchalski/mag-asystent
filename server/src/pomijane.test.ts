import { test } from "node:test";
import assert from "node:assert/strict";
import { pomijanaPozycja, sqlBezPozycjiUslugowych } from "./pomijane.js";

/* Dopasowanie symbolu do ustawienia. Domyślne `POZYCJE_NIE_TOWAROWE`
   to `PRZESYŁKA` — z ogonkiem, bo tak stoi w kartotece klienta.               */

test("domyślnie odsiewamy PRZESYŁKĘ", () => {
  assert.equal(pomijanaPozycja("PRZESYŁKA"), true);
});

test("ogonek, wielkość liter i myślnik nie mają znaczenia", () => {
  // `zwin` — to samo składanie, którego używa wyszukiwarka; bez niego
  // `przesylka` wpisane bez polskiej klawiatury byłoby innym ustawieniem
  for (const s of ["przesyłka", "PRZESYLKA", "Przesylka", "PRZE-SYŁKA"]) {
    assert.equal(pomijanaPozycja(s), true, s);
  }
});

test("zwykły towar zostaje", () => {
  assert.equal(pomijanaPozycja("LS51-139"), false);
  // dopasowanie jest CAŁOŚCIOWE, nie „zawiera": kartoteka o symbolu
  // `PRZESYŁKA-BĄBELKOWA` to koperta, czyli towar leżący na półce
  assert.equal(pomijanaPozycja("PRZESYŁKA-BĄBELKOWA"), false);
});

test("brak symbolu NIE wypada", () => {
  // kartoteka, której nie umiemy nazwać, ma być pokazana człowiekowi,
  // a nie schowana pod regułą o usługach
  assert.equal(pomijanaPozycja(null), false);
  assert.equal(pomijanaPozycja(""), false);
});

test("warunek SQL niesie tyle parametrów, ile ma luk", () => {
  const w = sqlBezPozycjiUslugowych("tw_id")!;
  assert.equal(w.parametry.length, (w.warunek.match(/\?/g) ?? []).length);
  assert.match(w.warunek, /tw_id NOT IN/);
});
