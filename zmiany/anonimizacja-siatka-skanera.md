---
rodzaj: patch
tytul: anonimizacja kopii — skaner łapie nazwy pod adresem i użytkownikiem
---

**Anonimizacja kopii bazy: szczelniejsza siatka skanera.** Nazwa osoby stojąca
w surowym JSON-ie pod adresem dostawy, użytkownikiem, firmą albo kontaktem
trafia teraz do skanu, więc kopia tej samej nazwy w kolumnie, która zostaje,
zatrzyma narzędzie. Plik roboczy `.czesciowy` jest usuwany tylko wtedy, gdy
powstał w tym przebiegu, i nie nadpisuje cudzego.
