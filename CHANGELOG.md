# Historia zmian WERTIS

Numer wersji stoi w **jednym miejscu** — polu `version` w `package.json`
w korzeniu repo. Bierze go stamtąd serwer (`/api/health`) i APK
(`android/app/build.gradle.kts` czyta ten plik przy budowaniu i wylicza z niego
`versionCode`). Kolektor pokazuje obie wersje na dole ekranu.

Do sierpnia 2026 numer był wpisany w trzech miejscach z komentarzem „zgodnie
z wersją monorepo" — i właśnie tak przestał być zgodny: `0.3.0` przetrwało
sześć zmergowanych zmian, w tym takie, które wymagały nowego uprawnienia SQL.
Komentarz nie jest mechanizmem.

## Kiedy który człon rośnie

Ta skala mierzy **koszt wdrożenia u klienta**, a nie zgodność API. WERTIS nie ma
publicznego API — jedynym klientem jest własny kolektor. Pytanie, na które numer
ma odpowiadać, brzmi: *„czy przy tej aktualizacji muszę coś zrobić ręką?"*

| człon | kiedy | co to znaczy dla wdrożenia |
|---|---|---|
| **MINOR** (`0.X.0`) | nowa funkcja widoczna dla człowieka **albo** zmiana wymagająca działania przy wdrożeniu | przeczytaj wpis: pozycje **[wymaga działania]** mówią, co zrobić poza `git pull` |
| **PATCH** (`0.3.X`) | poprawka błędu, dokumentacja, refaktor bez śladu na ekranie | `git pull`, `npm ci`, `npm run build`, restart usług — nic więcej |
| **MAJOR** (`1.0.0`) | **dopiero gdy system pracuje na produkcji codziennie** | zostaje `0` do tego czasu; podbicie będzie decyzją właściciela, nie skutkiem ubocznym |

**Nowy APK to zawsze osobna czynność.** `git pull` przestawia serwer od razu,
kolektor czeka na rozesłanie przez MDM — dlatego pasek na dole ekranu pokazuje
obie wersje i podświetla rozjazd. To jest stan przejściowy, nie awaria.

---

## 0.8.2 — 29 lipca 2026

Suma kontrolna NSSM wpisana — strażnik z 0.8.1 działa w obie strony.

W 0.8.1 stała `SUMA_NSSM_ZIP` została **celowo pusta**, bo `nssm.cc` nie było
osiągalne ze środowiska, w którym powstawał tamten kod. Wartość policzył runner
Windows w CI, pobierając plik wprost ze źródła:
`727d1e42275c605e0f04aba98095c38a8e1e46def453cdffce42869428aa6743`.

**Czego ta suma dowodzi, a czego nie.** Nie jest dowodem, że `nssm.cc` było
w tamtej chwili nienaruszone — to zaufanie przy pierwszym użyciu. Jest natomiast
gwarancją, że **od tamtej chwili plik się nie zmienił**.

### Poprawione

- **Krok CI stracił `continue-on-error`** i to jest sedno tej zmiany. Z pustą
  sumą krok tylko meldował wartość, więc pobłażliwość nic nie kosztowała.
  Z wpisaną — `continue-on-error` czyniłby strażnika **bezzębnym**: podmieniony
  plik dawałby zielone CI.

  Rozdzielone są za to dwa różne zdarzenia: **niedostępna sieć to nie to samo,
  co podmieniony plik**. Nieosiągalne `nssm.cc` daje ostrzeżenie i przepuszcza;
  niezgodna suma zatrzymuje budowę.

- **Wydanie powstawało PUSTE.** Workflow instalatora nie miał bloku
  `permissions`, więc `github.token` dostawał dostęp tylko do odczytu,
  a `gh release upload` kończył się `HTTP 403: Resource not accessible by
  integration`. Tag się tworzył, **plików przy nim nie było** — a to jedyna
  droga, którą instalator trafia do człowieka.

  Znalezione przy okazji, w logach nieudanego biegu z 12:56, nie zgłoszone.
  Dodane `contents: write` na poziomie zadania.

