---
rodzaj: minor
tytul: przepływ automatyzacji dla każdej kategorii pytania (tryb cienia)
---

**Rozmowa pokazuje, co automat zrobiłby sam.** Karta „Automat by…" mówi,
czy automat wysłałby szkic bez zmian, zlecił hali sprawdzenie albo oznaczył
sprawę jako pilną. „Zleć" i „Oznacz" robią to od razu, „Nie" zapisuje sprzeciw.
Nic nie wychodzi do klienta bez agenta.

**Zgodność automatu z biurem w pomiarze Copilota.** Za zębatką stoi tabela
zgodności osobno dla każdej kategorii pytania. Po niej właściciel zdecyduje,
które kategorie automat obsłuży sam.

Każda z piętnastu kategorii rozpoznania ma przepływ zapisany w kodzie
(`services/przeplyw-kategorii.ts`). Propozycje zapisują się w nowej tabeli
`propozycja_przeplywu` i nie kosztują wywołań modelu. Projekt: §14.6e
`docs/panel-obslugi-klienta.md`.
