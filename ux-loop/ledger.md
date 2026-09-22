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


### 2 — copy — zgoda przy werdykcie nazywa werdykt

**Cel:** T3. **Deficyt:** zapobieganie błędom (waga 0.25, ocena 6).

**Hipoteza:** nazwanie wybranego werdyktu w zdaniu zgody zbije E na T3 z 2 na 1,
bo pomyłka w liście przestanie być niewidoczna na całej ścieżce wysyłki.

**Co było nie tak.** Zdanie brzmiało „Rozumiem: werdykt jest nieodwracalny
i razem z wiadomością trafia do kupującego". To jest prawda przy KAŻDEJ
z jedenastu wartości listy, więc pasowało tak samo do uznania z pełnym zwrotem
pieniędzy, jak i do odmowy — a potwierdzało niby konkretną decyzję. Nazwa
wybranego werdyktu stała wyżej, w zwiniętym `select`. Agent, który pomylił
pozycję, nie miał ani jednego miejsca, gdzie pomyłka byłaby widoczna.

**Zmiana:** `panel/src/reklamacje/Werdykt.tsx` — zdanie zgody brzmi teraz
„Wysyłam **<nazwa werdyktu>** [na **<kwota>**] — nieodwracalnie, razem
z wiadomością do kupującego". Nazwa i kwota idą ze stanu formularza, więc
zmiana listy przepisuje zdanie natychmiast. Kwota wchodzi wyłącznie przy
częściowym zwrocie i dopiero gdy jest prawidłowa.

**Pomiar całej baterii:**

| zad. | C | S | R | E przed | E po | zmiana |
|---|---|---|---|---|---|---|
| T1 | 6 `+1 txt` | 3 | 0 | 0 | 0 | — |
| T2 | 13 `+2 txt` | 3 | 2 | 2 | 2 | — |
| T3 | 11 `+1 txt` | 3 | 1 | **2** | **1** | **cel trafiony** |
| T5 | 4 | 2 | 0 | 0 | 0 | — |
| T6 | 5 | 3 | 1 | 1 | 1 | — |
| T7 | — | — | 1 | 1 | 1 | — |
| T8 | 2 `+1 txt` | 1 | 0 | 0 | 0 | — |

Zero ruchów dołożonych: zdanie zmieniło treść, nie liczbę kliknięć.
**Bramka regresji przechodzi.**

**Rubryka:** zapobieganie błędom 6 → 7, treść komunikatów 8 → 9 (komunikat
mówi teraz, co się stanie, a nie tylko że będzie nieodwracalne). Reszta bez
zmian.

**Wynik ważony:** 0.30·5 + 0.25·7 + 0.15·7 + 0.10·7 + 0.10·6 + 0.10·9 = **6.50**
(z 6.15, czyli **+0.35**).

**Werdykt: ACCEPT.**

**Co zostaje na T3, i dlaczego nie w tej iteracji.** Zaznaczona zgoda NIE
zeruje się przy zmianie listy — zdanie się przepisuje, ale ptaszek zostaje.
To jest form behavior, czyli druga klasa, a iteracja zmienia jedną. Kandydat
na następną. Drugie E na T3 — brak przypomnienia przed terminem Allegro —
wymaga kolumny w bazie i stoi na liście „bez backendu".


### 3 — form behavior — zgoda traci ważność razem z decyzją

**Cel:** T3. **Deficyt:** zapobieganie błędom (waga 0.25, ocena 7).

**Hipoteza:** zdjęcie zgody przy zmianie werdyktu albo kwoty domknie E na T3
z 1 na 0, bo zniknie stan, w którym przycisk jest żywy pod decyzją, której
nikt nie potwierdził.

**Co zostawiła iteracja 2.** Zdanie zgody nazywa werdykt i przepisuje się
natychmiast — ale ptaszek zostawał zaznaczony. Agent, który potwierdził
„Uznana — naprawa" i zmienił listę na „Uznana — wymiana", miał żywy przycisk
pod decyzją, której nigdy nie potwierdził. Zdanie nad przyciskiem mówiło już
co innego niż to, na co kliknął.

**Zmiana:** `panel/src/reklamacje/Werdykt.tsx` — `onChange` listy i pola kwoty
woła `setZgoda(false)`. Pisanie WIADOMOŚCI zgody nie zdejmuje: treść to nie
decyzja, a odklikiwanie ptaszka po każdej literówce nauczyłoby agenta klikać
go bez czytania.

**Pomiar całej baterii:**

| zad. | C | S | R | E przed | E po | zmiana |
|---|---|---|---|---|---|---|
| T1 | 6 `+1 txt` | 3 | 0 | 0 | 0 | — |
| T2 | 13 `+2 txt` | 3 | 2 | 2 | 2 | — |
| T3 | 11 `+1 txt` | 3 | 1 | **1** | **1** | **cel NIEtrafiony** |
| T5 | 4 | 2 | 0 | 0 | 0 | — |
| T6 | 5 | 3 | 1 | 1 | 1 | — |
| T7 | — | — | 1 | 1 | 1 | — |
| T8 | 2 `+1 txt` | 1 | 0 | 0 | 0 | — |

