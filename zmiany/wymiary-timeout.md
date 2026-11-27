---
rodzaj: patch
tytul: lista „Do zmierzenia” mniej obciąża Subiekta
---

**Filtry w „Do zmierzenia” nie znikają.** Gdy lista się wczytuje albo nie
wczytała, rząd filtrów zostaje na ekranie i da się zmienić wybór. Po błędzie
ekran nie twierdzi już, że wszystko jest zmierzone. Kolektor czeka na tę listę
dłużej niż 10 sekund.

Lista „Do zmierzenia” kończyła się na kolektorze błędem po 30 sekundach. Przy
porządku po regałach, symbolu, nazwie i najnowszych serwer sumuje teraz stan
i sprzedaż tylko dla towarów ze strony. Licznik pilnych pyta o samą liczbę.
Identyczne żądania w trakcie wolnego odczytu czekają na jeden. Filtr „sprzedane 30 dni” działa jak
wcześniej, więc z nim lista może nadal przekraczać limit. Czasu na bazie
firmy nie zmierzono. Porządek po sprzedaży liczy to samo co wcześniej. Pomiar
robi `tools/pomiar-listy-wymiarow.sql`.
