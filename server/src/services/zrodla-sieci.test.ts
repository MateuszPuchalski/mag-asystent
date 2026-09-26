import { test } from "node:test";
import assert from "node:assert/strict";
import { numeryZWariantami, pewnoscZSieci, poziomZrodla, warunekZeStrony, wariantyNumeru } from "./zrodla-sieci.js";

/* ── Metoda SZPERACZA w kodzie (0.528.0) ────────────────────────────────────
   Czyste funkcje, bez bazy i bez sieci. Pilnujemy czterech reguł przepisanych
   z paczki: poziomów źródeł, „potwierdzone” = dwa niezależne źródła z katalogiem,
   równoważnych numerów i ukrytych warunków. */

test("poziom źródła po domenie, z subdomenami", () => {
  assert.equal(poziomZrodla("www.husqvarna.com"), 1);
  assert.equal(poziomZrodla("parts.al-ko.com"), 1);
  assert.equal(poziomZrodla("www.partstree.com"), 2);
  assert.equal(poziomZrodla("sklep-ogrodniczy.pl"), 3);
  assert.equal(poziomZrodla("notpartstree.com"), 3, "podobna nazwa to inna domena");
});

test("potwierdzone to dwie niezależne domeny, w tym katalog albo baza części", () => {
  assert.equal(pewnoscZSieci(["https://www.partstree.com/a", "https://sklep.example.pl/b"]), "potwierdzone");
  assert.equal(pewnoscZSieci(["https://a.partstree.com/x", "https://www.partstree.com/y"]), "prawdopodobne",
    "dwie podstrony jednej bazy to jedno źródło");
  assert.equal(pewnoscZSieci(["https://sklep-a.pl/x", "https://sklep-b.pl/y"]), "prawdopodobne", "dwa sklepy bez katalogu");
  assert.equal(pewnoscZSieci(["https://sklep-a.pl/x", null]), "slabe");
  assert.equal(pewnoscZSieci(["https://a.lsengineers.co.uk/x", "https://b.lsengineers.co.uk/y"]), "prawdopodobne",
    "co.uk bierze trzy człony — to jedna domena");
});

test("równoważne numery: pary MTD 7xx/9xx i przyrostek serwisowy S", () => {
  /* „Zawiera”, nie „równa się”: reguła S dokłada też „7540430s”, i to jest
     nieszkodliwe — strona z takim numerem mówi o tej samej części. */
  assert.ok(wariantyNumeru("7540430").includes("9540430"));
  assert.ok(wariantyNumeru("9420177").includes("7420177"));
  assert.deepEqual(new Set(wariantyNumeru("491588s")), new Set(["491588s", "491588"]));
  assert.deepEqual(new Set(wariantyNumeru("491588")), new Set(["491588", "491588s"]));
  assert.deepEqual(wariantyNumeru("17211zl8023"), ["17211zl8023"], "numer Hondy nie ma wariantów");
  assert.ok(numeryZWariantami(["754-0430"]).includes("9540430"), "zwija przed dobraniem wariantów");
});

test("ukryty warunek ze strony: zdanie przy cytacie, po polsku, angielsku i niemiecku", () => {
  const tekst = "Deck belt 954-0430. Fits models 13AX60RH. Will not fit manual gearbox models. Price 20 EUR.";
  assert.equal(warunekZeStrony(tekst, "Fits models 13AX60RH"), "strona: „Will not fit manual gearbox models.”");
  assert.match(warunekZeStrony("Keilriemen. Nur für Hydrostat-Modelle. Lieferzeit 2 Tage.", "Keilriemen") ?? "", /Nur für/);
  assert.equal(warunekZeStrony("Pasek napędowy do MS 250. Wysyłka 24h.", "MS 250"), null);
});