### Uwagi

- Przebieg próbny w CI potwierdził, że `-DryRun` **pomija pobieranie**, więc
  weryfikacja sum nie zmienia zachowania trybu próbnego.

---

## 0.8.1 — 29 lipca 2026

Antywirus zablokował instalator — i przy okazji wyszła realna dziura.

Zgłoszenie brzmiało: *„antywirus zablokował wertis-instalator.ps1, IDP.Generic,
zarażony"*. Audyt źródła: **plik jest czysty**. Zero kodu wykonywanego z sieci
(`IEX`, `DownloadString`, base64, `-EncodedCommand`), zero osadzonych binariów,
poprawny UTF-8 w całości, trzy adresy zewnętrzne — własne repo, `nodejs.org`,
`nssm.cc`. `IDP.Generic` to detekcja heurystyczna: ocenia zachowanie, nie
sygnaturę.

Instalator wykonuje sześć czynności, które razem dają profil droppera: pobiera
archiwum i uruchamia z niego plik, instaluje MSI po cichu (`/qn`), rozpakowuje
`SecureString` do jawnego hasła, nadpisuje TLS, podnosi uprawnienia i zakłada
usługi. Do tego **NSSM sam jest narzędziem dwojakiego użytku** — malware zakłada
nim usługi dla przetrwania restartu. Antywirus zachował się poprawnie.

### Poprawione

- **Pobierane pliki nie były w ŻADEN sposób weryfikowane.** Instalator ściągał
  instalator Node'a i `nssm.exe`, po czym uruchamiał je **z uprawnieniami
  administratora** — bez sprawdzenia, co właściwie przyszło. Przejęcie DNS
  w sieci klienta albo włamanie na serwer wydań wystarczyło, żeby ta maszyna
  wykonała cudzy kod jako SYSTEM.

  **To była realna dziura, nie fałszywy alarm** — znaleziona przy okazji, nie
  zgłoszona. Obie pozycje mają teraz sprawdzaną sumę SHA-256 **przed
  uruchomieniem**; niezgodność przerywa instalację i kasuje pobrany plik.

  Suma Node'a pochodzi z oficjalnego `SHASUMS256.txt` na nodejs.org. Suma NSSM
  została **celowo zostawiona pusta**: `nssm.cc` nie było osiągalne ze
  środowiska, w którym powstawał ten kod, a wpisanie wartości „z pamięci"
  dałoby weryfikację **pozorną** — gorszą od jawnego jej braku, bo wyglądającą
  na zabezpieczenie. Dopóki jest pusta, instalator ostrzega i wypisuje
  policzoną wartość. Ustala ją nowy krok CI na maszynie mającej dostęp do
  `nssm.cc`; późniejsza zmiana sumy **zatrzymuje budowę**, bo wymaga oczu
  człowieka.

### Dodane

- **`instalator/README.md` — sekcja „Antywirus zablokował instalator".** Co
  znaczy `IDP.Generic`, tabela sześciu zachowań, które go wywołują, jak
  **samodzielnie zweryfikować** plik (`.ps1` to czysty tekst — da się go
  przeczytać), gdzie zgłosić fałszywy alarm i **czego nie robić** (nie
  wykluczać całego katalogu, nie wyłączać ochrony).

  Osobno wypisane, **kiedy zacząć się naprawdę martwić**: base64,
  `Invoke-Expression`, `-EncodedCommand` albo adres spoza znanej trójki. Bez
  tego akapitu instrukcja „to fałszywka, kliknij zezwól" uczyłaby ignorowania
  antywirusa — czyli dokładnie odwrotnie, niż trzeba.

### Uwagi

- **`.exe` z `ps2exe` jest flagowany znacznie częściej niż `.ps1`.** Wydanie
  niesie oba; przy blokadzie używaj skryptu.
