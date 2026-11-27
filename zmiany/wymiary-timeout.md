---
rodzaj: patch
tytul: filtry „Do zmierzenia” nie znikają, a lista mniej obciąża Subiekta
---

**Filtry w „Do zmierzenia” nie znikają.** Gdy lista się wczytuje albo nie
wczytała, rząd filtrów zostaje na ekranie i da się zmienić wybór. Po błędzie
ekran nie twierdzi już, że wszystko jest zmierzone. Kolektor czeka na tę listę
dłużej niż 10 sekund.

Lista „Do zmierzenia” z filtrem „sprzedane 30 dni” kończyła się błędem po
30 sekundach. Serwer buduje teraz zbiór sprzedanych towarów i dołącza go do
listy, zamiast sprawdzać sprzedaż przy każdej kartotece. Czasu na bazie firmy
nie zmierzono. Licznik pilnych pyta o samą liczbę, a identyczne żądania
w trakcie wolnego odczytu czekają na jeden. Pomiar robi
`tools/pomiar-listy-wymiarow.sql`.
