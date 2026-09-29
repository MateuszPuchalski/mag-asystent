# Dobór od zera — propozycja

Status: **propozycja do decyzji właściciela. Żadnego kodu w tym PR-ze.**
Powód: dobór jest dziś za złożony i niejasny dla agenta biura. Ten dokument
wyprowadza go z pytania, na które ma odpowiadać, a nie z tego, co już stoi.

Pewność ocen podaję jawnie: **wysoka** (przeczytałem kod i sprawdziłem),
**umiarkowana** (opieram się na opisie kodu, którego nie czytałem w całości),
**niska** (domysł). Danych o użyciu z produkcji nie mam. Dlatego dokument
kończy się listą liczb, które trzeba zdjąć przed cięciem.

## 1. Pytanie, na które dobór odpowiada

Klient Allegro pyta, czy część pasuje do jego maszyny. Agent biura ma dojść
do odpowiedzi, którą wolno wysłać, ze źródłem (`docs/panel-obslugi-klienta.md`,
§11 i §14.3). Takich odpowiedzi jest cztery:

1. **Ta część.** Wybrana kartoteka i zdanie ze źródłem.
2. **Nie mamy tego.** Uczciwa odpowiedź, nie porażka (§11.2).
3. **Trzeba dopytać.** Wiadomo, czego brakuje, i agent pyta klienta.
4. **Nie dotyczy.** Klient kupił już ten towar albo pyta o coś innego.

Reszta jest środkiem. Środki to dane maszyny i części, lista kandydatów oraz
dowody. Środkiem jest też wiedza, która rośnie z pracy. Środek nie może
zasłaniać celu. Dziś zasłania: agent widzi środki, a cztery odpowiedzi musi
sobie wydedukować.

## 2. Co jest dziś złożone

Zakładka doboru (`panel/src/skrzynka/Dobor.tsx`, 693 linie) pokazuje naraz:

- status z **dziewięciu** wartości, z czego osiem do ręcznego wyboru,
- osiem pól danych i wolne parametry,
- **dwie** osobne karty Copilota z własnym „przyjmij / odrzuć",
- pasek **jedenastu dróg**, trzy poziomy pewności i zwijanie słabych trafień,
- sekcję „Nie pasuje" i listę „Czego brakuje" z przyciskami,
- trzy przyciski przy wyborze,
- **trzy** wejścia do zapisania pasowania,
- przełącznik „zapisz do maszyny czy do silnika".

Pytanie agenta brzmi „czy mogę to napisać?". Ekran odpowiada na dwadzieścia
innych. Poprzednie uproszczenie schowało wersję, drogi i „ustawił" w dymki.
Liczby pojęć nie zmieniło.

## 3. Cztery ustalenia z rozbioru

### 3.1. Status jest księgowością, którą człowiek prowadzi za system

Pewność: **wysoka** co do kodu, **umiarkowana** co do skutków zmiany.

Cztery z dziewięciu statusów wynikają z faktów, które system już zna.
`not_started`, `searching` i `candidates_found` mówią tylko „są dane?" i „jest
wybór?". `requires_expert` i `rejected` nie mają żadnej logiki na serwerze.
Nic ich nie ustawia. `extracting_data` nie ma nadawcy od początku.

Stały status kosztuje. Automat, który wpisuje dane, podnosi `not_started` do
`searching`. Przy towarze znanym z zamówienia trzeba to potem cofać. Stąd
`bezStartu`, `cofnijStartAutomatu` i `uporzadkujStartyAutomatu` w
`server/src/services/dobor.ts` i `server/src/services/towar-znany.ts`. To
maszyneria, która sprząta po własnym zapisie.

Gdyby wynik był **wyliczany** z danych, wyboru i notatki, ta maszyneria nie
miałaby czego cofać. Ryzyko: trzy miejsca czytają status jako sygnał.
Kokpit (`panel/src/skrzynka/kokpit.ts`) i raport skuteczności robią to przez
`searching` i `candidates_found`. Historia klienta czyta `confirmed`.

