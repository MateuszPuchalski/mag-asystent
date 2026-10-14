---
rodzaj: patch
tytul: wypłata trafia do właściwego zwrotu, gdy zamówienie ma kilka zwrotów
---

Przy zamówieniu z kilkoma zwrotami klienta wypłata z Allegro nie zdejmowała z kolejki żadnego z nich. Teraz aplikacja przypisuje wypłatę po pozycjach: zwrot jest rozliczony, gdy zwrot płatności wymienia wszystkie jego pozycje, a inny zwrot tego zamówienia nie dzieli z nim pozycji. Zwrot całego zamówienia (anulowanie przez kupującego, nieodebrana paczka) rozlicza wszystkie jego zwroty.

Gdy dopasowania nie da się zrobić pewnie, zwrot zostaje w kolejce, a „Sprawdź w Allegro” mówi dlaczego: dwa zwroty tej samej pozycji, pozycji nie da się przypiąć do zamówienia albo wypłata nie wymienia pozycji zwrotu. Dla takich zwrotów zostaje ręczne zamknięcie.

Starsza droga przez operacje płatnicze nie rozlicza już zwrotów przy zamówieniach z kilkoma zwrotami: pierwsza wypłata zdejmowała wtedy z kolejki także drugi, niezapłacony zwrot.

Zwroty już sprawdzone wymagają jednego kliknięcia „Sprawdź wszystkie w Allegro”.
