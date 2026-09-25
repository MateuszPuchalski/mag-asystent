---
rodzaj: patch
tytul: aktualizacja z paczki zatrzymuje też usługi dołożone ręcznie
---

**Aktualizacja z paczki nie pada już na „Odmowa dostępu do ścieżki C:\wertis".**
Pierwsza taka aktualizacja na magazynie wróciła na starą wersję w kroku
zamiany katalogów. Instalator zatrzymywał tylko trzy usługi ze stałej listy.
Usługa `wertis-tlo` zakłada się ręcznie, a jej program leży w
`C:\wertis\tlo-worker`, więc trzymała katalog.

- Przed zamianą instalator zatrzymuje każdą DZIAŁAJĄCĄ usługę, której program
  leży w katalogu aplikacji. Sprawdza ścieżkę usługi i plik aplikacji NSSM.
  Po zamianie, porażce albo wycofaniu uruchamia ten sam zestaw.
- Potem czeka do 15 sekund, aż procesy z katalogu się zamkną. Pozostałe
  zatrzymuje z nazwą w dzienniku.
- Dotyczy przycisku w panelu, automatu i `-Aktualizuj -Paczka`.
