# Wdrożenie WERTIS — on-premise (serwer w magazynie)

Instrukcja wdrożenia na firmowej maszynie Windows — tej, na której działa
**Subiekt GT ze Sferą**. API + worker działają na jednym hoście w sieci LAN
magazynu; kolektory (aplikacja Android) łączą się przez WiFi. Biuro ma **podgląd pod
`http://serwer:3001/biuro`** — status dostaw i protokoły rozbieżności do
wydruku; operacje wykonuje się wyłącznie na kolektorze. Zero chmury.

```
Kolektory Zebra/Honeywell (APK, WiFi LAN) ─── http://mag.wertis.local:3001
        ▼
Maszyna z Subiektem GT (Windows)
  ├─ wertis-api     Fastify: REST + podgląd biura pod /biuro
  ├─ wertis-worker  worker Sfery: kolejka → zapis do SGT
  ├─ wertis.db      SQLite: faktury zakupu z postępem per pozycja, wyjątki,
  │                 sesje trybu B, kolejka, audyt events
  ├─ data/photos/   zdjęcia dowodowe do reklamacji (poza gitem, w backupie)
  ├─ MSSQL Subiekta (odczyt: login read-only)
  └─ Sfera (COM)    (zapis: wyłącznie przez workera)
```

---

> **Jak to jest zbudowane i dlaczego tak** — [`docs/architektura.md`](docs/architektura.md).
> Ten dokument mówi tylko, jak to uruchomić.

## 0. Instalator (zalecana droga)

