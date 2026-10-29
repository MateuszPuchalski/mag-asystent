import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budujZapytanieBezWymiarow, budujZapytanieWag, budujZapytanieWymiarow, tekstWymiaru, zrodloWymiarow,
} from "./wymiary.sgt.js";

/* ── Zapytania wag i wymiarów — jedyna logika tego adaptera bez serwera MSSQL ─
   Pilnujemy formatu tekstu w polu własnym, tego, że zapis dotyka WYŁĄCZNIE
   zmierzonych kolumn, że towar bez wiersza pól własnych dostaje nowy wiersz,
   i że nazwy kolumn z konfiguracji nie wejdą do SQL bez sprawdzenia. */

/* Układ z bazy firmy: Wysokość = Tekst01, Szerokość = Tekst02, Długość = Tekst03. */
const POLA = { dlugosc: "pwd_Tekst03", szerokosc: "pwd_Tekst02", wysokosc: "pwd_Tekst01" };
const NIC = { bruttoKg: null, nettoKg: null, dlugosc: null, szerokosc: null, wysokosc: null };

test("wymiar to centymetry z przecinkiem, bez „,0” przy pełnych", () => {
  assert.equal(tekstWymiaru(12.5), "12,5");
  assert.equal(tekstWymiaru(30), "30");
  assert.equal(tekstWymiaru(7.04), "7");
  assert.equal(tekstWymiaru(7.06), "7,1");
  assert.equal(tekstWymiaru(0.5), "0,5");
});

test("wagi idą do tw__Towar i tylko te zważone", () => {
  assert.equal(
    budujZapytanieWag({ ...NIC, bruttoKg: 1.2, nettoKg: 1, dlugosc: 30 }),
    "UPDATE tw__Towar SET tw_Masa = @brutto, tw_MasaNetto = @netto WHERE tw_Id = @id"
  );
  assert.equal(budujZapytanieWag({ ...NIC, nettoKg: 0.5 }), "UPDATE tw__Towar SET tw_MasaNetto = @netto WHERE tw_Id = @id");
  assert.equal(budujZapytanieWag({ ...NIC, dlugosc: 30 }), null, "same wymiary nie ruszają tw__Towar");
});

test("wymiary: UPDATE wiersza towaru w pw_Dane, a bez wiersza INSERT z numerem z licznika", () => {
  const z = budujZapytanieWymiarow({ ...NIC, szerokosc: 4, wysokosc: 2 }, POLA, true)!;
  assert.match(z, /^IF EXISTS \(SELECT 1 FROM pw_Dane WITH \(UPDLOCK, HOLDLOCK\) WHERE pwd_TypObiektu = @typ AND pwd_IdObiektu = @id\)/);
  assert.ok(z.includes("UPDATE pw_Dane SET pwd_Tekst02 = @szerokosc, pwd_Tekst01 = @wysokosc WHERE pwd_TypObiektu = @typ AND pwd_IdObiektu = @id;"));
  assert.ok(!z.includes("pwd_Tekst03"), "niezmierzona długość zostaje nietknięta");
  assert.ok(z.includes("SELECT @nowe = ido_wartosc FROM ins_ident WITH (UPDLOCK, HOLDLOCK) WHERE ido_nazwa = 'pw_Dane';"));
  assert.ok(z.includes("IF @nowe IS NULL OR @nowe <= @maks SET @nowe = @maks + 1;"), "licznik spóźniony dogania MAX + 1");
  assert.ok(z.includes(
    "INSERT INTO pw_Dane (pwd_Id, pwd_TypObiektu, pwd_IdObiektu, pwd_Tekst02, pwd_Tekst01) VALUES (@nowe, @typ, @id, @szerokosc, @wysokosc);"
  ));
});

test("wymiary przy pwd_Id IDENTITY: INSERT bez numeru i bez licznika", () => {
  const z = budujZapytanieWymiarow({ ...NIC, dlugosc: 22 }, POLA, false)!;
  assert.ok(z.includes("INSERT INTO pw_Dane (pwd_TypObiektu, pwd_IdObiektu, pwd_Tekst03) VALUES (@typ, @id, @dlugosc);"));
  assert.ok(!z.includes("ins_ident"));
  assert.equal(budujZapytanieWymiarow({ ...NIC, bruttoKg: 1 }, POLA, true), null, "same wagi nie ruszają pw_Dane");
});