- **Wycięcie NSSM zostaje jako opcja.** Usunęłoby naraz pobieranie obcej
  binarki, zależność od `nssm.cc` i najczęściej flagowany składnik. Wymaga
  jednak przepisania rejestracji usług na Harmonogram zadań i **sprawdzenia na
  prawdziwym Windowsie** — a to jest mechanizm, od którego zależy uruchomienie
  produktu u klienta, więc nie idzie w ciemno razem z poprawką dokumentacji.

---

## 0.8.0 — 29 lipca 2026

Ślad audytowy odpowiada na reklamację faktem, a nie hipotezą.

Wymaganie brzmiało: *„za miesiąc ktoś powie «aplikacja mi zjadła 30 sztuk» —
chcesz mieć odpowiedź"*. Okazało się, że dane w większości **już były**: `events`
zbierał 28 typów zdarzeń od pierwszego dnia instalacji, z osobą, kontem,
urządzeniem i czasem, i nic ich nie kasuje. Brakowało czterech rzeczy — i to one
były robotą, nie „logowanie".

### Dodane

- **Trasa audytu `GET /api/events` i eksport CSV.** Filtr po osobie, towarze,
  urządzeniu, typie zdarzenia i zakresie dat. To był największy brak: odpowiedź
  na reklamację wymagała dotąd `sqlite3` na serwerze, czyli praktycznie nie
  istniała.

  Bramka na rolę **brygadzisty albo biura**, bez PIN-u — wzorem `GET
  /api/users`, gdzie PIN chroni zmiany, a nie odczyt. Log mówi, kto ile
  zeskanował, więc jest narzędziem nadzoru i hala go nie ogląda. **Kto wyniesie
  CSV, sam trafia do śladu** (`audyt_eksport`).

- **Wynik zapisu do Subiekta.** Worker zapisuje `queue_applied` (weszło i o
  której), `queue_retry` (nie weszło, wróci) i `queue_failed` (nie weszło
  i już nie wejdzie). `sfera_queue` dostała kolumnę `created_by_ref`, bo worker
  działa poza żądaniem i bez niej umiałby podać tylko nazwę, a nie konto.

- **`GET /api/health` mierzy wzrost historii** — liczba zdarzeń, data
  najstarszego i rozmiar bazy. Nie czyścimy `events` i to jest decyzja, ale
  „rośnie w nieskończoność" bez licznika kończy się pełnym dyskiem.

- **Indeks `ix_events_tw_time`.** „Co się działo z tym towarem" to najczęstsze
  pytanie przy reklamacji, a `tw_id` nie miało **żadnego** indeksu — nawet
  historia na karcie towaru skanowała całą tabelę.

### Poprawione

- **Bufor offline kasował operacje przy przejściowym błędzie serwera.**
  `OfflineQueue` klasyfikował `isNetworkError(e) = e !is ApiError`, więc
  **`ApiError(500)` nie był błędem sieci** — `flush()` wyrzucał operację
  z bufora i wołał lokalny toast. Restart serwera albo 503 spod reverse proxy
  zjadał zeskanowaną pracę magazyniera: bez śladu, bez ostrzeżenia, bez szansy
  na powtórkę.

  Teraz 5xx, 408 i 429 znaczą „serwer choruje, operacja jest zdrowa" —
  **zostaje w buforze** i wraca przy następnym flushu. Dopiero 4xx (żądanie
  wadliwe, ponowienie nic nie da) ją usuwa, i **melduje na serwer**
  (`klient_odrzucona`) z czasem wykonania na kolektorze, nie dosłania. Licznik
  `proby` pilnuje, żeby jedna chora operacja nie zamroziła kolejki na zawsze.

