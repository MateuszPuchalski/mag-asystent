# Struktura bazy Subiekta GT — co WERTIS czyta i pisze

Zweryfikowane wprost z oficjalnego **„Opisu struktury zbiorów danych InsERT GT",
wersja bazy 1.8731.31.6933** — czyli dokładnie tej, którą ma firma (Subiekt GT
1.87 SP3 HF1). Ten dokument istnieje po to, żeby przestać zgadywać: wszystko
poniżej jest cytatem ze struktury, a nie domysłem z innej wersji.

To, czego dokumentacja **nie** zawiera (bo zależy od konkretnego podmiotu),
zostało wyraźnie oznaczone `[WERYFIKUJ]` — takich rzeczy zostały trzy.

## Kody `dok_Typ` — już nie zgadujemy

```
1-FZ    2-FS    3-RZ    4-RS    5-KFZ   6-KFS   9-MM   10-PZ  11-WZ
12-PW  13-RW   14-ZW   15-ZD   16-ZK   21-PA   29-IW  35-ZPZ 36-ZWZ
```

Stąd domyślne w `config.ts`: `DOK_TYP_FZ=1`, `DOK_TYP_PZ=10`, `DOK_TYP_ZWROTY=14`.

> **Uwaga historyczna.** WERTIS miał wcześniej `DOK_TYP_PZ=5`, a 5 to **KFZ —
> korekta faktury zakupu**. Na prawdziwej bazie aplikacja listowałaby korekty
> jako dostawy i nie zobaczyła ani jednego PZ. Poprawione po sprawdzeniu
> w strukturze.

## Tabele czytane przez importer

| Tabela | Kolumny używane przez WERTIS |
|---|---|
| `tw__Towar` (dwa podkreślenia) | `tw_Id`, `tw_Symbol`, `tw_Nazwa`, `tw_PodstKodKresk`, `tw_JednMiary`, `tw_Opis`, `tw_Zablokowany`, `tw_Pole1..8` |
| `tw_Stan` | `st_TowId`, `st_MagId`, `st_Stan`, `st_StanRez` (PK: `st_TowId`+`st_MagId`) |
| `dok__Dokument` | `dok_Id`, `dok_Typ`, `dok_NrPelny`, `dok_DataWyst`, `dok_MagId`, `dok_PlatnikId`, `dok_Status` |
| `dok_Pozycja` | `ob_DokHanId` (→ `dok_Id`), `ob_TowId` (→ `tw_Id`), `ob_IloscMag` |
| `kh__Kontrahent` | `kh_Id`, `kh_Symbol` |
| `fl_Wartosc` + `fl__Flagi` | flaga sprawdzenia faktury — patrz niżej |
| `sl_Magazyn` | `mag_Id`, `mag_Symbol`, `mag_Nazwa` — nazwy magazynów na karcie towaru |

## Lokalizacja: pola własne, nie `tw_Lokalizacja`

Wersje z KSeF **nie mają** natywnej kolumny `tw_Lokalizacja`. Struktura
potwierdza za to osiem pól własnych na `tw__Towar`:

```
tw_Pole1 … tw_Pole8      varchar(50)      „Własne pole 1..8"
```

Stąd `MSSQL_LOC_COLUMN` (domyślnie `tw_Pole1`) i `LOC_FIELD_LIMIT=50` — limit nie
jest ostrożnym założeniem, tylko realnym rozmiarem kolumny.

`[WERYFIKUJ]` **które** z ośmiu pól firma przeznacza na lokalizację. Wybierz takie,
którego nie używa do niczego innego — worker nadpisuje je bezwarunkowo.

## Bufor: `dok_Status`

```
0-wycofany   1-wykonany   2-unieważniony   3-odłożony   4-MM wydany
5..8-zamówienia (różne stany realizacji)
```

Dokument „w buforze" to **odłożony (3)**. Domyślne `MSSQL_BUFFER_EXPR` sprawdza
więc `dok_Status = 3`.

> **Uwaga historyczna.** Wcześniej domyślne wyrażenie sprawdzało `= 0`, czyli
> **wycofany**. Myliło się w obie strony: dokument wycofany pokazywałby się jako
> bufor, a odłożony jako gotowy do pracy.

## Flaga sprawdzenia faktury — osobny mechanizm, nie kolumna

To najważniejsze ustalenie. Kolumna „FW" na liście faktur zakupu **nie odpowiada
żadnej kolumnie `dok__Dokument`**. InsERT trzyma flagi w parze tabel:

**`fl__Flagi`** — definicje flag (co istnieje):

| Kolumna | Znaczenie |
|---|---|
| `flg_Id` | identyfikator flagi — **to wpisujemy jako `DOC_FLAG_*_SGT`** |
| `flg_Numer` | numer wyznaczający ikonę |
| `flg_Text` | tytuł flagi — **to widzi człowiek** (`DOC_FLAG_*`) |
| `flg_IdGrupy` | grupa flag (→ `fl_Grupy.flp_Id`) |

**`fl_Wartosc`** — przypisania (co jest oflagowane):

