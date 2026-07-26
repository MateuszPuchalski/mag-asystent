# Architektura WERTIS

Dokument dla kogoś, kto ma ten system utrzymywać albo rozszerzać. Opisuje **jak
to jest zbudowane i dlaczego tak** — nie jak wdrożyć (to `DEPLOY.md`) ani jak
podpiąć Subiekta (to `docs/subiekt-gt-edu-setup.md`).

---

## 1. Po co to istnieje

Subiekt GT nie ma pojęcia lokalizacji półkowej. Wie, ile czegoś jest na
magazynie, ale nie wie, **gdzie to leży**. W magazynie o 342 m² z ~3600
kartotekami oznacza to, że znalezienie towaru jest zadaniem pamięciowym.

WERTIS dokłada Subiektowi tę jedną brakującą warstwę i **nic więcej**. To jest
najważniejsze zdanie w tym dokumencie, bo z niego wynikają wszystkie granice
opisane niżej.

### Co WERTIS zapisuje do Subiekta

Dokładnie dwie rzeczy, obie przez kolejkę i osobny proces:

| co | gdzie | kiedy |
|---|---|---|
| pole lokalizacji na kartotece | `tw__Towar.tw_Pole1` (konfigurowalne) | po skanie regału |
| flaga sprawdzenia faktury | `fl_Wartosc` (mechanizm flag InsERT-a) | przy zmianie stanu dostawy |

**Zero `INSERT` do tabel dokumentów. Zero modyfikacji stanów.** Aplikacja nie
tworzy dokumentów, nie zmienia ilości i nie rusza cen. Dokumenty MM
(`applyCreateMM`) mają kontrakt w `adapters/sfera.ts`, ale wykonuje je przyszły
worker COM na Windows — nie ten proces.

Wniosek praktyczny: **najgorsze, co WERTIS może zrobić Subiektowi, to wpisać zły
adres w polu tekstowym albo złą flagę na fakturze.** Obie rzeczy są odwracalne
jednym `UPDATE`. To była świadoma granica projektu, nie ograniczenie techniczne.

---

## 2. Rzut oka

```
┌─────────────────────┐
│ Kolektor (Android)  │  Kotlin + Compose, skan sprzętowy
│  :core  — logika    │  Zebra DataWedge / Honeywell DataCollection
│  :app   — ekrany    │  offline: bufor plikowy + WorkManager
└──────────┬──────────┘
           │ REST/JSON po HTTP w LAN (bez chmury, bez HTTPS-a)
           │ nagłówki: x-session (tożsamość), x-device (diagnostyka)
┌──────────▼──────────────────────────────────────────────────┐
│ Serwer — Fastify 5 + TypeScript          jeden host w LAN   │
│                                                              │
│  SQLite (better-sqlite3, WAL) — 16 tabel:                    │
│    delivery + delivery_line   tryb A: dostawy, zwroty        │
│    putaway_sessions + items   tryb B: kontener               │
│    problem, ean_conflict      wyjątki                        │
│    app_user, device_session   tożsamość (§7)                 │
│    sfera_queue                kolejka zapisów do Subiekta    │
│    events                     audyt — każdy skan i decyzja   │
│    sgt_*                      READ-MODEL Subiekta (5 tabel)  │
└──────────┬───────────────────────────────┬──────────────────┘
           │ ta sama baza SQLite            │ odczyt co 60 s
┌──────────▼──────────┐         ┌───────────▼──────────────────┐
│ Worker (osobny      │         │ MSSQL Subiekta GT            │
│ proces Node)        │────────▶│  odczyt: kartoteki, stany,   │
│ pętla poll, retry,  │  UPDATE │          dokumenty           │
│ backoff             │  ×2     │  zapis: dwa pola (patrz §1)  │
└─────────────────────┘         └──────────────────────────────┘
```

