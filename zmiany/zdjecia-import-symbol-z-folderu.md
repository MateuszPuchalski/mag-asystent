---
rodzaj: patch
tytul: import zdjęć rozpoznaje symbol z folderu i nazwy z dopiskiem
---

**Import zdjęć rozpoznaje więcej nazw.** Plik `W08-0501-miniaturka.jpg`,
`W08-0501-1.jpg` albo `W08-0501 (2).png` trafia do towaru `W08-0501`.
Plik `miniaturka.jpg` w folderze `W08-0501` też. Pełna nazwa pliku ma
pierwszeństwo, a o tym, która wersja jest symbolem, rozstrzyga Subiekt.
Z kilku zdjęć jednego towaru import bierze najpierw zdjęcie główne oferty
(`min`, `miniaturka`), a nie największą aranżację.