| Kolumna | Znaczenie |
|---|---|
| `flw_IdGrupyFlag` | grupa flag |
| `flw_TypObiektu` | typ obiektu w obrębie grupy |
| `flw_IdObiektu` | id flagowanego obiektu — dla dokumentu `dok_Id` |
| `flw_IdFlagi` | która flaga (→ `flg_Id`) |
| `flw_Komentarz` | komentarz do obiektu |
| `flw_IdUzytkownika` | kto ostatnio oflagował/zdjął |
| `flw_CzasOstatniejZmiany` | kiedy |

Klucz główny jest **złożony**: (`flw_IdGrupyFlag`, `flw_TypObiektu`,
`flw_IdObiektu`). Jeden obiekt ma więc najwyżej jedną flagę w grupie, a zapis to
MERGE — podmień, jeśli już jest, wstaw, jeśli nie (`adapters/sfera.sql.ts`).

Trzy konsekwencje dla WERTIS:

1. **Rozdział klucz / label / wartość okazał się trafny.** `flg_Text` to nazwa dla
   człowieka, `flg_Id` to liczba do zapisu — dokładnie te dwa byty, które
   `services/delivery-flag.ts` już rozróżnia.
2. **Aplikacja nie potrzebuje żadnego prawa zapisu do `dok__Dokument`.**
   To zawężenie uprawnień, nie rozszerzenie: `fl_Wartosc` nie uczestniczy
   w numeracji ani w skutkach magazynowych, więc zapis tam nie może naruszyć
   integralności dokumentu.
3. **Wykrywanie „biuro nadpisało flagę" staje się precyzyjne** —
   `flw_IdUzytkownika` i `flw_CzasOstatniejZmiany` mówią wprost kto i kiedy,
   zamiast wnioskowania z samej różnicy wartości.

`[WERYFIKUJ]` para (`flw_IdGrupyFlag`, `flw_TypObiektu`) dla faktur zakupu — jedyna
rzecz w całym mechanizmie flag, której dokumentacja nie zawiera. Jeden SELECT:

```sql
-- podstaw numer faktury oflagowanej ręcznie w Subiekcie
SELECT w.flw_IdGrupyFlag, w.flw_TypObiektu, w.flw_IdFlagi, f.flg_Text, f.flg_Numer
FROM fl_Wartosc w
JOIN fl__Flagi  f ON f.flg_Id = w.flw_IdFlagi
JOIN dok__Dokument d ON d.dok_Id = w.flw_IdObiektu
WHERE d.dok_NrPelny = 'FZ 60/MAG/07/2026';
```

Wynik daje naraz: obie liczby do env (`MSSQL_FLAG_GRUPA`,
`MSSQL_FLAG_TYP_OBIEKTU`) oraz `flg_Id` + `flg_Text` tej flagi. Powtórz dla
czterech flag albo wypisz je hurtem:

```sql
SELECT flg_Id, flg_Text, flg_Numer, flg_IdGrupy FROM fl__Flagi ORDER BY flg_IdGrupy, flg_Numer;
```

→ `DOC_FLAG_IN_PROGRESS_SGT`, `DOC_FLAG_PAUSED_SGT`, `DOC_FLAG_DONE_SGT`,
`DOC_FLAG_DONE_ERRORS_SGT`.

## Magazyny

`sl_Magazyn`: `mag_Id`, `mag_Symbol` varchar(3), `mag_Nazwa`, `mag_Glowny` (bit).

Od sierpnia 2026 importer **czyta tę tabelę** i pobiera stany ze WSZYSTKICH
magazynów, nie tylko z trzech skonfigurowanych — karta towaru odpowiada na
pytanie „gdzie ten towar jeszcze leży". Wymaga to `GRANT SELECT ON dbo.sl_Magazyn`
(`docs/subiekt-gt-edu-setup.md` §2); bez niego aplikacja degraduje się do trzech
magazynów i mówi o tym w `/api/health`.

`[WERYFIKUJ]` id magazynów MAG / MGP / Zwroty (`MAG_ID_*`). Magazyn główny da się
wykryć automatycznie (`mag_Glowny = 1`), ale MGP i Zwroty są nazwane po firmowemu:

```sql
SELECT mag_Id, mag_Symbol, mag_Nazwa, mag_Glowny FROM sl_Magazyn ORDER BY mag_Id;
```

## Dokument MM — na przyszłość

Gdy ruszy worker Sfery (albo import EPP), przyda się to, że dla MM struktura
używa dwóch pól magazynowych:

- `dok_MagId` — magazyn **źródłowy**,
- `dok_OdbiorcaId` — „dla MM oznacza identyfikator magazynu" (docelowy).

Typ dokumentu MM to `dok_Typ = 9`.

## Rodzaj zwrotu — niewykorzystana informacja

`dok_StatusEx` dla dokumentów ZW rozróżnia:

```
0-nieokreślony rodzaj zwrotu   1-zwrot ze sprzedaży   2-reklamacja
3-oczywista pomyłka
```

WERTIS tego dziś nie czyta. Reklamacja i zwrot ze sprzedaży to jednak różne
sytuacje na magazynie (reklamowany towar często nie wraca na półkę), więc jeśli
biuro tę informację wypełnia, warto ją pokazać magazynierowi przy koszyku.

