import { test } from "node:test";
import assert from "node:assert/strict";
import { WZORZEC_UUID_TSQL, uuidZTekstu, wyrazenieUuid } from "./subiekt.uuid.js";

/* ── UUID z uwag dokumentu (0.175.0) ─────────────────────────────────────────
   Wolny tekst z `dok_Uwagi` nie ma prawa trafić do naszej bazy. Przechodzi
   wyłącznie ciąg o kształcie UUID-a — i te testy pilnują obu zapór.        */

const Z_SUBIEKTA = "b9732a20-a621-11f1-8e66-3787b0f6d855 ; Client:143874145";

test("z uwag Sellasista wychodzi SAM identyfikator zamówienia", () => {
  /* Dokładnie ten napis stoi w polu Uwagi na zrzucie z Subiekta. Numer klienta
     po średniku zostaje w Subiekcie — nie jest UUID-em, więc nie ma jak przejść. */
  assert.equal(uuidZTekstu(Z_SUBIEKTA), "b9732a20-a621-11f1-8e66-3787b0f6d855");
});

test("adres, telefon i cokolwiek innego NIE przechodzi", () => {
  assert.equal(uuidZTekstu("ul. Ogrodowa 5, 00-001 Warszawa, tel. 600 700 800"), null);
  assert.equal(uuidZTekstu("Client:143874145"), null);
  assert.equal(uuidZTekstu(""), null);
  assert.equal(uuidZTekstu(null), null);
  // niepełny UUID też odpada — krótszy prefiks pasowałby do wszystkiego
  assert.equal(uuidZTekstu("b9732a20-a621-11f1-8e66-3787b0f6d8"), null);
});

test("wielkość liter nie ma znaczenia, wynik jest małymi", () => {
  assert.equal(uuidZTekstu("Allegro: B9732A20-A621-11F1-8E66-3787B0F6D855"),
    "b9732a20-a621-11f1-8e66-3787b0f6d855");
});

test("wzorzec T-SQL ma 36 pozycji i cztery myślniki tam, gdzie UUID", () => {
  /* `PATINDEX` nie zna powtórzeń, więc wzorzec jest długi — a długi wzorzec
     łatwo zepsuć o jedną pozycję. Liczymy go, zamiast ufać oku. */
  const klas = (WZORZEC_UUID_TSQL.match(/\[0-9a-fA-F\]/g) ?? []).length;
  assert.equal(klas, 32, "32 znaki szesnastkowe");
  /* Myślniki liczymy PO zdjęciu klas znaków — każda klasa niesie własne trzy
     (`0-9`, `a-f`, `A-F`) i bez tego kroku test liczyłby sto zamiast czterech. */
  const szkielet = WZORZEC_UUID_TSQL.replace(/\[0-9a-fA-F\]/g, "x");
  assert.equal(szkielet, "%xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx%");
  assert.ok(WZORZEC_UUID_TSQL.startsWith("%") && WZORZEC_UUID_TSQL.endsWith("%"));
  /* Ten sam wzorzec przetłumaczony na regex musi łapać UUID z Subiekta — bez
     tego test sprawdzałby wyłącznie liczbę nawiasów. */
  const regex = new RegExp(WZORZEC_UUID_TSQL.slice(1, -1));
  assert.ok(regex.test(Z_SUBIEKTA));
  assert.ok(!regex.test("Client:143874145"));
});

test("wyrażenie SQL wycina 36 znaków od miejsca dopasowania", () => {
  const w = wyrazenieUuid("d.dok_Uwagi");
  assert.match(w, /PATINDEX\(@uuid, d\.dok_Uwagi\) > 0/);
  assert.match(w, /SUBSTRING\(d\.dok_Uwagi, PATINDEX\(@uuid, d\.dok_Uwagi\), 36\)/);
});
