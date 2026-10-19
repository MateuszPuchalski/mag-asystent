---
rodzaj: patch
tytul: Copilot czyta pełne zdjęcia z telefonu klienta
---

Copilot czyta już zdjęcia zrobione aparatem telefonu, a nie tylko zrzuty
ekranu. Próg na jedno zdjęcie wynosił 3,5 MB, a zwykłe zdjęcie z telefonu
waży 3–6 MB. Takie zdjęcie odpadało, a szkic pisał, że nie udało się go
pobrać. Próg wynosi teraz 7 MB, pod limitem dostawcy modelu: 10 MB po
zakodowaniu. Plik ponad próg liczy się jako pominięty, nie jako błąd pobrania.
