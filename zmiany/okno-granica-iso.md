---
rodzaj: patch
tytul: okna raportów liczą dokładnie tyle dni, ile mówią
---

**Okna raportów bez dodatkowej doby.** Analiza, metryki, ergonomia, cykl
zwrotów i analiza dostaw porównywały znaczniki z bazy z `datetime('now', …)`.
Znaczniki mają `T`, a `datetime()` daje spację, więc porównanie tekstowe
wpuszczało całą dobę graniczną. Okno „7 dni" liczyło do ośmiu, także
w raporcie wydajności per osoba. Rekoncyliacja miała ten sam błąd w drugą
stronę: zadanie w błędzie od 25 godzin czekało na raport kolejną dobę.

- Granica okna ma jedną definicję, `GRANICA_OKNA` w `raporty.ts`. Ten sam
  zapis stał już w `skutecznosc-doboru.ts` od 0.267.0.
- Liczby w Analizie mogą spaść o zdarzenia z doby granicznej. To poprawka,
  nie utrata danych.
