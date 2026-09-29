---
rodzaj: minor
tytul: klasyfikację wiadomości klientów robi Jev
---

Rozpoznawanie wiadomości klientów (kategoria, następny krok, flagi) przechodzi z Claude na Jeva z TypeSafe. Robi to nowy nadawca `adapters/copilot.jev.ts`, który wpina się tą samą drogą co dotychczasowy, więc walidacja i polityka z `klasyfikacja-polityka.ts` zostają bez zmian. Wybór dostawcy stoi w `KLASYFIKATOR_DOSTAWCA` (`jev` albo `anthropic`), więc powrót do Claude to jedna zmienna i restart, bez wydania. Szkice odpowiedzi, dopytanie i reklamacje zostają przy Claude, bo Jev nie generuje tekstu.

Kod Jeva nie zetknął się jeszcze z żywym API TypeSafe: kształt żądania i odpowiedzi pochodzi z ich dokumentacji, a testy idą na atrapie. Trafność po polsku też nie jest zmierzona. Dokumentacja TypeSafe wskazuje angielski jako język o najlepszej trafności, a progi pewności w kodzie to nastawy startowe.

**[wymaga działania]** Dopisz w `wertis.env` klucz `TYPESAFE_API_KEY` z konsoli TypeSafe. Bez niego takt rozpoznawania i poranny przebieg przed pracą się nie uruchomią (jedno ostrzeżenie w logu), a ręczne rozpoznanie w panelu odpowie zdaniem o braku klucza. Klucz Claude nadal jest potrzebny do szkiców.

Po restarcie kliknij rozpoznanie na JEDNEJ rozmowie i sprawdź w księdze wywołań, że wpis ma model `jev-1.13.0` i niezerowe tokeny. Dopiero potem zostaw takt. Jeśli nie zgadza się kształt odpowiedzi, ustaw `KLASYFIKATOR_DOSTAWCA=anthropic`.

Przed włączeniem przeczytaj Data Processing Agreement i politykę prywatności na typesafe.ai/legal: treść wątków, zamaskowana tak jak przy Claude, trafia do drugiego podmiotu.
