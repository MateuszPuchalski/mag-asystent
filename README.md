# WERTIS · Asystent magazyniera (kolektor) — aplikacja full-stack

System dla magazynu części ogrodniczych pracującego na **Subiekcie GT**,
z **prawdziwymi danymi** (3415 kartotek z eksportu `magmat.xlsx`). Dwa klienty,
każdy do swojej roli:

- **Kolektor = natywna aplikacja Android** ([`android/`](android/README.md),
  Kotlin/Compose): skan sprzętowy (Honeywell DataCollection + Zebra DataWedge),
  trwały offline (Room), kiosk przez Android lock-task/MDM. Wdrożenie:
  [`DEPLOY.md`](DEPLOY.md) §5.
- **Biuro nie ma własnego ekranu.** Podgląd `/lookup` został usunięty; serwer
  nie serwuje żadnych statyk. Do biura zostaje REST (`/api/*`) i eksporty CSV
  z wyjątków i rekoncyliacji. Jedynym interfejsem człowieka jest kolektor.

To **nie jest mock** — działa realny serwer, baza danych, kolejka i worker
(spec §3, §7, §8). Granica do Subiekta/Sfery jest za adapterami: w tym
środowisku (Linux, bez Subiekta) zasilana z eksportu `magmat.xlsx`, a adaptery
produkcyjne (MSSQL + Sfera COM) są gotowym do podpięcia szkieletem.

## Realia magazynu — liczby, które rozstrzygają decyzje projektowe

| Fakt | Wartość |
|---|---|
| kartoteki ogółem / **aktywne** | ~3 600 / **~1 000** |
| powierzchnia | 19 × 18 m ≈ **342 m²**, przekątna ~26 m |
| dostawy krajowe | 7–8 małych tygodniowo (kontener importowy ~4×/rok) |
| format adresu regału | `A01-02-03` — litera + trzy pola po dwie cyfry, **2 myślniki** |
| format symbolu towaru | `W32-0203`, `50-111` — **0–1 myślnik**, bywa bez litery |

Dwie rzeczy z tej tabeli zmieniają projekt, a nie tylko go opisują:

- **Formaty adresu i symbolu są rozłączne po liczbie myślników.** To jedyny
  pewny dyskryminator — i dlatego rozpoznawanie skanu opiera się na wzorcu,
  a nie na heurystyce „ma literę". Szczegóły:
  [`docs/subiekt-gt-struktura.md`](docs/subiekt-gt-struktura.md).
- **Przy 342 m² optymalizacja drogi poziomej nie ma sensu ekonomicznego** —
  przejście róg–róg to ~20 s, więc różnica między najlepszym a najgorszym
  ułożeniem „po alejkach" to kilka sekund na pobranie. Realny koszt siedzi
  w pionie (drabina, schylanie) i w ~2 600 martwych kartotekach zajmujących
  dobre miejsca.

## Stack

| Warstwa | Technologia |
|---|---|
| Kolektor (`android/`) | Kotlin · Jetpack Compose · Retrofit · Room — skan sprzętowy Zebra/Honeywell ([README](android/README.md)) |
| Backend API (`server/`) | Node.js · Fastify 5 · TypeScript |
| Baza aplikacji | SQLite (better-sqlite3) — kolejka, sesje, events, locki (spec §7) |
| Worker Sfery | osobny proces Node, pętla poll, retry/backoff, `waiting_for_doc` (spec §9) |

Kolorystyka WERTIS: amber `#F7A600`, grafit `#2A2A2C`, papier `#F6F5F2`.
Strefa przyjęć nazywa się **MGP**.

## Architektura (spec §3)

> Pełny opis — komponenty, granica do Subiekta, model danych, tożsamość,
> offline i decyzje projektowe wraz z powodami — w
> [`docs/architektura.md`](docs/architektura.md). Poniżej sam szkielet.

```
Kolektor (Android)  ───REST/JSON──►  Serwer Fastify
                                       │  SQLite: delivery + delivery_line (tryb A:
                                       │          dostawy, zwroty, koszyki),
                                       │          problem + ean_conflict (wyjątki),
                                       │          putaway_* (tryb B), sfera_queue, events
                                       │  SubiektAdapter (odczyt)  → enqueue
                                       ▼
                                     Worker (poll 1–2 s, sekwencyjnie)
                                       │  SferaAdapter (zapis)
                                       ▼
                         DEV: tabele sgt_* (SQLite, seed z magmat.xlsx)
                         PROD: MSSQL SELECT (read-only) + Sfera COM (Windows)
```

