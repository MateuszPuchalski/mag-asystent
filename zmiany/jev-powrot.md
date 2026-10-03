---
rodzaj: minor
tytul: rozpoznawanie wiadomości klientów przez Jeva, gdy stoi klucz TypeSafe
---

Rozpoznawanie wiadomości klientów (kategoria, następny krok, flagi) może znów
robić Jev z TypeSafe. Włącza go sam klucz `TYPESAFE_API_KEY` w `wertis.env`.
Bez klucza nic się nie zmienia i rozpoznaje Claude. Szkice odpowiedzi,
dopytanie i reklamacje zawsze pisze Claude, bo Jev nie generuje tekstu.
Dlatego `COPILOT_MODE=anthropic` i `ANTHROPIC_API_KEY` są potrzebne także
z kluczem Jeva.

Wersja jest prostsza niż wycofana w 0.552.4. Nie ma przełącznika
`KLASYFIKATOR_DOSTAWCA` ani `JEV_MODEL`, więc stan „Jev bez klucza”, w którym
serwer przestawał rozpoznawać wiadomości, nie może już wystąpić. Model
`jev-1.13.0` jest przypięty w kodzie. Granice kategorii stoją w jednym
miejscu, wspólnym dla instrukcji Claude i pytań Jeva. Kontekst sklepu idzie
raz w `state`, a nie w każdym z dwudziestu pytań.

Jak włączyć: dopisz klucz z console.typesafe.ai/keys i zrestartuj
`wertis-api`. Kliknij „Rozpoznaj” na jednej rozmowie i sprawdź w księdze
wywołań, że wpis ma model `jev-1.13.0` i niezerowe tokeny. Dopiero wtedy
zostaw takt. Powrót do Claude: usuń klucz i zrestartuj usługę.

Przed włączeniem przeczytaj Data Processing Agreement na typesafe.ai/legal.
Zamaskowana treść wątków trafia wtedy do drugiego podmiotu. Trafność po
polsku nie jest jeszcze zmierzona, a progi pewności to nastawy startowe.