**Biuro nie ma własnego ekranu.** Statyczna strona `/lookup` istniała do lipca
2026 i została usunięta. Do biura zostaje REST i eksporty CSV.

---

## 3. Dlaczego dwa procesy

API i worker to **osobne procesy z tą samą bazą**, i to nie jest podział dla
elegancji.

Zapis do Subiekta przez Sferę idzie po COM, który nie jest thread-safe i potrafi
się zawiesić. Gdyby robił to ten sam proces, który obsługuje skany, jedno
zawieszenie COM zamrażałoby **cały magazyn** — skan przestałby odpowiadać.

Rozdzielenie daje trzy rzeczy naraz:

- skan odpowiada od razu, bo API tylko wpisuje wiersz do kolejki i wraca —
  nie czeka na Subiekta (docelowy p95 skan → informacja zwrotna to 150 ms,
  mierzony u człowieka przez `scan_timing`, nie po stronie serwera),
- zapis może się nie udać i być **ponowiony** (3 próby, backoff 5 s / 30 s /
  2 min) bez wiedzy magazyniera,
- worker można zatrzymać (aktualizacja Subiekta, restart) i praca w magazynie
  toczy się dalej — zadania czekają w kolejce.

Cena: **stan w Subiekcie jest opóźniony o sekundy**. Dlatego karta towaru
pokazuje stany **skorygowane o kolejkę** (`services/stock.ts`) i chipy
lokalizacji „w drodze" — inaczej człowiek widziałby stan sprzed własnego skanu
i skanowałby drugi raz.

---

## 4. Granica do Subiekta — adaptery

Cała wiedza o Subiekcie siedzi za dwoma interfejsami. Reszta kodu nie wie, czy
pracuje na prawdziwej bazie, czy na demo.

| interfejs | co robi | implementacje |
|---|---|---|
| `adapters/subiekt.ts` | **odczyt**: kartoteki, stany, dokumenty | `subiekt.seeded.ts` (SQLite z `products.json`), `subiekt.mssql.ts` (produkcja) |
| `adapters/sfera.ts` | **zapis**: lokalizacja, flaga, MM | `sfera.dev.ts` (mutacja `sgt_*`), `sfera.sql.ts` (UPDATE w MSSQL) |

Wybór jest **jednym przełącznikiem**: `SGT_MODE=seeded|mssql`. Adapter zapisu
nie jest osobną decyzją — wynika ze źródła danych (`config.sferaMode`).

<!-- docs_check: historia -->
Był kiedyś drugi przełącznik, `SFERA_MODE`. Usunięto go, bo dawało się ustawić
oba sprzecznie: czytać z demo i pisać do produkcji. Jeśli natrafisz na niego
w starym `wertis.env`, po prostu go skasuj — dziś nic go nie czyta.

### Read-model `sgt_*`

Serwer **nie odpytuje MSSQL przy każdym skanie**. Importer kopiuje kartoteki,
stany i dokumenty do lokalnych tabel `sgt_*` przy starcie, co `MSSQL_SYNC_MS`
(domyślnie 60 s) i na żądanie (`POST /api/admin/resync`).

Powód jest praktyczny: baza Subiekta stoi na tej samej maszynie co Subiekt,
z którego korzysta biuro. Odpytywanie jej z częstotliwością skanów obciążałoby
system, na którym ludzie wystawiają faktury. Stany na ekranie są więc **do 60 s
opóźnione** — i to jest akceptowalne, bo do rozkładania towaru wystarczy
wiedzieć, że coś jest, a nie ile dokładnie w tej sekundzie.

---

## 5. Trzy ścieżki rozkładania

Szczegóły w `docs/analiza-rozkladanie.md`; tu tylko podział i jego kryterium.