- **Odrzucone żądania nie zostawiały śladu.** 400 za przekroczony limit pola,
  zły kod półki czy nieznany towar wracały do kolektora i znikały — „skanowałem
  i się nie zapisało" nie miało po stronie serwera żadnego potwierdzenia. Hook
  `onSend` zapisuje je jako `http_rejected` z metodą, ścieżką, statusem
  i powodem.

  **Ciała żądania NIE zapisujemy i to jest zasada, nie przeoczenie** — przez
  `POST /api/users` przechodzi PIN. Pilnuje tego osobna asercja: log
  audytowy z PIN-ami w środku jest gorszy niż brak logu. `401` na `GET` jest
  pomijane, bo karta odpytuje serwer co 2 s i wygasła sesja utopiłaby resztę
  audytu w szumie; `401` na zapisie **jest** logowane.

- **Zdarzenia ilościowe niosą wartość sprzed zmiany** (`qtyPrzed`). Dotąd był
  sam stan po, więc „było 30, jest 0" trzeba było odtwarzać z całej sekwencji
  i ufać, że żadne zdarzenie nie zginęło.

### Czego to NIE naprawia

Operacja wykonana **bez Wi-Fi** żyje w pliku na kolektorze aż do połączenia.
Zginie urządzenie przed odzyskaniem sieci — śladu nie ma i **żadna zmiana po
stronie serwera tego nie zmieni**. Lukę zawęża to, że buforowana jest wyłącznie
zmiana lokalizacji; skany i rozkładanie offline po prostu nie działają.

### Uwagi

- Log audytowy jest narzędziem nadzoru. Warto powiedzieć zespołowi, że istnieje
  — cichy nadzór jest gorszy od jawnego.
- `klient_odrzucona` to **relacja urządzenia**, nie fakt zaobserwowany przez
  serwer. Prefiks `klient_` trzyma tę różnicę na wierzchu.
- Testy: 244 → **260** serwera, 92 → **96** w `:core`. Sabotażem sprawdzone:
  zdjęcie warunku metody przy `401` zapala 2 asercje, dopisanie ciała żądania
  do logu — asercję o PIN-ie, powrót starej klasyfikacji błędów — asercję 5xx.

---

## 0.7.0 — 29 lipca 2026

Karta towaru mówi, czego nie ma na półce, bo jeszcze nie przyjechało od dostawcy.

### Dodane

- **Sekcja „ZAMÓWIONE U DOSTAWCY" na karcie towaru.** Numer zamówienia, ilość
  pozostała do dostarczenia, termin i dostawca. Domyka pytanie otwarte przez
  0.6.0: tamta zmiana odpowiadała „towar przyjechał, poszukaj w przyjęciach",
  ta odpowiada „towaru nie ma i trzeba poczekać".

  Sekcja stoi **pod** „W DOSTAWIE, NIEROZŁOŻONE" i ma spokojne tło zamiast
  bursztynowego. Bursztyn na tej karcie znaczy „zrób coś teraz"; zamówienie nie
  daje żadnej czynności. Ten sam kolor w obu miejscach kazałby magazynierowi
  szukać towaru, którego w budynku nie ma.

  Zamówienie zrealizowane w całości znika z listy — pytanie brzmi „czego
  jeszcze nie ma", a nie „co zamówiono". Kolejność idzie po **terminie**, nie po
  dacie wystawienia; zamówienia bez terminu lądują na końcu z dopiskiem „termin
  nieznany", bo to uczciwsze niż podstawienie daty wystawienia w miejsce
  obietnicy dostawy.

### Poprawione

- **Napis „zam. u dostawcy" na kaflu MGP nie zapalił się nigdy na produkcji.**
  Karta brała go z pola `ordered`, a importer MSSQL wpisywał w nie **zero na
  sztywno** — „zamówione" nie ma w Subiekcie prostej kolumny, pochodzi
  z dokumentów ZD. Napis działał wyłącznie w trybie demo, gdzie seed czytał tę
  liczbę z arkusza. Czyli funkcja istniała dokładnie tam, gdzie nikt jej nie
  potrzebował.

  Pole `ordered` zniknęło z serwera, DTO i kafla. Ta sama liczba z arkusza
  zasila teraz syntetyczne zamówienia w seedzie, więc demo i produkcja chodzą
  **tym samym torem** — czego wcześniej nie robiły.

