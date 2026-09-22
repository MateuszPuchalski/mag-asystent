# Faza 0 — pomiar wyjściowy (bez żadnej poprawki)

Wersja panelu: **0.421.0**, `main` @ `19c9cb03`. Data: 2026-09-22.
Ewaluator czytał WYŁĄCZNIE kod i testy `panel/` oraz `server/src/routes|services`.
Niczego w tej fazie nie zmieniono.

## 0.1 Stack (uzupełnienie `[FILL]` z briefu — odczytane z `panel/package.json`)

| co | czym |
|---|---|
| framework | React 19.2, Vite 8.2, TypeScript 5.9 |
| biblioteka komponentów | **żadna** — ręcznie pisane `panel/src/ui/` (`Przycisk`, `Karta`, `Pusto`, `FiltrSegmentowy`); Tailwind 3.4 |
| dane | TanStack Query 5.102 przez własny `api/klient.ts` → Fastify + `node:sqlite` |
| formularze | react-hook-form 7.87 + zod 4.5 (tylko `Zadania`, `Ustawienia`, `wiedza`) |
| routing | react-router-dom 7.18, 12 tras pod `/obsluga` |
| ikony | lucide-react 1.38 |
| testy | vitest 4.1 + testing-library (109 plików, 1066 testów); Playwright obecny, e2e nieuruchamiane w bramkach |
| co jest zaślepione | Subiekt przez `adapters/subiekt.seeded.ts`; Allegro przez zapis w SQLite, synchronizacja na żądanie |

## 0.2 Zasady liczenia (żeby liczby dało się sprawdzić)

- Start: agent zalogowany, panel otwarty na kolejce właściwej dla zgłoszenia.
- **C** = kliknięcia + naciśnięcia klawiszy nawigacyjnych. Pisanie treści
  odpowiedzi jest w każdym wariancie takie samo, więc nie wchodzi do C;
  zapisuję je osobno jako `+txt`. Wpisanie frazy do szukania to `+txt`, ale
  kliknięcie w pole szukania liczy się do C.
- **S** = odrębne ekrany / panele / okna modalne. Zakładka w kolumnie kontekstu
  liczy się jako ekran, bo zasłania poprzednią.
- **R** = pola, które agent musi pamiętać, bo nie widzi ich w chwili decyzji.
- **E** = odrębne drogi do ZŁEGO wyniku, przy których panel nie ostrzega.
- Zadanie niewykonalne w panelu dostaje `—` w C/S i opis, co go blokuje.
  Rubryka liczy je jako maksymalną stratę na efektywności.

## 0.3 Tabela wyników T1–T8

| zad. | C | S | R | E | stan |
|---|---|---|---|---|---|
| T1 statusy paczki po numerze telefonu | — | — | 1 | 1 | **niewykonalne w panelu** |
| T2 model kosiarki + zdjęcie → numery części | 13 `+2 txt` | 3 | 2 | 2 | wykonalne |
| T3 spór Allegro: rozstrzygnięcie + przypomnienie | 11 `+1 txt` | 3 | 1 | 2 | **częściowo** — przypomnienia nie ma |
| T4 rejestracja reklamacji sprzed 6 tygodni | — | — | — | 0 | **niewykonalne w panelu** |
| T5 przełączenie w pół odpowiedzi i powrót | 4 | 2 | 0 | 1 | wykonalne, **szkic ginie poza skrzynką** |
| T6 wszystkie sprawy jednego klienta | 5 | 3 | 1 | 1 | **częściowo** — tylko po loginie Allegro |
| T7 dwaj klienci o tym samym nazwisku | — | — | 1 | 1 | wykonalne, ale nierozstrzygalne |
| T8 numer części z jedną złą literą | 2 `+1 txt` | 1 | 0 | **0** | **wykonalne i zabezpieczone** |