| ścieżka | jednostka pracy | skutek magazynowy |
|---|---|---|
| **Dostawa krajowa** (tryb A) | dokument FZ/PZ | sam adres — dokument księguje się wprost na MAG |
| **Zwrot** (tryb A) | koszyk w ramach dokumentu | adres + jeden MM Zwroty→MAG na koszyk |
| **Kontener importowy** (tryb B) | sesja z wózkiem | adres + MM MGP→MAG |

**Kryterium podziału to magazyn skutku, nie typ dokumentu.** To rozróżnienie
kosztowało jeden nieudany projekt modelu danych: `dok_Typ` nie mówi, gdzie towar
wyląduje, bo ten sam typ dokumentu bywa księgowany na różne magazyny. Decyduje
`mag_Id`, snapshotowany w chwili otwarcia dostawy — żeby przeksięgowanie
dokumentu w połowie pracy nie zmieniło reguł w jej trakcie.

### Niezmiennik: adres zawsze przed sprzedawalnością

Przy zwrotach i kontenerach zadanie `set_location` trafia do kolejki **przed**
zadaniem `mm`. Kolejka jest FIFO, więc towar staje się sprzedawalny dopiero
wtedy, gdy wiadomo, gdzie leży. Odwrotna kolejność dawałaby okno, w którym
handlowiec widzi towar dostępny, a magazynier nie wie, gdzie po niego iść.

---

## 6. Tożsamość (§7)

Do lipca 2026 „użytkownik" był dowolnym łańcuchem wpisywanym na kolektorze
i wysyłanym w `X-User`. Każdy mógł podać się za kogokolwiek, a `events.user_id`
zbierał warianty tej samej osoby.

Dziś: **skan badge'a → token sesji urządzenia**.

```
PRC-0007-3
└┬┘ └┬─┘ ┬
 │   │   └ cyfra kontrolna (wagi 3-1-3-1, jak w EAN)
 │   └──── numer nadany przez SERWER (unikalny w firmie)
 └──────── prefiks — nie koliduje z niczym w budynku
```

Trzy własności, każda z powodem:

- **Cyfra kontrolna** wyklucza rozpoznanie uszkodzonej etykiety jako *cudzego*
  badge'a. Bez niej starty znak zamienia Jana w Piotra, a audyt wskazuje
  niewinnego. To różnica między „nie dało się odczytać" a „odczytano źle".
- **Kod nie niesie nazwiska.** Badge się gubi i zostaje na kurtce; powiązanie
  kod → człowiek żyje wyłącznie w `app_user`.
- **Prefiks czyni badge kategorią zamkniętą** w klasyfikatorze skanów —
  sprawdzone na realnej kartotece: zero symboli, EAN-ów i adresów ma ten kształt.

### Blokada, nie wylogowanie

Po 10 minutach bezczynności sesja przechodzi w stan **zablokowana** — istnieje
dalej, z otwartą dostawą i całym postępem. Odblokowanie to jeden skan własnego
badge'a, ten sam token.

Wylogowanie gubiące trzydzieści rozłożonych pozycji to najprostszy znany sposób
na aplikację, która leży w szufladzie. Ekran blokady mówi wprost, że nic nie
zginęło, i **nie zasłania ekranu pod spodem** — widoczna dostawa jest dowodem.

### Przejęcie pracy nigdy nie jest ciche

Skan cudzego badge'a otwiera pytanie („Przejąć dostawę #17 od Jana?"), a nie
przełącza tożsamości. Ciche przełączenie podpisałoby cudze pozycje nie tym
nazwiskiem i nie zostawiło śladu. Potwierdzone przejęcie unieważnia starą sesję
i ląduje w `events` jako `session_handover`.

Rozstrzyga **kod badge'a, nie nazwisko** — dwóch Kowalskich w magazynie to nie
jest przypadek hipotetyczny.

### PIN tam, gdzie badge nie wystarcza

Badge'e bywają pożyczane („podaj swój, mam ręce w oleju"). Dwie operacje
wymagają więc PIN-u (scrypt, sól per konto, porównanie stałoczasowe):

