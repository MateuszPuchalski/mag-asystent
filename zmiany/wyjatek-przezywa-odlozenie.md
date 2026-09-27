---
rodzaj: patch
tytul: wyjątek przy pozycji przeżywa odłożenie reszty sztuk
---

**Wyjątek przy pozycji przeżywa odłożenie reszty sztuk.** Po zgłoszeniu
wyjątku magazynier często odkłada resztę, bo uszkodzone sztuki też idą na
półkę. Odłożenie liczyło wtedy status z samej ilości i po cichu zdejmowało
z pozycji wyjątek. Skutki były trzy:

- Dostawa z otwartym zgłoszeniem zamykała się sama po ostatnim odłożeniu,
  wbrew regule „wyjątek czeka na ZAKOŃCZ” z 22 września.
- Licznik wyjątków w postępie dostawy spadał do zera.
- Przy braku ZAKOŃCZ zgłaszał ten sam brak drugi raz. Dostawca dostawał dwie
  reklamacje, a na serwis szło dwa razy tyle sztuk, ile brakowało.

Pozycja zostaje teraz wyjątkiem, a ilość i półka zapisują się jak zawsze.
Pomyłkę w ilości cofa się tak jak dotąd przy odwrotnej kolejności: najpierw
WYCOFAJ ZGŁOSZENIE, potem COFNIJ.

**ZMIEŃ PÓŁKĘ działa też przy wyjątku.** Kolektor chował ten przycisk razem
z COFNIJ, choć półka nie należy do zgłoszenia. Źle zeskanowaną półkę poprawia
się teraz od razu, bez wycofywania zgłoszenia ze zdjęciem.