### T1 — dowód, że jest niewykonalne
Numer telefonu **nie istnieje nigdzie w panelu ani w trasach serwera**
(`grep -rn "telefon\|phone" server/src/routes panel/src/api` → jedyne trafienie
to komentarz o zdjęciu z telefonu). To nie jest przeoczenie: `CLAUDE.md`
zapisuje regułę prywatności, która blokuje ulicę, miasto, kod i telefon
z `delivery.address`, z jednym wyjątkiem na samą NAZWĘ odbiorcy od 0.367.0.
Agent musi wyjść do Allegro albo Sellasista, zamienić telefon na login,
wrócić i szukać po loginie. Po powrocie: 6 ruchów, 3 ekrany, R=1
(login trzymany w głowie między systemami).

### T3 — czego brakuje
Termin Allegro jest na ekranie (`decyzjaDo`, `dniDoTerminu`, sortowanie
`termin`) i to działa. **Przypomnienia nie ma**: mechanizm odłożenia z datą
(`snoozed` + `odlozoneDo`) istnieje WYŁĄCZNIE w skrzynce
(`skrzynka/Status.tsx`). Reklamacje i dyskusje mają tylko „Prowadzę / Odłóż
sprawę", co zdejmuje prowadzącego, a nie ustawia daty.

### T4 — dowód, że jest niewykonalne
`server/src/routes/reklamacje.ts` nie ma ANI JEDNEJ trasy tworzącej sprawę.
Jedyne `POST` to `synchronizuj`, werdykt, notatka, załączniki, odświeżenie.
Reklamacja może powstać wyłącznie po stronie Allegro i wejść przez
synchronizację. Zamówienie sprzed 6 tygodni dodatkowo wypada z okna importu
sprzedaży (`DOK_SPRZEDAZ_DNI_WSTECZ`, domyślnie 60 dni — na granicy).
**Plus:** wymóg „żaden szkic AI" jest w tej kolejce spełniony — Copilot
importowany jest tylko w `ekrany/Skrzynka.tsx` i `ekrany/Ustawienia.tsx`,
w `reklamacje/` nie ma go wcale. E=0.

### T5 — asymetria szkiców
Skrzynka trzyma szkic NA SERWERZE z wersją (`rozmowa.data.szkic.body`,
`expectedVersion`) — przełączenie i powrót szkicu nie gubi.
Reklamacje i dyskusje trzymają treść w `useState`, a `useEffect` na `[wybrana]`
robi `setTresc("")` — **przełączenie sprawy kasuje napisaną odpowiedź bez
ostrzeżenia i bez cofnięcia**. To jest E=1 na T5 i najdroższa pojedyncza
usterka w tym pomiarze.

### T6 — tożsamość klienta
`services/klient-historia.ts` mówi wprost: „TOŻSAMOŚĆ KLIENTA TO LOGIN ALLEGRO
i nic więcej". Historia wiąże zakupy, zwroty, reklamacje i dyskusje po loginie;
rozmowy po `conversation`, bo „`conversation` loginu nie trzyma, a rozmówca
bywa zamaskowany (blizna 0.56.6)". **Dwa adresy e-mail jednego klienta są
w tym panelu dwoma klientami** i żaden ekran tego nie scala.

### T7 — dlaczego E=1 mimo że nic nie jest zepsute
Szukanie w kolejce skrzynki idzie po „login, treść, prowadzący"
(`skrzynka/Kolejka.tsx:276`), więc fraza trafia też w TREŚĆ cudzej rozmowy.
Na ścieżce wysyłki nie ma ani jednego miejsca, które powtarza „piszesz do X" —
`Edytor` pokazuje tylko licznik znaków i przycisk. Dwaj klienci o tym samym
nazwisku są rozróżnialni po loginie, ale **login nie stoi przy przycisku
wysyłki**, tylko w nagłówku, wyżej.

### T8 — jedyne zadanie bez usterki
`adapters/subiekt.seeded.ts::szukajZFurtka` próbuje najpierw dokładnie,
potem przybliżone, i zwraca flagę `przyblizone`. `wyszukiwarka.tsx:82` rysuje
z niej bursztynowe zdanie nad wynikami. Literówka NIE daje „nie znaleziono".
**E=0. Tego nie ruszamy.**

## 0.4 Rubryka