- **zdjęcie cudzej blokady linii** przed wygaśnięciem TTL — jedyne miejsce,
  gdzie jedna osoba odbiera pracę drugiej bez jej wiedzy,
- **zarządzanie kontami** — jedyna operacja tworząca *tożsamość*, dlatego
  zastrzeżona dla roli `biuro`. Brygadzista mogący zakładać konta założyłby
  konto biura z własnym PIN-em i reszta reguł przestałaby cokolwiek znaczyć.

### Konta zakłada się z kolektora

Pusta instalacja → ekran startowy proponuje kreator (`ui/setup/`). Pierwsze
konto powstaje **bez sesji**, ale tylko dopóki tabela `app_user` jest pusta —
furtka zamyka się przy pierwszym wierszu i jest wymuszona jako konto biura
z PIN-em, bo będzie jedyną drogą do wszystkich następnych.

Kolejność wysyłki nie jest dowolna: biuro idzie pierwsze niezależnie od
kolejności wpisywania. Gdyby poszedł pierwszy magazynier, zająłby tę jedyną
furtkę i reszta listy odbiłaby się od 401 z kontami założonymi w połowie.

---

## 7. Klasyfikacja skanu — jedno źródło reguły

Ze skanera przychodzi łańcuch znaków. Trzeba rozstrzygnąć, czym jest.

```
prefiks LOC:  →  adres (etykieta QR)
wzorzec adresu →  adres          A01-02-03 (2 myślniki) | PAL-042
kształt badge'a →  badge          PRC-0007-3
13 cyfr        →  EAN
reszta         →  tekst (wyszukiwarka)
```

**`LOC` jest kategorią ZAMKNIĘTĄ**: kod, który nie pasuje do wzorca, adresem nie
jest — nigdy nie „spróbujemy mimo wszystko". Wzorzec należy do **serwera**
(`config.locPatterns`), a kolektor pobiera go w `GET /api/locations` i nie ma
własnej kopii.

Powód jest historyczny i konkretny: ta sama reguła żyła kiedyś w czterech
miejscach w trzech różnych kształtach, przez co symbol towaru `W32-0203` udawał
lokalizację i zapisywał widmowe adresy. Formaty są rozłączne **po liczbie
myślników** i to jest cały dyskryminator.

Zanim kolektor pobierze regułę, pracuje ostrożnie: adresem jest wyłącznie kod
z prefiksem `LOC:`. Ostrożnie ≠ zgadywać.

### Kontekstem jest otwarty ekran

Skan robi to, co widać:

| sytuacja | skutek |
|---|---|
| karta towaru otwarta + skan regału | **ten** towar dostaje ten adres |
| skan regału bez otwartej karty | pokaż zawartość regału |
| skan towaru | otwórz jego kartę |
| skan badge'a | zmienia się, KTO pracuje (nigdy nie idzie do `/api/scan`) |

Istniał wcześniej „kontekst przyklejony" — pierwszy skan przypinał regał albo
towar, kolejne wpadały w to przypięcie. Oszczędzał skany (8 indeksów na jeden
regał = 9 skanów zamiast 16), ale dało się mieć **przypięty towar A i otwartą
kartę towaru B**. Adres zapisany na niewłaściwy towar jest błędem cichym: nic
nie wygląda na zepsute, dopóki ktoś nie pójdzie po ten towar. Mechanizm
wycięto — siedem skanów tego nie warte.

---

## 8. Offline

Magazyn ma martwe punkty Wi-Fi przy metalowych regałach. Bufor jest więc
wymaganiem, nie ozdobą.

**Buforujemy tylko awarie sieci.** Błąd serwera (`ApiError`) propaguje do UI
i nie trafia do bufora — bo „serwer odmówił" znaczy coś innego niż „nie było
zasięgu", a zbuforowana odmowa wracałaby w kółko.

