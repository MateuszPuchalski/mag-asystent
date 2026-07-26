# Adresy do poprawy w kartotece Subiekta

Wynik audytu **2026-07-26** (`tools/audyt-kolizji.sql`, zapytanie E).

W polu lokalizacji siedzi **93 kodów** (**158 kartotek**), które nie pasują
do żadnego wzorca adresu, więc kolektor ich nie przyjmie. Ustalone: **żadna
z tych konwencji nie jest dziś używana** — to dług danych, nie zablokowana
praca. Aplikacja celowo ich nie obsługuje: rozszerzenie wzorca o martwe
formaty otworzyłoby z powrotem dziurę, przez którą symbol towaru udawał adres.

Wzorce, które kolektor przyjmuje:

```
regał   ^[A-Z]\d{2}-\d{2}-\d{2}$    np. A01-02-03
paleta  ^PAL-\d{3}$                 np. PAL-042   ← dziś ZERO trafień
```

---

## Część 1 — konwencje do migracji albo skasowania

Całe rodziny oznaczeń, nie pomyłki. Każdą trzeba albo przemianować na
`PAL-<nnn>`, albo wyczyścić, jeśli miejsce już nie istnieje.

### `PALETA<nn>` — 31 kodów, 65 kartotek

*miejsce paletowe bez separatora*

| kod | kartotek | przykładowe symbole |
|---|---|---|
| `PALETA04` | 2 | W09-1601, W23-1301 |
| `PALETA05` | 1 | W28-0304 |
| `PALETA06` | 1 | W44-1301 |
| `PALETA14` | 3 | W09-1601, W09-1101 |
| `PALETA16` | 1 | W80-2009 |
| `PALETA22` | 7 | W16-1311, W09-0205 |
| `PALETA23` | 1 | W09-0506 |
| `PALETA26` | 1 | W43-0506(K) |
| `PALETA28` | 1 | W21-0801 |
| `PALETA29` | 1 | W80-2010 |
| `PALETA32` | 1 | W10-0407 |
| `PALETA36` | 2 | W09-0808, W09-0813 |
| `PALETA38` | 1 | W02-0801 |
| `PALETA45` | 4 | W07-0802, W28-0815 |
| `PALETA46` | 1 | W08-0810 |
| `PALETA47` | 1 | W58-0204 |
| `PALETA48` | 1 | W39-0812 |
| `PALETA49` | 5 | W39-0811, W28-0817 |
| `PALETA51` | 1 | W75-2004 |
| `PALETA52` | 3 | W43-0805, W28-0410 |
| `PALETA53` | 1 | W75-2002 |
| `PALETA54` | 4 | W28-0805, W43-0805 |
| `PALETA55` | 5 | W43-0805, W80-2011 |
| `PALETA56` | 1 | W28-0410 |
| `PALETA58` | 3 | W28-0402, W49-0804 |
| `PALETA60` | 1 | W28-0407 |
| `PALETA61` | 3 | W21-0807, W80-0803 |
| `PALETA62` | 2 | W21-0807, W44-0202 |
| `PALETA64` | 1 | W07-0101 |
| `PALETA65` | 3 | W07-0101, W08-0810 |
| `PALETA66` | 2 | W07-0101, W55-0808 |

### `PAL<nn>II` — 24 kodów, 48 kartotek

*paleta z sufiksem rzymskim*

| kod | kartotek | przykładowe symbole |
|---|---|---|
| `PAL01II` | 4 | W43-0102, W43-0508 |
| `PAL06II` | 2 | W28-0811, W37-0505 |
| `PAL07II` | 3 | W09-0403, W09-0413 |
| `PAL08II` | 1 | W52-1304 |
| `PAL09II` | 1 | W29-0102 |
| `PAL10II` | 2 | W32-0803, W43-0405 |
| `PAL11II` | 2 | W32-0803, W43-0405 |
| `PAL12II` | 1 | W30-1301 |
| `PAL16II` | 1 | W09-0106 |
| `PAL18II` | 1 | W43-0203 |
| `PAL19II` | 3 | W43-0102, W43-0508 |
| `PAL20II` | 2 | W37-0504, W37-0507 |
| `PAL21II` | 1 | W16-1306 |
| `PAL22II` | 2 | W29-1306, W29-1304 |
| `PAL26II` | 2 | W27-1204, W56-1303 |
| `PAL30II` | 3 | W09-0406, W09-0407 |
| `PAL31II` | 1 | W09-0513 |
| `PAL32II` | 1 | W28-0415 |
| `PAL34II` | 1 | W65-0403 |
| `PAL37II` | 4 | W28-0415, W20-0505 |
| `PAL38II` | 4 | W08-0403, W07-0401 |
| `PAL39II` | 1 | W43-0503 |
| `PAL41II` | 1 | W43-0503 |
| `PAL42II` | 4 | W09-0807, W09-0506 |