### 3.2. Jedenaście dróg to trzy różne pytania

Pewność: **wysoka**.

`server/src/services/kandydaci.ts` traktuje wszystkie drogi jak jedną skalę
pewności. To trzy różne rzeczy:

| Grupa | Drogi | Co klient dał | Co system mówi |
|---|---|---|---|
| **Wskazane przez klienta** | symbol, EAN, OEM, oferta, zamiennik | numer albo ofertę | „To jest ta część, o którą pytasz" |
| **Pasuje — z bazy wiedzy** | zastosowanie, przez silnik, pasuje do części | maszynę albo swoją część | „Pasuje do X, bo: dowód" |
| **Podobne — do sprawdzenia** | pełny tekst, zgodne wymiary | tylko słowa albo wymiar | „Wygląda podobnie, to nie dowód" |

Pierwsza grupa **identyfikuje** kartotekę. Nie mówi nic o zgodności z maszyną.
Druga grupa jest jedyną, która **dowodzi** zgodności. Trzecia to pomoc w
szukaniu i decyzja właściciela mówi, że nie jest dowodem.

Konsekwencja w kodzie. W `dobor.ts` (linie 233–234) zatwierdzony dobór bez
podparcia w wiedzy daje zdanie „Do {maszyna} **pasuje** {symbol} — źródło:
{droga}". Dla drogi „pełny tekst" wychodzi: „pasuje … — źródło: trafienie po
treści — nie dowód". Kliknięcie „Zatwierdź" podnosi pewność zdania, które idzie
do klienta, z „prawdopodobnie" do „pasuje". §14.3 mówi odwrotnie: brak źródła
oznacza przypuszczenie. To jest **defekt**, niezależny od przebudowy (p. 6).

Ekran może pokazać trzy grupy zamiast jedenastu pigułek. Jedenaście dróg
zostaje w serwerze, bo raport skuteczności liczy po nich i ma na nich `CHECK`.

### 3.3. „Zatwierdź" zostało rytuałem po zniesieniu roli eksperta

Pewność: **umiarkowana**. To ocena celu, nie odczyt kodu.

Dwa kroki (wybór, potem zatwierdzenie) powstały dla dwóch osób: agenta i
eksperta. Właściciel zniósł rolę eksperta. „Robi to każdy z biura, także autor
propozycji" (`docs/panel-obslugi-klienta.md`, §7). Kandydata wybiera wyłącznie
człowiek, automat nigdy. Drugie kliknięcie tego samego człowieka niczego nie
zabezpiecza.

Co „Zatwierdź" robi naprawdę (`ustawStatusDoboru`, linie 485–541):

1. zapisuje status `confirmed`,
2. tworzy **jedną propozycję zastosowania** z dowodem „rozmowa" i pewnością
   „prawdopodobne", nigdy fakt,
3. sprawia, że maszyna wchodzi do historii klienta.

To jest **zapamiętanie na przyszłość**, nie zatwierdzenie odpowiedzi. Wybór
kandydata (`wybierzKandydata`) niczego do wiedzy nie zapisuje. Rozdział już
istnieje w kodzie. Ekran go tylko ukrywa pod jednym słowem.

### 3.4. Praca nad wiedzą leży w środku odpowiedzi klientowi

Pewność: **wysoka**.

Pasowanie z rozmowy, zabudowa silnika i wybór „maszyna czy silnik" to
utrzymanie bazy wiedzy. Agent odpowiadający klientowi nie potrzebuje ich, żeby
odpowiedzieć. Dziś leżą między kandydatami a wyborem, a karta pasowania Copilota
wymaga kliknięcia, zanim para trafi do kolejki, w której i tak rozstrzyga
biuro. Inne automaty wkładają propozycje do tej kolejki bez pośredniego
kliknięcia (pewność **umiarkowana**, do sprawdzenia w etapie 0).