test("nazwa kolumny spoza identyfikatorów nie wchodzi do SQL", () => {
  const zle = { ...POLA, wysokosc: "pwd_Tekst01; DROP TABLE pw_Dane" };
  assert.throws(() => budujZapytanieWymiarow({ ...NIC, wysokosc: 3 }, zle, true));
  assert.throws(() => zrodloWymiarow(zle));
  assert.throws(() => budujZapytanieBezWymiarow({ pola: zle, lokalizacja: "tw_Pole1", zFiltrem: false }));
});

test("wymiary czyta jeden wiersz pól własnych towaru — drugi nie dubluje towaru na liście", () => {
  assert.equal(
    zrodloWymiarow(POLA),
    "OUTER APPLY (SELECT TOP 1 pwd_Tekst03 AS dlugosc, pwd_Tekst02 AS szerokosc, pwd_Tekst01 AS wysokosc " +
      "FROM pw_Dane WITH (NOLOCK) WHERE pwd_TypObiektu = -14 AND pwd_IdObiektu = t.tw_Id ORDER BY pwd_Id) pw"
  );
});

test("lista łapie brak którejś wagi albo któregokolwiek wymiaru, tylko niezablokowane", () => {
  const { strona, razem } = budujZapytanieBezWymiarow({ pola: POLA, lokalizacja: "tw_Pole1", zFiltrem: false });
  const brak =
    "(ISNULL(t.tw_Masa, 0) <= 0 OR ISNULL(t.tw_MasaNetto, 0) <= 0 OR LTRIM(RTRIM(ISNULL(pw.dlugosc, ''))) = '' " +
    "OR LTRIM(RTRIM(ISNULL(pw.szerokosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.wysokosc, ''))) = '')";
  for (const z of [strona, razem]) {
    assert.ok(z.includes("t.tw_Zablokowany = 0"), z);
    assert.ok(z.includes(brak), z);
    assert.ok(z.includes(zrodloWymiarow(POLA)), "licznik też widzi pola własne");
    assert.ok(!z.includes("@q"), "bez szukania nie ma parametru @q");
  }
  assert.ok(strona.includes("t.tw_Pole1 AS lokalizacja, t.tw_Masa AS brutto, t.tw_MasaNetto AS netto, pw.dlugosc, pw.szerokosc, pw.wysokosc"));
  /* Stronicowanie bez pełnego porządku gubi wiersze — domyka je tw_Id. */
  assert.match(strona, /ORDER BY .*t\.tw_Id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY$/);
});

test("szukanie, stan i sprzedaż dokładają swoje warunki do strony i licznika", () => {
  const { strona, razem } = budujZapytanieBezWymiarow({
    pola: POLA, lokalizacja: "tw_Pole1", zFiltrem: true, naStanie: true, sprzedane: true, sortuj: "symbol",
  });
  for (const z of [strona, razem]) {
    assert.ok(z.includes("t.tw_Symbol LIKE @q ESCAPE '!'"));
    assert.ok(z.includes("st.st_Stan > 0"));
    assert.ok(z.includes("p.ob_IloscMag > 0"));
  }
  assert.ok(strona.includes("ORDER BY t.tw_Symbol, t.tw_Id"));
});

test("obchód po regałach: porządek po lokalizacji, towary bez adresu na końcu", () => {
  const { strona } = budujZapytanieBezWymiarow({ pola: POLA, lokalizacja: "tw_Pole1", zFiltrem: false, sortuj: "lokalizacja" });
  assert.ok(strona.includes(
    "ORDER BY CASE WHEN LTRIM(RTRIM(ISNULL(t.tw_Pole1, ''))) = '' THEN 1 ELSE 0 END, t.tw_Pole1, t.tw_Id OFFSET"
  ), strona);
  assert.throws(() => budujZapytanieBezWymiarow({ pola: POLA, lokalizacja: "tw_Pole1;--", zFiltrem: false }));
});
