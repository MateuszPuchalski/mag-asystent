# Zamknięcie pętli — faza 3

Cztery iteracje, wszystkie przyjęte. Zatrzymanie na warunku z fazy 2 briefu:
**następnej poprawy nie da się ocenić bez prawdziwych spraw albo prawdziwego
agenta.** Nie na wyczerpaniu limitu ośmiu iteracji i nie na plateau.

## 1. Wynik końcowy wobec wyjściowego

| zad. | C wyj. | C końc. | S wyj. | S końc. | E wyj. | E końc. |
|---|---|---|---|---|---|---|
| T1 statusy paczki po telefonie | — | 6 `+1 txt` | — | 3 | 1 | **0** |
| T2 model + zdjęcie → części | 13 `+2 txt` | 13 `+2 txt` | 3 | 3 | 2 | 2 |
| T3 spór Allegro | 11 `+1 txt` | 11 `+1 txt` | 3 | 3 | 2 | **1** |
| T5 przełączenie w pół odpowiedzi | 4 | 4 | 2 | 2 | 1 | **0** |
| T6 sprawy jednego klienta | 5 | 5 | 3 | 3 | 1 | 1 |
| T7 dwoje o jednym nazwisku | — | — | — | — | 1 | **0** |
| T8 literówka w numerze części | 2 `+1 txt` | 2 `+1 txt` | 1 | 1 | 0 | 0 |

**Suma E: 8 → 4.** T1 przeszło z niewykonalnego na wykonalne.
**C i S nie spadły nigdzie** i to jest uczciwy obraz: cztery iteracje poszły
w zapobieganie błędom, żadna nie skróciła drogi.

| rubryka | waga | wyj. | końc. |
|---|---|---|---|
| Efektywność zadań | 0.30 | 4 | 5 |
| Zapobieganie błędom | 0.25 | 5 | 8 |
| Skanowalność i hierarchia | 0.15 | 7 | 7 |
| Spójność i uczenie się | 0.10 | 6 | 8 |
| Klawiatura i dostępność | 0.10 | 6 | 6 |
| Treść komunikatów | 0.10 | 8 | 9 |

**Wynik ważony: 5.50 → 6.85.** PASS wymaga 8.0, więc **nie osiągnięty**.
Warunek poboczny PASS jest za to spełniony: **E=0 na T7 i na T8**.

Z tych 1.35 przyrostu **0.30 nie należy do pętli**: tyle dało samo skreślenie
T4 z baterii, czyli zmiana miarki. Pętla odpowiada za 1.05.

## 2. Przyjęte zmiany, według zmierzonego wpływu

1. **0.425.0 — wiersz mówi, na czym trafiło szukanie** (iteracja 4, klasa:
   search). E na T7 z 1 na 0, +0.25 wyniku. Najdroższa pomyłka tego ekranu
   przestała być cicha: wpisane nazwisko trafiało w treść cudzej wiadomości
   i wyglądało jak trafienie po kliencie.
2. **0.423.0 — szkic przeżywa przełączenie sprawy** (iteracja 1, klasa: form
   behavior). E na T5 z 1 na 0, +0.35 wyniku. Największy pojedynczy przyrost,
   bo podniósł także spójność: szkic zachowuje się odtąd tak samo w trzech
   kolejkach zamiast inaczej w skrzynce.
3. **0.424.0 — zgoda nazywa werdykt** (iteracja 2, klasa: copy). E na T3
   z 2 na 1, +0.35 wyniku.
4. **0.424.0 — zgoda traci ważność razem z decyzją** (iteracja 3, klasa: form
   behavior). E bez zmian, +0.10 wyniku. **Hipoteza się nie potwierdziła:**
   zakładałem E na 0, wyszło 1. Zmiana jest poprawna, ale zamyka dziurę węższą
   niż policzone E.

Poza pętlą, decyzją właściciela: **0.422.0 — zdjęcie blokady adresu dostawy**
odblokowało T1 w całości (E z 1 na 0).

## 3. Bez backendu się nie da