### Do sprawdzenia na własnej bazie

- **[wymaga działania — opcjonalne]** Doszły dwa `[WERYFIKUJ]` (łącznie cztery,
  `docs/subiekt-gt-struktura.md`). Bez nich karta działa, tylko mniej dokładnie:

  - `DOK_STATUS_ZD_OTWARTE` — opis struktury InsERT mówi tylko „5..8 —
    zamówienia (różne stany realizacji)" i nie rozpisuje ich. Domyślne bierze
    wszystkie cztery i jest **założeniem, nie ustaleniem**.
  - `MSSQL_ZD_ZREAL_COLUMN` — nazwy kolumny z ilością już odebraną nie ma
    w naszym opisie struktury. Gdy nie istnieje, import **nie przerywa się**:
    wpisuje zero, `/api/health` zgłasza zdanie z nazwą do poprawienia, a karta
    opisuje ilość jako oszacowanie. Zamówienie odebrane w połowie wygląda wtedy
    na nietknięte — dlatego to tryb awaryjny, nie docelowy.

  Oba `SELECT`-y są w DEPLOY §6. **Nowych uprawnień SQL nie trzeba** — ZD leży
  w tych samych tabelach co dostawy.

### Uwagi

- ZK (zamówienie **od klienta**, `dok_Typ = 16`) celowo poza zakresem. To ruch
  w drugą stronę i pokrywa go rezerwacja na kaflu MAG; wciągnięcie go do sekcji
  o nazwie „zamówione u dostawcy" pomyliłoby dwa przeciwne kierunki.
- Kolumna `sgt_towar.ordered` **zostaje w bazie** jako martwa. `DROP COLUMN`
  w SQLite to przepisanie tabeli, a kod jej już nie czyta ani nie zapisuje.
- Testy: 244 serwera (doszło 9), 92 w `:core` (doszły 2). Reguły „zrealizowane
  znika" i „kolejność po terminie" sprawdzone sabotażem — odwrócenie sortowania
  zapala dwie asercje, usunięcie odejmowania cztery.

---

## 0.6.1 — 29 lipca 2026

Instalator pokazuje, która baza Subiekta jest produkcyjna, a która jest jej kopią.

### Poprawione

- **Kreator nie odróżniał podmiotu od kopii.** Listował bazy alfabetycznie,
  a po wyborze sprawdzał obecność czterech tabel Subiekta. Kopia ma dokładnie
  te same tabele, więc przechodziła bez słowa — a sortowanie po nazwie potrafiło
  postawić ją **nad** produkcyjną.

  > **Dlaczego to bolało.** Pomyłka nie dawała objawu: konto SQL powstawało na
  > kopii, aplikacja czytała nieaktualne stany i zapisywała lokalizacje
  > w martwą bazę, a wszystko wyglądało poprawnie. Dowiedziałby się o tym
  > dopiero magazynier, któremu stany nie zgadzają się z półką.

- **Lista niesie teraz datę ostatniego dokumentu, liczbę dokumentów i datę
  utworzenia bazy**, posortowana od najświeższej. Żywa baza ma dzisiejszy
  dokument, kopia stoi na dniu zrzutu.
- **Podpowiedź Enterem tylko przy ściśle najświeższej bazie.** Dwie kopie z tego
  samego dnia podpowiedzi nie dostają — byłaby rzutem monetą udającym radę.
- **Ostrzeżenie po wyborze bazy z dokumentem starszym niż tydzień**, z potwierdzeniem
  domyślnie na „nie". Baza bez ani jednego dokumentu ma osobny komunikat: świeży
  podmiot jest pusty, a nie podejrzany.

Obie liczby są tanie celowo: `TOP 1 ... ORDER BY dok_Id DESC` idzie po kluczu
głównym, a licznik dokumentów bierze się z `sys.partitions`. `COUNT(*)` na
serwerze, z którego biuro właśnie korzysta, to nie jest cena za podpowiedź.

### Pod spodem

