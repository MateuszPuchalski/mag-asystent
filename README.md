# WERTIS · Asystent magazyniera (kolektor) — aplikacja full-stack

System dla magazynu części ogrodniczych pracującego na **Subiekcie GT**,
z **prawdziwymi danymi** (3415 kartotek z eksportu `magmat.xlsx`). Dwa klienty,
każdy do swojej roli:

- **Kolektor = natywna aplikacja Android** ([`android/`](android/README.md),
  Kotlin/Compose): skan sprzętowy (Honeywell DataCollection + Zebra DataWedge),
  trwały offline (bufor plikowy JSON + WorkManager), kiosk przez Android
  lock-task/MDM. Od 0.52.0 **aktualizuje się sam z serwera WERTIS**: plik leży
  w sieci magazynu, a kolektor proponuje go przy otwarciu aplikacji. Od 0.88.0
  **magazynier dodaje z niego zdjęcie kartoteki**: dotyka pustego slotu na
  karcie towaru, robi zdjęcie albo wybiera je z galerii, a serwer wycina tło.
  Wdrożenie: [`DEPLOY.md`](DEPLOY.md) §5 i §6 etap 2a.
- **Biuro ma podgląd pod `/biuro`** (od 0.18.0): status rozkładania dostaw
  i protokoły rozbieżności do wydruku ze zdjęciami. Od 0.27.0 także metryki,
  kolejka zapisów, rekoncyliacja i ślad audytowy. Od 0.48.0 zakładka ANALIZA:
  wykresy operacji, rytm dostaw, szukane bez wyniku, zdrowie urządzeń
  i wydajność per osoba (z podstawą prawną monitoringu). Od 0.50.0 także
  import zbiórek z Sellasist i kandydaci do strefy złotej z edytorem reguł
  strefy, a od 0.87.0 przy dostawcy stoi jego logo. Dostawca z własnym drukiem
  reklamacyjnym (GEKO, PARTNER) dostaje od 0.28.0 swój formularz. Jedna strona
  bez builda i logowanie loginem — operacje magazynowe wykonuje się wyłącznie
  na kolektorze.

To **nie jest mock** — działa realny serwer, baza danych, kolejka i worker
(spec §3, §7, §8). Granica do Subiekta i Sfery jest za adapterami. W tym
środowisku (Linux, bez Subiekta) zasila ją eksport `magmat.xlsx`. Adaptery
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
- **Przy 342 m² optymalizacja drogi poziomej nie ma sensu ekonomicznego.**
  Przejście róg–róg to ~20 s, więc różnica między najlepszym a najgorszym
  ułożeniem „po alejkach" to kilka sekund na pobranie. Realny koszt siedzi
  w pionie (drabina, schylanie) i w ~2 600 martwych kartotekach zajmujących
  dobre miejsca.

## Stack

| Warstwa | Technologia |
|---|---|
| Kolektor (`android/`) | Kotlin · Jetpack Compose · Retrofit · WorkManager — skan sprzętowy Zebra/Honeywell ([README](android/README.md)) |
| Backend API (`server/`) | Node.js · Fastify 5 · TypeScript |
| Baza aplikacji | SQLite (wbudowany `node:sqlite`, zero modułów natywnych) — kolejka, sesje, events (spec §7) |
| Worker zapisu | osobny proces Node, pętla poll, retry/backoff, `waiting_for_doc` (spec §9) |
| Worker Sfery (`sfera-worker/`) | C#/.NET 8 · COM Sfery — dokumenty MM na produkcji, opcjonalny ([README](sfera-worker/README.md)) |
| Usługa tła (`tlo-worker/`) | C#/.NET 8 · ONNX Runtime · SkiaSharp — wycina tło ze zdjęcia dodanego z kolektora, opcjonalna ([README](tlo-worker/README.md)) |

Kolorystyka WERTIS: amber `#F7A600`, grafit `#2A2A2C`, papier `#F6F5F2`.
Strefa przyjęć nazywa się **MGP**.

## Architektura (spec §3)

> Pełny opis — komponenty, granica do Subiekta, model danych, tożsamość,
> offline i decyzje projektowe wraz z powodami — w
> [`docs/architektura.md`](docs/architektura.md). Poniżej sam szkielet.

```
Kolektor (Android)  ───REST/JSON──►  Serwer Fastify
                                       │  SQLite: delivery + delivery_line
                                       │          (faktury zakupu),
                                       │          problem + ean_conflict (wyjątki),
                                       │          sfera_queue, events
                                       │  SubiektAdapter (odczyt)  → enqueue
                                       ▼
                                     Worker (poll 1–2 s, sekwencyjnie)
                                       │  SferaAdapter (zapis)
                                       ▼
                         DEV: tabele sgt_* (SQLite, seed z magmat.xlsx)
                         PROD: MSSQL SELECT (read-only) + Sfera COM (Windows)
```

Twarde zasady (spec §12) egzekwowane na serwerze:

- zero zapisu do „SGT" poza kolejką,
- stany na ekranie skorygowane o oczekujące MM,
- walidacja długości `tw_Lokalizacja` (twardy błąd, nie ucięcie),
- kody lokalizacji bez spacji,
- każda operacja w `events`.

### Wdrożenie na produkcji idzie etapami

Aplikacja zapisuje do bazy firmy dwie rzeczy — pole lokalizacji i podstawowy
kod kreskowy (0.37.0) — odwracalne wyłącznie z kopii zapasowej. Dlatego wpuszczanie jej na produkcję ma **sześć
etapów z bramkami**, opisanych w [`docs/wdrozenie.md`](docs/wdrozenie.md).
Najważniejsze narzędzie jest darmowe: **worker jest jedynym procesem
zapisującym do Subiekta**, więc jego zatrzymanie daje przebieg próbny na żywych
danych ([`DEPLOY.md`](DEPLOY.md) §6).

### Ślad audytowy — „aplikacja zjadła mi 30 sztuk"

`events` zbiera od pierwszego dnia instalacji **każdy skan, każdą decyzję
i każdy błąd**, z osobą, kontem, urządzeniem i czasem. Nic tego nie kasuje.
Łańcuch jest pełny w obie strony:

```
skan → decyzja człowieka → zadanie w kolejce → ZAPIS DO SUBIEKTA (albo jego brak)
scan   location_set        (sfera_queue)       queue_applied | queue_retry | queue_failed
```

