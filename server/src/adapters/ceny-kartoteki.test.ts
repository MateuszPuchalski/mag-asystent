import { test } from "node:test";
import assert from "node:assert/strict";
import { naGrosze, rozwinCeny, type CenaRow } from "./subiekt.mssql.js";

/* ── Cennik kartoteki z Subiekta na read-model (0.405.0) ─────────────────────
   Właściciel uruchomił `tools/sonda-cen.sql` na produkcji 19 września 2026
   i wynik rozstrzygnął dwie rzeczy, których nie dało się wziąć z kodu:

   1. POZIOMY TO KOLUMNY. `tw_Cena` niesie `tc_CenaNetto0..10`
      i `tc_CenaBrutto0..10` — jedenaście par w jednym wierszu na kartotekę.
      Nasz `sgt_cena` ma kształt odwrotny, więc import je ROZWIJA.
   2. NETTO I BRUTTO STOJĄ OBOK SIEBIE. Nie przeliczamy przez VAT.

   Te testy pilnują trzech rzeczy, z których każda kosztuje grosz w cenie
   podanej klientowi — a grosz w cenie to reklamacja:

   A. ZAOKRĄGLENIE. `money(19,4)` wraca ze sterownika jako liczba
      zmiennoprzecinkowa, więc `19.99 * 100` to `1998.9999999999998`.
   B. PUSTY POZIOM NIE WCHODZI. Subiekt trzyma nieużywane poziomy jako NULL
      albo parę zer; dziewięć wierszy „0,00 zł" na karcie to dziewięć
      zaproszeń do podania klientowi ceny, której nie ma.
   C. ZERO PO JEDNEJ STRONIE TO NIE PUSTY POZIOM. Netto 0 przy brutto 12,30
      jest danymi do obejrzenia przez człowieka, nie śmieciem do wycięcia. */

const pusty = (): CenaRow => {
  const w: CenaRow = { tc_IdTowar: 7701 };
  for (let i = 0; i < 11; i += 1) {
    w[`tc_CenaNetto${i}`] = null;
    w[`tc_CenaBrutto${i}`] = null;
    w[`tc_IdWaluta${i}`] = "PLN";
  }
  return w;
};

const NAZWY = new Map([[1, "Detaliczna"], [2, "Hurtowa"]]);

test("kwota z Subiekta idzie na CAŁKOWITE grosze, bez ogona zmiennoprzecinkowego", () => {
  /* Bez `Math.round` wyszłoby 1998.9999999999998, a `INSERT` do kolumny
     INTEGER zapisałby to jako 1998 — czyli cenę o grosz niższą, na każdym
     towarze kończącym się na 99. */
  assert.equal(naGrosze(19.99), 1999);
  assert.equal(naGrosze(0.07), 7);
  assert.equal(naGrosze(1234.5), 123450);
  assert.equal(naGrosze(null), null, "brak ceny to nie zero");
  assert.equal(naGrosze(undefined), null);
});

test("jeden wiersz tw_Cena rozwija się na TYLE wierszy, ile poziomów firma wypełniła", () => {
  const w = pusty();
  w.tc_CenaNetto1 = 40.65;
  w.tc_CenaBrutto1 = 50.0;
  w.tc_CenaNetto2 = 36.59;
  w.tc_CenaBrutto2 = 45.0;

  const out = rozwinCeny(w, NAZWY);
  assert.equal(out.length, 2, "dziewięć pustych poziomów nie wchodzi");
  assert.deepEqual(out.map((c) => c.poziom), [1, 2]);
  assert.deepEqual(out.map((c) => c.nazwa), ["Detaliczna", "Hurtowa"]);
  assert.deepEqual(out.map((c) => c.netto), [4065, 3659]);
  assert.deepEqual(out.map((c) => c.brutto), [5000, 4500]);
});

test("poziom wypełniony parą ZER nie wchodzi — to nie jest cena, to pusty cennik", () => {
  const w = pusty();
  w.tc_CenaNetto3 = 0;
  w.tc_CenaBrutto3 = 0;
  assert.deepEqual(rozwinCeny(w, NAZWY), []);
});

test("zero po JEDNEJ stronie zostaje — to dane dla człowieka, nie śmieć", () => {
  const w = pusty();
  w.tc_CenaNetto4 = 0;
  w.tc_CenaBrutto4 = 12.3;
  const out = rozwinCeny(w, NAZWY);
  assert.equal(out.length, 1);
  assert.equal(out[0].netto, 0);
  assert.equal(out[0].brutto, 1230);
});

test("poziom bez nazwy w słowniku dostaje pustą, a nie zmyśloną", () => {
  /* Widok `vwPoziomyCen` numeruje od 1; kolumna 0 to cena zakupu i nazwy nie
     ma. Panel pokazuje wtedy numer poziomu — a nie wymyśloną etykietę, po
     której agent podałby klientowi cennik zakupu jako detaliczny. */
  const w = pusty();
  w.tc_CenaNetto0 = 22.5;
  w.tc_CenaBrutto0 = 27.68;
  const out = rozwinCeny(w, NAZWY);
  assert.equal(out.length, 1);
  assert.equal(out[0].poziom, 0);
  assert.equal(out[0].nazwa, "");
});

test("waluta bierze się Z POZIOMU, bo Subiekt trzyma ją osobno dla każdego", () => {
  const w = pusty();
  w.tc_CenaNetto1 = 10;
  w.tc_CenaBrutto1 = 12.3;
  w.tc_IdWaluta1 = "EUR";
  w.tc_CenaNetto2 = 40;
  w.tc_CenaBrutto2 = 49.2;
  w.tc_IdWaluta2 = "  ";
  const out = rozwinCeny(w, NAZWY);
  assert.equal(out[0].waluta, "EUR");
  assert.equal(out[1].waluta, "PLN", "pusta waluta to złotówki, nie pusty ciąg");
});
