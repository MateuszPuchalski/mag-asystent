---
rodzaj: patch
tytul: anonimizacja kopii — skaner szuka tylko danych osobowych, nie nazw towarów i ról
---

**Anonimizacja kopii bazy: skaner nie bierze nazw towarów, ról i autorów
systemowych za dane osobowe.** Na prawdziwej bazie zatrzymywał pracę na
dziesiątkach tysięcy trafień. Szukał nazw części z doboru, nazw modeli maszyn,
ról „BUYER" i autorów „automat", a te słowa stoją też w kartotece i słownikach.
Z listy szukanych wartości znikają klucze `nazwa` i pokrewne, role i statusy,
autorzy systemowi oraz krótkie teksty, które nic nie identyfikują. Imiona,
nazwiska, loginy, adresy, telefony i pełne treści wiadomości zostają.