`queue_failed` to najważniejszy wpis w całym logu: magazynier zrobił swoje,
kolektor przyjął, a do bazy firmy nic nie weszło. Odrzucone żądania mają własny
typ (`http_rejected`), więc „skanowałem i się nie zapisało" też zostawia ślad.

Odczyt: `GET /api/events` z filtrami oraz `GET /api/events/csv` do arkusza —
**wymaga roli biura albo admina**, bo log mówi, kto ile zeskanował.
Rozmiar historii widać w `/api/health` (`audyt`); nie czyścimy jej, bo
reklamacja przychodzi po miesiącach. Pełny opis łańcucha, jego luk i powodów:
[`docs/architektura.md`](docs/architektura.md) §9.

**Zapis do Subiekta ogranicza się do DWÓCH pól na kartotece.** Pierwsze to
lokalizacja (`tw_Pole1..8`, bo natywnego `tw_Lokalizacja` nowsze wersje nie
mają). Drugie to podstawowy kod kreskowy (`tw_PodstKodKresk`, od 0.37.0), bo
magazynier z kartonem nieznanego kartotece kodu nie miał gdzie go wpisać. Każde
pole ma własny `GRANT UPDATE` na tę jedną kolumnę. Zapis idzie kolejką
(kolejka → worker → adapter), więc kolektor nigdy nie czeka na COM. Nic poza
tym: zero `INSERT` do tabel dokumentów, zero modyfikacji stanów; dokumenty MM
(kontener) tworzy osobny worker Sfery na Windows.

Granice i ich powody: [`docs/architektura.md`](docs/architektura.md) §1;
zweryfikowana struktura bazy (wersja 1.8731.31.6933, ta sama co w firmie):
[`docs/subiekt-gt-struktura.md`](docs/subiekt-gt-struktura.md).

## Uruchomienie

```bash
npm install
npm run seed     # zasila SQLite z server/seed/products.json (raz; FORCE_SEED=1 nadpisuje)
npm run seed:scenariusze   # opcjonalnie: 66 przypadków brzegowych do przeklikania
npm run dev      # api :3001 + worker; sprawdzenie: http://localhost:3001/api/health
```

`npm run dev` odpala OBA procesy, i to nie jest wygoda. API wyłącznie kolejkuje
zapisy. Bez workera chip lokalizacji zostaje „w drodze" bez końca, a stan nie
drgnie. `/api/health` mówi to wprost: `"ok":false` i zdanie o workerze. Zajrzyj
tam, zanim uznasz, że coś jest zepsute.

To jest **tryb `seeded`** — dane demo z `magmat.xlsx`, zero kontaktu z Subiektem.
Połączenie z prawdziwą bazą włącza `SGT_MODE=mssql` wraz z resztą `MSSQL_*`;
ustawienia trzyma jeden plik `wertis.env` dla obu procesów
([`DEPLOY.md`](DEPLOY.md) §2a). Ten plik dotyczy **wyłącznie** trybu MSSQL —
w dev nie tyka się go wcale, a tryb `seeded` nie potrzebuje ani jednej zmiennej.

Kolektor: build APK w [`android/`](android/README.md) (`./gradlew :app:assembleDebug`
albo artefakt z CI). Adres serwera fabrycznie wskazuje magazyn; na emulatorze
wpisz `http://10.0.2.2:3001`.

### Pierwsze konto — bez niego kolektor nie wpuści

Ekran startowy jest twardą bramką: bez konta nie ma jak podpisać operacji, więc
nie ma przejścia dalej. **W trybie `seeded` konto jest od razu**: start API na
pustej bazie sam zakłada konto demo — login `admin`, hasło `admin` (0.53.2).
Kolektor i `/biuro` logują się nim bez żadnego kroku ręcznego.

Konto demo powstaje wyłącznie przy `SGT_MODE=seeded` i wyłącznie w bazie bez
żadnego konta z loginem. Na produkcji (`mssql`) nie powstaje nigdy, a w demo
z własnymi kontami nie wraca. To odwrócenie (decyzją właściciela) dawnej
reguły „żadnych stałych haseł demo": ogrodzeniem jest tryb, nie hasło.

Inne hasło w demo ustawia `npm run seed` przez `ADMIN_HASLO` (bez zmiennej —
losowane i wypisane raz):

```
[seed] konto admina: login=admin hasło=4m9E0gfK806DVm07
[seed] hasło wylosowane i pokazane RAZ — wpisz ADMIN_HASLO, żeby je ustalić.
```

Zmienną `ADMIN_HASLO` czyta **wyłącznie skrypt seeda**, nigdy serwer — na
produkcji nie znaczy nic. Drugi przebieg konta nie dubluje i nie rusza hasła.

U klienta to samo konto zakłada instalator, pytając instalującego o hasło.

Pierwsze konto da się też założyć ręcznie na pustej bazie, bez sesji. Rola
`admin` jest wtedy **wymuszona**, a furtka zamyka się po pierwszym koncie
z loginem. Procedurę `curl` i zakładanie reszty kont podaje
[`DEPLOY.md`](DEPLOY.md) §5a.

Na ekranie startowym kolektora są dwa pola — login i hasło — więc emulator bez
skanera wystarczy. Adres fabryczny wskazuje serwer magazynu, więc na emulatorze
trzeba go zmienić na `http://10.0.2.2:3001`.