1. **Przypomnienie przed terminem Allegro (T3, zostaje E=1).** Odłożenie z datą
   (`snoozed`, `odlozone_do`) ma wyłącznie skrzynka. Reklamacje i dyskusje mają
   „Prowadzę / Odłóż sprawę", co zdejmuje prowadzącego, a nie ustawia daty.
   Potrzebna kolumna i trasa.
2. **Szkic trwalszy niż karta przeglądarki (T5).** Iteracja 1 dała szkic, który
   przeżywa przełączenie sprawy, wyjście na inną kolejkę i odświeżenie strony.
   Zamknięcia karty ani przesiadki na inny komputer nie przeżyje. Skrzynka ma
   na to kolumnę z wersją; te dwie kolejki nie.
3. **Scalenie dwóch adresów e-mail jednego klienta (T6, zostaje E=1).**
   Tożsamością jest login Allegro, a rozmowy z Gmaila loginu nie niosą
   i rozmówca bywa zamaskowany. Bez wiązania tożsamości ekran pokaże połowę.
4. **Założenie reklamacji z panelu.** `routes/reklamacje.ts` nie ma trasy
   tworzącej sprawę. Dotyczyło to skreślonego T4, ale zostaje faktem.
5. **Uczciwy współczynnik reklamacji.** Okno importu sprzedaży to 60 dni
   (`DOK_SPRZEDAZ_DNI_WSTECZ`), a reklamacje sięgają lat — mianownika nie ma.

## 4. Dlaczego pętla staje tutaj, a nie po ósmej iteracji

Jedyny deficyt, który został, to **efektywność zadań: 5**, a w niej **C=13
na T2**. Żeby to skrócić uczciwie, muszę wiedzieć rzeczy, których z kodu nie
wyczytam: ile z tych trzynastu ruchów to kliknięcia, a ile tabulator; jak
często dobór w ogóle jest wypełniany; czy agent zaczyna od modelu, czy od
zdjęcia. Każda dalsza iteracja bez tego byłaby zgadywaniem, a brief zabrania
twierdzeń o poprawie bez policzonej liczby.

**Dwie z moich własnych liczb okazały się w trakcie pętli błędne** i obie
poprawiłem w `baseline.md`, zamiast zostawić je jako sukces do odtrąbienia:

- **T7** — napisałem, że login stoi „tylko w nagłówku, wyżej". Nagłówek ma
  `shrink-0`, więc login widać przez cały czas pisania. Zagrożenie leżało
  gdzie indziej, przy wyborze wiersza, i tam poszła iteracja 4.
- **T2** — policzyłem R=2, twierdząc, że agent przepisuje model „z innej
  kolumny". Ekran ma trzy kolumny naraz, więc wiadomość jest na ekranie
  w chwili wypełniania formularza. R na T2 to **0**.

To jest najmocniejszy argument za zatrzymaniem: dwa z siedmiu zadań miałem
policzone źle, a znalazłem to dopiero czytając kod pod konkretną zmianę.
Trzeciego takiego błędu nie wykryję bez patrzenia komuś przez ramię.

## 5. Trzy pytania, na które odpowie tylko pół godziny przy agencie

1. **Czym agent naprawdę wybiera rozmowę z kolejki — loginem, treścią czy
   pozycją na liście?** Cała iteracja 4 stoi na założeniu, że zdarza się
   wybór po treści. Jeśli agent w praktyce wraca zawsze po loginie, ten
   znacznik jest kosztem uwagi bez zysku i należy go zdjąć.
2. **Ile z trzynastu ruchów T2 to mysz, a ile klawiatura — i czy dobór
   wypełnia się przy każdym pytaniu o część, czy przy co dziesiątym?**
   Od tego zależy, czy skracać formularz, czy raczej drogę do niego. Bez tego
   każda zmiana w doborze jest strzałem.
3. **Co agent robi DZIŚ, żeby nie przegapić terminu Allegro?** Panel nie ma
   przypomnienia, a sprawy jakoś nie przepadają — więc istnieje nawyk poza
   panelem: kartka, kalendarz, sortowanie po terminie rano. Ten nawyk mówi,
   czy potrzebne jest przypomnienie z datą, czy wystarczy kubełek „termin
   w tym tygodniu", który nie wymaga ani jednej kolumny w bazie.
