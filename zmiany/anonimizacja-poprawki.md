---
rodzaj: patch
tytul: anonimizacja kopii bazy po przeglądzie, poprawki wycieków
---

Przegląd narzędzia `tools/anonimizuj-baze.mjs` znalazł luki w jego głównej własności. Identyfikator kupującego z surowego JSON-a Allegro przeżywał rozsyp, a wynik nieprzeskanowany mógł zostać pod docelową nazwą. Poprawki: klucze osobowe w JSON-ie są zawsze rozsypywane, wynik dostaje docelową nazwę dopiero po skanie, a plik roboczy leży w katalogu tymczasowym. Narzędzie jedzie teraz w paczce wydania, a skaner nie myli się z przypadkową zbieżnością numerów telefonu i pracuje kilka razy szybciej na dużej bazie.
