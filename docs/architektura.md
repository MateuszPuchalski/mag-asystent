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

Przez kolejkę i osobne procesy:

| co | gdzie | kiedy |
|---|---|---|
| pole lokalizacji na kartotece | `tw__Towar.tw_Pole1` (konfigurowalne) | po skanie regału |
| podstawowy kod kreskowy | `tw__Towar.tw_PodstKodKresk` (0.37.0) | gdy człowiek nada go kartotece |
| dokument MM | Sfera COM (`sfera-worker/`) | tylko przy `SFERA_WORKER=1` |

Kod kreskowy rozszerzył tę listę z jednej pozycji do dwóch i było to świadome:
magazynier stojący z kartonem, którego kodu kartoteka nie zna, nie miał gdzie go
wpisać. Rozszerzenie kosztuje osobny `GRANT UPDATE` na tę jedną kolumnę, a bez
niego funkcja **nie pada** — kod działa na kolektorze (tabela `ean_alias`),
a zadanie czeka w kolejce ze statusem `error`.

**Procesy Node nie robią żadnego `INSERT` do tabel dokumentów i nie modyfikują
stanów.** Nie tworzą dokumentów, nie zmieniają ilości i nie ruszają cen.
Dokumenty MM (`createMM`, kontrakt w `adapters/sfera.ts`) wykonuje worker Sfery
(`sfera-worker/`, C#) — osobny, opcjonalny proces włączany `SFERA_WORKER=1`
(§3, „Trzeci proces").

Wniosek praktyczny: przy wyłączonym `SFERA_WORKER` **najgorsze, co WERTIS może
zrobić Subiektowi, to wpisać zły adres w jednym polu tekstowym kartoteki** —
odwraca to jeden `UPDATE`. Włączenie workera Sfery świadomie rozszerza pole
rażenia o dokument MM ze skutkiem magazynowym; dlatego siedzi za osobnym
przełącznikiem i osobnymi bramkami wdrożenia (`docs/wdrozenie.md`).

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
│  SQLite (node:sqlite, WAL) — 23 tabele:                      │
│    delivery + delivery_line   rozkładanie faktur zakupu      │
│    delivery_note              notatki biura do dostawy       │
│    problem, ean_conflict      wyjątki                        │
│    ean_alias                  kody nadane w WERTIS           │
│    zdjecie_cache              zdjęcia kartotek z Subiekta    │
│    zbiorka, strefa_regula     rotacja i strefa złota         │
│    app_user, device_session   tożsamość (§7)                 │
│    sfera_queue                kolejka zapisów do Subiekta    │
│    events                     audyt — każdy skan i decyzja   │
│    process_state              meldunki procesów (api|worker|sfera)
│    counters, magazyn_widocznosc                              │
│    sgt_*                      READ-MODEL Subiekta (7 tabel)  │
└──────────┬───────────────┬───────────────┬──────────────────┘
           │ ta sama baza SQLite            │ odczyt co 60 s
┌──────────▼──────────┐    │    ┌───────────▼──────────────────┐
│ Worker (osobny      │    │    │ MSSQL Subiekta GT            │
│ proces Node)        │────┼───▶│  odczyt: kartoteki, stany,   │
│ pętla poll, retry,  │ UPDATE  │          dokumenty           │
│ backoff             │    │    │  zapis: dwa pola (§1)        │
└─────────────────────┘    │    └──────────────▲───────────────┘
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐    │                   │ MM przez COM
  Worker Sfery (C#)   ◀────┘                   │ Sfery
│ opcjonalny:         │────────────────────────┘
  SFERA_WORKER=1 (§3)
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

**Biuro ma podgląd pod `/biuro`** — jedną stronę HTML bez builda
(`server/src/web/biuro.html`), serwowaną przez API i czytającą istniejące trasy
z tokenem sesji. Wcześniejszy `/lookup` zniknął razem z klientem PWA; nowy
podgląd świadomie nie jest drugim frontem: zero frameworka, zero zapisu.
Powstał w 0.18.0, bo wycięcie flagi faktury (0.16.0) zamknęło jedyny kanał,
którym biuro widziało stan dostaw.

Od 0.36.0 da się z listy **wejść w fakturę** i zobaczyć jej pozycje: zdjęcie,
postęp, adres, autora odłożenia i wyjątek przy właściwej linii. Także taką,
której nikt nie zaczął — a to jest cała trudność tej trasy. Otwarcie dostawy
(`openDelivery`) jest ZAPISEM: zakłada rekord, sprząta pozycje usługowe
i przestawia dokument na W TOKU. Podgląd nie ma prawa go wołać, bo wtedy samo
patrzenie zapełniałoby listę pracy dokumentami, których nikt nie tknął. Dlatego
`services/podglad-dostawy.ts` czyta dwoma drogami — snapshot z `delivery_line`
albo pozycje z faktury tym samym helperem, którego użyje otwarcie — i mówi
w odpowiedzi, którą z nich pokazuje.

Od 0.27.0 ma zakładki i pasek stanu: dostawy z reklamacjami, stan systemu
(metryki, kolejka, rekoncyliacja, kolizje kodów, meldunek serwera) oraz ślad
audytowy z filtrami. Zasada „zero zapisu" nie drgnęła — ponowienie zadania
z kolejki zostaje na kolektorze, bo jest zapisem do bazy firmy wykonywanym
przez osobę stojącą przy półce.

Od 0.48.0 doszła zakładka ANALIZA: operacje per dzień i per godzinę, rytm
dostaw, najczęstsze wyszukiwania (w tym bez wyniku), zdrowie urządzeń oraz —
decyzją właściciela ODWRACAJĄCĄ wcześniejszą — raport wydajności per osoba.
Do 0.47.x strona celowo go nie odpytywała; teraz pokazuje go z podstawą
prawną nad tabelą, bo obowiązek informacyjny z Kodeksu pracy nie zniknął.

Od 0.50.0 zakładka ANALIZA przyjmuje pierwszy kanał danych spoza Subiekta:
eksport zbiórek z systemu sprzedażowego (Sellasist, CSV). Serwer liczy z niego
kandydatów do strefy złotej — górne 15% rotacji stojące poza strefą — tą samą
regułą progu co roczny raport przeslotowania. Kandydat dostaje adnotację na
karcie towaru w kolektorze. Import jest idempotentny po `ID Koszyka`, a plik
z dopasowaniem poniżej połowy wierszy jest odrzucany w całości. Reguły strefy
(które poziomy regału są „złote") mieszkają w tabeli `strefa_regula` i są
edytowalne z tej samej zakładki, za rolą `biuro`/`admin`. Docelowo ten sam
`POST /api/biuro/zbiorki/import` ma wołać integracja — bez zmian po naszej
stronie.

---

## 3. Dlaczego osobne procesy

API i worker to **osobne procesy z tą samą bazą**, i to nie jest podział dla
elegancji. (Na produkcji z MM dochodzi trzeci — worker Sfery, niżej.)

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

### Trzeci proces: worker Sfery (`sfera-worker/`, opcjonalny)

Na produkcji dokumentów MM nie da się wystawić SQL-em (numeracja, skutki
magazynowe, wycena — domena Sfery COM), a COM żyje tylko na Windows
z Subiektem. Stąd trzeci proces — C#/.NET, ta sama baza, ta sama kolejka —
wykonujący **wyłącznie zadania `mm`**. Włącza go `SFERA_WORKER=1`; bez
przełącznika nic się nie zmienia (mm kończy się czytelnym błędem, dokument
wystawia biuro).

Podział pracy jest pilnowany z obu stron:

- worker Node przy `SFERA_WORKER=1` **nie dotyka** zadań `mm`
  (filtr w `pickTask`, `worker/kolejka.ts`),
- worker Sfery bierze wyłącznie `mm` — i **pomija** zadanie, dopóki wcześniejsze
  niewykonane `set_location` tego samego towaru nie wejdzie
  (`sfera-worker/sql/pick_mm_pending.sql`).

Ten drugi punkt to nowy strażnik starego niezmiennika. Przy jednym workerze
„adres przed sprzedawalnością" gwarantowała kolejność wstawienia (`ORDER BY id`,
patrz `services/przesuniecie.ts`); dwa niezależne pollery łamią ją
konstrukcyjnie, więc guard przeniósł się do zapytania wyboru zadania. Te same
pliki SQL wykonuje test `server/src/worker/sfera-pick.test.ts` — zmiana guardu
jest mierzona w CI bez dotneta.

Worker Sfery melduje się w `process_state` (wiersz `sfera`) jak pozostałe
procesy, a `/api/health` przy `SFERA_WORKER=1` raportuje jego stan i zaległe
MM. Szczegóły wdrożenia: [`sfera-worker/README.md`](../sfera-worker/README.md).

---

## 4. Granica do Subiekta — adaptery

Cała wiedza o Subiekcie siedzi za dwoma interfejsami. Reszta kodu nie wie, czy
pracuje na prawdziwej bazie, czy na demo.

| interfejs | co robi | implementacje |
|---|---|---|
| `adapters/subiekt.ts` | **odczyt**: kartoteki, stany, dokumenty | `subiekt.seeded.ts` (SQLite z `products.json`), `subiekt.mssql.ts` (produkcja) |
| `adapters/sfera.ts` | **zapis**: lokalizacja, kod kreskowy, MM | `sfera.dev.ts` (mutacja `sgt_*` — lokalizacja i MM), `sfera.sql.ts` (UPDATE w MSSQL — lokalizacja i kod kreskowy, MM rzuca błąd) + `sfera-worker/` (C#/COM) — jedyna produkcyjna implementacja MM |

Wybór adaptera jest **jednym przełącznikiem**: `SGT_MODE=seeded|mssql`. Adapter
zapisu nie jest osobną decyzją — wynika ze źródła danych (`config.sferaMode`).
`SFERA_WORKER` nie wybiera adaptera, tylko **wykonawcę** zadań `mm` (worker
Node czy worker Sfery) — i wymaga `SGT_MODE=mssql`, czego pilnuje walidacja
w `config.ts` (sprzeczne ustawienie nie przechodzi startu).

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

### Stan to nie to samo co „leży w regale"

Przy dostawie krajowej skutek magazynowy niesie sam dokument w Subiekcie —
księgowany wprost na MAG. Towar figuruje więc w stanie od chwili zaksięgowania,
choć fizycznie stoi na palecie w przyjęciach.

Kafel „MAG · DOSTĘPNE" pokazywał z tego powodu 12 szt przy pustej półce
i nie mówił dlaczego. Karta ma dziś osobną sekcję **„w dostawie, nierozłożone"**
(`services/dostawy-towaru.ts`): dokumenty z ostatnich 14 dni, na których ten
towar przyjechał, minus to, co już odłożono.

Liczbę składają dwa źródła i to jest jej cała logika:

- **`sgt_pozycja` + `sgt_dokument`** — co przyszło, wprost z lustra Subiekta,
- **`delivery_line.ilosc_odlozona`** — co z tego trafiło w regał.

Kryterium „co jest dostawą" siedzi w adapterze obok `listDeliveryDocuments`,
a nie w serwisie. Dwie kopie tego warunku rozjechałyby się przy pierwszej
zmianie, a objawem byłby towar policzony dwa razy albo wcale.

Kontener na MGP wchodzi tu od 0.22.0, odkąd rozkłada się tą samą ścieżką. Nie
dubluje to kafla strefy przyjęć: kafel mówi, ILE tam stoi, a ten wiersz — na
którym dokumencie i ile z tego nie ma jeszcze adresu.

---

## 5. Rozkładanie i przesunięcie stanu

Szczegóły w `docs/analiza-rozkladanie.md`; tu tylko podział.

**Rozkładanie jest jedno** i zapisuje wyłącznie adres. Magazyn skutku mówi,
co zostaje po nim:

| magazyn skutku | co to jest | co zostaje po odłożeniu |
|---|---|---|
| `MAG` | dostawa krajowa | nic — towar leży na hali z adresem |
| `MGP` | kontener importowy | stan do przesunięcia na halę |

**Przesunięcie stanu jest osobną czynnością**, nie końcem sesji. Do 0.22.0
dokument MM umiał powstać wyłącznie przy zatwierdzeniu wózka w trybie
kontenerowym; dziś wychodzi z karty towaru i z wiersza dostawy, dla dowolnej
pary magazynów.

Kolejkowanie jest bezwarunkowe, wykonanie nie: przy `SFERA_WORKER=1` dokument
MM wystawia worker Sfery (§3), a przy wyłączonym zadanie kończy się czytelnym
błędem i dokument wystawia ręcznie biuro — adres na półce zapisuje się
w obu wariantach.

Że o skutku decyduje **magazyn, nie typ dokumentu**, kosztowało jeden nieudany
projekt modelu danych: `dok_Typ` nie mówi, gdzie towar wyląduje, bo ten sam typ
bywa księgowany na różne magazyny. Decyduje `mag_Id`, snapshotowany w chwili
otwarcia dostawy — żeby przeksięgowanie dokumentu w połowie pracy nie zmieniło
reguł w jej trakcie.

### Pomyłkę w liczeniu odkręca korekta, nie wyjątek

Skan półki dodaje sztuki i nigdy ich nie odejmuje, więc do 0.45.0 jedyną drogą
cofnięcia było zgłoszenie wyjątku — czyli wpis do protokołu rozbieżności,
dokumentu idącego do dostawcy. Pomyłka w liczeniu zamieniała się w reklamację.

`korygujIlosc` ustawia wartość **bezwzględną** i przelicza z niej status
pozycji. Nie tworzy zadania w kolejce Sfery, nie kasuje zapisanego adresu i nie
tworzy wyjątku: `ilosc_odlozona` jest licznikiem postępu po stronie WERTIS,
więc poprawka jest lokalna. Pozycja ze zgłoszonym wyjątkiem jest poza jej
zasięgiem — wyjątek jest twierdzeniem wobec dostawcy i żyje własnym trybem.

Od 0.47.0 korekta jest też jedyną drogą odkręcenia **podwójnego odłożenia**.
Blokady pozycji wyszły razem z rolą brygadzisty, więc dwie osoby przy jednym
kartonie mogą policzyć tę samą pozycję dwa razy. Widać to na liście
(„odłożono 8 z 5") i poprawia bez niczyjej zgody.

### Notatka biura trzyma dostawę otwartą

Biuro dopisuje do dostawy pytanie (`delivery_note`), a rozkładający musi na nie
odpowiedzieć, zanim faktura się domknie. Bramka stoi w `closeIfComplete`, a nie
tylko przy przycisku zakończenia — inaczej odłożenie ostatniej pozycji
domykałoby dostawę z pytaniem bez odpowiedzi.

Odpowiadanie jest świadomie **bez bramki roli**: odpowiada człowiek przy
palecie, bo to on sprawdza, czy dosłali. Pisanie notatki jest pod `/api/biuro`,
odpowiadanie przy trasach kolektora — i ten podział jest całą regułą.

### Niezmiennik: adres zawsze przed sprzedawalnością

Przy przesunięciu zadanie `set_location` trafia do kolejki **przed** zadaniem
`mm`. Kolejka jest FIFO, więc towar staje się sprzedawalny dopiero wtedy, gdy
wiadomo, gdzie leży. Odwrotna kolejność dawałaby okno, w którym handlowiec widzi
towar dostępny, a magazynier nie wie, gdzie po niego iść — i przy nieudanym
zapisie adresu stan ten byłby trwały.

Przy `SFERA_WORKER=1` samo FIFO przestaje wystarczać — zadania biorą dwa
niezależne procesy. Gwarantem staje się wtedy guard w zapytaniu wyboru zadania
mm (`sfera-worker/sql/`, opis w §3): MM stoi, dopóki wcześniejsze niewykonane
`set_location` tego samego towaru nie wejdzie.

---

## 6. Tożsamość (§7)

Do lipca 2026 „użytkownik" był dowolnym łańcuchem wpisywanym na kolektorze
i wysyłanym w `X-User`. Każdy mógł podać się za kogokolwiek, a `events.user_id`
zbierał warianty tej samej osoby.

Dziś: **login i hasło → token sesji urządzenia**. Hasło leży w `app_user`
wyłącznie jako hasz (scrypt, sól per konto, porównanie stałoczasowe), minimum
osiem znaków, bez wymagań na klasy znaków.

Trzy decyzje, każda z powodem:

- **Nieznany login i błędne hasło wyglądają identycznie** — jeden komunikat
  i ten sam czas odpowiedzi, bo nieznany login też przechodzi przez scrypt po
  atrapie hasza. Bez tego czas odpowiedzi mówi, które konta istnieją.
- **Pięć nieudanych prób zamyka login na minutę.** Licznik żyje w pamięci
  procesu, odpowiedź to 429, nie 401 — kolektor po 401 kasuje operację z bufora
  offline, więc kod błędu jest tu decyzją o cudzej pracy, nie kosmetyką.
- **Login JEST daną osobową**, w odróżnieniu od kodu plakietki. To realna
  strata przy tej zmianie i nie ma sensu jej przemilczać: `GET /api/users`
  wystawia listę loginów, więc zostaje zastrzeżone dla ról `biuro` i `admin`.

<!-- docs_check: historia -->
Do sierpnia 2026 tożsamością był skan plakietki `PRC-0007-3` — prefiks, numer
nadawany przez serwer i cyfra kontrolna licząca wagami 3-1-3-1. Jedna sekunda
zamiast wpisywania, kod bez nazwiska (plakietka się gubi i zostaje na kurtce)
i kategoria zamknięta w klasyfikatorze skanów. Wypadło razem z PIN-em w 0.20.0,
bo firma wszędzie indziej loguje się loginem i hasłem, a dwa wzorce naraz to
dwa razy tyle do wytłumaczenia nowej osobie.

### Sesja nie wygasa sama

Sesja urządzenia trwa do jawnej decyzji człowieka: wylogowania z Ustawień.
Bezczynność jej nie rusza — kolektor odłożony na regale na całą przerwę wraca
do otwartej dostawy bez logowania.

Do sierpnia 2026 działał tu TTL: po 10 minutach sesja przechodziła w stan
`zablokowana`, kolektor pokazywał pełnoekranowy komunikat, a zapis dostawał
z serwera 423. Blokada nigdy nie gubiła pracy — zachowywała token, dostawę
i postęp — więc jej jedynym mierzalnym skutkiem był skan przy każdym powrocie
do urządzenia.

Kupowała za to obronę przed scenariuszem, który tu nie występuje: kolektory nie
opuszczają hali.

### Zmiana osoby to wylogowanie i zalogowanie

Przy plakietce ten sam gest — skan — znaczył trzy różne rzeczy naraz, więc
kolektor musiał pytać „przejąć pracę?", zamiast przełączać po cichu. Przy haśle
nie ma czego przejmować: kto siada do kolektora, ten się loguje, a poprzednik
wylogowuje. Audyt na tym nie traci, bo każda operacja i tak niesie własne
`user_ref` — przejęcie było zdarzeniem o SESJI, nie o pracy.

### Aktualizacja kolektora idzie z serwera, nie z CI

Do 0.52.0 nowy APK wgrywał człowiek: artefakt z GitHuba, potem MDM albo
`adb install` na każdym urządzeniu. Od 0.52.0 plik leży w `server/data/apk/`,
a kolektor pyta o niego przy otwarciu aplikacji. Wersję niesie NAZWA pliku —
czytanie `versionName` z APK znaczyłoby własny dekoder binarnego
`AndroidManifest.xml` dla jednego pola.

Obie trasy (`GET /api/aktualizacja` i `/api/aktualizacja/apk`) są poza bramką
sesji. Powód jest ten sam, co przy kreatorze kont: bez nich kolektora, którego
aplikacja jest zepsuta albo przestarzała, nie da się doprowadzić do stanu,
w którym da się zalogować. Konsekwencja jest jawna — plik pobierze każdy w sieci
magazynu, więc do APK nie wolno wbudować niczego tajnego.

Tym, co odróżnia aktualizację WERTIS od dowolnego APK podanego kolektorowi
z tej samej sieci, jest PODPIS: Android odmawia instalacji pliku podpisanego
innym kluczem. Suma SHA-256 chroni wyłącznie przed uszkodzeniem w transporcie,
bo przychodzi tym samym kanałem co plik. Dlatego klucz wydania jest tu
zabezpieczeniem nośnym, a nie higieną, i nie może leżeć w repozytorium.

### Operacje uprzywilejowane rozstrzyga rola

Dwie operacje są zastrzeżone dla ról:

- **zarządzanie kontami** — jedyna operacja tworząca *tożsamość*, dlatego
  zastrzeżona dla roli `biuro`. Człowiek z hali mogący zakładać konta założyłby
  konto biura z własnym hasłem i reszta reguł przestałaby cokolwiek znaczyć,
- **domknięcie dostawy jako rozłożonej poza WERTIS** (`biuro`) — jedyna
  operacja zdejmująca pracę z listy bez ani jednego skanu. Hali tu nie ma
  świadomie: to *orzeka*, że pracy nie ma. Wymaga powodu wpisanego z ręki
  i zawsze idzie do `events`; dostępna wyłącznie z `/biuro`, nigdy z kolektora.

Trzecia — zdjęcie cudzej blokady pozycji — zniknęła w 0.47.0 razem z samymi
blokadami i rolą brygadzisty, która istniała głównie dla niej.

Drugiego czynnika nie ma. Do 0.20.0 obie wymagały PIN-u, bo plakietkę dawało
się pożyczyć razem z tożsamością. Hasła się tak nie pożycza — ale porzucony
zalogowany kolektor pozwala teraz obcej osobie na wszystko, co może jego
właściciel, i to jest cena zapisana wprost w `services/auth.ts`.

### Konta zakłada się z kolektora

Pusta instalacja → ekran startowy proponuje kreator (`ui/setup/`). Pierwsze
konto powstaje **bez sesji**, ale tylko dopóki nie ma ani jednego konta
Z LOGINEM — furtka zamyka się przy pierwszym takim koncie i jest wymuszona jako
konto biura, bo będzie jedyną drogą do wszystkich następnych.

Warunek liczy konta z loginem, nie wiersze, i to nie jest szczegół
implementacji. Konta-ślady po migracji historii zostają w tabeli na zawsze;
gdyby liczyły się do tego warunku, furtka byłaby na każdej istniejącej
instalacji zamknięta na głucho: żeby założyć konto, trzeba sesji, a żeby mieć
sesję, trzeba konta.

Kolejność wysyłki nie jest dowolna: biuro idzie pierwsze niezależnie od
kolejności wpisywania. Gdyby poszedł pierwszy magazynier, zająłby tę jedyną
furtkę i reszta listy odbiłaby się od 401 z kontami założonymi w połowie.

---

## 7. Klasyfikacja skanu — jedno źródło reguły

Ze skanera przychodzi łańcuch znaków. Trzeba rozstrzygnąć, czym jest.

```
prefiks LOC:  →  adres (etykieta QR)
wzorzec adresu →  adres          A01-02-03 (2 myślniki) | PAL-042
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

`events` to jedyna tabela, do której piszą wszystkie warstwy: **31 typów
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
| Rekoncyliacja | `GET /api/reconcile`, `npm run reconcile` | 4 kontrole (czwarta, `mm_czeka`, tylko przy `SFERA_WORKER=1`); zerowy wynik **nie tworzy raportu** |
| Wydajność per osoba | `GET /api/wydajnosc` | patrz ostrzeżenie niżej |
| Przeslotowanie | `npm run reslot` | pion i martwe kartoteki, 1–2× w roku |
| Kandydaci do strefy złotej | `GET /api/biuro/zbiorki/kandydaci` (+ `/csv`) | bieżąca rotacja ze zbiórek Sellasist; ten sam próg co reslot |
| **Ślad audytowy** | `GET /api/events`, `/api/events/csv` | surowe zdarzenia z filtrem; rola biura albo admina |

### Łańcuch „poprosił → wykonane" musi być pełny w obie strony

Raporty wyżej agregują. Reklamacja potrzebuje czegoś innego: pojedynczego
zdarzenia z godziną i nazwiskiem. Do sierpnia 2026 łańcuch urywał się w dwóch
miejscach i oba były po tej samej stronie — po stronie SKUTKU.

`location_set` mówił, że człowiek o coś POPROSIŁ. Czy zapis wszedł do Subiekta,
nie mówiło nic: sukces nie był logowany, a porażka istniała wyłącznie jako
`error_msg` w wierszu kolejki, czyli poza tabelą, w której ktokolwiek by jej
szukał. Dziś **oba workery** — Node i Sfery — dopisują `queue_applied`,
`queue_retry` i `queue_failed`, a autora biorą z `sfera_queue.created_by_ref`,
bo działają poza żądaniem i sesji tam nie ma. To jedyne miejsce, w którym ślad
audytowy przekracza granicę Node/C#, i strona C# honoruje tę samą regułę autora
(`sfera-worker/src/Queue.cs`).

Drugie urwanie to **odrzucenia**. Żądanie zwrócone z 400 nie zostawiało nic,
więc „skanowałem i się nie zapisało" dało się zbyć zdaniem „nie widzę takiej
operacji" — prawdziwym i jednocześnie nieprawdziwym. Hook `onSend` zapisuje je
jako `http_rejected`.

**Ciała żądania nie zapisujemy nigdy** — przez `POST /api/users` przechodzi
hasło, a log audytowy z hasłami w środku jest gorszy niż jego brak. Pilnuje tego osobna
asercja w `routes/audyt.test.ts`. Z tego samego powodu `401` na `GET` jest
pomijane: karta odpytuje serwer co 2 s i wygasła sesja utopiłaby resztę audytu
w szumie.

Ta sama reguła objęła w 0.52.3 **brak zdjęcia kartoteki**, i to na dowodach
z produkcji: w oknie czterech dni 355 z 1000 zdarzeń było wpisem „404 Brak
zdjęcia", przy 301 różnych kartotekach i zerze trafień, bo instalacja nie ma
włączonych `ZDJECIA_*`. Prawdziwych odrzuceń było w tym samym oknie pięć.
Kolektor pyta o miniaturę każdego rysowanego wiersza, więc częstotliwość bierze
się z rysowania ekranu, a nie z pracy człowieka — a brak zdjęcia jest
odpowiedzią, nie odmową: nikomu niczego nie odebrano.

Lista wyciszonych tras (`BEZ_AUDYTU_404` w `context.ts`) jest wąska celowo.
Wpis wymaga OBU warunków naraz: częstotliwości rysowania ekranu i normalności
odpowiedzi „nie ma". Sam brak czegoś nie wystarcza — inaczej lista zjadłaby
cały audyt odrzuceń, czyli to, po co on istnieje.

### Czego ślad nie obejmie

Operacja wykonana bez Wi-Fi żyje w pliku na kolektorze aż do połączenia.
Urządzenie zginie przed odzyskaniem sieci — śladu nie ma i **żadna zmiana po
stronie serwera tego nie naprawi**. Lukę zawęża to, że buforowana jest wyłącznie
zmiana lokalizacji.

Co dało się naprawić, naprawione: bufor przestał kasować operacje przy
przejściowym błędzie serwera (5xx/408/429 zostawiają je w kolejce), a operacja
odrzucona trwale idzie na serwer jako `klient_odrzucona`. Prefiks `klient_` jest
celowy — to relacja urządzenia, nie fakt zaobserwowany przez serwer.

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

| co | gdzie |
|---|---|
| serwer (jednostkowe + trasy przez `app.inject()`) | `cd server && npm test` (node:test przez tsx) |
| `:core` | `cd android && ./gradlew :core:test` — **bez Android SDK** |
| `:app` | tylko CI: wymaga Android SDK; testów nie ma |

> Liczb testów ta tabela celowo **nie podaje**. `tools/docs_check.py` pilnuje
> ich wyłącznie w `README.md` i `android/README.md`, a policzyć ich statycznie
> się nie da (`grep` po `test(` daje 610 przy 650 uruchomionych — testy
> parametryzowane i zagnieżdżone). Liczba poza kontrolą narzędzia starzeje się
> po cichu; tak właśnie ten dokument doszedł do „153" przy 199 — i do „138",
> zanim ktoś znów policzył.

Cztery workflow: `android.yml` (`:core` + APK debug), `server.yml` (testy,
`tsc`, `docs_check`), `instalator.yml` (składnia + przebieg `-DryRun`)
i `sfera-worker.yml` (sama kompilacja C#, path-filtered do `sfera-worker/**` —
dlatego guard kolejności jest mierzony testem Node w `server.yml`, bez dotneta).

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
| Login wpisuje biuro, unikalności pilnuje baza | dwie osoby z tym samym loginem to jedno żądanie od pomyłki |

---

## 12. Znane ograniczenia

- **Brak testów adapterów MSSQL.** `adapters/subiekt.mssql.ts`
  i `adapters/sfera.sql.ts` to jedyny kod piszący do bazy firmy, a sensowny
  test wymagałby działającego SQL Servera. Weryfikuje je **ręczna** checklista
  na Subiekcie edu (`docs/subiekt-gt-edu-setup.md` §5) — zielone `npm test`
  nie mówi o nich nic.
- **Brak testów w module `:app`** (~8,6 tys. linii Kotlina). Logika, którą dało
  się wynieść, siedzi w `:core` i ma testy; w `:app` zostają ViewModele,
  obsługa błędów sieci i wyzwalacze flusha bufora.
- **Wywołania COM workera Sfery są niezweryfikowane na żywej Sferze** —
  implementacja istnieje (`sfera-worker/`), ale każde wywołanie COM nosi
  `[WERYFIKUJ]` (wszystkie w `SferaComAdapter.cs`), a `SFERA_WORKER` jest
  domyślnie wyłączony. Do czasu weryfikacji dokument MM wystawia biuro.
- **Zdjęcia kartotek są wyłączone, dopóki nie wskaże się źródła.** Dla tego
  podmiotu źródło jest już ustalone — `tw_ZdjecieTw`, komplet ustawień
  w `docs/subiekt-gt-struktura.md` — ale funkcja rusza dopiero po wpisaniu ich
  do `wertis.env` i nadaniu siódmego `GRANT SELECT`.
- **Otwarte `[WERYFIKUJ]`** dla własnej bazy (komplet z `config.ts`):
  `MAG_ID_*`, `MSSQL_LOC_COLUMN` (które `tw_Pole1..8` trzyma lokalizację),
  `DOK_STATUS_ZD_OTWARTE`, `MSSQL_ZD_ZREAL_COLUMN`, `LOC_FIELD_LIMIT`.
  Zapytania: `docs/subiekt-gt-edu-setup.md` §3. Osobna rodzina: wywołania COM
  w `sfera-worker/src/SferaComAdapter.cs` — lista w `sfera-worker/README.md`.
  Trzecia: `ZDJECIA_*`, gdy funkcja zdjęć ma być włączona.
- **Reguły strefy złotej** nie pokrywają w ziarnie regałów `D00`, `D06`,
  `D07`, `E01` — raport przeslotowania i kandydaci ze zbiórek wskazują je na
  osobnej liście „brak reguły" zamiast zgadywać. Od 0.50.0 reguły są
  edytowalne z panelu biura, więc lukę zamyka wpis, nie wydanie.

---

## Gdzie szukać dalej

| pytanie | plik |
|---|---|
| Jak to wdrożyć? | `DEPLOY.md` |
| Jak podpiąć Subiekta? | `docs/subiekt-gt-edu-setup.md` |
| Co dokładnie jest w bazie Subiekta? | `docs/subiekt-gt-struktura.md` |
| Jak wygląda rozkładanie w praktyce? | `docs/analiza-rozkladanie.md` |
| Jak zbudować kolektor? | `android/README.md` |
