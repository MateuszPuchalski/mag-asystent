---
rodzaj: patch
tytul: strażnicy granicy okna w ergonomii, dostawach, cyklu zwrotów i koszach
---

**Granica okna ma strażnika w każdym pliku.** Poprawka z 0.494.1 zmieniła
granicę okna na ISO w siedmiu plikach, ale test dostały tylko metryki
i rekoncyliacja. Ergonomia, analiza dostaw, cykl zwrotów i listy koszy
dostały teraz po jednym teście z wierszem z doby granicznej. Wiersz minutę
przed granicą ma zostać poza oknem, a wiersz minutę po niej — w oknie. Każdy
z czterech testów jest czerwony, gdy granica wraca do `datetime()`.

- Komentarz przy `GRANICA_OKNA` mówi znów, czego NIE używać. Zamiana
  w 0.494.1 wpisała tam nazwę samej stałej.
- Zachowanie serwera się nie zmienia.