Operacja z bufora niesie **konto autora z chwili wykonania** (`x-buffered-user`).
Bez tego dwanaście pozycji odłożonych przez Jana poza zasięgiem dostałoby
nazwisko Piotra, który przejął kolektor, zanim wróciło Wi-Fi — czyli ta sama
cicha podmiana tożsamości, przed którą broni jawne przejęcie pracy, tylko
wejściem od tyłu. Serwer przyjmuje nagłówek tylko wtedy, gdy wskazuje istniejące
konto, a fakt wysyłki przez kogoś innego zapisuje w payloadzie zdarzenia.

---

## 9. Audyt i pomiar

`events` to jedyna tabela, do której piszą wszystkie warstwy: **26 typów
zapisywanych przez serwer** plus 3 przysyłane przez kolektor (`device_drop`,
`battery_low`, `scan_timing` — lista dozwolonych w `routes/device.ts`, żeby
klient nie mógł wstrzyknąć dowolnego typu). Każdy wiersz niesie `user_id`
(tekst), `user_ref` (konto), `device_id` i payload JSON.

Historii **nie kasujemy i nie nadpisujemy**: `user_id` został jako tekstowy
snapshot tego, co aplikacja wtedy wiedziała, a `user_ref` doszedł obok.
Zdarzenie, którego nie da się przypisać, zostaje z `NULL` — to jest uczciwe,
w odróżnieniu od zgadywania po podobieństwie.

| raport | trasa | co mówi |
|---|---|---|
| Cztery liczby | `GET /api/metrics` | dotknięcia/pozycję, p95 skanu, etykiety do przedruku, towary bez czytelnego kodu |
| Rekoncyliacja | `GET /api/reconcile`, `npm run reconcile` | 4 kontrole; zerowy wynik **nie tworzy raportu** |
| Wydajność per osoba | `GET /api/wydajnosc` | patrz ostrzeżenie niżej |
| Przeslotowanie | `npm run reslot` | pion i martwe kartoteki, 1–2× w roku |

### Raport wydajności to monitoring pracowniczy

`GET /api/wydajnosc` podlega Kodeksowi pracy (art. 22² i nast.): wymaga zapisu
w regulaminie albo obwieszczeniu i uprzedzenia pracowników **2 tygodnie przed**
uruchomieniem. Kod tego nie blokuje, ale odpowiedź niesie pole `podstawaPrawna`.

Raport ma trzy reguły wbudowane w kod, każda z testem:

1. **Zgłoszony problem nie jest błędem zgłaszającego.** Cały projekt wyjątków
   opiera się na tym, że opłaca się je zgłosić; policzenie `problem_raised` na
   czyjąś niekorzyść sprawiłoby, że problemy nie znikną — przestaną być widoczne.
2. **Nie ma kolumny błędów**, bo aplikacja nie ma zdarzenia „pomyłka".
   `location_mismatch` znaczy „adres w Subiekcie był nieaktualny" — to odkrycie.
3. **Tempo poniżej 20 pozycji to `null`.** Czas aktywny liczony z odstępów
   ≤ 15 min, więc z natury zaniżony: zawyżone tempo krzywdziłoby ludzi.

---

## 10. Testy i bramki

| co | ile | gdzie |
|---|---|---|
| serwer | 153 | `cd server && npm test` (node:test przez tsx) |
| `:core` | 85 | `cd android && ./gradlew :core:test` — **bez Android SDK** |
| `:app` | — | tylko CI: wymaga Android SDK |

Dwa workflow: `android.yml` (`:core` + APK debug) i `server.yml` (testy, `tsc`,
`docs_check`).

### Dlaczego `:core` jest osobnym modułem

Żeby logika dała się testować **bez Androida**. `settings.gradle.kts` konfiguruje
sam `:core`, gdy nie ma SDK — dlatego walidacja adresów, klasyfikacja skanów,
model sesji, reguły zakładania kont i bufor offline mają testy uruchamialne
wszędzie. To nie jest podział „bo warstwy": to jest podział przebiegający tam,
gdzie kończy się możliwość szybkiego sprawdzenia.

