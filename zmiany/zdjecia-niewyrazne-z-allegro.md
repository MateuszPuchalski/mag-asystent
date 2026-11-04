---
rodzaj: minor
tytul: niewyraźne zdjęcia kartotek zastąpione zdjęciami z Allegro
---

**Niewyraźne zdjęcia zastąpisz zdjęciem z naszej oferty Allegro.** W zakładce
„Zdjęcia” przycisk „Popraw niewyraźne” mierzy rozmiar i ostrość zdjęć
w Subiekcie, gdy towar ma ofertę ze zdjęciem. Najgorsze stoją na górze, obok
zdjęcia z oferty. Zamiana robi nowe zdjęcie główne, a stare zostaje w Subiekcie
jako dodatkowe.

**[wymaga działania]** Zamiana przestawia flagę zdjęcia głównego, więc konto
`wertis` potrzebuje prawa `UPDATE` na kolumnie `zd_Glowne`. Na bazie Subiekta:
`GRANT UPDATE ON dbo.tw_ZdjecieTw (zd_Glowne) TO wertis;`. Bez niego zamiana
skończy się błędem uprawnień, a zwykłe dodawanie zdjęć działa dalej.