## 4. Model docelowy

### 4.1. Pięć wyników zamiast dziewięciu statusów

Wynik widać na górze jednym słowem. Wyliczamy go z danych, nie prowadzimy ręcznie:

| Wynik | Kiedy | Dziś zapisany jako |
|---|---|---|
| **Otwarty** | brak wyboru i brak decyzji | `not_started`, `searching`, `candidates_found` bez wyboru |
| **Wybrano** | jest wybrana kartoteka | `candidates_found` z wyborem, `confirmed` |
| **Dopytać** | agent zapisał, czego brakuje | `missing_information` |
| **Nie mamy** | agent uznał, że nie ma | `rejected` |
| **Nie dotyczy** | towar znany z zamówienia albo inny temat | `not_applicable` |

W etapie 1 nic się nie zmienia w bazie. Ekran tylko **tłumaczy** stare wartości
na pięć wyników. `CHECK` zostaje, żeby nie przebudowywać tabeli.
Zasada: przestajemy pisać wartości, których nie czytamy.

### 4.2. Cztery czasowniki agenta

Każdy odpowiada jednemu z czterech wyników z p. 1:

1. **Wybierz** — wybór kandydata, potem zdanie ze źródłem.
2. **Wstaw do odpowiedzi** — zdanie z serwera trafia do szkicu.
3. **Dopytaj o…** — pole, co dopytać, i wstawienie pytania do szkicu.
4. **Nie mamy tego** — świadome „nie".

„Zapamiętaj dla następnych pytań" to piąta czynność, ale **inna**. Stoi w
zwiniętej sekcji i nie blokuje żadnego z czterech.

### 4.3. Układ ekranu

```
DOBÓR                                   Wynik: Wybrano  ▾
┌ Ustalone ────────────────────────────────── Popraw ┐
│ Maszyna  NAC LS 46-450 HS (2019) · silnik B&S 450E   │
│ Część    szarpak rozrusznika · OEM 532 19 93-77      │
└──────────────────────────────────────────────────────┘
Wskazane przez klienta
  [zdjęcie] Szarpak rozrusznika …   dostępne 28
            532199377 · po numerze OEM              [Wybierz]
Pasuje — z bazy wiedzy
  [zdjęcie] …                       dostępne 3
            potwierdzone zastosowanie do NAC LS…    [Wybierz]
Podobne — do sprawdzenia (2)  ▸  (zwinięte)
Nie pasuje: … (czerwony pasek, tylko gdy jest)
┌ Wybrano ─────────────────────────────────────────────┐
│ „Do NAC LS 46-450 pasuje … — źródło: …"              │
│ [Wstaw do odpowiedzi]  [Zleć pomiar]                 │
└──────────────────────────────────────────────────────┘
▸ Zapamiętaj dla następnych pytań   (zwinięte)
```

Zasady układu, z `docs/ergonomia-magazynu.md` (punkty 1, 2, 5, 6 i 10):

- Dane widać jako **dwa wiersze do sprawdzenia**, nie formularz. Od wpisu
  automatu Copilota dane wchodzą same, więc agent głównie **weryfikuje**.
- Każdy kandydat ma jedną linię powodu. Droga i źródło nie stoją osobno.
- Grupa „Podobne" jest zawsze zwinięta. Wybrany kandydat z tej grupy zostaje
  na wierzchu, jak dziś (§4.3).
- „Zapamiętaj" zbiera to, co dziś jest rozsiane: zapis zastosowania (do
  maszyny albo silnika), „Pasuje do…" i zabudowę silnika.

### 4.4. Co znika z ekranu

- Lista statusów. Zastępuje ją wynik z p. 4.1.
- Karta „Copilot rozpoznał w rozmowie". Dane wchodzą same. Gdy zapis się nie
  uda, ekran mówi to komunikatem konfliktu, jak przy ręcznym zapisie.
