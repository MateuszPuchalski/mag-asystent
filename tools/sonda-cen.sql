/* ─────────────────────────────────────────────────────────────────────────────
   WERTIS · sonda cen z kartoteki Subiekta GT

   PO CO TO ISTNIEJE. Zgłoszenie właściciela: „nie widzę cen z Subiekta przy
   towarach". I nie widzi, bo ich tam nigdy nie było — `sgt_towar` nie ma
   kolumny ceny, importer ich nie pobiera, a login `wertis` nie ma nawet
   `GRANT SELECT` na tabelę cennikową.

   Dołożenie ich wymagało DWÓCH rzeczy, których nie da się wziąć z kodu:
     1. nazw tabeli i kolumn cennika w TEJ wersji bazy — ODPOWIEDZIANE,
     2. ile poziomów cen ta firma naprawdę używa — pyta o to sekcja D.

   Nasz zweryfikowany wyciąg ze struktury InsERT
   (`docs/subiekt-gt-struktura.md`) opisuje `tw__Towar`, `tw_Stan`, dokumenty
   i kontrahentów — cennika NIE opisuje. Wpisanie nazw z pamięci to dokładnie
   ta klasa błędu, która przy Allegro kosztowała trzy wydania, więc tutaj
   pytamy bazę, zamiast zgadywać.

   JAK URUCHOMIĆ (login read-only wystarczy — to same odczyty ze słowników
   systemowych plus jedna próbka danych):

       sqlcmd -S localhost -d Subiekt_GT -U wertis -P '...' \
              -i tools/sonda-cen.sql -s ';' -W > sonda-cen.txt

   Sekcje A-C i E-F czytają same słowniki systemowe i chodzą na każdym loginie.
   Sekcje D i D2 sięgają do DANYCH, więc wymagają `GRANT SELECT ON dbo.tw_Cena`
   i `dbo.vwPoziomyCen` (`docs/subiekt-gt-edu-setup.md` §2). Błąd uprawnień
   tam to ODPOWIEDŹ, nie awaria: znaczy, że grantu jeszcze nie nadano.

   URUCHOMIONA 19 WRZEŚNIA 2026 przez właściciela; wynik sekcji A-C, F stoi
   w `docs/subiekt-gt-struktura.md`, sekcja „Ceny na kartotece". Plik ZOSTAJE
   w repo, bo baza się zmienia, a ponowne sprawdzenie ma być jedną komendą,
   nie godziną pisania zapytań od nowa.

   WYNIK WKLEJ do `docs/subiekt-gt-struktura.md`, RAZEM Z DATĄ — tak samo jak
   wynik audytu kolizji. Bez zapisu za rok ktoś to „poprawi", nie wiedząc, że
   ktokolwiek cokolwiek sprawdzał.
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
/* URUCHAMIALNE OD 19 WRZEŚNIA 2026. Do tej daty stało tu zakomentowane
   zapytanie z zaślepkami zamiast nazw — bo nazw nie znaliśmy i o to szła cała
   sonda. Sekcje A-C odpowiedziały: `tw_Cena`, poziomy jako KOLUMNY
   `tc_CenaNetto0..10`, nazwy w widoku `vwPoziomyCen`.

   Poziomy są kolumnami, więc `GROUP BY` nie ma po czym grupować — liczymy
   wypełnienia kolumna po kolumnie. Wiersz z zerem kartotek to poziom, którego
   ta firma nie prowadzi; import go nie wpuszcza (`rozwinCeny`).            */
SELECT 0 AS poziom, COUNT(tc_CenaNetto0) AS kartotek,
       MIN(tc_CenaBrutto0) AS min_brutto, MAX(tc_CenaBrutto0) AS max_brutto FROM tw_Cena
UNION ALL SELECT 1, COUNT(tc_CenaNetto1), MIN(tc_CenaBrutto1), MAX(tc_CenaBrutto1) FROM tw_Cena
UNION ALL SELECT 2, COUNT(tc_CenaNetto2), MIN(tc_CenaBrutto2), MAX(tc_CenaBrutto2) FROM tw_Cena
UNION ALL SELECT 3, COUNT(tc_CenaNetto3), MIN(tc_CenaBrutto3), MAX(tc_CenaBrutto3) FROM tw_Cena
UNION ALL SELECT 4, COUNT(tc_CenaNetto4), MIN(tc_CenaBrutto4), MAX(tc_CenaBrutto4) FROM tw_Cena
UNION ALL SELECT 5, COUNT(tc_CenaNetto5), MIN(tc_CenaBrutto5), MAX(tc_CenaBrutto5) FROM tw_Cena
UNION ALL SELECT 6, COUNT(tc_CenaNetto6), MIN(tc_CenaBrutto6), MAX(tc_CenaBrutto6) FROM tw_Cena
UNION ALL SELECT 7, COUNT(tc_CenaNetto7), MIN(tc_CenaBrutto7), MAX(tc_CenaBrutto7) FROM tw_Cena
UNION ALL SELECT 8, COUNT(tc_CenaNetto8), MIN(tc_CenaBrutto8), MAX(tc_CenaBrutto8) FROM tw_Cena
UNION ALL SELECT 9, COUNT(tc_CenaNetto9), MIN(tc_CenaBrutto9), MAX(tc_CenaBrutto9) FROM tw_Cena
UNION ALL SELECT 10, COUNT(tc_CenaNetto10), MIN(tc_CenaBrutto10), MAX(tc_CenaBrutto10) FROM tw_Cena
ORDER BY poziom;

PRINT '';
PRINT '=== D2. Jak te poziomy się nazywają ===';
/* Bez nazw kolumna „poziom 1..11" jest bezużyteczna: agent musi wiedzieć,
   który to cennik detaliczny, a który hurtowy. Import czyta ten sam widok. */
SELECT IDENT AS poziom, NAZWA FROM vwPoziomyCen ORDER BY IDENT;

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