### Dwa narzędzia zamiast kompilatora

`:app` nie kompiluje się poza CI, więc powstały dwa tanie strażniki:

- `tools/docs_check.py` — liczby i ścieżki w dokumentacji kontra repo. Złapał
  m.in. merge, który zostawił w README dwie sprzeczne liczby testów obok siebie
  (git nie widzi konfliktu semantycznego — plik był poprawny składniowo).
- `tools/kt_imports_check.py` — brakujące importy i bilans nawiasów. Złapał
  właściwość rozszerzającą użytą bez importu oraz polski cudzysłów zamknięty
  prostym `"` wewnątrz łańcucha Kotlina.

Żadne nie jest kompilatorem i nie udaje. Zielony wynik znaczy „nie ten błąd".

---

## 11. Decyzje, które wyglądają dziwnie, a mają powód

| decyzja | powód |
|---|---|
| SQLite, nie Postgres | jeden host, jeden proces piszący, zero administracji. Baza to plik, backup to `copy` |
| Brak HTTPS | LAN magazynowy, klient natywny, brak service workera. Certyfikat lokalnego CA na kolektorach kosztowałby więcej niż wnosi |
| Polling 2 s zamiast WebSocketów | kolektor traci Wi-Fi kilkanaście razy dziennie; reconnect WS to kod, którego przy pollingu nie ma |
| Konta się nie kasuje | historia w `events` musi mieć na co wskazywać; jest `active = 0` |
| `events` bez retencji | przy szacowanych kilkuset zdarzeniach dziennie to rząd 10⁵ wierszy rocznie — SQLite z indeksami tego nie zauważa. To ślad audytu, więc automatyczne kasowanie byłoby gorsze niż wzrost. Gdyby tabela urosła ponad oczekiwania, decyzję o archiwizacji podejmuje właściciel, nie kod |
| `flaga_wyslana` zapisywana przy kolejkowaniu | dedupe musi się na czymś oprzeć. Terminalne niepowodzenie (błąd **albo anulowanie**) cofa zapis, żeby `syncFlag` policzył stan od nowa |
| Numer badge'a nadaje serwer | musi być unikalny w całej firmie i nieść poprawną cyfrę kontrolną |

---

## 12. Znane ograniczenia

- **Brak testów na poziomie tras.** Testy serwera są jednostkowe; błąd
  w warstwie routingu (np. walidacja czytająca surowe pole zamiast wartości
  efektywnej) wychodzi dopiero przy ręcznym `curl`. Taki błąd realnie wystąpił.
- **Dokumenty MM nie są jeszcze tworzone** — kontrakt istnieje
  (`adapters/sfera.ts`), implementacja czeka na worker COM na Windows.
- **Otwarte `[WERYFIKUJ]`** dla własnej bazy: `MAG_ID_*`, które `tw_Pole1..8`
  trzyma lokalizację, para (grupa flag, typ obiektu). Lista i zapytania:
  `docs/subiekt-gt-edu-setup.md` §3.
- **Reguły strefy złotej** nie pokrywają regałów `D00`, `D06`, `D07`, `E01` —
  raport przeslotowania wskazuje je na osobnej liście „brak reguły" zamiast
  zgadywać.

---

## Gdzie szukać dalej

| pytanie | plik |
|---|---|
| Jak to wdrożyć? | `DEPLOY.md` |
| Jak podpiąć Subiekta? | `docs/subiekt-gt-edu-setup.md` |
| Co dokładnie jest w bazie Subiekta? | `docs/subiekt-gt-struktura.md` |
| Jak wygląda rozkładanie w praktyce? | `docs/analiza-rozkladanie.md` |
| Jak zbudować kolektor? | `android/README.md` |