Twarde zasady (spec §12) egzekwowane na serwerze: zero zapisu do „SGT" poza
kolejką; stany na ekranie skorygowane o oczekujące MM; walidacja długości
`tw_Lokalizacja` (twardy błąd, nie ucięcie); kody lokalizacji bez spacji;
każda operacja w `events`.

**Zapis do Subiekta ogranicza się do dwóch rzeczy** — pola lokalizacji na
kartotece (`tw_Pole1..8`, bo natywnego `tw_Lokalizacja` nowsze wersje nie mają)
oraz **flagi sprawdzenia na fakturze dostawy**. Ta druga to świadomy, nazwany
wyjątek od reguły „tylko lokalizacja": w tej firmie rozkładanie JEST sprawdzaniem
faktury, więc bez niej biuro musiałoby pytać magazyn o stan każdej dostawy.
Flaga nie jest kolumną dokumentu — InsERT trzyma ją w osobnej tabeli przypisań
`fl_Wartosc`, więc aplikacja **nie potrzebuje żadnego prawa zapisu do
`dok__Dokument`**. Oba zapisy idą tą samą drogą (kolejka → worker → adapter),
więc kolektor nigdy nie czeka na COM. Nic poza tym: zero `INSERT` do tabel
dokumentów, zero MM przy dostawie krajowej, zero modyfikacji stanów. Dokumenty
MM (kontener, zwroty) tworzy osobny worker Sfery na Windows — ten proces tylko
je kolejkuje. Zweryfikowana struktura bazy (wersja 1.8731.31.6933, ta sama co
w firmie): [`docs/subiekt-gt-struktura.md`](docs/subiekt-gt-struktura.md).

## Uruchomienie

```bash
npm install
npm run seed     # zasila SQLite z server/seed/products.json (raz; FORCE_SEED=1 nadpisuje)
npm run dev      # api :3001 + worker; sprawdzenie: http://localhost:3001/api/health
```

To jest **tryb `seeded`** — dane demo z `magmat.xlsx`, zero kontaktu z Subiektem.
Połączenie z prawdziwą bazą włącza `SGT_MODE=mssql` wraz z resztą `MSSQL_*`;
ustawienia trzyma jeden plik dla obu procesów (API i workera):

```bash
cp wertis.env.example wertis.env && nano wertis.env
source wertis.env && npm run dev
curl -s http://localhost:3001/api/health    # "mode" musi być "mssql"
```

Kolektor: build APK w [`android/`](android/README.md) (`./gradlew :app:assembleDebug`
albo artefakt z CI), w aplikacji ustaw adres serwera (emulator: `http://10.0.2.2:3001`).

Produkcyjnie:

```bash
npm run build    # server → server/dist (frontendu nie ma — serwer wystawia samo API)
npm start        # Fastify wystawia API (worker: npm -w server run start:worker)
```

**Wdrożenie w firmie (on-premise):** kompletna instrukcja — maszyna z Subiektem,
usługi Windows (NSSM), DNS/zapora, instalacja APK na kolektorach (MDM/kiosk),
etapy przejścia na MSSQL/Sferę i backup — w [`DEPLOY.md`](DEPLOY.md).

Parametry (env, dev):

| Zmienna | Znaczenie |
|---|---|
| `WORKER_SIM_ERRORS=1` | losowe błędy zapisu (test ścieżki `error` + PONÓW) |
| `SGT_MODE` | `seeded` (domyślnie) lub `mssql` (prawdziwa baza Subiekta) |
| `LOC_FIELD_LIMIT` | limit pola `tw_Lokalizacja` (domyślnie 50) |
| `LOC_FORMAT_STANDARD` / `LOC_FORMAT_PALLET` | wzorce adresu — **jedno źródło prawdy**, kolektor pobiera je z `/api/locations` |
| `LOC_STRICT=0` | wyłącza twarde egzekwowanie wzorca poza rozkładaniem (domyślnie **włączone**) |
| `MSSQL_FLAG_GRUPA` / `MSSQL_FLAG_TYP_OBIEKTU` | gdzie w `fl_Wartosc` siedzą flagi faktur zakupu — **bez domyślnych**, jeden SELECT wg DEPLOY §6 |
| `DOC_FLAG_IN_PROGRESS` / `_PAUSED` / `_DONE` / `_DONE_ERRORS` | nazwy czterech flag pokazywane człowiekowi (domyślnie słownictwo firmy) |
| `DOC_FLAG_*_SGT` | `flg_Id` czterech flag z `fl__Flagi` — liczba, nie nazwa |
| `MAG_ID_MAG` / `MAG_ID_MGP` / `MAG_ID_ZWROTY` | id magazynów w SGT — rozstrzygają, którym trybem idzie dokument |
| `DOK_TYP_ZWROTY` | kody `dok_Typ` zwrotów na magazynie Zwroty (CSV); puste = każdy dokument na tym magazynie |