- Karta „Copilot rozpoznał pasowanie". Para idzie do kolejki wiedzy (decyzja D3).
- Pasek jedenastu dróg. Zostaje dymek przy kandydacie.
- Trzy wejścia do pasowania. Zostaje jedno, w „Zapamiętaj".

## 5. Co się nie zmienia

Te reguły właściciela obowiązują w każdym wariancie. Cytaty stoją w
`docs/panel-obslugi-klienta.md`.

- Automat **nigdy nie zatwierdza** doboru ani zastosowania.
- Roli eksperta nie ma. Decyduje każdy z biura.
- Zdanie do szkicu pisze **serwer**, ze źródłem i datą, bez nazwiska.
- Brak źródła oznacza przypuszczenie (§14.3).
- Dobór pyta o dane **wpisane przez agenta**, nigdy o treść wiadomości
  (blizna „szarpaka").
- Maszyna z kilkoma silnikami nie daje „potwierdzone".
- Wynik z pełnego tekstu i wymiarów nie jest dowodem.
- „Nie mamy tego" jest odpowiedzią. Numer bez kartoteki nie znika.
- Zapisu do Subiekta ten projekt nie dotyka, więc brama zgody nie wchodzi.

## 6. Defekty do naprawy niezależnie od przebudowy

| # | Defekt | Pewność | Skutek |
|---|---|---|---|
| B1 | `zapiszDane` nie cofa `confirmed` po zmianie marki, modelu, rocznika albo numeru | **wysoka** (odczyt `dobor.ts`, linie 399–441) | Zatwierdzenie i propozycja wiedzy zostają przy starej maszynie |
| B2 | Zdanie „pasuje" dla `confirmed` bez podparcia w wiedzy | **wysoka** (`dobor.ts`, linie 233–234) | Kliknięcie podnosi pewność zdania do klienta ponad dowód |
| B3 | Pasek „Przy okazji: do doboru wpisano…" może nie wymieniać pól | **niska** (nie uruchamiałem) | `propozycjaDoboru` zwraca pustą listę, gdy `daneOcena` jest ustawione, a automat ustawia je zawsze |
| B4 | Osierocony komentarz i stała `PO_IDENTYFIKATORZE` użyta przed definicją w `kandydaci.ts` | **umiarkowana** | Tylko czytelność |

B1 i B2 to poprawki serwera z testami. Każdą można wydać osobno.
B2 zmienia tekst, który widzi klient, więc ją opisuję jako `minor`.

## 7. Etapy

Każdy etap jest osobnym PR-em i osobnym wydaniem. Wydanie jedzie do magazynu
w godzinę po scaleniu, więc etapy muszą być małe i odwracalne.

| Etap | Zakres | Baza | Odwracalność |
|---|---|---|---|
| **0** | Pomiar (p. 9). Poprawki B1 i B2. Sprawdzić, jak inne automaty wkładają propozycje do kolejki wiedzy | bez migracji | pełna |
| **1** | Nowy ekran w `panel/`: wynik, „Ustalone", trzy grupy, „Zapamiętaj". Tłumaczy stare statusy | bez migracji | pełna |
| **2** | Usunięcie kart Copilota. Po decyzji D3 para idzie prosto do kolejki | bez migracji | pełna |
| **3** | Status wyliczany. Znika `bezStartu`, `cofnijStartAutomatu`, `uporzadkujStartyAutomatu` i część bramki doboru | `CHECK` zostaje | trudniejsza |

Etap 3 dotyka kokpitu, historii klienta i raportu skuteczności. Robię go
dopiero po dwóch tygodniach pracy na etapie 1. Wtedy widać, czy wyliczony wynik
wystarcza.

Testy-strażnicy, które etap 1 musi utrzymać: `ZeroZapisu`, `Kontrast`,
`Skala` i dostępność (axe). Otwarcie zakładki nie może niczego zapisywać.

## 8. Decyzje dla właściciela

Przy każdej podaję rekomendację. Bez odpowiedzi idę tą drogą.

**D1. Co zrobić z „Zatwierdź dobór".**
Opcje: (a) połączyć z wyborem, (b) zostawić, ale nazwać tym, czym jest, czyli
„Zapamiętaj dla następnych pytań", (c) tworzyć propozycję dopiero po wysłaniu
odpowiedzi.
Rekomendacja: **(b) teraz, (a) po pomiarze.** (b) nie wymaga serwera i nie
psuje historii klienta ani raportu. (c) wymaga powiązania wysłanej odpowiedzi z
wyborem. Nie wiem, czy to jest wykonalne (pewność **niska**).

**D2. Pięć wyników zamiast statusów.**
Rekomendacja: **tak.** Czy ktokolwiek w biurze używa „Do sprawdzenia"
(`requires_expert`)? Kod nic z nim nie robi. Widzę tylko kod, więc pytam.

**D3. Para z Copilota prosto do kolejki wiedzy.**
Dziś wymaga kliknięcia przed kolejką, w której i tak rozstrzyga biuro. To
zmiana doktryny „nic nie czeka na kliknięcie" o krok dalej. Precedens: kolejka
wiedzy z opisów od 0.331.0.
Rekomendacja: **tak**, z pozostawieniem „Odrzuć" w samej kolejce.

**D4. Zdanie dla klienta zależne od grupy.**
Grupa „Wskazane przez klienta" mówi „To jest część {symbol}, o którą pytasz".
Zgodność z maszyną wolno napisać tylko z grupy „Pasuje — z bazy wiedzy".
Rekomendacja: **tak.** To wyprowadza B2 do końca. Zmienia tekst dla klientów.

**D5. Ile mierzyć przed cięciem.**
Rekomendacja: **tydzień pomiaru, potem etap 1.** Bez liczb każda zmiana w
doborze jest strzałem. Tak samo ocenia to `ux-loop/summary.md`.

## 9. Liczby do zdjęcia przed etapem 1

Raport skuteczności doboru (Ustawienia) już je częściowo daje. Nikt ich nie
zapisał w repo. Potrzebuję:

1. Ile rozmów ma dobór **rozpoczęty** i ile miało pytanie o dobór.
2. Rozkład wyborów po drogach (`SkutecznoscDoboru.tsx`). Ile jest dróg z zerem?
3. Ile wyborów kończy się zatwierdzeniem i ile mija czasu.
4. Ile razy agent klika „Wpisz do danych" i „Zaproponuj pasowanie", a ile „Odrzuć".
5. Ile razy używa wyszukiwarki zamiast kandydatów.
6. Które statusy w ogóle występują w `naStole`.

Liczby 2, 4 i 5 rozstrzygają, czy trzy grupy i usunięcie kart są bezpieczne.
Jeśli droga „wymiar" albo „pełny tekst" nigdy nie dała wybranej części, jest to
argument za schowaniem jej jeszcze głębiej. Skreślenie z kodu to osobna
decyzja. Raport nazywa taką drogę „najcenniejszym ustaleniem".

## 10. Czego ten dokument nie wie

- Nie wiem, ile z trzynastu ruchów zadania T2 to mysz, a ile klawiatura
  (`ux-loop/summary.md`, §5). Dwie moje wcześniejsze liczby w tej pętli były
  błędne, więc nie ufam pomiarowi z samego kodu.
- Nie znam liczby doborów na produkcji ani udziału rozmów o dobór.
- Nie wiem, czy agent zaczyna od modelu maszyny, czy od zdjęcia.
- Makieta `docs/projekt-widokow/Dobor.dc.html` jest statyczna i zawiera zdanie
  „poziom pewności bierze się z najsłabszego dowodu", które projekt świadomie
  odrzucił. Nie służy jako źródło reguł.
