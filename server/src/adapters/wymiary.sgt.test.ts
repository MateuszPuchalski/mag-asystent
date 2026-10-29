import { test } from "node:test";
import assert from "node:assert/strict";
import { budujZapytanieBezWymiarow, budujZapytanieZapisu, tekstWymiaru } from "./wymiary.sgt.js";

/* ── Zapytania wymiarów — jedyna logika tego adaptera bez serwera MSSQL ──────
   Pilnujemy trzech rzeczy: formatu tekstu w polu własnym, tego, że UPDATE
   dotyka WYŁĄCZNIE zmierzonych kolumn, i że nazwy pól z konfiguracji nie
   wejdą do SQL bez sprawdzenia. */

const POLA = { dlugosc: "tw_Pole4", szerokosc: "tw_Pole5", wysokosc: "tw_Pole6" };

test("wymiar to centymetry z przecinkiem, bez „,0” przy pełnych", () => {
  assert.equal(tekstWymiaru(12.5), "12,5");
  assert.equal(tekstWymiaru(30), "30");
  assert.equal(tekstWymiaru(7.04), "7");
  assert.equal(tekstWymiaru(7.06), "7,1");
  assert.equal(tekstWymiaru(0.5), "0,5");
});

test("UPDATE niesie tylko zmierzone kolumny", () => {
  assert.equal(
    budujZapytanieZapisu({ bruttoKg: 1.2, nettoKg: 1, dlugosc: 30, szerokosc: 20, wysokosc: 10 }, POLA),
    "UPDATE tw__Towar SET tw_Masa = @brutto, tw_MasaNetto = @netto, tw_Pole4 = @dlugosc, tw_Pole5 = @szerokosc, tw_Pole6 = @wysokosc WHERE tw_Id = @id"
  );
  assert.equal(
    budujZapytanieZapisu({ bruttoKg: null, nettoKg: null, dlugosc: null, szerokosc: 4, wysokosc: null }, POLA),
    "UPDATE tw__Towar SET tw_Pole5 = @szerokosc WHERE tw_Id = @id"
  );
  assert.equal(budujZapytanieZapisu({ bruttoKg: null, nettoKg: null, dlugosc: null, szerokosc: null, wysokosc: null }, POLA), null);
  assert.equal(
    budujZapytanieZapisu({ bruttoKg: null, nettoKg: 0.5, dlugosc: null, szerokosc: null, wysokosc: null }, POLA),
    "UPDATE tw__Towar SET tw_MasaNetto = @netto WHERE tw_Id = @id"
  );
});

test("nazwa pola spoza identyfikatorów nie wchodzi do SQL", () => {
  const zle = { ...POLA, wysokosc: "tw_Pole6; DROP TABLE tw__Towar" };
  assert.throws(() => budujZapytanieZapisu({ bruttoKg: null, nettoKg: null, dlugosc: null, szerokosc: null, wysokosc: 3 }, zle));
  assert.throws(() => budujZapytanieBezWymiarow({ pola: zle, zFiltrem: false }));
});

test("lista łapie brak którejś wagi albo któregokolwiek wymiaru, tylko niezablokowane", () => {
  const { strona, razem } = budujZapytanieBezWymiarow({ pola: POLA, zFiltrem: false });
  const brak =
    "(ISNULL(t.tw_Masa, 0) <= 0 OR ISNULL(t.tw_MasaNetto, 0) <= 0 OR LTRIM(RTRIM(ISNULL(t.tw_Pole4, ''))) = '' " +
    "OR LTRIM(RTRIM(ISNULL(t.tw_Pole5, ''))) = '' OR LTRIM(RTRIM(ISNULL(t.tw_Pole6, ''))) = '')";
  for (const z of [strona, razem]) {
    assert.ok(z.includes("t.tw_Zablokowany = 0"), z);
    assert.ok(z.includes(brak), z);
    assert.ok(!z.includes("@q"), "bez szukania nie ma parametru @q");
  }
  assert.ok(strona.includes("t.tw_Pole4 AS dlugosc, t.tw_Pole5 AS szerokosc, t.tw_Pole6 AS wysokosc"));
  /* Stronicowanie bez pełnego porządku gubi wiersze — domyka je tw_Id. */
  assert.match(strona, /ORDER BY .*t\.tw_Id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY$/);
});

test("szukanie, stan i sprzedaż dokładają swoje warunki do strony i licznika", () => {
  const { strona, razem } = budujZapytanieBezWymiarow({
    pola: POLA, zFiltrem: true, naStanie: true, sprzedane: true, sortuj: "symbol",
  });
  for (const z of [strona, razem]) {
    assert.ok(z.includes("t.tw_Symbol LIKE @q ESCAPE '!'"));
    assert.ok(z.includes("st.st_Stan > 0"));
    assert.ok(z.includes("p.ob_IloscMag > 0"));
  }
  assert.ok(strona.includes("ORDER BY t.tw_Symbol, t.tw_Id"));
});