## Funkcje (kolektor — aplikacja Android)

**Kto pracuje — badge, nie wolny tekst (plan §7)**
- **Jeden skan plakietki loguje** (~1 s, bez PIN-u na ścieżce codziennej).
  Wcześniej „użytkownik" był dowolnym łańcuchem wpisywanym z klawiatury
  i wysyłanym w nagłówku `X-User`: `events.user_id` zbierał warianty tej samej
  osoby (`Jan`, `jan`, `Jan K`), więc audyt nadawał się do czytania oczami i do
  niczego więcej, a każdy mógł podać się za kogokolwiek jednym wpisem.
- **Kod badge'a `PRC-0007-3` niesie cyfrę kontrolną** (wagi 3-1-3-1). Bez niej
  starty znak na etykiecie zamienia Jana w Piotra, a audyt wskazuje niewinnego —
  to jest różnica między „nie dało się odczytać" a „odczytano źle". Kod **nie
  niesie nazwiska**: badge się gubi i zostaje na kurtce, więc powiązanie
  kod → człowiek żyje wyłącznie w bazie.
- **Bezczynność BLOKUJE sesję, nigdy jej nie kończy.** Po 10 minutach ekran
  mówi wprost, że nic nie zginęło; otwarta dostawa i cały postęp czekają,
  a odblokowanie to jeden skan własnego badge'a — ten sam token. Wylogowanie
  gubiące 30 rozłożonych pozycji to najprostszy sposób na aplikację, która leży
  w szufladzie.
- **Skan cudzego badge'a nigdy nie przełącza po cichu.** Ekran pyta „Przejąć
  pracę? Trwa: dostawa #17, rozpoczęte przez: Jan Kowalski", a przejęcie ląduje
  w `events` (`session_handover`). Ciche przełączenie podpisałoby cudze pozycje
  nie tym nazwiskiem i nie zostawiłoby po sobie śladu.
- **PIN tam, gdzie badge nie wystarcza.** Badge'e bywają pożyczane („podaj mi
  swój, mam ręce w oleju"), więc odebranie koledze linii przed wygaśnięciem TTL
  wymaga PIN-u. To jedyne miejsce, gdzie jedna osoba odbiera pracę drugiej bez
  jej wiedzy — zdarzenie `lock_forced` zapisuje komu i przez kogo.

**Podgląd i operacje ad-hoc**
- Skan sprzętowy (Zebra DataWedge / Honeywell DataCollection, fallback
  klawiaturowy) / wyszukiwarka (symbol, nazwa, końcówka EAN) — logika `SELECT`
  na serwerze (spec §5.1).
- **Rozpoznanie kodu po wzorcu, nie po heurystyce.** `LOC` jest kategorią
  **zamkniętą**: kod, który nie pasuje do wzorca adresu, adresem nie jest.
  Wzorzec należy do serwera i kolektor go tylko pobiera — trzy niezależne kopie
  tej reguły były przyczyną błędu, w którym symbol `W32-0203` udawał lokalizację.
  Zanim kolektor pobierze regułę, pracuje ostrożnie: adresem jest wyłącznie kod
  z prefiksem `LOC:` z etykiety QR. Po klasyfikacji obowiązuje **jedno
  wyszukanie w jednej dziedzinie, bez fallbacku na drugą**.
