/* ─────────────────────────────────────────────────────────────────────────────
   WERTIS · sonda cen z kartoteki Subiekta GT

   PO CO TO ISTNIEJE. Zgłoszenie właściciela: „nie widzę cen z Subiekta przy
   towarach". I nie widzi, bo ich tam nigdy nie było — `sgt_towar` nie ma
   kolumny ceny, importer ich nie pobiera, a login `wertis` nie ma nawet
   `GRANT SELECT` na tabelę cennikową.

   Dołożenie ich wymaga DWÓCH rzeczy, których nie da się wziąć z kodu:
     1. nazw tabeli i kolumn cennika w TEJ wersji bazy,
     2. odpowiedzi, ile poziomów cen ta firma naprawdę używa.

   Nasz zweryfikowany wyciąg ze struktury InsERT
   (`docs/subiekt-gt-struktura.md`) opisuje `tw__Towar`, `tw_Stan`, dokumenty
   i kontrahentów — cennika NIE opisuje. Wpisanie nazw z pamięci to dokładnie
   ta klasa błędu, która przy Allegro kosztowała trzy wydania, więc tutaj
   pytamy bazę, zamiast zgadywać.

   JAK URUCHOMIĆ (login read-only wystarczy — to same odczyty ze słowników
   systemowych plus jedna próbka danych):

       sqlcmd -S localhost -d Subiekt_GT -U wertis -P '...' \
              -i tools/sonda-cen.sql -s ';' -W > sonda-cen.txt

   Jeśli login `wertis` nie ma jeszcze prawa do tabel cennikowych, sekcja D
   zwróci błąd uprawnień — to jest ODPOWIEDŹ, nie awaria: znaczy, że do
   `docs/subiekt-gt-edu-setup.md` §2 dochodzi nowy `GRANT SELECT`.

   WYNIK WKLEJ do `docs/subiekt-gt-struktura.md`, sekcja „Ceny na kartotece",
   RAZEM Z DATĄ — tak samo jak wynik audytu kolizji. Bez zapisu za rok ktoś
   to „poprawi", nie wiedząc, że ktokolwiek cokolwiek sprawdzał.
   ────────────────────────────────────────────────────────────────────────── */

PRINT '=== A. Tabele, które w nazwie mają cenę albo cennik ===';
/* Szukamy po NAZWIE, bo nazwy tabeli nie znamy — to jest cały sens sondy.
   Spodziewamy się jednej tabeli wiążącej kartotekę z poziomami cen i jednego
   słownika samych poziomów. Gdy wyjdzie więcej, decyduje kolumna z `tw_Id`
   (sekcja B) — to ta, w której siedzą ceny konkretnych towarów. */
SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME LIKE '%Cen%' OR TABLE_NAME LIKE '%cennik%'
ORDER BY TABLE_NAME;

PRINT '';
PRINT '=== B. Kolumny tych tabel — typy i dopuszczalność NULL ===';
/* Typ jest tu ważniejszy, niż wygląda. Ceny w Subiekcie są dziesiętne, a my
   trzymamy u siebie GROSZE jako liczby całkowite (tak samo jak kwoty
   z Allegro). Bez znajomości skali przeliczenie byłoby zgadywaniem, a błąd
   o rząd wielkości w cenie podanej klientowi jest droższy niż brak ceny. */
SELECT c.TABLE_NAME, c.ORDINAL_POSITION, c.COLUMN_NAME, c.DATA_TYPE,
       c.NUMERIC_PRECISION, c.NUMERIC_SCALE, c.CHARACTER_MAXIMUM_LENGTH,
       c.IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME IN (
  SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_NAME LIKE '%Cen%' OR TABLE_NAME LIKE '%cennik%')
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;

PRINT '';
PRINT '=== C. Która z nich wiąże się z kartoteką (ma kolumnę po tw_Id) ===';
/* Bez tego nie wiadomo, po czym JOIN-ować. Nazwa kolumny wiążącej bywa inna
   niż `tw_Id` — pytamy o wszystkie, które wyglądają na identyfikator towaru. */
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%Tow%' AND (
  TABLE_NAME LIKE '%Cen%' OR TABLE_NAME LIKE '%cennik%')
ORDER BY TABLE_NAME, COLUMN_NAME;

PRINT '';
PRINT '=== D. ILE POZIOMÓW CEN ta firma naprawdę używa ===';
/* Właściciel wybrał „wszystkie poziomy cen" na ekranie. To pytanie mówi,
   ile ich będzie: jeśli firma używa dwóch z dziesięciu możliwych, kolumna
   pokaże dwa wiersze, a nie osiem pustych.

   Podmień NAZWA_TABELI_CENNIKA i NAZWA_KOLUMNY_POZIOMU na to, co wyszło
   w sekcjach A-C. Zapytanie zostaje zakomentowane, bo bez tych nazw jest
   nieuruchamialne, a sonda ma chodzić w całości albo wcale.               */
-- SELECT NAZWA_KOLUMNY_POZIOMU AS poziom, COUNT(*) AS kartotek,
--        MIN(NAZWA_KOLUMNY_CENY) AS min_cena, MAX(NAZWA_KOLUMNY_CENY) AS max_cena
-- FROM NAZWA_TABELI_CENNIKA
-- GROUP BY NAZWA_KOLUMNY_POZIOMU
-- ORDER BY poziom;

PRINT '';
PRINT '=== E. Czy poziomy mają NAZWY, czy same numery ===';
/* Kolumna z ośmioma wierszami „poziom 1..8" jest bezużyteczna — agent musi
   wiedzieć, który to cennik detaliczny, a który hurtowy. Jeśli słownik nazw
   istnieje, nazwy jadą na ekran; jeśli nie, właściciel nazywa poziomy raz,
   w konfiguracji, a nie każdy agent w głowie. */
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%Nazwa%' AND (
  TABLE_NAME LIKE '%Cen%' OR TABLE_NAME LIKE '%cennik%')
ORDER BY TABLE_NAME, COLUMN_NAME;

PRINT '';
PRINT '=== F. Netto czy brutto — czy w tabeli stoją OBIE kwoty ===';
/* Decyduje o tym, czy przeliczamy po stronie WERTIS-a (wtedy potrzebujemy
   stawki VAT z kartoteki i mamy własny błąd zaokrąglenia), czy bierzemy obie
   gotowe z Subiekta. Drugie jest zawsze lepsze: cena podana klientowi ma się
   zgadzać z tą na fakturze co do grosza. */
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE (COLUMN_NAME LIKE '%Netto%' OR COLUMN_NAME LIKE '%Brutto%'
   OR COLUMN_NAME LIKE '%Vat%') AND (
  TABLE_NAME LIKE '%Cen%' OR TABLE_NAME LIKE '%cennik%')
ORDER BY TABLE_NAME, COLUMN_NAME;
