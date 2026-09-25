---
rodzaj: minor
tytul: nocne pasowanie części z sieci poza Allegro
---

**Nocne pasowanie części z sieci, poza Allegro.** Nowy automat nocny (1–5)
bierze kartoteki z numerem OEM albo oryginalnym, które nie mają ani jednego
zastosowania, i szuka w sieci, do jakich maszyn i silników pasują. Znalezisko
staje w kolejce Wiedzy jako propozycja z cytatem i linkiem do strony. Nic nie
zatwierdza się samo.

Allegro jest wyłączone na trzy sposoby: automat nie wysyła do niego ani
jednego żądania, domeny Allegro są zablokowane w wyszukiwarce, a znalezisko
z takiej domeny serwer i tak odrzuca. Wyszukiwanie robią serwery Anthropic,
nie adres sklepu. Propozycja przechodzi tylko wtedy, gdy model przeczytał
stronę, cytat stoi na niej dosłownie, a strona zawiera nasz numer.

Domyślnie wyłączone: `PASOWANIE_Z_SIECI=1` w `wertis.env`, sufit
`PASOWANIE_Z_SIECI_NA_NOC` (domyślnie 10 kartotek). Automat można też
uruchomić od razu: Wiedza → „Z opisów i ofert” → karta „Pasowanie z sieci”
→ „Sprawdź teraz” (trzy kartoteki, po jednej, z przyciskiem „Zatrzymaj”).
Ręczny przebieg liczy się do tego samego sufitu co noc. Pomiar Copilota i raport
tygodnia doliczają teraz wyszukiwania, płatne po jednym cencie od sztuki.