**Konto jest potrzebne także do grzebania curlem.** API wymaga nagłówka
`x-session` na każdej trasie poza sześcioma: `GET /api/health`, `GET /api/setup`,
`POST /api/auth/login`, `POST /api/users` przy pustej bazie oraz dwie trasy
aktualizacji kolektora (`GET /api/aktualizacja` i `/api/aktualizacja/apk`).
Te ostatnie są otwarte, bo kolektor pyta o nową wersję przy otwarciu aplikacji
— także wtedy, gdy sesji nie ma. Token bierze się tak samo jak kolektor:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' -d '{"login":"biuro","haslo":"tajnehaslo"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s http://localhost:3001/api/queue -H "x-session: $TOKEN"
```

**Produkcja i wdrożenie w firmie (on-premise): [`DEPLOY.md`](DEPLOY.md).**
Instalator Windows, usługi NSSM, sieć i zapora, APK na kolektorach (pierwsza
instalacja przez MDM, kiosk),
etapy przejścia na MSSQL i Sferę, backup — wszystko tam. Od 0.69.0 także
**środowisko dev obok produkcji** (instalator z `-Dev`, rozdział 6b).

Parametry (env, dev):

| Zmienna | Znaczenie |
|---|---|
| `WORKER_SIM_ERRORS=1` | losowe błędy zapisu (test ścieżki `error` + PONÓW) |
| `SGT_MODE` | `seeded` (domyślnie) lub `mssql` (prawdziwa baza Subiekta) |
| `FORCE_SEED=1` | przeładowuje kartotekę, ale czyści **tylko** tabele `sgt_*` — dostawy, kolejka i `events` zostają i wskazują na skasowane `dok_id`. Pełny reset to usunięcie pliku bazy (`server/data/wertis.db`) |
| `LOC_FIELD_LIMIT` | limit pola `tw_Lokalizacja` (domyślnie 50) |
| `LOC_FORMAT_STANDARD` / `LOC_FORMAT_PALLET` | wzorce adresu — **jedno źródło prawdy**, kolektor pobiera je z `/api/locations` |
| `LOC_STRICT=0` | wyłącza twarde egzekwowanie wzorca poza rozkładaniem (domyślnie **włączone**) |
| `MAG_ID_MAG` / `MAG_ID_MGP` / `MAG_ID_ZWROTY` | id magazynów w SGT — MAG i MGP rozstrzygają, którym trybem idzie dokument; Zwroty służą już tylko kafelkowi „gdzie jeszcze leży" |

## Funkcje (kolektor — aplikacja Android)

**Kto pracuje — konto imienne, nie wolny tekst (plan §7)**
- **Login i hasło**, ten sam wzorzec, co w reszcie firmy (od 0.20.0). Hasło
  leży wyłącznie jako hasz (scrypt, sól per konto), minimum osiem znaków.
- **Nieznany login i błędne hasło wyglądają identycznie** — jeden komunikat
  i ten sam czas odpowiedzi. Pięć nieudanych prób zamyka login na minutę.
- **Sesja nie wygasa sama.** Trwa do wylogowania z Ustawień; bezczynność nie
  robi nic.
- **Operacje nieodwracalne rozstrzyga ROLA.** Zdjęcie dostawy z listy należy do
  biura, a zakładanie kont biurowych do admina. Każde przejście przez bramkę
  zostawia wpis `privileged` z nazwiskiem.

Historia tych decyzji — wolny tekst, plakietki, PIN, blokada bezczynności —
i powody każdej: [`docs/architektura.md`](docs/architektura.md) §6.

**Podgląd i operacje ad-hoc**
- Skan sprzętowy (Zebra DataWedge / Honeywell DataCollection, fallback
  klawiaturowy) / wyszukiwarka (symbol, nazwa, końcówka EAN) — logika `SELECT`
  na serwerze (spec §5.1).
- **Wyszukiwarka wybacza.** `gaznik` znajduje `gaźnik`, słowa mogą iść
  w dowolnej kolejności, a myślnik w symbolu nie ma znaczenia. Literówka też
  jest wybaczana, ale **dopiero gdy nic innego nie wyszło** — wmieszana
  w ranking wypychałaby trafienia dokładne. Ścieżka skanu tej furtki nie ma
  wcale: sama otwiera kartę przy jednym wyniku, więc dopasowanie przybliżone
  prowadziłoby do cudzej kartoteki.
- **Te same reguły mają pola filtra na kolektorze** (pozycje otwartej dostawy,
  lista faktur) — od 0.117.0, przez moduł `:core`. Wcześniej porównywały tekst
  dosłownie, więc `gaznik` i `ls51139` nie znajdowały niczego.
- **Rozpoznanie kodu po wzorcu, nie po heurystyce.** `LOC` jest kategorią
  **zamkniętą**: kod, który nie pasuje do wzorca adresu, adresem nie jest.
  Wzorzec należy do serwera i kolektor go tylko pobiera (`/api/locations`).
  Po klasyfikacji obowiązuje **jedno wyszukanie w jednej dziedzinie, bez
  fallbacku na drugą**. Historia i powody:
  [`docs/architektura.md`](docs/architektura.md) §7.
- **Skan etykiety regału pokazuje jego zawartość od razu**, z ekranu głównego —
  nie trzeba wcześniej wybierać trybu. Pusty regał to poprawna odpowiedź
  („Regał A01-02-03 pusty"), bo półkę skanuje się także po to, żeby sprawdzić,
  czy jest wolna.
- **Kontekstem jest OTWARTY EKRAN, nie ukryty stan.** Skan robi to, co widać.
  Karta towaru otwarta + skan regału → ten towar dostaje ten adres. Skan regału
  bez otwartej karty → zawartość regału. Skan towaru → jego karta. Nie ma paska
  „przypięto", nie ma trybu, nie ma czego zdejmować.

  Dlaczego zniknął „kontekst przyklejony" — poprzednik tego modelu:
  [`docs/architektura.md`](docs/architektura.md) §7.
- **Karta towaru odpowiada nagłówkiem na całe codzienne pytanie.** Symbol,
  wielka liczba dostępnych sztuk i pastylka adresu pickingowego stoją w jednej
  karcie. Rezerwacja, stan łączny i MGP idą podlinijką pod liczbą. Pozostałe
  adresy leżą rzędem niżej, razem z licznikiem 50 znaków pola w Subiekcie.

  > **Dlaczego.** Wcześniej to samo zajmowało dwa kafle po pół ekranu, a adres
  > pickingowy siedział w rzędzie chipów jako jeden z wielu. Magazynier pyta
  > o dwie rzeczy naraz — ile jest i gdzie leży — więc obie odpowiedzi mieszczą
  > się teraz w jednym spojrzeniu. Reszta karty zeszła do trzech zwijanych
  > sekcji.
- **Trzy sekcje zwijane: HISTORIA, POZOSTAŁE MAGAZYNY, ZAMIENNIKI I OPIS.**
  Każda niesie podsumowanie w nagłówku (`ost. Jan K · 07-28`, `SKLEP 3 · SERWIS 0`,
  `24-04003 · MAG 4`). Sekcja bez danych nie pokazuje się wcale.

  > **Dlaczego.** Wszystkie trzy odpowiadają na pytania zadawane rzadko i żadna
  > nie jest krokiem codziennej pracy. Podsumowanie ma wystarczyć bez
  > rozwijania, bo inaczej zwinięcie zamienia jedno spojrzenie w trzy
  > dotknięcia na każdej karcie.
- **„W dostawie, nierozłożone" — czemu stanu nie widać na półce.** Karta podaje
  jedną linią, ile sztuk przyszło na dokumencie z ostatnich 14 dni i nie
  trafiło jeszcze w regał, z numerem dokumentu i dostawcą.

  > **Dlaczego dostawca.** Numer dokumentu identyfikuje dostawę w Subiekcie,
  > ale w strefie przyjęć nie jest napisany nigdzie — na palecie i na kartonach
  > widać nazwę dostawcy. To ona prowadzi rękę do towaru.

  > **Dlaczego.** Przy dostawie krajowej skutek magazynowy niesie sam dokument
  > w Subiekcie, więc towar figuruje na MAG od chwili zaksięgowania. Kafel stanu
  > nie odróżnia „leży w regale" od „stoi na palecie w przyjęciach" i pokazywał
  > 12 szt przy pustej półce. Pominięte pozycje i te ze zgłoszonym wyjątkiem
  > ZOSTAJĄ na liście — tak samo nie ma ich w regale.
- **„Zamówione u dostawcy" — czego nie ma i kiedy przyjedzie.** Kolejna linia
  tej samej karty: ilość pozostała do dostarczenia, termin i dostawca.
  Zamówienie odebrane w całości znika z listy.

  > **Dlaczego.** To druga połowa tego samego pytania. Linia wyżej mówi
  > „przyjechało, poszukaj w przyjęciach", ta mówi „nie ma i trzeba poczekać".
  > Stoi niżej i ma szary tusz oraz własną ikonę, bo nie daje żadnej czynności.
  > Kolejność idzie po terminie, nie po dacie wystawienia — pytanie brzmi
  > „kiedy będzie".
- **Zamienniki z opisu kartoteki.** Opisy od lat niosą symbole zamienników
  (`Zamiennik: 24-04003`, `Zamiennie: 101-024 // KAR00149`), tyle że jako prozę,
  której nie da się dotknąć. Serwer je wycina (`services/zamienniki.ts`), a to,
  co jest NASZĄ kartoteką, staje się wierszem ze stanem i lokalizacją —
  dotknięcie otwiera kartę zamiennika. Sekcja jest zwinięta i niesie także sam
  opis kartoteki.

  Rozstrzyga kartoteka, nie wzorzec. Z 2304 tokenów w sekcjach zamienników tylko
  478 to nasze towary. Reszta to numery OEM i katalogi obcych firm — zostają
  szarym tekstem, bo idą w rozmowę z dostawcą. `+` nigdy nie rozdziela:
  w opisach łączy części zestawu, więc podział podałby pół kompletu jako
  pełnoprawny zamiennik.

  **Lista bez nagłówka też się liczy** (0.61.0). Część kartotek ma w opisie sam
  ciąg `S11100 // G74050 // MF381350`, bez słowa „Zamiennik". Podwójny ukośnik
  w prozie się nie zdarza, więc sam w sobie jest sygnałem. Tryb bez nagłówka
  jest węższy: wymaga `//`, bierze tylko tokeny z cyfrą i milczy przy jednym
  trafieniu, bo numer modelu bywa naszym symbolem. Numery obce z takiej listy
  nie powstają — bez nagłówka nie wiadomo, czym są.
- Zmiana lokalizacji: **skan półki przy otwartej karcie** — przy jednym adresie
  zastępuje od razu, przy ≥2 pyta arkuszem zastąp/dodaj/zastąp jedną. Walidacje
  bez spacji i długości. Pomyłkę poprawia się skanem właściwej półki — nie ma
  czego cofać.

  > **Dlaczego bez przycisku.** Do 0.41.0 stał pod spodem „ZMIEŃ LOKALIZACJĘ"
  > i prowadził na ekran skanu, który robił dokładnie to samo, co ten sam skan
  > przy otwartej karcie. Był przy tym największym elementem karty — a ZASTĄP
  > kasuje istniejący adres, podczas gdy bezpieczne „+ DODAJ" jest tylko małym
  > chipem. Waga na ekranie była odwrotna do ceny pomyłki.
- Dołożenie drugiego adresu: chip **„+ DODAJ"** w rzędzie adresów (albo pastylka
  „+ DODAJ ADRES" w nagłówku, gdy towar nie ma żadnego). To jedyne wejście na
  ekran skanu półki i ma on od 0.41.0 jedno znaczenie: dokłada, nie zastępuje.
- **Lokalizacja „w drodze".** Pole lokalizacji w Subiekcie zmienia się dopiero po
  udanym zapisie przez workera, więc do tego czasu karta pokazywałaby stan sprzed
  skanu. Chipy niosą więc stan zamiast milczeć: dochodząca — przerywana ramka
  i `⏳`; schodząca — kod przekreślony; **nieudany zapis — czerwony i pulsuje**.
  Tapnięcie w czerwony chip prowadzi wprost do kolejki z PONÓW.

  Pulsuje wyłącznie błąd, bo tylko on wymaga reakcji człowieka i tylko on jest
  stanem trwałym. Ten sam sygnał widać z drugiej strony — na zawartości regału
  (`jedzie tutaj` / `schodzi stąd`). To ten sam pomysł, co `⏳ N szt w drodze`
  przy stanach.
- Kolejka Sfery: statusy `pending`/`processing`/`waiting_for_doc`/`done`/`error`,
  PONÓW, polling, pull-to-refresh. Wejście prowadzi przez **pastylkę statusu
  Sfery** w prawym górnym rogu. Pastylka jest zarazem wskaźnikiem stanu: zielona
  = OK, amber = ⏳ w kolejce z licznikiem, czerwona = błąd. Dolny pasek ma
  4 zakładki: SKAN, DOSTAWY, ZWROTY i KARTON.
- Bufor offline (plik JSON + WorkManager) na zapisy przy zaniku Wi-Fi, asysta niskiej baterii,
  log upadków urządzenia (`device_drop`) dla serwisu.

**DOSTAWY — Tryb A (redesign v2.0)** — druga zakładka
- Jednostką pracy jest **dokument**, nie sesja. Zakładka pokazuje typy z
  `DOK_TYPY_DOSTAW` (domyślnie sama FZ) z okna `DOK_DNI_WSTECZ` (domyślnie
  14 dni). Pozycje **usługowe** (symbole z `POZYCJE_NIE_TOWAROWE`, domyślnie
  `PRZESYŁKA` — wiersz „koszt transportu") wypadają z rozkładania w ogóle: nie
  ma ich czym zeskanować ani gdzie położyć.
  Dokumenty **w buforze** też są do wzięcia. Przy dostawie krajowej
  skutek magazynowy niesie sam dokument w Subiekcie, więc aplikacja zapisuje
  **wyłącznie lokalizację** — zero MM, zero `waiting_for_doc`.
- Ścieżka codzienna to **dwa skany na pozycję**. Skan towaru rozwija wiersz
  z ilością i lokalizacją docelową. Skan etykiety regału zapisuje adres i zwija
  wiersz jako odłożony. Bez dialogu potwierdzającego.

  Postęp zapisuje się per pozycja, więc przerwanie pracy nic nie kosztuje.
  Dostawa zamyka się sama, gdy nie ma już czego rozkładać.
- **Nic nie podmienia listy.** Rutyna i rozjazd lokalizacji dzieją się
  w wierszu. Wyjątek ze zdjęciem i wybór przy kolizji EAN wysuwają się jako
  arkusz od dołu. Dostawa zostaje widoczna pod spodem, bo to na niej widać, ile
  jeszcze zostało w kartonie.
- Lista jest **kontrolą kompletności, nie kolejką**. Pozycje bierze się z kartonu
  w takiej kolejności, w jakiej wpadną w rękę. Odłożone **zwężają się do paska
  ze zdjęciem** i schodzą pod pracę do zrobienia, od ostatnio odłożonej.
  Pozycje **BEZ LOKALIZACJI** stoją między jednymi a drugimi jako osobna grupa.

  Serwer sortuje po lokalizacji docelowej, ale kolektor nie rysuje już nagłówków
  alejek — przy pracy „co wpadnie w rękę" nikt po nich nie nawigował.
- **Niejednoznaczny kod kreskowy zatrzymuje operację** — aplikacja nigdy nie
  bierze „pierwszego dopasowania”. Jedyne automatyczne zawężenie: dokładnie
  jeden kandydat występuje w otwartym dokumencie.
- **Stan dostawy mieszka w aplikacji, nie w Subiekcie.** Postęp jest liczony
  z pozycji: co odłożone, gdzie, przez kogo i z jakim wyjątkiem. Do 0.15.0
  aplikacja rzutowała ten stan na flagę faktury, żeby widziało go biuro —
  ten kanał został zamknięty razem z prawem zapisu do tabeli flag.
- **Liczy się każdą pozycję**, więc skan półki niesie znaczenie „policzyłem,
  zgadza się". Ilość ustawia licznik − / +, a od 0.113.0 także **wpisanie
  liczby** po dotknięciu jej w kaflu — sto sztuk nadmiaru nie może znaczyć stu
  stuknięć. Rozbieżność zgłasza się jako wyjątek („Zła ilość").
- **Własna pomyłka w liczeniu to nie reklamacja.** Przycisk **POPRAW ILOŚĆ**
  ustawia liczbę odłożonych sztuk na nowo, dopóki faktura jest otwarta. Zmiana
  zostaje w WERTIS: nie rusza Subiekta, nie kasuje zapisanego adresu i nie
  tworzy wyjątku. Pozycja ze zgłoszonym wyjątkiem jest poza jej zasięgiem.
- **Jedna dostawa, jedna osoba.** Blokady pozycji z TTL wyszły w 0.47.0. Nie
  rozstrzygały tu żadnego realnego sporu, a kosztowały wiszące „zajęte przez"
  po kolektorze odłożonym na koniec zmiany. Podwójne odłożenie widać na liście
  („odłożono 8 z 5") i poprawia je POPRAW ILOŚĆ.
- **Rozjazd lokalizacji**: skan innej półki niż kartoteka otwiera pytanie
  **PRZED zapisem** — „przeniesiony (ZAMIEŃ)” czy „leży w obu (DODAJ)”. Z samego
  skanu tych dwóch sytuacji odróżnić się nie da, więc decyduje człowiek.
- **Wyjątki jako obiekt pierwszej klasy.** Lista kategorii jest zamknięta. Od
  0.21.0 jest to lista z firmowego formularza „Niezgodność w dostawie": błędny
  artykuł, brak w przesyłce, uszkodzone w transporcie, zła ilość, artykuł
  niezamówiony.

  Każda kategoria wymaga **ilości** — tak samo jak formularz. Przy uszkodzeniu
  i błędnym artykule **zdjęcie jest obowiązkowe**: to dowód do reklamacji, robi
  je systemowy aparat. Artykuł spoza dokumentu wymaga numeru katalogowego, bo
  nie ma linii, z której dałoby się go odczytać. Numer przesyłki i pytanie
  o protokół kuriera padają **raz na dostawę**, nie przy każdym artykule —
  przesyłka jest jedna. Pozycja z wyjątkiem wypada z rutyny, ale nie blokuje
  zamknięcia dostawy.

  Kluczy sprzed 0.21.0 (`qty_short`, `no_space`…) serwer od 0.26.0 już **nie
  przyjmuje** — okno wdrożenia APK się zamknęło. Etykiety zostają na zawsze:
  historii się nie kasuje, a protokół dla dostawcy nie może pokazywać
  surowego klucza.
- Ekran **WYJĄTKI**: nierozwiązane zgłoszenia (pytane przy starcie aplikacji,
  czerwony pasek na każdym ekranie do czasu zamknięcia) + **raport kolizji
  kodów** dla biura. Eksport problemów dostawy do **CSV** (`;` + BOM, Excel PL)
  pod `GET /api/delivery/:id/problems.csv`.

**KARTON — rozkładanie od zera (0.122.0)** — czwarta zakładka
- Pakujący odkładają do jednego pudła towary źle zebrane pod zamówienia.
  Ten obieg **nie ma dokumentu** i nie będzie go miał: towar nie opuścił
  magazynu, więc żaden stan się nie zmienia.
- NOWY KARTON otwiera puste pudło z kodem nadanym przez aplikację (`K-1`).
  Skan dokłada **jedną sztukę** i sumuje na istniejącej pozycji; większą liczbę
  wpisuje się z klawiatury. Przed ZATWIERDŹ pozycję wolno usunąć.
- **Wpisywanie szuka w kartotece**, a nie dodaje w ciemno (0.123.0). Te same
  reguły co w dostawie; wyniki to lista z półkami i stanem, a dotknięcie
  wiersza dokłada towar. Każda pozycja pokazuje adres jedną linią pod nazwą:
  pełny kod półki pickingowej i licznik pozostałych (0.124.0).
- **ANULUJ KARTON** na każdym etapie. Pusty znika z bazy, pudło z zawartością
  zostaje ze statusem ANULOWANY. Pozycje już odłożone zostają odłożone.
- Po ZATWIERDŹ karton jest zwykłym koszem do rozłożenia: ten sam ekran, ten sam
  skan półki, ten sam ZAKOŃCZ. **Zapisują się wyłącznie adresy** — żadnego MM.
- W bazie karton to wiersz tabeli `kosz` z `rodzaj = 'karton'`. Biuro widzi go
  na liście koszy z pastylką KARTON i wyłącznie ogląda.

**Przesunięcie stanu między magazynami**
- **Jedna czynność, nie tryb pracy**: przesuń tyle a tyle sztuk z magazynu do
  magazynu. Wychodzi z kafla magazynu na karcie towaru, z podlinijki „MGP N"
  oraz z rozwiniętego wiersza kontenera. To jedyne miejsce, w którym powstaje
  dokument **MM**.
- **Kolejka jest zarazem rezerwacją**: dostępne to stan minus przesunięcia,
  które jeszcze czekają na workera. Drugie przesunięcie widzi już pomniejszony
  stan, zamiast dowiadywać się o odmowie godzinę później.
- **Adres najpierw, stan potem.** Zadanie `set_location` idzie do kolejki przed
  `mm`, bo MM czyni towar sprzedawalnym. Odwrotna kolejność dawałaby okno,
  w którym towar jest już do wzięcia, a jego adres w kartotece stary.
- Przy celu **MAG skan półki jest obowiązkowy**, przy innym magazynie
  **zabroniony**. Adres w kartotece to jedno pole na towar, bez wymiaru
  magazynu — opisuje regał na hali.
- **Bez bufora offline** — przesunięcie wymaga sieci. Wysłane pół godziny
  później trafiłoby w stan, którego już nie ma.

**Magazyn skutku decyduje, co zostaje PO rozłożeniu**
`MAG` → dostawa krajowa: towar już leży na hali, brakuje mu adresu, po
odłożeniu nie zostaje nic. `MGP` → kontener importowy (~4× w roku): rozkłada
się identycznie, ale jego stan trzeba jeszcze przesunąć na halę. Lista dostaw
oznacza go pastylką **przyjęcia**, żeby było to widać przed wejściem w alejkę.

**Telemetria, która mierzy właściwą rzecz**
- **Wejście ręczne liczone osobno od skanu** (`manual_entry`). Udział wpisów
  ręcznych **per regał** to darmowy raport jakości etykiet; **per towar** mówi,
  która kartoteka nie ma czytelnego kodu.
- **Czas skan → odpowiedź mierzy klient, nie serwer** (`scan_timing`), bo
  serwer pomija sieć i render. Cel: `p95 < 150 ms`; powyżej ~300 ms ludzie
  skanują podwójnie, a to błąd **ilościowy**.
- Cztery liczby pod `GET /api/metrics` — liczby, nie panel. Raport wydajności
  per osoba to **monitoring pracowniczy** — obowiązki formalne PRZED jego
  uruchomieniem opisuje [`DEPLOY.md`](DEPLOY.md) §5a.

**Raport przeslotowania — mierzy pion, nie odległość**
- `npm run reslot` (1–2× w roku, przed sezonem) czyta Subiekta read-only i daje
  cztery listy do wydruku, posortowane **po lokalizacji**, żeby chodzić alejką
  raz. Nie jest to funkcja aplikacji — człowiek z wydrukiem robi to w dzień.
- Pobrania liczy jako **wystąpienia pozycji na WZ, nie sumę ilości**; strefa
  złota jest per zakres regałów. Uruchomienie i pułapki (m.in. odmowa bez
  historii pobrań): [`DEPLOY.md`](DEPLOY.md) §7.
- Od 0.50.0 **tę samą regułę progu** (górne 15% rotacji) stosuje bieżący
  import zbiórek z Sellasist w panelu biura. Kandydat stojący poza strefą
  dostaje adnotację na karcie towaru w kolektorze — obie ścieżki liczą jedną
  miarą, więc nigdy nie wskażą sprzecznych list. Reguły strefy mieszkają
  w bazie i są edytowalne z `/biuro` → ANALIZA.

**Nocna rekoncyliacja — niezmienniki trzeba mierzyć, nie deklarować**
- `npm run reconcile` (raz na dobę z crona) porównuje adres w Subiekcie
  z ostatnim udanym zapisem i wyławia zawieszone zadania kolejki.
- **Zerowy wynik nie tworzy raportu.** Rozjazdy → CSV + kod wyjścia `2` pod
  alert. Ustawienie i szczegóły: [`DEPLOY.md`](DEPLOY.md) §7.

**Biuro — podgląd pod `/biuro`**
- Jedna strona HTML bez builda (`server/src/web/biuro.html`), serwowana przez
  API. Logowanie loginem i hasłem, dane czytane istniejącymi trasami z tokenem
  sesji. Strona nie ma własnych uprawnień, a jedyny zapis poza logowaniem to
  zdjęcie dostawy z listy pracy (niżej) — zastrzeżone dla roli `biuro`.
- **Pasek stanu to dwie ikony, widoczne z każdej zakładki** (0.114.0).
  Ikona SYSTEM zmienia kolor: zielony — wszystko gra, bursztyn — działa, ale
  kuleje, czerwień — coś stoi. Najechanie pokazuje pełne zdania: wersję i tryb
  serwera, workera, kolejkę, rozjazdy i problemy z `/api/health`. Kliknięcie
  prowadzi do STANU SYSTEMU. Ikona ALLEGRO mówi kolorem o stanie konta,
  a kliknięcie otwiera stojącą tam kartę KONTO ALLEGRO i zaczyna parowanie.
- **W pasku stoi tylko praca** (0.76.0), w dwóch grupach oddzielonych kreską.
  PRACA (dostawy, magazyn zwrotów) otwiera się kilkanaście razy dziennie.
  WGLĄD (stan systemu, dziennik, analiza) wtedy, gdy czegoś szukam.
- **Ustawienia siedzą za zębatką** w nagłówku, obok Wyloguj. Dziś prowadzi
  do DOSTAWCÓW. Konfiguracja nie jest zakładką pracy i nie ma ważyć tyle,
  co dostawy.
- **DOSTAWY I REKLAMACJE** — postęp per dokument oraz nierozwiązane wyjątki;
  protokół rozbieżności (ze zdjęciami) do druku, obok CSV.
- **Wyjątki widać z listy** (0.57.0): wiersz dostawy niesie licznik
  nierozwiązanych zgłoszeń. Pasek postępu ich nie pokaże i pokazać nie może —
  wyjątek liczy się jako pozycja domknięta. Biuro może też **zamknąć wyjątek**
  z notatką, która trafia do protokołu.
- **Odpowiedź na notatkę wraca sama** (0.57.0): pasek stanu pokazuje licznik
  nieprzeczytanych odpowiedzi. Kliknięcie licznika **prowadzi do karty**. Karta
  stoi nad tabelą dostaw i niesie pytanie, odpowiedź i przycisk PRZECZYTANE.
  Stan „przeczytane" siedzi w bazie, więc gaśnie także na drugim biurku.
- **DOSTAWCY** (0.56.0): logo firmy wgrywane raz, widoczne potem po lewej
  stronie wiersza na liście dostaw w kolektorze. Plik może być w dowolnym
  formacie — **PNG, JPG, WEBP albo SVG** — bo przerabia go przeglądarka, zanim
  cokolwiek pojedzie na serwer. Logo wiąże się z identyfikatorem kontrahenta
  z Subiekta, więc przeżywa poprawkę nazwy. Bez konfiguracji: działa od razu.
- **Wejście w fakturę** (0.36.0): kliknięcie wiersza pokazuje jej pozycje —
  zdjęcie kartoteki, ile odłożono z ilu, adres, status, kto odłożył i kiedy.
  Rozjazd adresu jest wyróżniony, a zgłoszony wyjątek siedzi w wierszu swojej
  pozycji. Wejść da się także w dokument, którego **nikt jeszcze nie zaczął** —
  wtedy pozycje idą wprost z faktury i nagłówek mówi o tym wprost. Podgląd
  **czyta**: kliknięcie nie otwiera dostawy i niczego w niej nie przestawia.
- **„ROZŁOŻONE POZA WERTIS"** (0.40.0) — dostawa rozłożona starą aplikacją albo
  z ręki nie ma w WERTIS ani jednego śladu. Stoi więc na liście jako nietknięta
  i psuje kartę towaru: „w dostawie" o towarze z półki. Biuro zdejmuje taki
  dokument z listy, podając powód. Zamknięcie nie dopisuje ani jednej pozycji,
  nie zapisuje adresu i nie rusza Subiekta. Zamknięte leżą w osobnej karcie
  z nazwiskiem i powodem, i wracają na listę jednym kliknięciem.

  > **Dlaczego to nie jest „ROZŁOŻONA".** `done` znaczy „ludzie odłożyli to
  > tutaj i mamy z tego skany". O tej dostawie powiedzieć się tego nie da,
  > a jedna wartość na oba stany kazałaby czytać raporty odłożeń jako pracę,
  > której nikt nie wykonał.

  > **Dlaczego biuro, nie hala.** To jedyna operacja zdejmująca pracę z listy
  > bez ani jednego skanu — czyli jedyny sposób, żeby „rozłożyć" całą dostawę,
  > nie wstając z krzesła. ORZEKA, że pracy nie ma, więc należy do roli, która
  > czyta protokoły rozbieżności.
- **STAN SYSTEMU** — metryki w oknie 7, 30 albo 90 dni: dotknięcia na pozycję,
  p95 skanu, etykiety do przedruku i kartoteki bez czytelnego kodu. Niżej
  kolejka zapisów, rekoncyliacja na żądanie z eksportem CSV, kolizje kodów
  i meldunek serwera.
- **DZIENNIK** — ślad audytowy z filtrami po dacie, typie, towarze i urządzeniu
  oraz eksport CSV. Wymaga roli biura albo admina; magazynier
  dostaje tu odmowę zamiast danych.
- **Kolejki się stąd nie ponawia i wydajności per osoba tu nie ma.** Pierwsze
  jest zapisem do Subiekta i zostaje na kolektorze, drugie jest monitoringiem
  pracowniczym (Kodeks pracy art. 22²) i zostaje pod `GET /api/wydajnosc`.

## Struktura repo

```
android/                   KOLEKTOR — natywna aplikacja (Kotlin/Compose), android/README.md
  core/                    czysta logika JVM (skan, DTO, nawigacja, wyjątki, offline)
                           + 268 testów jednostkowych; buduje się bez Android SDK
  app/                     aplikacja Compose: 15 ekranów, skanery, czujniki
server/                    backend (Fastify + SQLite + worker)
  seed/products.json       3415 kartotek z magmat.xlsx (źródło seedu)
  src/db/schema.sql        tabele aplikacji (§7) + read-model sgt_*
  src/db/seed.ts           seed z products.json: dokumenty FZ/PZ per dostawca,
                           w tym jeden kontener na MGP
  src/db/seed-scenariusze.ts  dane do przypadków brzegowych (docs/scenariusze-testowe.md)
  src/adapters/            Subiekt/Sfera: seeded+dev (tu) oraz mssql+sql (prod)
  src/services/            delivery (rozkładanie faktur zakupu),
                           przesuniecie (stan między magazynami, MM),
                           problems + ean (wyjątki),
                           stock (korekta o kolejkę), dostawy-towaru (co przyszło,
                           a nie leży w regale), podglad-dostawy (pozycje
                           dokumentu dla biura — sam odczyt),
                           queue, locations, events, notatki (do dostaw),
                           zamienniki + zamowienia-towaru (karta towaru),
                           kosze + karton + przyjecia (zwroty na regale),
                           ksztalt (opis kształtu JSON bez treści — sonda),
                           raporty + reslot (analiza), zbiorki + strefa-zlota
                           (rotacja z Sellasist),
                           aktualizacja (APK dla kolektorów)
  src/routes/              products, delivery, problems, przesuniecie, queue,
                           locations, device (§8), auth, magazyny, audyt,
                           analiza, zbiorki, biuro, aktualizacja (APK),
                           dostawcy (logo), kosze, kartony, przyjecia,
                           allegro (parowanie konta)
  data/photos/             zdjęcia dowodowe do reklamacji (poza gitem)
  data/zdjecia/            CACHE zdjęć kartotek z Subiekta — wolno skasować
  data/apk/                APK dla kolektorów — kładzie go instalator
  data/reconcile/          raporty rekoncyliacji (CSV)
  data/reslot/             raporty przeslotowania
  src/worker/worker.ts     pętla poll, retry/backoff, waiting_for_doc (§9)
docs/architektura.md       jak to jest zbudowane i dlaczego tak (start dla nowej osoby)
docs/analiza-rozkladanie.md rozkładanie i przesunięcia + backlog
docs/scenariusze-testowe.md katalog przypadków brzegowych: co seed buduje,
                           jak to sprawdzić i czego oczekiwać
docs/porownanie-asystent.md WERTIS a Firmes+ Asystent Magazyniera — materiał do
                           decyzji dla właściciela: zakres, scenariusze, koszty,
                           środowisko demo
CHANGELOG.md               co się zmieniło i czy wymaga działania przy wdrożeniu;
                           tam też reguła, kiedy rośnie który człon wersji
docs/subiekt-gt-edu-setup.md  podpięcie Subiekta GT krok po kroku
docs/subiekt-gt-struktura.md  co WERTIS czyta i pisze w bazie Subiekta
docs/slownik.md            jak pisze się tę dokumentację: reguły w duchu
                           ASD-STE100 i słowniczek terminów
instalator/README.md       instalator Windows: usługi, kreator konfiguracji,
                           konto SQL o minimalnych uprawnieniach
tools/convert_xlsx.py      konwersja eksportu Subiekta → products.json
tools/docs_check.py        kontrola spójności dokumentacji z repo (martwe ścieżki,
                           usunięte byty, liczby ekranów/testów) — `python3 tools/docs_check.py`
tools/styl_check.py        mierzalna część reguł z docs/slownik.md (długość zdania
                           i akapitu, odrzucone terminy)
tools/kt_imports_check.py  namiastka kompilatora dla :app (brakujące importy,
                           bilans nawiasów) — :app nie kompiluje się bez SDK
.github/workflows/         CI: android.yml (testy :core, APK debug, a na main
                           podpisane wydanie z sumą SHA-256), server.yml
                           (testy serwera, tsc, docs_check), instalator.yml
```

## Dane testowe

`server/seed/products.json` z eksportu `magmat.xlsx` (`tools/convert_xlsx.py`,
rozpoznaje kolumny po nazwie). Eksport zawiera **prawdziwe** kolumny `Stan`
(MAG), `Rezerwacja`, `MGP` (strefa przyjęć) i `Dostawca`, więc konwerter bierze
je wprost, bez syntetyki. Dla starszego, płaskiego eksportu bez tych kolumn
konwerter nadal rozdziela stany deterministycznie hashem.

94 towary mają stan na MGP. Seed buduje z nich dokumenty FZ/PZ **pogrupowane po
realnym dostawcy**. Duże paczki dzieli po ≤20 pozycji i zostawia jeden dokument
w buforze, jako test `waiting_for_doc`.

Seed rozstawia dokumenty po **dwóch magazynach skutku**, żeby demo pokazywało
oba przypadki:

- krajowe FZ/PZ na `MAG` — po odłożeniu nie zostaje nic,
- jeden dokument na `MGP` jako kontener — zostaje stan do przesunięcia.

Magazyn `Zwroty` dostaje same stany — kafel „gdzie jeszcze leży" ma wtedy co
pokazać. W produkcji stany i dokumenty pochodzą z `tw_Stan` i `dok__Dokument`
przez adapter MSSQL (patrz
[`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md)).

### Przypadki brzegowe — `npm run seed:scenariusze`

Kartoteka wyżej pokazuje ścieżkę codzienną i tyle. Rzeczy, na których aplikacja
naprawdę się łamie, nie ma w niej wcale. Brakuje kolizji kodów, zadania
w błędzie, zdjęcia bez pliku i adresu spoza wzorca.

```bash
npm run seed                 # kartoteka — raz
npm run seed:scenariusze     # 66 przypadków brzegowych, dopisywane do kartoteki
```

Katalog scenariuszy z instrukcją sprawdzenia:
[`docs/scenariusze-testowe.md`](docs/scenariusze-testowe.md). Źródłem danych jest
[`server/src/db/seed-scenariusze.ts`](server/src/db/seed-scenariusze.ts), a test
pilnuje, że oba mówią to samo.

Seed jest **dopisaniem, nie wymianą**: kasuje wyłącznie własne wiersze
(`tw_id` od 900001, `dok_id` od 9001, własne konta) i buduje je od nowa. Można go
uruchamiać dowolnie często, żeby wrócić do punktu wyjścia.

Zakłada konta ze znanym hasłem i wystawia gotowe tokeny sesji, więc przy
`SGT_MODE=mssql` **odmawia startu**. Zasila też dokumenty WZ z historią pobrań —
bez nich `npm run reslot -- --demo` nie ma czego liczyć i odmawia wypisania
trzech pierwszych list.

## Praca z prawdziwym Subiektem GT

Docelowa wersja w firmie: **Subiekt GT 1.87 SP3 HF1** (era KSeF — brak natywnego
pola lokalizacji, stąd pole własne `tw_Pole1..8`).

Tryb `SGT_MODE=mssql` (Windows z Subiektem, także **wersja edu**) to CAŁE
połączenie. Wystarczy do niego **jeden login** o minimalnych uprawnieniach,
a tryb zapisu wynika z `SGT_MODE` — osobnego przełącznika nie ma. Podpięcie
krok po kroku: [`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md);
etapy przejścia na produkcję: [`DEPLOY.md`](DEPLOY.md) §6.

W tym środowisku (chmura Linux, bez Subiekta/MSSQL) działa tryb `seeded` —
API, kolejka, worker i rozkładanie realnie na SQLite zasilonym danymi
z eksportu Subiekta.
