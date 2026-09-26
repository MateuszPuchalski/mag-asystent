---
rodzaj: minor
tytul: szukanie w sieci prościej i metodą SZPERACZA; pewność źródeł, zatwierdzanie potwierdzonych i sieć w dopytaniu Copilota
---

**Szukanie w sieci na górze Kolejki, jednym przyciskiem.** Wiedza → Kolejka
zaczyna się od karty „Szukanie w sieci” z jednym przyciskiem „Szukaj
w sieci”. Szuka przez godzinę i da się go zatrzymać w każdej chwili.
Ręczne szukanie ma własny limit: 60 kartotek na godzinę, osobno od nocy.
Nie trzeba już podnosić `PASOWANIE_Z_SIECI_NA_NOC`, żeby godzina szła
godzinę. Propozycje stają niżej, w tej samej Kolejce.

**Pewność źródeł i „Zatwierdź wszystkie potwierdzone”.** Każda propozycja
z sieci ma znak: potwierdzone, prawdopodobne albo słabe. Potwierdzone to
dwa niezależne źródła, w tym katalog producenta albo baza części. Ta sama
para z drugiej strony dopisuje się jako drugi dowód. Potwierdzone
zatwierdza jeden przycisk nad Kolejką, a reszta czeka na przegląd.

**Metoda SZPERACZA w automacie.** Automat nie czyta OLX ani Ceneo. Numery
MTD 7xx i 9xx oraz numer z przyrostkiem „S” uznaje za tę samą część.
Zdanie w rodzaju „will not fit manual gearbox” trafia do warunków
propozycji. Model dostaje listę katalogów marek i szuka marek europejskich
także po niemiecku. Wykaz Briggs & Stratton rozpoznaje też po oznaczeniu
MODEL-TYPE.

**Copilot szuka w sieci przy dopytaniu.** Gdy baza nie rozstrzyga
pytania, model czyta strony spoza Allegro, OLX i Ceneo. Twierdzenie ze
strony ma źródło „ze strony w sieci” i najwyżej pewność „prawdopodobne”.
Pasowanie ze strony, która potwierdza nasz numer, stoi pod odpowiedzią
z przyciskiem „Zapisz jako propozycję”. Działa przy `PASOWANIE_Z_SIECI=1`.

**Importy nad listą.** W zakładce „Z opisów i ofert” zwinięta sekcja
importów stoi na górze, nad listą tekstów.

**Błąd szukania mówi, co się stało.** „Ostatnio sprawdzone” pokazuje też
silniki z listy, a przy błędzie rozwija się samo. Pod wynikiem stoi treść
ostatniego błędu. Ślad odrzucenia w księdze niesie zdanie dostawcy, nie
tylko kod 400.
