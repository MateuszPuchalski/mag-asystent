# Fragmenty zmian

Każdy PR, który ma trafić do magazynu, dokłada tu jeden plik `<nazwa>.md`.
Numer wydania, wpis w `CHANGELOG.md` i tag robi po scaleniu `wydanie.yml`
(`DEPLOY.md` §0c). PR nie zmienia ani wersji w `package.json`, ani
`CHANGELOG.md` — bramka `Fragmenty zmian` w checku `Serwer` go zatrzyma.

Nazwa pliku jest dowolna, byle inna niż w cudzych PR-ach. Najprościej nazwać
go jak gałąź, np. `zmiany/kosze-kolejnosc.md`.

```markdown
---
rodzaj: minor
tytul: rozłożone kosze w kolejności rozłożenia
---

**Kosze w kolejności rozłożenia.** Treść wpisu dokładnie tak, jak ma stanąć
w CHANGELOG.md — bez nagłówka `##`, ten dopisze automat z numerem i datą.

**[wymaga działania]** Tylko gdy wdrożenie potrzebuje czegoś poza
aktualizacją. Ta pozycja zatrzymuje aktualizację automatyczną serwera.
```

- **`rodzaj`**: `minor` dla widocznej funkcji albo działania przy wdrożeniu,
  `patch` dla reszty. Wydanie z kilku fragmentów bierze najwyższy rodzaj.
- **`tytul`**: staje w tytule commita wydania, po numerze i myślniku.
- **Numer w komentarzach i dokumentach:** zamiast numeru pisz `@wydanie`.
  Automat zamieni znacznik na numer w całym repozytorium.

PR z samym CI albo dokumentacją fragmentu nie potrzebuje. Nie dostaje wtedy
wydania, a jego zmiana wejdzie z najbliższym wydaniem.
