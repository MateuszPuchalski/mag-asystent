---
rodzaj: minor
tytul: klasyfikację wiadomości klientów robi Jev
---

Rozpoznawanie wiadomości klientów (kategoria, następny krok, flagi) przechodzi z Claude na Jeva z TypeSafe. Robi to nowy nadawca `adapters/copilot.jev.ts`, który wpina się tą samą drogą co dotychczasowy, więc walidacja i polityka z `klasyfikacja-polityka.ts` zostają bez zmian. Wybór dostawcy stoi w `KLASYFIKATOR_DOSTAWCA` (`jev` albo `anthropic`), więc powrót do Claude to jedna zmienna, bez wydania. Szkice odpowiedzi, dopytanie i reklamacje zostają przy Claude, bo Jev nie generuje tekstu.

**[wymaga działania]** Dopisz w `wertis.env` klucz `TYPESAFE_API_KEY` z konsoli TypeSafe. Bez niego takt rozpoznawania się nie uruchomi (jedno ostrzeżenie w logu), a ręczne rozpoznanie w panelu odpowie błędem klucza. Przed włączeniem przeczytaj Data Processing Agreement i politykę prywatności na typesafe.ai: treść wątków, zamaskowana tak jak przy Claude, trafia do drugiego podmiotu.
