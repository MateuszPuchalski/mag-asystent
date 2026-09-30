---
rodzaj: patch
tytul: anonimizacja kopii — raport skanera mówi, skąd wzięła się każda igła
---

**Anonimizacja kopii bazy: raport skanera pokazuje pochodzenie trafień.** Na
prawdziwej bazie skaner zatrzymywał pracę na tysiącach trafień w kolumnach,
które mają zostać, i lista miejsc nie mówiła, skąd wzięła się szukana wartość.
Raport podaje teraz dla każdego miejsca źródło igieł: kolumnę albo ścieżkę
kluczy JSON, kształt wartości i liczbę trafień. Wartości nie wychodzą z
narzędzia. Znaczniki czasu i identyfikatory UUID przestają być igłami, bo
nie identyfikują człowieka.