| kryterium | waga | ocena | dowód (jedno zdanie) |
|---|---|---|---|
| Efektywność zadań | 0.30 | **4** | Dwa z ośmiu zadań są w panelu niewykonalne, a trzecie (T3) kończy się bez przypomnienia. |
| Zapobieganie błędom | 0.25 | **5** | T8 wzorowe i T4 wolne od szkicu AI, ale szkic ginie przy przełączeniu sprawy, zgoda przy werdykcie nie nazywa wybranego rozstrzygnięcia, a nic nie broni przed odpowiedzią do złego klienta. |
| Skanowalność i hierarchia | 0.15 | **7** | Kolumna dowodów odpowiada na „kto / które zamówienie / co się stało / co dalej" bez przewijania, a `Spoiwo` daje ten sam blok w czterech kolejkach. |
| Spójność i uczenie się | 0.10 | **6** | Jeden `Spoiwo`, jeden `Edytor` na reklamacje i dyskusje, ale szkic zachowuje się inaczej w skrzynce niż w pozostałych trzech kolejkach, a odłożenie z datą istnieje tylko w jednej. |
| Klawiatura i dostępność | 0.10 | **6** | `j/k`, strzałki i cyfry przełączają wiersze i kubełki w trzech kolejkach, ale nie ma skrótu do pola odpowiedzi, do wysyłki ani przejścia między kolejkami; strażnik kontrastu pilnuje tylko trzech znanych par barw. |
| Treść komunikatów | 0.10 | **8** | Komunikaty mówią, czego szukano i co zrobić („Allegro zamknęło rozmowę w tej sprawie — nowej wiadomości nie przyjmie”); nigdzie nie ma „coś poszło nie tak”. |

**Wynik ważony: 0.30·4 + 0.25·5 + 0.15·7 + 0.10·6 + 0.10·6 + 0.10·8 = 5.50**

PASS wymaga ≥ 8.0 oraz E=0 na T7 i T8. **T8 już jest na zero. T7 nie.**

## 0.5 Najgroźniejsze znalezisko

**Szkic odpowiedzi w reklamacji i dyskusji ginie bez śladu przy przełączeniu
sprawy.** `ekrany/Reklamacje.tsx:311` — `setTresc("")` w `useEffect` na
`[wybrana]`. Komentarz obok broni tego przed innym zagrożeniem (kasowanie przy
odświeżeniu taktu) i przed nim broni skutecznie, ale scenariusz T5 jest
dokładnie tym, czego ta linia nie przewiduje. Agent pisze odpowiedź, wchodzi
sprawa pilniejsza, wraca — pole jest puste, a nigdzie nie ma cofnięcia.
Skrzynka ma na to gotowe rozwiązanie po stronie serwera; te trzy kolejki nie.

## 0.6 Rzeczy, których nie da się zrobić bez backendu

1. **T1** — szukanie po numerze telefonu. Wymaga zmiany reguły prywatności
   (decyzja właściciela), nie kodu panelu.
2. **T4** — założenie reklamacji z panelu. Brak trasy `POST`; reklamacje
   powstają wyłącznie u Allegro.
3. **T6** — scalenie dwóch adresów e-mail jednego klienta. Tożsamością jest
   login Allegro; rozmowy z Gmaila loginu nie niosą.
4. **T3** — trwałe przypomnienie przed terminem. Odłożenie z datą ma tylko
   skrzynka; dla reklamacji i dyskusji nie ma kolumny.

## 0.7 Zadania dwuznaczne (zgłoszone, nie rozstrzygnięte przeze mnie)

- **T3** miesza trzy kolejki tego panelu: „spór Allegro” to `dyskusje`
  (typ `DISPUTE`), „rozstrzygnięcie refund/exchange” to słownik werdyktu
  z `reklamacje`, a „co naprawdę wysłano” bywa w `zwroty`. Policzyłem
  odczytanie gorsze dla agenta: przejście przez dwie kolejki.
- **T1** nie mówi, czy telefon wolno zamienić na zamówienie poza panelem.
  Policzyłem gorzej: zamiana musi zajść w panelu, więc zadanie jest
  niewykonalne.

## 0.8 Czego Faza 0 świadomie NIE zrobiła

Niczego nie poprawiono. Żaden plik `panel/` ani `server/` nie został zmieniony
w tej fazie — jedyny nowy plik to ten dokument.
