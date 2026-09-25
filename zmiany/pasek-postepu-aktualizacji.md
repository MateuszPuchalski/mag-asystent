---
rodzaj: minor
tytul: pasek postępu aktualizacji serwera w panelu
---

**Karta „Aktualizacja serwera" pokazuje, na którym kroku jest aktualizacja.**
Do tej pory mówiła tylko „trwa", przez minutę albo trzy, bez znaku życia.

- Cztery kroki: pobieranie paczki, rozpakowanie obok działającej wersji,
  zamiana wersji z serwerem na chwilę wyłączonym, uruchomienie i sprawdzenie.
  Przy nieudanej wersji czwarty krok nazywa się „Wycofanie".
- Kroki zapisuje instalator do `server\data\aktualizacja\postep.json`, a serwer
  podaje je dalej. Procentów liczonych z zegara nie ma, bo pobieranie zależy
  od łącza. Obok kroku stoi czas trwania.
- W kroku zamiany serwer nie odpowiada. Karta zostaje przy ostatnim kroku
  i mówi, że to norma.
- Pasek widać przy aktualizacji Z tej wersji na następną. Bieżąca aktualizacja
  jeszcze go nie ma, bo kroki zapisuje instalator wersji, która już działa.
