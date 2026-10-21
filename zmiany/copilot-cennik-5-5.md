---
rodzaj: patch
tytul: cennik Copilota zna modele 5.5 i ich stawkę odczytu cache
---

Koszt Copilota na ekranie pomiaru i w raporcie tygodnia liczy się poprawnie
dla `claude-opus-5-5`, `claude-sonnet-5-5` i `claude-haiku-5-5`. Dotąd te
modele szły po stawce najdroższego znanego modelu. Odczyt z cache ma teraz
stawkę per model, bo Opus 5.5 i Sonnet 5.5 czytają cache za 0,05 ceny
wejścia, a nie 0,1.