- **Skan etykiety regału pokazuje jego zawartość od razu**, z ekranu głównego —
  nie trzeba wcześniej wybierać trybu. Pusty regał to poprawna odpowiedź
  („Regał A01-02-03 pusty"), bo półkę skanuje się także po to, żeby sprawdzić,
  czy jest wolna.
- **Kontekstem jest OTWARTY EKRAN, nie ukryty stan.** Skan robi to, co widać:
  karta towaru otwarta + skan regału → ten towar dostaje ten adres; skan regału
  bez otwartej karty → zawartość regału; skan towaru → jego karta. Nie ma paska
  „przypięto", nie ma trybu, nie ma czego zdejmować.
- **Dlaczego zniknął kontekst przyklejony.** Wcześniej pierwszy skan przypinał
  regał albo towar, a kolejne wpadały w to przypięcie — osiem indeksów na jeden
  regał kosztowało 9 skanów zamiast 16. Cena była jednak taka, że dało się mieć
  **przypięty towar A i otwartą kartę towaru B**: pasek mówił jedno, a zapis szedł
  gdzie indziej. Adres zapisany na niewłaściwy towar jest błędem CICHYM — nic nie
  wygląda na zepsute, dopóki ktoś nie pójdzie po ten towar. Siedem zaoszczędzonych
  skanów tego nie warte. Razem z mechanizmem zniknął jego TTL w Ustawieniach
  i telemetria `pin_expired`.
- Karta towaru: stany MAG (dostępne/rez./razem) i MGP, **skorygowane o kolejkę**
  (`⏳ N szt w drodze`), lokalizacje (pierwsza = pickingowa), limit 50 znaków.
- **Zamienniki z opisu kartoteki.** Opisy od lat niosą symbole zamienników
  (`Zamiennik: 24-04003`, `Zamiennie: 101-024 // KAR00149`), tyle że jako prozę,
  której nie da się dotknąć. Serwer je wycina (`services/zamienniki.ts`), a to,
  co jest NASZĄ kartoteką, staje się wierszem ze stanem i lokalizacją —
  dotknięcie otwiera kartę zamiennika. Rozstrzyga kartoteka, nie wzorzec:
  z 2304 tokenów w sekcjach zamienników tylko 478 to nasze towary, reszta to
  numery OEM i katalogi obcych firm (zostają szarym tekstem, bo idą w rozmowę
  z dostawcą). `+` nigdy nie rozdziela — w opisach łączy części zestawu, więc
  podział podałby pół kompletu jako pełnoprawny zamiennik.
- Zmiana lokalizacji: skan towaru → skan lokalizacji; przy ≥2 lokalizacjach
  bottom-sheet zastąp/dodaj/zastąp jedną; walidacje bez spacji i długości.
  Pomyłkę poprawia się skanem właściwej półki — nie ma czego cofać.
- **Lokalizacja „w drodze".** Pole lokalizacji w Subiekcie zmienia się dopiero po
  udanym zapisie przez workera, więc do tego czasu karta pokazywałaby stan sprzed
  skanu. Chipy niosą więc stan zamiast milczeć: dochodząca — przerywana ramka
  i `⏳`; schodząca — kod przekreślony; **nieudany zapis — czerwony i pulsuje**,
  a tapnięcie prowadzi wprost do kolejki z PONÓW. Pulsuje wyłącznie błąd, bo
  tylko on wymaga reakcji człowieka i tylko on jest stanem trwałym. Ten sam
  sygnał widać z drugiej strony — na zawartości regału (`jedzie tutaj` /
  `schodzi stąd`). To ten sam pomysł, co `⏳ N szt w drodze` przy stanach.
- Kolejka Sfery: statusy `pending`/`processing`/`waiting_for_doc`/`done`/`error`,
  PONÓW, polling, pull-to-refresh. Wejście przez **pastylkę statusu Sfery** w
  prawym górnym rogu (zielona = OK, amber = ⏳ w kolejce z licznikiem, czerwona =
  błąd) — jest jednocześnie wskaźnikiem stanu; dolny pasek ma 2 zakładki.
- Bufor offline (Room) na zapisy przy zaniku Wi-Fi, asysta niskiej baterii,
  log upadków urządzenia (`device_drop`) dla serwisu.

**Rozkładanie dostaw i zwrotów — Tryb A (redesign v2.0)** — druga zakładka
- Jednostką pracy jest **dokument** (FZ/PZ albo zbiorczy dokument zwrotów), nie
  sesja. Dokumenty **w buforze** też
  są do wzięcia: przy dostawie krajowej skutek magazynowy niesie sam dokument
  w Subiekcie, więc aplikacja zapisuje **wyłącznie lokalizację** — zero MM, zero
  `waiting_for_doc`.
- Ścieżka codzienna to **dwa skany na pozycję**: skan towaru → wiersz rozwija
  się z ilością i lokalizacją docelową → skan etykiety regału → zapis, a wiersz
  zwija się jako odłożony. Bez dialogu potwierdzającego. Postęp zapisuje się per
  pozycja, więc przerwanie pracy nic nie kosztuje; dostawa zamyka się sama, gdy
  nie ma już czego rozkładać.
- **Nic nie podmienia listy.** Rutyna i rozjazd lokalizacji dzieją się w wierszu,
  a wyjątek ze zdjęciem i wybór przy kolizji EAN wysuwają się jako arkusz od
  dołu — dostawa zostaje widoczna pod spodem, bo to na niej widać, ile jeszcze
  zostało w kartonie.
- Lista jest **kontrolą kompletności, nie kolejką**: pozycje bierze się z kartonu
  w takiej kolejności, w jakiej wpadną w rękę. Odłożone **zwężają się w miejscu**
  (dziesięć pozycji drobnicy mieści się na jednym ekranie), kolejność wierszy się
  nie zmienia, a pozycje **BEZ LOKALIZACJI** idą na koniec jako osobna sekcja.
  Serwer sortuje po lokalizacji docelowej, ale kolektor nie rysuje już nagłówków
  alejek — przy pracy „co wpadnie w rękę" nikt po nich nie nawigował.
- **Niejednoznaczny kod kreskowy zatrzymuje operację** — aplikacja nigdy nie
  bierze „pierwszego dopasowania”. Jedyne automatyczne zawężenie: dokładnie
  jeden kandydat występuje w otwartym dokumencie.
- **Flaga sprawdzenia faktury zamiast drugiej prawdy.** Rozkładanie JEST
  sprawdzaniem faktury, więc aplikacja nie trzyma własnego stanu obok stanu
  z Subiekta — wyprowadza go i wysyła jako flagę: *W trakcie sprawdzania* (ktoś
  przy tym stoi), *Do sprawdzenia z zapisanym postępem* (przerwane), *Sprawdzone*,
  *Sprawdzone z błędami* (**wyłącznie** rozbieżność ilościowa — uszkodzenie czy
  brak miejsca to sprawy reklamacyjne, nie zgodność dokumentu). Magazynier widzi
  tę samą plakietkę, co biuro. Firma używa **wbudowanych flag dokumentu** (kolumna
  „FW" na liście faktur zakupu), więc domena operuje stabilnym kluczem, a mapowanie
  klucz → nazwa → wartość w bazie siedzi w konfiguracji (`DOC_FLAG_*`).
  Nadpisanie przez biuro wygrywa: aplikacja schodzi z takiej faktury i zapisuje
  to w `events`.
- **Liczy się każdą pozycję**, więc skan półki niesie znaczenie „policzyłem,
  zgadza się"; rozbieżność zgłasza osobny przycisk **INNA ILOŚĆ** (najczęstszy
  wyjątek nie może wymagać szukania kafla wśród siedmiu typów).
- **Kilka osób przy jednej dostawie**: lock per pozycja z TTL 30 min — drugi
  skaner mówi, kto trzyma linię, zamiast pozwolić na podwójne odłożenie.
- **Rozjazd lokalizacji**: skan innej półki niż kartoteka otwiera pytanie
  **PRZED zapisem** — „przeniesiony (ZAMIEŃ)” czy „leży w obu (DODAJ)”. Z samego
  skanu tych dwóch sytuacji odróżnić się nie da, więc decyduje człowiek.
- **Wyjątki jako obiekt pierwszej klasy**: zamknięta lista typów (za mało, za
  dużo, uszkodzony, zły towar, brak miejsca, nieznany kod, kolizja EAN);
  przy uszkodzeniu / złym towarze / nieznanym kodzie **zdjęcie jest
  obowiązkowe** (dowód do reklamacji, robi je systemowy aparat). Pozycja
  z wyjątkiem wypada z rutyny, ale nie blokuje zamknięcia dostawy.
- Ekran **WYJĄTKI**: nierozwiązane zgłoszenia (pytane przy starcie aplikacji,
  czerwony pasek na każdym ekranie do czasu zamknięcia) + **raport kolizji
  kodów** dla biura. Eksport problemów dostawy do **CSV** (`;` + BOM, Excel PL)
  pod `GET /api/delivery/:id/problems.csv`.

**Zwroty — koszyk jako jednostka pracy (w trybie A, osobna sekcja listy)**
- Biuro otwiera zwroty karton po kartonie, przyjmuje towar na magazyn **Zwroty**
  jednym **zbiorczym dokumentem** i układa go w **koszyki opisane numerem
  zwrotu**. Podziału na koszyki nie ma w żadnym dokumencie — istnieje wyłącznie
  fizycznie, więc w aplikacji koszyk to grupa linii domkniętych za jednym
  podejściem, otagowana numerem (krótkim, wpisywanym ręcznie — koszyki nie mają
  kodów kreskowych).
- Rozkładanie przebiega dokładnie jak przy dostawie: dwa skany, sekcje alejek,
  INNA ILOŚĆ, wyjątki ze zdjęciem, kolizje EAN, te same cztery flagi dokumentu.
- Różnica jest jedna: **po opróżnieniu koszyka domyka się go przyciskiem i
  powstaje JEDEN dokument MM Zwroty→MAG** na wszystko, co z niego poszło na
  półki. `set_location` powstaje przy każdym odłożeniu, MM dopiero na końcu, więc
  niezmiennik **adres zawsze przed sprzedawalnością** trzyma się sam.
- Rozliczenie idzie **ilościami** (`odłożone − objęte MM`), nie statusem linii:
  ten sam towar bywa w dwóch koszykach (dokument zbiorczy agreguje go w jedną
  linię), ponowne domknięcie koszyka nie dubluje przesunięcia, a sztuki odłożone
  z pozycji zgłoszonej potem jako uszkodzona i tak jadą na MAG.
- Otwarte koszyki (rozłożone, bez MM) widać na ekranie dostawy i **wstrzymują jej
  domknięcie**: dopóki MM nie powstanie, towar leży na półce, ale w Subiekcie
  wisi na Zwrotach — czyli jest niesprzedawalny.

**Kontener importowy — Tryb B (sesja z wózkiem, spec §5.4)**
- Wchodzi tu **wyłącznie kontener na MGP** (~4× w roku): 1000 kartonów, wiele
  kursów wózkiem. Tylko ten proces potrzebuje modelu sesji zamiast dokumentu.
- Lista dokumentów (14 dni) z postępem sesji; pozycje **sortowane po lokalizacji
  docelowej**, `BRAK LOK` na końcu, agregacja tego samego towaru.
- Tryb wózka: skan towaru na wózek (domyślna ilość = min(pozostało, stan strefy)),
  potwierdzenie ze skanem lokalizacji, częściowe rozłożenie, pomiń, dodanie
  spoza dokumentu, rozjazd lokalizacji.
- **Zatwierdź wózek → jeden dokument MM strefa→MAG + zadania `set_location`**
  z tej rundy.
- Locki multi-user (TTL 30 min), `waiting_for_doc` gdy dokument w buforze,
  zamknięcie sesji z rozliczeniem (`closed` / `closed_with_deviations`).

**Który tryb obsługuje dokument — rozstrzyga magazyn skutku, nie typ**
`MAG` → tryb A (dostawa krajowa: towar już leży na hali, brakuje mu adresu).
`Zwroty` → tryb A, sekcja zwrotów (adres jak wyżej + MM na zamknięty koszyk).
`MGP` → tryb B (kontener: sesja z wózkiem, MM na rundę). Kryteria są **rozłączne**
— ten sam dokument nie może pojawić się w obu zakładkach, inaczej dałoby się go
rozłożyć dwiema niekompatybilnymi ścieżkami naraz.

**Telemetria, która mierzy właściwą rzecz**
- `events` ma indeks po czasie (bez niego każdy raport skanuje całą tabelę)
  i `device_id` — przy współdzielonych kolektorach pierwsze pytanie przy awarii
  brzmi „to jedno urządzenie czy wszystkie?".
- **Wejście ręczne liczone osobno od skanu** (`manual_entry`). To nie jest
  kosmetyka: udział wpisów ręcznych **per regał** to darmowy raport jakości
  etykiet (który wymaga przedruku), a **per towar** mówi, która kartoteka nie ma
  czytelnego kodu. W jednym worku ze skanem nie mierzy niczego.
- **Czas skan → odpowiedź mierzy klient, nie serwer** (`scan_timing`), bo czas
  obsługi na serwerze pomija sieć i render — czyli akurat to, gdzie problem
  siedzi. Cel: `p95 < 150 ms`; powyżej ~300 ms ludzie zaczynają skanować
  podwójnie, a podwójny skan przy liczeniu pozycji to błąd **ilościowy**.
- Cztery liczby pod `GET /api/metrics` — liczby, nie panel.
  **Świadomie bez raportu wydajności per osoba:** to monitoring pracowniczy
  w rozumieniu Kodeksu pracy (art. 22² i nast.) i wymaga zapisu w regulaminie
  oraz uprzedzenia ludzi przed uruchomieniem. Techniczny audyt „kto zmienił
  lokalizację" to co innego i zostaje.

**Raport przeslotowania — mierzy pion, nie odległość**
- `npm run reslot` (1–2× w roku, przed sezonem) czyta Subiekta read-only i daje
  cztery listy do wydruku, posortowane **po lokalizacji**, żeby chodzić alejką
  raz. Nie jest to funkcja aplikacji — człowiek z wydrukiem robi to w dzień.
- **Pobrania liczone jako wystąpienia pozycji na WZ, nie suma ilości.** Indeks
  wydany 400× po sztuce generuje wielokrotnie więcej pracy niż wydany 4× po
  100 szt.; mylenie tych dwóch liczb to najczęstszy błąd domowych analiz ABC.
- Strefa złota jest **per zakres regałów** (`A,B,H,J` → poziomy 2-3-4, `F` → 4 i 8,
  `E03–E04` → tylko 2…), bo ten sam numer poziomu to inna wysokość w różnej
  geometrii regału. Regał bez reguły trafia na **czwartą listę**, nie do kosza
  „poza strefą" — inaczej jego martwy towar zniknąłby z oczu.
- **Bez historii pobrań skrypt odmawia wypisania list 1–3.** Każdy indeks
  wyglądałby wtedy na martwy, a raport kazałby opróżnić całą strefę złotą —
  i wyglądałby przy tym jak zlecenie robocze, nie jak awaria.

**Nocna rekoncyliacja — niezmienniki trzeba mierzyć, nie deklarować**
- Aplikacja pisze do Subiekta przez kolejkę, ale nikt nie sprawdzał, **czy stan
  po stronie Subiekta odpowiada temu, co aplikacja myśli, że zapisała**.
  `npm run reconcile` (raz na dobę z crona) porównuje adres w Subiekcie
  z ostatnim udanym zapisem, wyławia zadania w `error` starsze niż doba,
  `waiting_for_doc` starsze niż trzy dni i koszyki zwrotów rozłożone bez MM.
- **Zerowy wynik nie tworzy raportu** — raport przychodzący codziennie przestaje
  być czytany po tygodniu, a wtedy nie chroni już przed niczym. Rozjazdy → CSV
  + kod wyjścia `2` pod alert. Szczegóły: [`DEPLOY.md`](DEPLOY.md) §7.

**Biuro — bez własnego ekranu**
- Strona `/lookup` została **usunięta**, razem z serwowaniem statyk. Serwer
  wystawia wyłącznie API. Biuro sięga po dane przez `GET /api/products/search`,
  `GET /api/locations/:code/products`, `GET /api/metrics`, `GET /api/reconcile`
  oraz eksporty CSV wyjątków i rekoncyliacji.
- Konsekwencja, którą trzeba znać przed wdrożeniem: **nikt w biurze nie sprawdzi
  już lokalizacji towaru bez kolektora albo bez narzędzia, które umie wywołać
  REST.** To była jedyna droga „z przeglądarki".

## Struktura repo

```
android/                   KOLEKTOR — natywna aplikacja (Kotlin/Compose), android/README.md
  core/                    czysta logika JVM (skan, DTO, nawigacja, wyjątki, offline)
                           + 92 testy jednostkowe; buduje się bez Android SDK
  app/                     aplikacja Compose: 13 ekranów, skanery, czujniki
server/                    backend (Fastify + SQLite + worker)
  seed/products.json       3415 kartotek z magmat.xlsx (źródło seedu)
  src/db/schema.sql        tabele aplikacji (§7) + read-model sgt_*
  src/db/seed.ts           seed z products.json: dokumenty FZ/PZ per dostawca,
                           kontener na MGP, zbiorczy dokument zwrotów
  src/adapters/            Subiekt/Sfera: seeded+dev (tu) oraz mssql+sql (prod)
  src/services/            delivery + delivery-flag (tryb A: dostawy, zwroty, koszyki),
                           problems + ean (wyjątki), putaway (tryb B — kontener),
                           stock (korekta o kolejkę), queue, locks, locations, events
  src/routes/              products, delivery, problems, putaway, queue,
                           locations, device (§8)
  data/photos/             zdjęcia dowodowe do reklamacji (poza gitem)
  src/worker/worker.ts     pętla poll, retry/backoff, waiting_for_doc (§9)
docs/architektura.md       jak to jest zbudowane i dlaczego tak (start dla nowej osoby)
docs/analiza-rozkladanie.md trzy ścieżki rozkładania + backlog
docs/subiekt-gt-edu-setup.md  podpięcie Subiekta GT krok po kroku
docs/subiekt-gt-struktura.md  co WERTIS czyta i pisze w bazie Subiekta
tools/convert_xlsx.py      konwersja eksportu Subiekta → products.json
tools/docs_check.py        kontrola spójności dokumentacji z repo (martwe ścieżki,
                           usunięte byty, liczby ekranów/testów) — `python3 tools/docs_check.py`
tools/kt_imports_check.py  namiastka kompilatora dla :app (brakujące importy,
                           bilans nawiasów) — :app nie kompiluje się bez SDK
.github/workflows/         CI: android.yml (testy :core + APK debug) oraz
                           server.yml (testy serwera, tsc, docs_check)
```

## Dane testowe

`server/seed/products.json` z eksportu `magmat.xlsx` (`tools/convert_xlsx.py`,
rozpoznaje kolumny po nazwie). Eksport zawiera **prawdziwe** kolumny `Stan`
(MAG), `Rezerwacja`, `MGP` (strefa przyjęć) i `Dostawca`, więc konwerter bierze
je wprost — bez syntetyki (dla starszego, płaskiego eksportu bez tych kolumn
konwerter nadal rozdziela stany deterministycznie hashem). 94 towary mają stan
na MGP. Seed buduje z nich dokumenty FZ/PZ **pogrupowane po realnym dostawcy**
(duże paczki dzielone po ≤20 pozycji, jeden dokument w buforze — test
`waiting_for_doc`).

Żeby obie ścieżki miały czym żyć, seed rozstawia dokumenty po **trzech
magazynach skutku**: krajowe FZ/PZ na `MAG` (tryb A), jeden dokument zostaje na
`MGP` jako kontener importowy (tryb B) i jeden zbiorczy dokument zwrotów na
magazynie `Zwroty` — ten ostatni razem ze stanami, bo bez nich MM z koszyka nie
miałby czego przenosić. W produkcji stany i dokumenty pochodzą z `tw_Stan` /
`dok__Dokument` przez adapter MSSQL (patrz [`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md)).

## Praca z prawdziwym Subiektem GT

Docelowa wersja w firmie: **Subiekt GT 1.87 SP3 HF1** (era KSeF — brak natywnego
pola lokalizacji, stąd pole dodatkowe `tw_Pole1..8`).

Tryb `SGT_MODE=mssql` (Windows z Subiektem, także **wersja edu**) to CAŁE
połączenie: **jeden login** o minimalnych uprawnieniach, importer
`server/src/adapters/subiekt.mssql.ts` zasila read-model `sgt_*` prosto z bazy
(przy starcie, co `MSSQL_SYNC_MS`, `POST /api/admin/resync`), a worker zapisuje
w dwóch miejscach: UPDATE **jednej kolumny** (lokalizacja na `tw__Towar`) oraz
MERGE w `fl_Wartosc` (flaga). Tryb zapisu wynika z `SGT_MODE` — nie ma
osobnego przełącznika. Dokumenty MM — a powstają w dwóch miejscach: runda wózka
w trybie B i **zamknięty koszyk zwrotu** — tworzy docelowo osobny worker Sfery
(COM) czytający tę samą kolejkę `sfera_queue`; do tego czasu zadanie MM kończy
się czytelnym błędem, a MM wystawia biuro. Instrukcja krok po kroku:
[`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md).

W tym środowisku (chmura Linux, bez Subiekta/MSSQL) działa tryb `seeded` —
API, kolejka, worker i rozkładanie realnie na SQLite zasilonym danymi
z eksportu Subiekta.
