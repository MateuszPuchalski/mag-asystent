---
rodzaj: patch
tytul: aktualizacja ponawia zamianę katalogu i mówi, kto go trzyma
---

**Aktualizacja serwera nie poddaje się od razu, gdy coś trzyma katalog
aplikacji.** Zmiana nazwy `C:\wertis` kończyła się odmową dostępu, gdy jakaś
konsola albo program miał ten katalog otwarty. Instalator wracał na starą wersję
i mówił tylko, żeby zamknąć okna. Teraz ponawia zmianę nazwy przez około pół
minuty, bo chwilowe blokady same znikają. Gdy blokada trwa, podaje nazwę i numer
procesu, który trzyma katalog, razem z jego katalogiem roboczym.