- `instalator/testy.ps1` — 14 nowych asercji na funkcjach czystych (21 → 35 przebiegów)
  (`Format-WertisEtykietaBazy`, `Sort-WertisBazy`, `Get-WertisSugerowanaBaza`,
  `Test-WertisBazaPodejrzana`). Decyzja i formatowanie są osobno od SQL-a
  właśnie po to, żeby reguła „przy remisie nie podpowiadaj" miała asercję,
  a nie komentarz.

**Wdrożenie: nic.** Zmiana dotyczy wyłącznie `instalator/**` i dokumentacji.
Działający system, konfiguracja i APK zostają bez zmian — dlatego PATCH,
mimo że osoba uruchamiająca instalator zobaczy inny ekran.

---

## 0.6.0 — 29 lipca 2026

Karta towaru mówi, czy towar przyszedł, ale nie leży jeszcze w regale.

### Nowe

- **„W dostawie, nierozłożone" na karcie towaru.** Pod kaflami stanów doszła
  sekcja z numerem dokumentu, datą i ilością, której jeszcze nie odłożono.
  Liczy się z dwóch źródeł: co przyszło (`sgt_pozycja`) minus co trafiło
  w regał (`delivery_line.ilosc_odlozona`). Okno to 14 dni, jak lista
  w zakładce rozkładania.

  > **Dlaczego.** Przy dostawie krajowej skutek magazynowy niesie sam dokument
  > w Subiekcie, więc towar figuruje na MAG od zaksięgowania. Kafel „MAG ·
  > DOSTĘPNE" pokazywał 12 szt przy pustej półce i nie mówił, że sześć z nich
  > stoi na palecie w przyjęciach. Odpowiadał na pytanie POZORNIE, a to gorsze
  > od milczenia.

- **Pominięte pozycje i te ze zgłoszonym wyjątkiem ZOSTAJĄ na liście.** Tak samo
  nie ma ich w regale, a magazynier, który właśnie ich szuka, ma prawo wiedzieć,
  że ktoś się już o nie potknął.

**Sekcja jest nieklikalna i to jest decyzja.** Wejście w dokument z karty
towaru wołałoby `openDelivery`, a ta trasa przestawia flagę faktury w Subiekcie
na „W trakcie sprawdzania". Biuro widziałoby, że ktoś sprawdza fakturę, bo
magazynier zajrzał na kartę towaru.

### Poza zakresem, świadomie

Kontener na MGP — idzie osobnym torem (`putaway_*`) i widać go na własnym kaflu
strefy przyjęć. Dokładanie go tutaj dublowałoby tę samą liczbę na jednym ekranie.

**Zamówienia u dostawcy (ZK/ZD) to osobna zmiana.** Karta odpowiada dziś na
„przyjechało, ale nie na półce", a nie na „nie ma w firmie, ale jedzie". Przy
okazji wyszło, że importer wpisuje `ordered: 0` na sztywno
(`subiekt.mssql.ts:246`), więc podpis „zam. u dostawcy" na kaflu MGP na
prawdziwych danych **nigdy się nie pokazuje**.

### Pod spodem

- Testy serwera 220 → 235: `services/dostawy-towaru.test.ts` (12 przypadków)
  i `routes/karta-towaru.test.ts` (przejście pola przez trasę).
- Adapter dostał `getDeliveryPositionsForProduct` — odwrotność
  `listDeliveryDocuments`, w tym samym pliku i z tym samym warunkiem `WHERE`.

**Nowy APK jest potrzebny**, inaczej kolektor nie narysuje sekcji. Serwer
wysyła pole niezależnie od wersji aplikacji.

---

## 0.5.0 — 27 lipca 2026

Ekran blokady po bezczynności zniknął. Sesja urządzenia nie wygasa sama.

### Zmiana zachowania

- **Kolektor nie pokazuje już ekranu „Sesja zablokowana".** Do tej pory
  dziesięć minut bez ruchu przełączało go na pełnoekranowy komunikat, a powrót
  do pracy kosztował skan badge'a. Kolektor odłożony na regale na całą przerwę
  wraca dziś do otwartej dostawy bez niczego.
