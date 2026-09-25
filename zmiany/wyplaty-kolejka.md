---
rodzaj: patch
tytul: sprawdzanie wypłat dochodzi do każdego zwrotu
---

**Sprawdzanie wypłat dochodzi do każdego zwrotu.** Wyszło przy zwrocie
6016/2026: pieniądze oddane w Allegro 23 września, a panel dalej pokazywał
„do zwrotu".

Aplikacja pyta Allegro o wypłaty setkę zwrotów na przebieg, dotąd zawsze
najstarszych i bez pamięci, kogo już pytała. Gdy zwrotów bez rozliczenia jest
więcej, czoło listy zajmują te, które rozliczenia nie dostaną nigdy, a nowsze
nie doczekają się pytania. Teraz kolejka się kręci: najpierw zwroty jeszcze
niepytane, potem te, o które pytaliśmy najdawniej.
