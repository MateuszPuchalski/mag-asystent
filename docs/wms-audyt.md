# WMS — audyt pracy wózkowej i plan weryfikacji

Stan początkowy: `63b6e75`, wersja 0.286.0. Praca nadal wyłącznie na danych seeded.
Właściciel potwierdził własny kod każdej skrzynki oraz stałe pozycje na wózku.

## Najważniejsze braki

| Obszar | Stan początkowy | Wymagane zachowanie |
|---|---|---|
| Przydział | Ręczny wybór maksymalnie 12 zamówień | Skan wózka 20/30 pozycji przydziela gotowe zamówienia automatycznie |
| Identyfikacja | Nazwa jednorazowej trasy i kod pojemnika | Osobne tożsamości wózka, stałej pozycji, skrzynki i zamówienia |
| Kolejność | Alfabetyczna lokalizacja | Konfigurowalna kolejność przejścia; wspólny przystanek lokalizacja/SKU |
| Odkładanie | Powtarzany pełny formularz | Widoczny numer pozycji, ilość całego przystanku i skan właściwej skrzynki |
| Przekazanie | Koniec zbiórki bez ewidencji stanowiska | Jawny skan stanowiska i zachowanie odpowiedzialności za każdą skrzynkę |
| Wyjątki | Ogólne wstrzymanie | Brak, uszkodzenie i pełna skrzynka z opisanym dalszym działaniem |
| Uzupełnienie | Ręczne przesunięcie z raportu zapasu | Kolejka potrzeb z zaplecza, skan źródła, towaru i celu |
| Nadzór | Raport zamówień i pobrań | Wypełnienie wózków, czas trasy, przystanki, skrzynki i zaległe wyjątki |

## Kryteria odbioru

1. Wózki 20 i 30 pozycji mają trwały kod oraz jednoznaczne mapowanie skrzynek.
2. Skan przydziela jedno zamówienie na skrzynkę według priorytetu i terminu.
3. Braki, blokady i zajęte skrzynki nie powodują częściowego lub podwójnego przydziału.
4. Ponowienie oraz równoległy skan tego samego wózka nie tworzą drugiej trasy.
5. Przydział nie pomija dostępnych zamówień za grupą zamówień z brakami.
6. Ekran wskazuje pozycję i kod skrzynki oraz sumę potrzebnego SKU w danej lokalizacji.
7. Błędny kod, nadmiar i nieaktualna wersja nie zmieniają stanów.
8. Przerwana sesja wraca do tej samej trasy i zachowuje potwierdzone operacje.
9. Przekazanie do pakowania, wymiana skrzynki i zwolnienie wózka zachowują historię zamówienia.
10. Wyjątek pozwala kontynuować pozostałe pozycje bez wysłania niepełnego zamówienia.
11. Uzupełnienia oraz wyjaśnienie rozbieżności mają kontrolę ról, skanów i konkurencyjnych zapisów.
12. Analityka rozróżnia wykorzystanie pozycji i czas przebiegu od czasu pracy człowieka.
13. Usługi, API, migracja, przeglądarka i próba skali obejmują rzeczywiste wózki 20/30 pozycji.
14. Pozostają zachowane logo WERTIS, wygląd zgodny z obsługą i ergonomia skanowania na telefonie.

## Punkty odniesienia

Nie istnieje jeden certyfikat „światowego standardu” obejmujący każdy rodzaj magazynu.
Porównujemy konkretne praktyki realizacji części, bez deklarowania certyfikacji.

- [Microsoft: system-directed cluster picking](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/system-directed-cluster-pick): automatyczny przydział, pozycje i potwierdzenie odłożenia.
- [Oracle: Pick Cart](https://docs.oracle.com/en/cloud/saas/warehouse-management/26c/owmol/pick-cart.html): kolejność lokalizacji, sumy SKU, skrzynki i przekazanie do strefy docelowej.
- [Microsoft: Cluster position full](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/cluster-position-full): obsługa pojemnika, który nie mieści całego zamówienia.

## Wyniki lokalnego odbioru

Przeprowadzono 2176 testów serwera i 727 testów panelu obsługi; wszystkie przeszły.
Przeszły kontrole TypeScript, kompilacja oraz strażnice dokumentacji, stylu, ergonomii i importów Kotlin.
Test przeglądarki obejmuje pełne wózki 20 i 30 pozycji oraz zgłoszenie braku, przeliczenie i uzupełnienie.
Przy 390 × 844 potwierdzenie pobrania mieści się na pierwszym ekranie.

Test dwóch procesów potwierdza pojedynczy przydział dla równoległych skanów jednego wózka.
Osobny test potwierdza brak podwójnej rezerwacji ostatniej sztuki przez dwa różne wózki.
Symulowana awaria po pierwszym przydziale wycofuje zapas, zamówienia, trasę i klucz ponowienia.
Aktualizacja kopii wcześniejszego demo zachowała 1500 zamówień i 5000 wierszy zapasu; kontrola ewidencji przeszła.

Próba HTTP obejmuje 5000 SKU, 2000 zamówień, osiem równoległych klientów i oba rozmiary wózków.
Zakończono 84 trasy i 2000 wysyłek w 67,15 sekundy, wykonując 12258 żądań.
Percentyl 95 wyniósł 63,01 ms dla żądań oraz 332,93 ms dla skanu przydzielającego wózek.
Końcowa kontrola zapasu i dziennika ruchów przeszła.
To przepustowość aplikacji na tej maszynie, bez emulacji czasu chodzenia i pracy rąk.
Liczba pozycji i współwystępowanie SKU są syntetycznymi założeniami; test nie odtwarza rzeczywistych tras hali.

Powtórzenie: `npm run test:wms`, `npm run test:wms:e2e -- --built`, `npm run test:wms:cart-capacity`.
Wyniki oraz zrzuty trafiają do ignorowanego katalogu `.wms-artifacts`.
Eksport pakowania przeanalizowano wyłącznie lokalnie; nie zasilił bazy ani repozytorium danymi zamówień.

## Pozostałe granice wdrożenia

Rzeczywiste kanały sprzedaży, etykiety przewoźników, sprzęt i dokumenty ERP pozostają poza bieżącym zakresem seeded.
Nie przyjmujemy fikcyjnych wymiarów części jako gwarancji, że fizyczny produkt mieści się w skrzynce.
Przed produkcją potrzebne będą dane gabarytów, rzeczywiste czasy przejść i pomiary na stanowiskach.
Dotychczasowe kopie bazy, kontrola ewidencji, role i dziennik ruchów pozostają bramkami każdej zmiany.
