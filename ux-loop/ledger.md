# Dziennik pętli — jedna linia na iterację

Pomiar wyjściowy i zasady liczenia: `ux-loop/baseline.md`.
Wynik ważony liczony rubryką z briefu; PASS = ≥ 8.0 oraz E=0 na T7 i T8.

## Zdarzenia spoza pętli

Dwie rzeczy zmieniły wynik bez udziału Generatora i obie są tu zapisane, żeby
nie policzyć ich jako zasługi iteracji.

| kiedy | co | wpływ na wynik |
|---|---|---|
| przed iteracją 1 | **T4 skreślone z baterii** decyzją właściciela | 5.50 → 5.80 (efektywność 4 → 5), **bez zmiany w kodzie** |
| 0.422.0 | **blokada adresu dostawy zdjęta** decyzją właściciela | T1 z niewykonalnego na C=6, S=3, R=0, **E z 1 na 0** |

## Iteracje

### 1 — form behavior — szkic przeżywa zmianę sprawy

**Cel:** T5. **Deficyt:** zapobieganie błędom (waga 0.25, ocena 5).

**Hipoteza:** przypisanie treści odpowiedzi do NUMERU sprawy zamiast do pola
zbije E na T5 z 1 na 0, bo szkic przestanie ginąć przy czynności, którą agent
wykonuje z zupełnie innego powodu.

**Zmiana:** `panel/src/sprawy/useSzkicSprawy.ts` — jeden hook dla reklamacji
i dyskusji. Szkic w magazynie karty przeglądarki pod kluczem `kolejka:numer`,
z pamięcią ekranu jako źródłem prawdy w trakcie pisania. `setTresc("")`
zdjęte z `useEffect` na `[wybrana]`; kasowanie zostaje po UDANEJ wysyłce.

**Pomiar całej baterii** (T4 skreślone, T1 po 0.422.0):

| zad. | C | S | R | E przed | E po | zmiana |
|---|---|---|---|---|---|---|
| T1 | 6 `+1 txt` | 3 | 0 | 0 | 0 | — |
| T2 | 13 `+2 txt` | 3 | 2 | 2 | 2 | — |
| T3 | 11 `+1 txt` | 3 | 1 | 2 | 2 | — |
| T5 | 4 | 2 | 0 | **1** | **0** | **cel trafiony** |
| T6 | 5 | 3 | 1 | 1 | 1 | — |
| T7 | — | — | 1 | 1 | 1 | — |
| T8 | 2 `+1 txt` | 1 | 0 | 0 | 0 | — |

Żadne C, S ani E nie wzrosło nigdzie. **Bramka regresji przechodzi.**

**Rubryka:** zapobieganie błędom 5 → 6 (E na T5 wyzerowane, ale T7 i T3 dalej
po 1 i 2), spójność 6 → 7 (szkic zachowuje się tak samo w trzech kolejkach
zamiast inaczej w skrzynce). Reszta bez zmian.

**Wynik ważony:** 0.30·5 + 0.25·6 + 0.15·7 + 0.10·7 + 0.10·6 + 0.10·8 = **6.15**
(z 5.80, czyli **+0.35**).

**Werdykt: ACCEPT** — ale dopiero za drugim podejściem.

**Pierwsze podejście padło i padło słusznie.** Dwa testy ekranu reklamacji
zobaczyły treść podwojoną i potrojoną: `sessionStorage` żyje w jsdomie przez
cały plik, więc szkic z jednego testu witał następny w polu, a `userEvent.type`
dopisywał do niego. Naprawa poszła w `test/setup.ts` — każdy test zaczyna
świeżą kartą. Żadna asercja nie została zmieniona ani wyłączona; zmienił się
stan wejściowy, który i tak był przypadkowy.

To jest zarazem odpowiedź na pytanie, którego pomiar sam by nie zadał: szkic
trwalszy niż render widać dopiero wtedy, gdy coś zacznie go dziedziczyć.

**Czego ta zmiana NIE robi, i to jest jej granica.** Szkic siedzi w karcie
przeglądarki, nie na serwerze. Przeżywa przełączenie sprawy, wyjście na inną
kolejkę i odświeżenie strony; nie przeżywa zamknięcia karty ani przesiadki na
inny komputer. Skrzynka ma na to kolumnę i wersję, te dwie kolejki nie —
dołożenie jej to zmiana backendu, czyli rzecz spoza reguł tej pętli.
Wpisane na listę „bez backendu" w `baseline.md`.
