/* ─────────────────────────────────────────────────────────────────────────────
   WERTIS · audyt kolizji kodów (plan §2)

   Klasyfikator skanów stoi na jednej hipotezie:
       ŻADEN symbol towaru ani kod kreskowy nie ma kształtu lokalizacji.
   Hipoteza jest prawdopodobna, ale niesprawdzona na ~3 600 kartotekach
   wprowadzanych ręcznie przez lata. Ten plik ją weryfikuje.

   Uruchom na PRODUKCYJNEJ bazie Subiekta, loginem READ-ONLY (`wertis`):

       sqlcmd -S localhost -d Subiekt_GT -U wertis -P '...' \
              -i tools/audyt-kolizji.sql -s ';' -W > audyt.txt

   Wynik wklej do docs/subiekt-gt-struktura.md (sekcja „Audyt kolizji kodów")
   RAZEM Z DATĄ. To jest założenie, na którym stoi klasyfikator — bez zapisu
   za rok ktoś je „poprawi", nie wiedząc, że coś sprawdzał.
   ────────────────────────────────────────────────────────────────────────── */

PRINT '=== A. Symbol o DOKŁADNYM kształcie lokalizacji — MUSI zwrócić 0 wierszy ===';
/* Kilka sztuk  → popraw symbole w SGT (taniej niż kod obronny na zawsze).
   Kilkadziesiąt → decyzja właściciela: prefiks `L` na etykietach regałów
                   przy najbliższym przedruku.                                */
SELECT tw_Symbol, tw_Nazwa
FROM tw__Towar
WHERE tw_Symbol LIKE '[A-Z][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND LEN(tw_Symbol) = 9
ORDER BY tw_Symbol;

PRINT '';
PRINT '=== A2. To samo dla miejsc paletowych (PAL-000) ===';
SELECT tw_Symbol, tw_Nazwa
FROM tw__Towar
WHERE tw_Symbol LIKE 'PAL-[0-9][0-9][0-9]'
  AND LEN(tw_Symbol) = 7
ORDER BY tw_Symbol;

PRINT '';
PRINT '=== B. Szerzej: dowolny symbol z co najmniej dwoma myślnikami ===';
/* Nie jest błędem sam w sobie — służy ocenie, jak blisko krawędzi jesteśmy. */
SELECT tw_Symbol, tw_Nazwa
FROM tw__Towar
WHERE LEN(tw_Symbol) - LEN(REPLACE(tw_Symbol, '-', '')) >= 2
ORDER BY tw_Symbol;

PRINT '';
PRINT '=== C. Rozkład liczby myślników w symbolach ===';
/* Sprawdza, czy `w32-0203` i `50-111` są reprezentatywne dla kartoteki. */
SELECT LEN(tw_Symbol) - LEN(REPLACE(tw_Symbol, '-', '')) AS myslniki,
       COUNT(*) AS ile
FROM tw__Towar
GROUP BY LEN(tw_Symbol) - LEN(REPLACE(tw_Symbol, '-', ''))
ORDER BY myslniki;

PRINT '';
PRINT '=== D. KODY KRESKOWE o kształcie lokalizacji ===';
/* Kody dostawców na kartonach części zamiennych bywają bogate w myślniki,
   a kod kreskowy skanuje się częściej niż symbol — więc kolizja tutaj jest
   groźniejsza. `tw_PodstawowyKodKreskowy` to kod główny na kartotece;
   kody dodatkowe leżą w `tw_KodyKreskowe` (osobna tabela, jeśli używana). */
SELECT tw_Symbol, tw_PodstawowyKodKreskowy
FROM tw__Towar
WHERE tw_PodstawowyKodKreskowy LIKE '[A-Z][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
   OR tw_PodstawowyKodKreskowy LIKE 'PAL-[0-9][0-9][0-9]';

PRINT '';
PRINT '=== E. Aktualny rozkład kodów lokalizacji w polu własnym ===';
/* [WERYFIKUJ] podmień tw_Pole1 na to pole, które w tej instalacji trzyma
   lokalizację (DEPLOY §6). Pokazuje, ile adresów NIE pasuje do wzorca —
   to znany dług danych (literówki typu C07A-06-01), nie błąd walidatora.  */
SELECT tw_Pole1 AS lokalizacja, COUNT(*) AS ile
FROM tw__Towar
WHERE ISNULL(tw_Pole1, '') <> ''
  AND tw_Pole1 NOT LIKE '[A-Z][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND tw_Pole1 NOT LIKE 'PAL-[0-9][0-9][0-9]'
GROUP BY tw_Pole1
ORDER BY ile DESC;