- **Sesja kończy się wyłącznie jawną decyzją** — wylogowaniem z Ustawień albo
  przejęciem pracy cudzym badge'em. Blokada nigdy nie gubiła postępu, więc jej
  jedynym mierzalnym skutkiem był ten skan.
- **Tożsamości pilnuje dalej to, co pilnowało naprawdę:** skan cudzego badge'a
  nie przełącza po cichu — pyta człowieka i zapisuje przejęcie w `events`.

**Nowy APK nie jest do tego potrzebny.** Blokadę zgłaszał serwer, więc starsze
kolektory przestają ją pokazywać zaraz po restarcie usług. APK z tego wydania
usuwa już tylko martwy kod po stronie aplikacji.

### Usunięte

- `POST /api/auth/unlock` — trasa nie ma czego odblokowywać.
- Odpowiedzi `/api/auth/badge` i `/api/auth/me` nie niosą już `blokadaMin`
  ani `zablokowana`.
- Bramka `423 Sesja zablokowana` w `context.ts`. Razem z nią odpadł wyjątek dla
  `x-buffered-user`, który istniał wyłącznie po to, żeby wysyłka z bufora
  offline nie ginęła na zablokowanej sesji. Sam nagłówek **zostaje** — dalej
  rozstrzyga, kto podpisuje operację wykonaną poza zasięgiem.
- Stan `SessionState.Zablokowana` i akcja `BadgeAction.Odblokuj` w `:core`.

`device_session.last_seen` zostaje, ale niczego już nie bramkuje: to jedyny
ślad, kiedy dany kolektor się odezwał, i przydaje się przy pytaniu „to jedno
urządzenie czy wszystkie?".

### Pod spodem

- Testy serwera 223 → 220, testy `:core` 92 → 90. W obu miejscach doszła
  regresja na usunięty TTL: sesja bezczynna od godziny **pisze tak samo jak
  świeża**, a wcześniej dostawała 423.

---

## 0.4.1 — 27 lipca 2026

Dokumentacja przepisana według reguł ASD-STE100 w zakresie, jaki da się
przenieść na polski. PATCH, bo na ekranie nic się nie zmienia — `git pull`,
`npm ci`, `npm run build`, restart usług.

### Nowe

- **[`docs/slownik.md`](docs/slownik.md)** — jedno miejsce z regułami pisania
  dokumentacji i słowniczkiem terminów. Mówi też wprost, których reguł STE
  **nie** stosujemy, bo zależą od angielskiego. Zgodności ze standardem nie
  deklarujemy: poza angielskim nie da się jej spełnić.
- **`tools/styl_check.py`** — mierzy trzy reguły ze słownika: długość zdania
  (20 wyrazów w kroku procedury, 25 w prozie), długość akapitu i odrzucone
  warianty terminów. Bramkuje CI obok `docs_check.py`.

### Poprawione

- **Osiem dokumentów przepisanych.** Instrukcja została krótka i rozkazująca,
  a „dlaczego" zeszło pod nią do osobnych bloków. Najdłuższe zdanie w repo
  spadło z 52 do 25 wyrazów, ostrzeżenia stoją teraz **przed** krokiem, a
  40-pozycyjna checklista smoke-testu ma jedną rzecz do sprawdzenia na pozycję.
- **`README.md` mówił `better-sqlite3`** — moduł natywny zniknął w 0.4.0
  na rzecz wbudowanego `node:sqlite`.
- **`instalator/README.md` mówił o `SELECT` na siedmiu tabelach** — od 0.4.0
  jest ich osiem (`sl_Magazyn`).
- **CI nie uruchamiało się przy zmianie samego `DEPLOY.md`.** `docs_check.py`
  czytał ten plik od zawsze, ale nie było go w `paths` workflow — razem
  z `CHANGELOG.md` i `instalator/README.md`.