Rozdziały 1–4 i checklistę z §6 wykonuje za Ciebie
[**instalator dla Windows**](instalator/README.md): pobierz
`WERTIS-Instalator.exe` z [wydań](https://github.com/MateuszPuchalski/mag-asystent/releases)
i uruchom jako administrator. Stawia Node i Gita, buduje aplikację, rejestruje
obie usługi, otwiera port, wypełnia `wertis.env` **odpytując bazę Subiekta**
i zakłada konto SQL o minimalnych uprawnieniach.

Trzy rzeczy robi lepiej niż ręczna droga, i to jest jego właściwy powód:

- **pokazuje zajętość wszystkich ośmiu pól własnych**, zanim wybierzesz to na
  lokalizację (§6 Etap 1) — aplikacja nadpisuje wybrane pole bezwarunkowo;
- **kasuje `AppEnvironment` i `AppEnvironmentExtra` obu usług**, bo zmienne
  środowiskowe przykrywają `wertis.env` (§2a) — pozostałość po starszej
  instalacji wygrałaby po cichu z nowymi ustawieniami;
- **sprawdza wersję Node** (aplikacja wymaga ≥ 22.5, §1) zamiast pozwolić jej
  wywalić się dopiero przy starcie usługi.

Instalacja pilotażowa bez dotykania Subiekta (Etap 0 z §6):

```powershell
WERTIS-Instalator.exe -Demo
```

Odinstalowanie idzie tym samym plikiem:

```powershell
WERTIS-Instalator.exe -Odinstaluj
```

Zdejmuje usługi, regułę zapory i katalog. Ślad audytowy przenosi obok.

**Nie cofa jednak tego, co aplikacja zapisała do Subiekta**, i nie usuwa loginu
SQL. Pełną listę podaje [`docs/wdrozenie.md`](docs/wdrozenie.md), sekcja
„Jak odinstalować".

**Reszta tego dokumentu opisuje to samo krok po kroku i nadal obowiązuje.**
Instalator nie robi wszystkiego. Konta pracowników zakłada się z kolektora
(§5a). Kopia zapasowa i nocna rekoncyliacja (§7) zostają do ustawienia ręcznie —
obie **zanim** ruszy praca na prawdziwych danych. Gdy instalator zawiedzie
w połowie, każdy jego krok da się dokończyć poniższą drogą.

## 1. Wymagania

- Windows z zainstalowanym Subiektem GT i licencją Sfery,
- [Node.js LTS 22](https://nodejs.org) — **wymagane ≥ 22.5** (`node -v`).
  Serwer używa wbudowanego `node:sqlite`, którego starsze wersje nie mają;
  w zamian **nie kompiluje już żadnego modułu natywnego**, więc `npm ci`
  nie potrzebuje build tools,
- [Git](https://git-scm.com) — instalator daje też **Git Bash**, w którym
  wykonuje się polecenia z tej instrukcji (albo WSL, jeśli wolisz),
- [NSSM](https://nssm.cc) do rejestracji usług (pojedynczy `nssm.exe`),
- stały adres maszyny w LAN (rezerwacja DHCP).

> Wszystkie polecenia niżej są w **bashu** (Git Bash). Ścieżki windowsowe
> zapisuje się w nim jako `/c/wertis`; tam, gdzie narzędzie Windows wymaga
> `C:\...` (NSSM), ścieżka jest w apostrofach, żeby bash nie zjadł ukośników.

## 2. Instalacja aplikacji

```bash
cd /c
git clone https://github.com/MateuszPuchalski/mag-asystent.git wertis
cd /c/wertis
npm ci
npm run build      # server → server/dist (API + strona /biuro)
npm run seed       # zasila SQLite danymi demo (tryb seeded)
```

Szybki test ręczny (przed rejestracją usług):

```bash
npm start                              # API
npm -w server run start:worker         # worker, w drugim oknie
curl -s http://localhost:3001/api/health      # {"ok":true,...} = API stoi
```

> ⚠️ **To jest tryb DEMO, nie Subiekt.** Bez `SGT_MODE=mssql` aplikacja czyta
> i zapisuje wyłącznie własną bazę SQLite zasiloną z `magmat.xlsx` — Subiekt nie
> jest ani odczytywany, ani zapisywany. Wszystko działa i wygląda normalnie,
> więc łatwo to przeoczyć: zmiana lokalizacji „się uda", a w Subiekcie nic się
> nie zmieni. Połączenie z prawdziwą bazą włącza **Etap 1 w §6**.

## 2a. Plik ustawień (`wertis.env`)

API i worker to **osobne procesy**. Gdy tylko jeden dostanie
`SGT_MODE=mssql`, zapisy po cichu wylądują w lokalnej bazie zamiast w Subiekcie —
i mimo to zgłoszą sukces. Dlatego **oba czytają ten sam plik z dysku**:

```bash
cd /c/wertis
cp wertis.env.example wertis.env
nano wertis.env            # uzupełnij MSSQL_* i magazyny (§6 Etap 1)

npm start                            # okno 1: API
npm -w server run start:worker       # okno 2: worker
```

Aplikacja szuka `wertis.env` obok pliku wykonywalnego, a w instalacji z repo —
w katalogu, z którego ją uruchomiono. `source wertis.env` nie jest już
potrzebne (dalej działa: zmienne środowiskowe mają pierwszeństwo nad plikiem).
Inną ścieżkę wskazuje `WERTIS_ENV_FILE`.

`wertis.env` jest w `.gitignore` (trzyma hasło). Sprawdzenie, że **oba** procesy
widzą Subiekta:

```bash
curl -s http://localhost:3001/api/health
# → {"ok":true,"mode":"mssql","worker":{"zyje":true,"mode":"mssql"},...}
```

Czytaj tak:

| co widzisz | co to znaczy |
|---|---|
| `"ok":true` | oba procesy żyją i pracują w tym samym trybie |
| `"mode":"seeded"` | pracujesz na danych demo, Subiekt nietknięty |
| `"problemy":[...]` | **przeczytaj zdanie** — mówi, co jest nie tak |
| `"worker":{"zyje":false}` | usługa `wertis-worker` nie działa; zapisy stoją w kolejce |

Wcześniej ten `curl` **nie mógł wykryć rozjazdu**: raportował wyłącznie proces
API, więc worker pracujący na demo wyglądał identycznie jak poprawny. Teraz
każdy proces melduje swój tryb i `/api/health` je porównuje.

## 3. Rejestracja usług Windows (NSSM)

NSSM to narzędzie Windows, ale uruchamia się je z Git Basha tak samo jak
z wiersza poleceń. Ścieżki `C:\...` w apostrofach — bash nie tknie wtedy
ukośników:

```bash
mkdir -p /c/wertis/logs

# API (razem z podglądem biura pod /biuro)
nssm install wertis-api 'C:\Program Files\nodejs\node.exe' 'C:\wertis\server\dist\index.js'
nssm set wertis-api AppDirectory 'C:\wertis'
nssm set wertis-api AppStdout 'C:\wertis\logs\api.log'
nssm set wertis-api AppStderr 'C:\wertis\logs\api.err.log'
nssm set wertis-api AppRotateFiles 1
nssm set wertis-api AppRotateBytes 10485760
nssm set wertis-api Start SERVICE_AUTO_START
nssm set wertis-api AppExit Default Restart

# Worker Sfery
nssm install wertis-worker 'C:\Program Files\nodejs\node.exe' 'C:\wertis\server\dist\worker\worker.js'
nssm set wertis-worker AppDirectory 'C:\wertis'
nssm set wertis-worker AppStdout 'C:\wertis\logs\worker.log'
nssm set wertis-worker AppStderr 'C:\wertis\logs\worker.err.log'
nssm set wertis-worker AppRotateFiles 1
nssm set wertis-worker Start SERVICE_AUTO_START
nssm set wertis-worker AppExit Default Restart

nssm start wertis-api
nssm start wertis-worker
```

**Konfiguracja usług — nic do przepisywania.** Obie usługi mają
`AppDirectory C:\wertis`, więc czytają `C:\wertis\wertis.env` — ten sam plik,
który uzupełniłeś w §2a. Po jego zmianie wystarczy restart:

```bash
nssm restart wertis-api ; nssm restart wertis-worker
```

> **Dlaczego nie przez `AppEnvironmentExtra`.** Wcześniej te same wartości
> wpisywało się TRZECI raz — osobno dla każdej usługi — i to była najgroźniejsza
> pułapka całego wdrożenia. Rozjazd nie dawał objawu: worker bez
> `SGT_MODE=mssql` pisał do lokalnej bazy i oznaczał zadania jako wykonane.
> Do tego przykład `ENV_WERTIS` pomijał część zmiennych (kto wkleił go
> dosłownie, tracił je po cichu), a niecytowana zmienna rozbijała się o spację
> w haśle.
> Jeden plik usuwa wszystkie trzy problemy naraz.
>
> Zmienne środowiskowe dalej działają i mają pierwszeństwo nad plikiem — gdyby
> ktoś ich kiedyś użył, `/api/health` pokaże rozjazd zamiast go przemilczeć.

> **Uwaga:** worker Sfery musi działać na TEJ maszynie (COM Sfery jest lokalny)
> i oba procesy muszą widzieć ten sam plik `C:\wertis\server\data\wertis.db`.
> Nie przenoś API na inny host bez migracji kolejki na Postgres.

## 4. Sieć: stały adres + zapora + DNS

1. **Rezerwacja DHCP** dla maszyny (po MAC) w routerze.
2. **Wpis DNS** `mag.wertis.local → <IP maszyny>` w routerze / serwerze AD DNS.
   Bez własnego DNS: wpis w plikach hosts kolektorów albo używanie samego IP.
3. **Zapora Windows** — wpuść port 3001 tylko z sieci LAN:

```bash
netsh advfirewall firewall add rule name="WERTIS kolektor" dir=in action=allow protocol=TCP localport=3001 remoteip=localsubnet
```

Kolektory łączą się z `http://mag.wertis.local:3001`. HTTPS nie jest wymagane —
kolektor działa po zwykłym HTTP w LAN.

## 5. Kolektory — natywna aplikacja Android (APK)

Kolektor to natywny klient z [`android/`](android/README.md) — czysty klient
REST tego serwera. Skan przez SDK producenta (Zebra DataWedge / Honeywell
DataCollection), trwały offline (Room), kiosk przez Android lock-task/MDM.

**1. Zbuduj APK** (maszyna z Android SDK / Android Studio albo artefakt z CI
`.github/workflows/android.yml` — job „build" wystawia `wertis-kolektor-debug-apk`):

```bash
cd android
./gradlew :app:assembleDebug        # → app/build/outputs/apk/debug/app-debug.apk
```

Do produkcji podpisz release (`./gradlew :app:assembleRelease` z własnym
keystore) — instrukcja podpisu jak w standardowym projekcie Android.

**2. Skaner sprzętowy** (bez konfiguracji w aplikacji — wybór wg producenta):
- **Zebra (DataWedge):** aplikacja sama tworzy profil `WERTIS` przy starcie
  (BARCODE→INTENT broadcast, wyjście klawiaturowe wyłączone). Gdy MDM blokuje
  zdalną konfigurację — profil ręcznie wg `android/README.md`.
- **Honeywell (DataCollection SDK):** wrzuć `DataCollection.aar` z portalu
  Honeywell do `android/app/libs/honeywell-datacollection.aar` **przed** buildem.
  Bez AAR-a aplikacja działa na skanerze klawiaturowym (wedge).

**3. Instalacja i konfiguracja na kolektorze:**
- Wgraj APK przez MDM (SOTI / Honeywell / Zebra) lub `adb install app-debug.apk`.
- Kiosk: przypnij aplikację przez Android lock-task / device owner (MDM) —
  Fully Kiosk Browser nie jest potrzebny.
- Przy pierwszym starcie adres serwera podajesz **na ekranie startowym**
  (`ZMIEŃ ADRES SERWERA`) — adres API w LAN, czyli
  `http://mag.wertis.local:3001` albo `http://<IP-serwera>:3001`. Ustawienia
  są za bramką sesji, więc przed pierwszym zalogowaniem tamtędy nie wejdziesz;
  po zalogowaniu ten sam adres zmienia się w **Ustawienia → Serwer WERTIS**.
- Fabryczna wartość to `http://10.0.2.2:3001` — alias hosta **w emulatorze**.
  Na fizycznym kolektorze nie wskazuje na nic, więc dopóki jej nie zmienisz,
  ekran startowy pokazuje „Nie widzę serwera pod adresem…".

Checklist smoke-test i szczegóły integracji skanerów: [`android/README.md`](android/README.md).

## 5a. Konta pracowników i hasła (plan §7)

Bez kont kolektor nie ma czym podpisać operacji. Ekran startowy prosi o login
i hasło, i nie przepuszcza dalej. **Tak samo API** — od lipca każda trasa poza
czterema (`GET /api/health`, `GET /api/setup`, `POST /api/auth/login`
i `POST /api/users` przy pustej bazie) wymaga nagłówka `x-session`.

> **Dlaczego.** Wcześniej bramką był wyłącznie ekran kolektora. Dowolne
> urządzenie w sieci hali mogło zmienić lokalizację w Subiekcie albo pobrać
> raport wydajności per pracownik. Podpisywało operację dowolnym nazwiskiem.

**1. Załóż konta z KOLEKTORA — bez terminala.** Po instalacji APK i ustawieniu
adresu serwera aplikacja sama sprawdza, czy instalacja jest pusta. Jeśli tak,
ekran startowy pokazuje **ZAŁÓŻ KONTA** obok pól logowania (których nikt
jeszcze nie założył).

> Przycisk **ZAŁÓŻ KONTA** pojawia się dopiero wtedy, gdy serwer odpowiedział.
> Jeśli widzisz same pola logowania, to znaczy, że kolektor NIE DOGADAŁ SIĘ
> Z SERWEREM — poprawny adres jest warunkiem wstępnym całego tego
> punktu. Brak odpowiedzi świadomie nie odblokowuje kreatora: martwe Wi-Fi
> wyglądałoby wtedy jak pusta instalacja i powstałby drugi komplet kont obok
> istniejącego.

W kreatorze wpisujesz wszystkich naraz:

- **pierwsza pozycja to konto biura** — pole roli jest zablokowane, bo to konto
  zakłada wszystkie następne i tylko ono widzi listę kont. Konto magazyniera na
  tej pozycji zamurowałoby administrację;
- kolejne osoby: imię, nazwisko, login, hasło, rola. Hasło jest wymagane dla
  każdej roli — konto bez hasła nie zaloguje się nigdy;
- po zatwierdzeniu kolektor pokazuje **loginy**. Haseł nie pokazuje ani razu:
  wpisałeś je przed chwilą, więc rozdaj je osobiście.

Kolejność wysyłki układa kreator: biuro zawsze pierwsze. Kreator sam loguje się
nowym kontem biura, żeby móc założyć resztę.

Gdy coś padnie w połowie — zerwane Wi-Fi przy czwartej osobie z sześciu — ekran
pokazuje **co już powstało**. Tych osób nie zakładaj drugi raz. Dopisz tylko
brakujące.

Nowe osoby dochodzą później tą samą drogą: **Ustawienia → DODAJ OSOBY**
(widoczne tylko dla konta biura).

**1b. Alternatywa: `curl`,** gdy kolektora jeszcze nie ma pod ręką albo konta
zakłada się skryptem.

```bash
# pierwsze konto — bez sesji, ale TYLKO przy pustej bazie
curl -X POST http://<IP-serwera>:3001/api/users \
  -H 'content-type: application/json' \
  -d '{"name":"Biuro Zakupy","role":"biuro","login":"biuro","haslo":"tajnehaslo"}'
# → {"user":{"userId":1,"login":"biuro","role":"biuro","maHaslo":true}}

# zaloguj się nim i dopisz resztę
TOKEN=$(curl -s -X POST http://<IP-serwera>:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"login":"biuro","haslo":"tajnehaslo"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -X POST http://<IP-serwera>:3001/api/users \
  -H "x-session: $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Jan Kowalski","login":"jkowalski","haslo":"tajnehaslo"}'

curl -X POST http://<IP-serwera>:3001/api/users \
  -H "x-session: $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Adam Nowak","role":"brygadzista","login":"anowak","haslo":"tajnehaslo"}'

curl http://<IP-serwera>:3001/api/users -H "x-session: $TOKEN"   # lista kont
```

Hasła z przykładu zmień. `tajnehaslo` jest w tej instrukcji po to, żeby dało się
ją wykonać bez zastanawiania się — nie po to, żeby zostało w firmie.

`GET /api/setup` odpowiada `{"potrzebne":true}`, dopóki nie ma ani jednego
konta — tego samego pytania używa kolektor.

**Lista kont jest dostępna tylko dla biura** i to nie jest przesada: zwraca
login każdej osoby, czyli połowę tego, czego trzeba do zalogowania. Wystawiona
hali byłaby listą celów.

**2. Zmiana hasła.** Swoje hasło każdy zmienia sam:

```bash
curl -X POST http://<IP-serwera>:3001/api/auth/haslo \
  -H "x-session: $TOKEN" -H 'content-type: application/json' \
  -d '{"stare":"tajnehaslo","nowe":"noweHaslo123"}'
```

Cudze ustawia biuro przez `POST /api/users/:id/haslo` z ciałem `{"haslo":"…"}`.
Podanie `null` odbiera hasło: konto zostaje w bazie razem z historią, ale nikt
się nim nie zaloguje.

**3. Migracja historii** (tylko przy aktualizacji istniejącej instalacji —
jednorazowo, idempotentnie). Zakłada konta dla nazw, które już są w `events`,
scala warianty tej samej osoby (`Jan`, `jan`, `Jan K`) w jedno konto i wypełnia
`events.user_ref`. Historii nie kasuje: `user_id` zostaje jako tekstowy
snapshot, a zdarzenia niedopasowane zostają z `user_ref = NULL`.

```bash
curl -X POST http://<IP-serwera>:3001/api/users/migrate-history \
  -H "x-session: $TOKEN" -H 'content-type: application/json'
# → {"zalozonychKont":4,"przypisanychZdarzen":1281,"nieprzypisanych":37,"nazwy":[...]}
```

Konta z migracji powstają **bez loginu i bez hasła** — to konta-ślady. Audyt ma
na co wskazywać, a zalogować się nimi nie da. Po migracji przejrzyj `nazwy`;
wpisy w rodzaju „magazynier" albo „test" wyłącz przez
`POST /api/users/:id/active` z `{"active":false}`. Konta się **nie kasuje**:
historia w `events` musi mieć na co wskazywać.

**3a. Co wymaga której roli.** Do codziennej pracy wystarcza zalogowanie. Dwie
operacje są zastrzeżone:

| operacja | kto | gdzie |
|---|---|---|
| odebranie koledze zajętej pozycji przed 30-min TTL | brygadzista lub biuro | kolektor: skan zajętego towaru → propozycja odebrania |
| zakładanie kont, hasła, wyłączanie kont | **tylko biuro** | kolektor: Ustawienia → DODAJ OSOBY, albo `curl` |

Odebranie pozycji zapisuje w `events` (`lock_forced`) **komu i przez kogo**.
Lock już wygasły zdejmuje się bez wpisu — po TTL nikomu nic nie odebrano.

Zarządzanie kontami jest zastrzeżone dla biura, bo to jedyna operacja tworząca
tożsamość. Brygadzista mogący zakładać konta założyłby konto biura z własnym
hasłem. Reszta reguł przestałaby wtedy cokolwiek znaczyć.

> **Drugiego czynnika już nie ma.** Do 0.20.0 obie operacje wymagały PIN-u,
> bo plakietkę dawało się pożyczyć razem z tożsamością („weź moją, mam ręce
> w oleju"). Hasła się tak nie pożycza, więc PIN wyszedł — ale porzucony
> zalogowany kolektor pozwala teraz obcej osobie na wszystko, co może jego
> właściciel. Wylogowanie po zmianie przestało być uprzejmością.

**4. Raport wydajności (`GET /api/wydajnosc?days=7`) — obowiązek formalny
PRZED uruchomieniem.** Telemetria per pracownik to **monitoring pracowniczy**
w rozumieniu Kodeksu pracy (art. 22² i nast.). Wymaga:
- zapisu w **regulaminie pracy**, a gdy regulaminu nie ma — w **obwieszczeniu**,
- **uprzedzenia pracowników na 2 tygodnie** przed uruchomieniem,
- informacji dla nowych osób **przed dopuszczeniem do pracy**.

Bez tego dane są kwestionowalne w każdym zastosowaniu kadrowym. Kod tego nie
blokuje — decyzja należy do pracodawcy — a sam raport niesie tę informację
w polu `podstawaPrawna`. Techniczny audyt „kto zmienił lokalizację" to **co
innego** i nie wymaga wstrzymania.

## 6. Przejście na prawdziwe dane Subiekta (etapy wg spec §10)

> **Test na wersji edu (bez Sfery):** kompletna instrukcja krok po kroku —
> konfiguracja SQL Servera, loginy, checklist `[WERYFIKUJ]`, env i test
> end-to-end — w [`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md).
> Etap 1 poniżej i zapis lokalizacji (plan B) są już **zaimplementowane**.

**Etap 0 — pilot (tryb `seeded`, bez dotykania SGT):**
działa od razu po instalacji; dane z eksportu `magmat.xlsx`. Magazynier testuje
wyszukiwanie, kartę towaru, rozkładanie. Zero ryzyka.

**Etap 1 — odczyt z MSSQL (`SGT_MODE=mssql`):**
1. Utwórz login SQL o minimalnych uprawnieniach. Gotowy, idempotentny skrypt
   jest w [`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md) §2.

   Skrypt nadaje `GRANT SELECT` na sześć tabel i `GRANT UPDATE` na jedną
   kolumnę (lokalizacja). Aplikacja **nie ma żadnego innego prawa zapisu**.
2. Przejdź checklistę `[WERYFIKUJ]`. Jest krótka.

   Nazwy tabel i kolumn oraz kody `dok_Typ` i `dok_Status` są odczytane wprost
   z oficjalnego opisu struktury InsERT dla wersji bazy 1.8731.31.6933 — tej,
   którą ma firma. Patrz
   [`docs/subiekt-gt-struktura.md`](docs/subiekt-gt-struktura.md).

   Domyślne w `config.ts` są z niego wzięte i nie trzeba ich ustalać:
   `DOK_TYP_FZ=1`, `DOK_TYP_PZ=10` (PZ, **nie** 5 = KFZ), bufor =
   `dok_Status = 3` (odłożony).

   Do ustalenia na własnej bazie zostają **trzy** rzeczy. Ta sekcja mówi,
   **co i po co**. Zapytania, odczyt wyniku i skutki pomyłki opisuje rozdział
   „Jak ustalić wszystkie wartości" w
   [`docs/subiekt-gt-struktura.md`](docs/subiekt-gt-struktura.md).

   Zapytania stały wcześniej w obu plikach naraz. Czytelnik nie miał jak
   poznać, która wersja jest aktualna — a jedna z nich była błędna przez pół
   roku.

   - **`mag_Id` magazynów MAG, MGP i Zwroty** (→ `MAG_ID_MAG` / `MAG_ID_MGP` /
     `MAG_ID_ZWROTY`). O trybie dokumentu rozstrzyga magazyn skutku, więc
     pomyłka wysyła dostawę do złej zakładki. Zwroty rozlicza biuro
     w Subiekcie; aplikacja pokazuje tylko ich stan na karcie towaru.

   - **pole lokalizacji na `tw__Towar`** (→ `MSSQL_LOC_COLUMN`).

     > ⚠️ Worker **nadpisuje wybrane pole bezwarunkowo**. Wybierz takie, którego
     > firma nie używa do niczego innego.

     W 1.87 SP3 HF1 (era KSeF) natywnej kolumny `tw_Lokalizacja` **nie ma**.
     Wybierasz jedno z ośmiu pól własnych `tw_Pole1..tw_Pole8`, każde
     `varchar(50)`. `LOC_FIELD_LIMIT=50` wynika z rozmiaru kolumny.

     Kreator liczy dla każdego pola zajętość **i liczbę gotowych adresów
     półek**, po czym podpowiada pole z adresami. Jeśli firma już gdzieś notuje
     lokalizacje, to jest właśnie to pole. Wskazanie innego zostawiłoby dwa
     źródła prawdy o tym samym.

   - **zamówienia do dostawcy (ZD) na karcie towaru** (→ `DOK_STATUS_ZD_OTWARTE`,
     `MSSQL_ZD_ZREAL_COLUMN`, `MSSQL_ZD_TERMIN_COLUMN`). Wszystkie trzy są
     opcjonalne — bez nich karta działa, tylko mniej dokładnie.

     **Kolumny ilości zrealizowanej może nie być wcale.** Na bazie
     1.8731.31.6933 `dok_Pozycja` nie niesie stopnia realizacji w żadnym polu.
     Poprawnym ustawieniem jest wtedy wartość pusta: `MSSQL_ZD_ZREAL_COLUMN=`.

   Kreator z §0 pyta sam o trzy pierwsze pozycje. **O ustawienia ZD, typy
   dostaw i okno importu nie pyta wcale** — te dopisuje się ręcznie do
   `wertis.env`. Komplet wymienia rozdział „Grupa 3" w opisie struktury.

3. Wpisz wartości do `wertis.env` (§2a) — jeden plik dla API i workera.
   Importer `server/src/adapters/subiekt.mssql.ts` zasila read-model `sgt_*`
   przy starcie API, co `MSSQL_SYNC_MS` i przez `POST /api/admin/resync`.
4. Uruchom oba procesy — czytają ten sam plik, więc nie ma czego przenosić.
   Przy pracy na usługach wystarczy `nssm restart` obu (§3):

   ```bash
   npm start                          # okno 1
   npm -w server run start:worker     # okno 2

   curl -s http://localhost:3001/api/health
   ```

   Ma pokazać `"ok":true`, `"mode":"mssql"` **oraz** `"worker":{"mode":"mssql"}`.
   Dopóki którykolwiek mówi `seeded`, ta strona pracuje na danych demo
   i **nic nie trafia do Subiekta** — a `"problemy"` powiedzą, która to.

**Etap 1a — zapis (automatyczny przy `SGT_MODE=mssql`):** ten sam jeden login
wykonuje `set_location` bezpośrednim UPDATE jednej kolumny objętej
`GRANT UPDATE`. Zadania MM — z rundy wózka (kontener) i z zamkniętego
— zgłaszają czytelny błąd; do czasu workera Sfery MM wystawia
biuro w Subiekcie. Osobnego przełącznika trybu zapisu nie ma.

Konsekwencja dla zwrotów na tym etapie: adres na półce zapisuje aplikacja, ale
towar zjeżdża z magazynu Zwroty dopiero po ręcznym MM w biurze. Kolejność jest
bezpieczna (adres przed sprzedawalnością), więc opóźnienie kosztuje utraconą
szansę sprzedaży, a nie błędny stan.

**Etap 2 — dokumenty MM przez Sferę (kontener + zwroty):**
1. Postaw osobny proces na Windows w C# albo w Pythonie z pywin32. COM Sfery
   najstabilniej działa z tych środowisk (spec §9).

   Proces czyta tę samą tabelę `sfera_queue` i wykonuje wyłącznie zadania `mm`.
   Kontrakt wywołań jest w `server/src/adapters/sfera.ts`.
2. Najpierw jedno MM testowe na kartotece próbnej, potem produkcyjnie.

**Etap 3 — pełny obieg:** rozkładanie dostaw z prawdziwych FZ/PZ i MM per wózek
(kontener) przez workera Sfery.

## 7. Backup i utrzymanie

- **Backup:** nocna kopia `C:\wertis\server\data\wertis.db` (Harmonogram zadań):

  ```bash
  cp /c/wertis/server/data/wertis.db "/d/backup/wertis-$(date +%Y%m%d).db"
  ```

  Plik trzyma postęp rozkładania dostaw, wyjątki, sesje trybu B, kolejkę
  i audyt `events`. Źródłem prawdy o towarach i stanach pozostaje baza Subiekta, więc
  to lekki backup.
- **Zdjęcia dowodowe:** `C:\wertis\server\data\photos\`. To jedyne dane, których
  nie da się odtworzyć z Subiekta ani z seedu — dowód do reklamacji u dostawcy.
  Kopiuj ten katalog razem z bazą:

  ```bash
  cp -r /c/wertis/server/data/photos "/d/backup/photos-$(date +%Y%m%d)"
  ```

  Kolektor skaluje kadr do 1280 px / JPEG 70 (~200 KB), więc katalog rośnie
  wolno; po zamknięciu reklamacji stare zdjęcia można archiwizować ręcznie.
- **Logi:** `C:\wertis\logs\` (rotacja przez NSSM). Błędy zapisu Sfery widać
  też na kolektorze (czerwona pastylka + PONÓW).
- **„Tryb seeded, chociaż w `wertis.env` stoi `mssql`".** Konfigurację przykryła
  zmienna środowiskowa usługi — środowisko ma nad plikiem pierwszeństwo.
  `/api/health` wypisuje wtedy przykryte klucze w `configPrzykryte` i zgłasza
  to jako problem.

  ```powershell
  nssm get wertis-api AppEnvironment ; nssm get wertis-api AppEnvironmentExtra
  ```

  Czyści się je przez `nssm reset <usługa> <ustawienie>`, dla obu usług, po
  czym trzeba je zrestartować. To są **dwa różne ustawienia**: `Extra` dokłada
  zmienne, `AppEnvironment` zastępuje całe środowisko procesu.
- **Nocna rekoncyliacja — ustaw ją, zanim ruszy praca na prawdziwych danych.**
  Aplikacja pisze do Subiekta przez kolejkę, ale bez tego kroku **nikt nie
  sprawdza, czy stan po stronie Subiekta odpowiada temu, co aplikacja myśli, że
  zapisała**. To najtańsza obrona przed cichym błędem: kod działa, wygląda
  dobrze i przez trzy tygodnie rozjeżdża dane.

  ```bash
  # Harmonogram zadań Windows / cron, raz na dobę:
  cd /c/wertis && npm run reconcile
  ```

  Sprawdza trzy rzeczy:

  1. adres w Subiekcie kontra ostatni udany zapis (24 h),
  2. zadania w `error` starsze niż doba,
  3. `waiting_for_doc` starsze niż trzy dni (dokument raczej nie wyjdzie już
     z bufora).

  Każda z nich mierzy zadeklarowany niezmiennik. Niezmienniki trzeba mierzyć,
  nie deklarować.

  **Zerowy wynik nie tworzy pliku i kończy się kodem 0**, bo raport przychodzący
  codziennie przestaje być czytany po tygodniu. Rozjazdy → CSV z datą w nazwie,
  w katalogu `reconcile/` obok bazy, i **kod wyjścia 2** do podpięcia pod alert.
  Podgląd na żądanie: `GET /api/reconcile`.
- **Raport przeslotowania — 1–2× w roku, przed sezonem.** Nie jest to funkcja
  aplikacji ani zadanie cykliczne; uruchamia się go ręcznie, gdy jest czas na
  przestawianie towaru.

  ```bash
  cd /c/wertis && npm run reslot
  ```

  Czyta bazę Subiekta **wyłącznie do odczytu** i wypisuje CSV z czterema
  listami. Liczy **pion, nie odległość**. Przy 342 m² przejście róg–róg to
  ~20 s, a pobranie z podłogi albo z drabiny 10–25 s wobec ~3 s ze strefy
  złotej.

  **Kolejność ma znaczenie i jest w nagłówku pliku.** Najpierw eksmisja martwych
  indeksów ze strefy złotej: daje ~80% korzyści i jest bezpieczna, bo przenosisz
  towar, którego nikt nie ruszał. Awanse idą dopiero potem, bo wymagają
  zwolnionych miejsc.

  Skrypt **odmawia wypisania list 1–3, gdy nie widzi historii pobrań** — bez niej
  każdy indeks wygląda na martwy i raport kazałby opróżnić całą strefę złotą.
  Jeśli tak się stanie, sprawdź `dok_Typ` dokumentów WZ i zakres dat.

  Poziomy strefy złotej są per zakres regałów w
  `server/src/services/strefa-zlota.ts` — regały bez reguły trafiają na osobną,
  czwartą listę, zamiast po cichu wpaść do złego kubełka.

- **Aktualizacja aplikacji:**

  ```bash
  cd /c/wertis
  git pull
  npm ci
  npm run build
  nssm restart wertis-api
  nssm restart wertis-worker
  ```

  **Kolektor aktualizuje się osobno.** Zbuduj nowy APK w CI albo przez
  `./gradlew :app:assembleRelease` i roześlij go przez MDM (sekcja 5).
- **Diagnoza:** `http://mag.wertis.local:3001/api/health` → `{ ok: true, mode: ... }`;
  tabela `sfera_queue` w `wertis.db` pokazuje pełną historię zadań.
- **Komputer pokazuje stary splash kolektora zamiast podglądu biura.** Aplikacja
  webowa („Kolektor magazynowy · prototyp v0.2") wyszła z repo w 0.3.0. Była
  jednak PWA: jej service worker serwuje splash z cache, więc żądanie w ogóle
  nie dociera do serwera. Od 0.19.0 serwer odpowiada pod `/sw.js` skryptem, który
  kasuje cache i wyrejestrowuje starego workera; wystarczy raz wejść na
  `http://mag.wertis.local:3001/` i odświeżyć. Gdyby maszyna miała aplikację
  **zainstalowaną** jako osobne okno, odinstaluj ją w przeglądarce
  (Chrome → Ustawienia → Aplikacje).

## Dlaczego nie chmura

Worker musi rozmawiać ze Sferą przez COM na maszynie z Subiektem, a odczyt idzie
z MSSQL w LAN. Chmura nie ma dostępu do żadnego z nich. Hostowanie samego
frontendu na zewnątrz dodaje zależność od internetu w hali bez żadnej korzyści,
bo kolektory i tak są w LAN. Jedna maszyna on-premise = najprostsza
i najodporniejsza topologia dla tej skali.
