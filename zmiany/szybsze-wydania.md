---
rodzaj: minor
tytul: serwer aktualizuje się sam w nocy, numer wydania nadaje automat
---

**Serwer aktualizuje się sam.** Przycisk z 0.492.0 zrobił jedną
aktualizację tanią, ale ktoś wciąż musiał kliknąć, a wydań jest
kilkadziesiąt dziennie. Automat klika sam, przez to samo zadanie
Harmonogramu i z tym samym wycofaniem przy porażce (DEPLOY §0b).

- **Produkcja w nocy, dev od razu.** Produkcja wgrywa w oknie 3–5 wydanie
  starsze niż 6 godzin, po dziesięciu minutach bez zapisu. Dev dostaje każde
  wydanie od razu i może być kanarkiem (`AKTUALIZACJA_KANAREK`).
- **Czego automat nie wgra:** wydania z pozycją „[wymaga działania]", wersji,
  która już raz się nie udała, i wydania oznaczonego na GitHubie jako
  pre-release. Karta „Aktualizacja serwera" mówi jednym zdaniem, co zrobi
  i dlaczego jeszcze nie.
- **Cztery nowe klucze** zmieniane z karty konfiguracji: `AKTUALIZACJA_AUTO`,
  `AKTUALIZACJA_OKNO`, `AKTUALIZACJA_DOJRZALOSC_H`, `AKTUALIZACJA_KANAREK`.

**Numer wydania nadaje automat po scaleniu.** Każdy PR zmieniał dotąd te
same cztery miejsca: dwa `package.json`, lockfile i szczyt tego pliku. Dwa
otwarte PR-y konfliktowały więc zawsze, a numery zderzały się mimo
`co_w_toku.sh`. Teraz PR dokłada `zmiany/<nazwa>.md`, a `wydanie.yml` podbija
wersję, składa wpis i taguje (DEPLOY §0c). To wydanie jest pierwszym tak
ponumerowanym.

**[wymaga działania w ustawieniach repozytorium]** Załóż klucz wdrożeniowy
i sekret `WYDANIE_KLUCZ`, potem zaimportuj ponownie `.github/rulesets/main.json`
(DEPLOY §0c). Bez tego scalenie PR-a z fragmentem kończy się czerwonym
„Wydanie" i nie dostaje numeru.