Poza zakresem świadomie zostały `docs/architektura.md`,
`docs/porownanie-asystent.md` i ten plik: to uzasadnienia decyzji, a limit
długości zdania wycina z nich dokładnie tę treść, dla której powstały.

---

## 0.4.0 — 27 lipca 2026

Pierwsze wydanie z numerem, który cokolwiek znaczy. Zbiera sześć zmian
zmergowanych po `0.3.0`.

### Wymaga działania

- **[wymaga działania] Nowe uprawnienie SQL: `GRANT SELECT ON dbo.sl_Magazyn`.**
  Bez niego karta towaru pokazuje tylko MAG, MGP i Zwroty, a `/api/health`
  mówi o tym w `problemy`. Aplikacja działa dalej — uruchom ponownie skrypt
  z [`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md) §2 albo
  instalator z `-TylkoKonfiguracja`.
- **[wymaga działania] API wymaga sesji.** Skrypty i `curl` uderzające w `/api/*`
  potrzebują teraz nagłówka `x-session` — poza czterema trasami
  (`GET /api/health`, `GET /api/setup`, `POST /api/auth/badge`,
  `POST /api/users` przy pustej bazie).
- **[wymaga działania] Konfiguracja przeniesiona do `wertis.env` na dysku.**
  `AppEnvironmentExtra` w usługach przestało być używane; instalator je kasuje,
  bo zmienne środowiskowe przykrywają plik.
- **[wymaga działania] Node ≥ 22.5.** Serwer używa wbudowanego `node:sqlite`.

### Nowe

- **Wszystkie magazyny na karcie towaru** — sekcja „pozostałe magazyny"
  odpowiada na pytanie „gdzie ten towar jeszcze leży". Biuro może wybrane
  ukryć: Ustawienia → Magazyny (konto biura + PIN). MAG, MGP i Zwroty zostają
  zawsze, bo prowadzą rozkładanie.
- **Instalator Windows** — jeden `.exe` zamiast ~500 linii poleceń: usługi,
  zapora, kreator konfiguracji odpytujący bazę Subiekta i konto SQL
  o uprawnieniach kolumnowych. [`instalator/README.md`](instalator/README.md).
- **Wersje widoczne na dole ekranu** — aplikacji i serwera, z podświetleniem
  rozjazdu.

### Poprawione

- **Bramka sesji na całym API.** Wcześniej sesji wymagały trzy trasy;
  `POST /api/products/:id/location` (zmiana lokalizacji w Subiekcie)
  i `GET /api/wydajnosc` (dane per pracownik) przechodziły bez tokenu,
  podpisując operację nagłówkiem `x-user` albo słowem „anonim".
- **`SQLITE_BUSY` przy dwóch procesach** — `busy_timeout` i `BEGIN IMMEDIATE`.
  Objawem były losowe 500 i zadania w statusie `error`, bez wzorca.
- **Żądanie bez pola `action` dawało 500 zamiast 400** — znalezione przez nowe
  testy tras.
- **Instalator wywracał się przy domyślnym `C:\wertis`** — `New-Item` na
  korzeniu dysku. Do tego brak sprawdzenia kodu wyjścia `git clone`, przez co
  nieudany klon meldował sukces i padał dwa kroki dalej.
- **Zero modułów natywnych** — `better-sqlite3` zastąpione wbudowanym
  `node:sqlite`, więc `npm ci` na Windows nie kompiluje już niczego.
- **Rozjazd trybu API i workera widoczny w `/api/health`** — wcześniej worker
  pracujący na danych demo wyglądał identycznie jak poprawny.

### Pod spodem

- Testy serwera 153 → 223, w tym pierwsze testy tras HTTP (`app.inject()`)
  i kolejki Sfery. Instalator dostał 21 asercji.
- `docs_check.py` pilnuje teraz także katalogu `instalator/` i zgodności wersji.

---

## 0.3.0 i wcześniej

Historia sprzed wprowadzenia tego pliku — patrz `git log` oraz opisy PR-ów.