**Hipoteza się NIE potwierdziła i liczba to pokazuje.** Zakładałem E z 1 na 0,
wyszło 1. Pomyliłem dwie rzeczy: iteracja 2 zamknęła drogę „pomyliłem pozycję
w liście", a to, co zostaje na T3, to brak przypomnienia przed terminem
Allegro — i tego żadna zmiana w panelu nie zdejmie, bo wymaga kolumny w bazie.
Domknięcie zgody jest poprawne, ale zamyka dziurę WĘŻSZĄ niż policzone E.

C i S bez zmian: przestawiona została kolejność kroków, nie ich liczba.
**Bramka regresji przechodzi.**

**Rubryka:** zapobieganie błędom 7 → 7 (E nigdzie nie spadło), spójność
7 → 8 (zgoda zachowuje się teraz jak każda inna bramka: unieważnia ją zmiana
tego, czego dotyczy). Reszta bez zmian.

**Wynik ważony:** 0.30·5 + 0.25·7 + 0.15·7 + 0.10·8 + 0.10·6 + 0.10·9 =
**6.60** (z 6.50, czyli **+0.10**).

**Werdykt: ACCEPT** — zmiana jest poprawna i nic nie psuje — **ale to pierwszy
sygnał plateau.** Przyrost 0.10 przy progu 0.20. Drugi taki pod rząd kończy
pętlę zgodnie z fazą 2 briefu.

**Blizna metody.** Istniejący test bramkowania klikał zgodę PRZED wpisaniem
kwoty i przez to padł. Miał rację, że padł: potwierdzał liczbę, której nie było
jeszcze na ekranie. Przestawiona została kolejność kroków w teście, nie jego
asercje — powód dopisany w komentarzu przy nim.


### 4 — search — wiersz mówi, na czym trafiło szukanie

**Cel:** T7. **Deficyt:** zapobieganie błędom (waga 0.25, ocena 7) — i jedyne
E, które blokuje PASS, bo T8 jest już na zerze.

**Poprawka pomiaru, zanim hipoteza.** Faza 0 zapisała, że login stoi „tylko
w nagłówku, wyżej". Nagłówek rozmowy ma `shrink-0`, więc login widać nad
edytorem przez cały czas pisania. Tamto zdanie sugerowało zagrożenie, którego
nie ma; prawdziwe leży przy WYBORZE wiersza. Poprawione w `baseline.md`.

**Hipoteza:** nazwanie powodu trafienia w wierszu kolejki zbije E na T7 z 1
na 0, bo zniknie wiersz, który wygląda jak trafienie po kliencie, a jest
trafieniem w cudzą wiadomość.

**Co było nie tak.** Sito szuka po loginie, treści i prowadzącym — i tak ma
zostać, bo do sprawy wraca się też po zdaniu, którego się nie pamięta inaczej.
Wiersz nie mówił jednak, którą gałęzią trafił. Wpisane „Kowalski" pokazywało
obok siebie rozmowę Kowalskiego i rozmowę Zielińskiej, w której ktoś napisał
„sąsiad Kowalski polecił". Login jest w wierszu od zawsze, ale jako jeden
z dziewięciu drobnych znaczników POD treścią, a treść wzrok czyta pierwszy.

**Zmiana:** `panel/src/skrzynka/Kolejka.tsx` — znacznik „trafienie w treści,
nie w loginie" albo „trafienie po prowadzącym", przy loginie, wyłącznie tam,
gdzie login frazy nie zawiera. Na trafieniu po loginie milczy: znak zapalany
przy każdym wierszu przestaje być znakiem.

**Pomiar całej baterii:**

| zad. | C | S | R | E przed | E po | zmiana |
|---|---|---|---|---|---|---|
| T1 | 6 `+1 txt` | 3 | 0 | 0 | 0 | — |
| T2 | 13 `+2 txt` | 3 | 2 | 2 | 2 | — |
| T3 | 11 `+1 txt` | 3 | 1 | 1 | 1 | — |
| T5 | 4 | 2 | 0 | 0 | 0 | — |
| T6 | 5 | 3 | 1 | 1 | 1 | — |
| T7 | — | — | 1 | **1** | **0** | **cel trafiony** |
| T8 | 2 `+1 txt` | 1 | 0 | 0 | 0 | — |

Zero ruchów dołożonych — znacznik jest odczytem, nie kliknięciem.
**Bramka regresji przechodzi.**

**Rubryka:** zapobieganie błędom 7 → 8 (E na T7 wyzerowane, zostaje po jednym
na T2, T3 i T6). Reszta bez zmian.

**Wynik ważony:** 0.30·5 + 0.25·8 + 0.15·7 + 0.10·8 + 0.10·6 + 0.10·9 =
**6.85** (z 6.60, czyli **+0.25**).

**Werdykt: ACCEPT.** Plateau NIE nastąpiło: 0.10, potem 0.25, więc drugiego
przyrostu poniżej 0.20 pod rząd nie ma.

**PASS dalej nieosiągnięty.** E jest teraz zerowe na T7 i T8, ale wynik ważony
to 6.85 przy progu 8.0, a efektywność zadań stoi na 5. Ona jest odtąd jedynym
sensownym celem: T2 kosztuje 13 ruchów i 2 pola z pamięci.