## Audyt kolizji kodów — założenie klasyfikatora skanów

Od lipca 2026 kolektor rozpoznaje etykietę regału **po wzorcu**, nie po
heurystyce „ma literę, nie ma spacji". `LOC` jest kategorią **zamkniętą**:

```
regał   ^[A-Z]\d{2}-\d{2}-\d{2}$     A01-02-03    2 myślniki
paleta  ^PAL-\d{3}$                  PAL-042      1 myślnik + prefiks
EAN     ^\d{8}$|^\d{12,14}$                       0 myślników
symbol  wszystko pozostałe           W32-0203     0–1 myślnik
```

Ta reguła stoi na jednym założeniu: **żaden symbol towaru ani kod kreskowy
w kartotece nie ma kształtu lokalizacji.** Formaty są rozłączne po liczbie
myślników, więc założenie jest prawdopodobne — ale kartoteka ma ~3 600 pozycji
wprowadzanych ręcznie przez lata, więc prawdopodobne to nie to samo co
sprawdzone.

Weryfikuje je [`tools/audyt-kolizji.sql`](../tools/audyt-kolizji.sql). Uruchom
na produkcyjnej bazie loginem read-only:

```bash
sqlcmd -S localhost -d Subiekt_GT -U wertis -P "$MSSQL_PASSWORD" \
       -i tools/audyt-kolizji.sql -s ';' -W > audyt.txt
```

**Zapytanie A musi zwrócić 0 wierszy.** Gdy zwróci kilka — popraw symbole
w Subiekcie (taniej niż kod obronny na zawsze). Gdy kilkadziesiąt — to decyzja
właściciela, bo najprostszym wyjściem jest prefiks `L` na etykietach regałów
przy najbliższym przedruku.

### Wynik

| data | A (symbol = regał) | A2 (symbol = paleta) | D (kod kreskowy = regał) | kartotek |
|---|---|---|---|---|
| **2026-07-26** | **0** | **0** | **0** | 3415 |

**Założenie potwierdzone. Klasyfikator jest bezpieczny.**

**Jak, skoro audyt szedł bez dostępu do MSSQL.** Zapytanie C (rozkład liczby
myślników w symbolach) na produkcji dało `0:1403, 1:1878, 2:64, 3:32, 4:36,
5:2` — czyli **identycznie, we wszystkich sześciu kubełkach**, jak
`server/seed/products.json` w tym repo. To ta sama kartoteka, więc A, A2 i D
policzono na niej. To jest dowód przez zgodność rozkładu, nie skrót ani
założenie — i dlatego nie ma potrzeby powtarzać audytu bez zmiany kartoteki.

**Najbliższa kolizja: rodzina `B20-40-*`** („Akumulator 20V; 4Ah — B20-40-S").
`B20-40-S` ma 8 znaków, wzorzec regału wymaga 9 — czyli **jeden znak dzieli tę
rodzinę od kolizji**. Kartoteka nazwana `B20-40-01` zostałaby uznana za adres
regału. To jedyna trwała lekcja z tego audytu: przy zakładaniu kartotek unikać
schematu `litera + 2 cyfry - 2 cyfry - 2 cyfry`.

Pilnuje tego test `server/src/scan.test.ts` — czyta `products.json` i wywala się
przy pierwszym symbolu lub kodzie kreskowym w kształcie adresu. Jednorazowe
zapytanie chroniło przez jeden dzień; test chroni zawsze.

### Adresy niepasujące do wzorca (zapytanie E)

To samo uruchomienie pokazało **93 kody adresowe w 158 kartotekach**, które nie
pasują do żadnego wzorca — i nie są to literówki, tylko trzy całe konwencje:
`PALETA22` (31 kodów), `PAL38II` (24), `KT1` (14), plus `PAL-SIE-<nn>` (3)
i 21 realnych pomyłek.

**Ustalone z właścicielem: żadna z tych konwencji nie jest dziś używana.** To
dług danych, nie zablokowana praca — aplikacja słusznie ich nie przyjmuje, bo
rozszerzenie wzorca o martwe formaty otworzyłoby z powrotem dziurę, przez którą
symbol towaru udawał adres. Lista do posprzątania w Subiekcie:
[`adresy-do-poprawy.md`](adresy-do-poprawy.md).

Konsekwencja dla konfiguracji: **`^PAL-\d{3}$` ma dziś zero trafień w całej
kartotece.** Zostaje w `config.locPatterns` jako format DOCELOWY, na który
migrują palety przy sprzątaniu — nie jako opis stanu obecnego.

## Zasada nadrzędna

Zapis do bazy Subiekta ogranicza się do **dwóch rzeczy**: pola lokalizacji na
`tw__Towar` i przypisania flagi w `fl_Wartosc`. Zero `INSERT` do tabel
dokumentów, zero modyfikacji stanów, zero ingerencji w numerację — dokumenty MM
tworzy Sfera (COM) albo import EPP, nigdy bezpośredni SQL.
