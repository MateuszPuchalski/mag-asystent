---
rodzaj: patch
tytul: anonimizacja kopii — zamówienia bez fałszywych alarmów i kolumny unikalne
---

**Anonimizacja kopii bazy: poprawki po drugim przeglądzie.** Skaner wycieków
nie uznaje już nazwy oferty ani sposobu dostawy z zamówienia za dane osobowe,
więc kopia prawdziwej bazy nie kończy się fałszywym alarmem. Kolumny z
unikalnym indeksem, także na wyrażeniu jak `lower(nazwa)`, dostają zamienniki
jeden do jednego. Narzędzie odmawia od razu, gdy nie może zapisać pliku
wynikowego, i nie kasuje cudzego pliku roboczego.