### `KT<n>` — 14 kodów, 20 kartotek

*strefa dodatkowa, wystepuje OBOK adresu regalu*

| kod | kartotek | przykładowe symbole |
|---|---|---|
| `KT05` | 1 | W65-0403 |
| `KT06` | 1 | W65-0401 |
| `KT1` | 1 | W80-2005 |
| `KT11` | 1 | W28-0410 |
| `KT12` | 2 | W39-0810, W04-0804 |
| `KT13` | 2 | W21-0807, W43-0805 |
| `KT16` | 1 | W65-0404 |
| `KT2` | 1 | W29-0101 |
| `KT4` | 1 | W80-2006 |
| `KT5` | 3 | W08-2001, W28-0202 |
| `KT6` | 3 | W43-0201, W75-2002 |
| `KT7` | 1 | W28-0305 |
| `KT8` | 1 | W10-0412 |
| `KT9` | 1 | W04-0805 |

### `PAL-SIE-<nn>` — 3 kodów, 3 kartotek

*trzecia odmiana paletowa*

| kod | kartotek | przykładowe symbole |
|---|---|---|
| `PAL-SIE-26` | 1 | M83004 |
| `PAL-SIE-52` | 1 | M80901R |
| `PAL-SIE-61` | 1 | FTC269 |

---

## Część 2 — literówki i kody ucięte (21 kodów, 22 kartotek)

Tu nie ma konwencji do migracji — każdy wpis to osobna pomyłka przy
wprowadzaniu. `PALETQ29` ma **Q zamiast A**, `A03-05-0` i `E04-01` są ucięte,
`META` i samo `A` to nie adresy.

| kod | kartotek | przykładowe symbole |
|---|---|---|
| `A` | 2 | WKLADZEL, FTC179 |
| `A03-05-0` | 1 | W24-0402 |
| `B03-02-05-PAKOWALNIA` | 1 | FT0025 |
| `B04-01-03-PAKOWALNIA` | 1 | T475P-046 |
| `B04-01-05-PAKOWALNIA` | 1 | PA350X25.4C |
| `B04-02-01-PAKOWALNIA` | 1 | G02510 |
| `B04-03-05-PAKOWALNIA` | 1 | PA350X32C |
| `C07A-06-01` | 1 | W20-0505 |
| `D07` | 1 | 100005E |
| `E04-01` | 1 | W28-0410 |
| `G03` | 1 | W55-0201 |
| `G14` | 1 | W43-2002 |
| `H02-06-01PO` | 1 | W52-1304 |
| `H05` | 1 | 100006E |
| `J05` | 1 | OLEJ-MIX-1L |
| `KT` | 1 | W65-0407 |
| `LA03-04-01` | 1 | W64-0401 |
| `META` | 1 | OLEJ-MIX-1L |
| `PAL` | 1 | OLEJ-MIX-0,5L |
| `PAL20` | 1 | W27-1304 |
| `PALETQ29` | 1 | W27-0405 |

---

## Jak sprawdzić, że zrobione

Po poprawkach w Subiekcie przeeksportuj kartotekę i uruchom ponownie
zapytanie E z `tools/audyt-kolizji.sql` — ma zwrócić zero wierszy.

Niezależnie od tego `server/src/scan.test.ts` pilnuje drugiej strony
(żaden symbol ani kod kreskowy nie może przybrać kształtu adresu) i wywali
się przy pierwszej takiej kartotece.
