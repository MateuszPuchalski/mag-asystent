---
rodzaj: patch
tytul: księga Copilota zapisuje wersję instrukcji, źródło szkicu i kod odrzucenia
---

Każde wywołanie Copilota zapisuje w księdze, z której wersji instrukcji
powstało, skąd przyszło (kliknięcie, takt, po rozpoznaniu, poranek, dopytanie)
i dlaczego zostało odrzucone, jako kod. Do tego liczba rund narzędzi, liczba
twierdzeń, w tym obniżonych przez serwer, i kategoria rozmowy. Zmiana treści
instrukcji szkicu albo dopytania bez nowej wersji zatrzymuje CI.

Model `claude-haiku-5-5`, jeśli stoi w `COPILOT_MODEL` albo
`COPILOT_MODEL_KLASYFIKACJA`, dostaje teraz zamówiony wysiłek: `low`
przy klasyfikacji, `medium` przy szkicu i dopytaniu. Dotąd chodził na
domyślnym, bo kod brał go za Haiku 4.5, które wysiłku nie przyjmuje.
