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
  │                 kolejka, audyt events
  ├─ data/photos/   zdjęcia dowodowe do reklamacji (poza gitem, w backupie)
  ├─ MSSQL Subiekta (odczyt: login read-only)
  └─ Sfera (COM)    (zapis: wyłącznie przez workera)
```

---

> **Jak to jest zbudowane i dlaczego tak** — [`docs/architektura.md`](docs/architektura.md).
> Ten dokument mówi tylko, jak to uruchomić.

## 0. Instalator — właściwa droga

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
SQL. Pełną procedurę i listę tego, co zostaje, podaje §8.

**Rozdziały 1–4 to droga ręczna — dokumentacja odniesienia instalatora.**
Opisują krok po kroku to, co on robi sam. Sięgnij po nie, gdy instalator
zawiedzie w połowie albo gdy chcesz wiedzieć, co dokładnie stanęło na maszynie.

**Rozdziały 5–8 dotyczą każdej instalacji**, także tej z instalatora.
Instalator nie robi wszystkiego. Konta pracowników zakłada się z kolektora
(§5a). Kopia zapasowa i nocna rekoncyliacja (§7) zostają do ustawienia ręcznie —
obie **zanim** ruszy praca na prawdziwych danych.

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

Instalator **scala** ten plik, a nie nadpisuje. Klucz, o który kreator zapytał,
bierze z odpowiedzi; klucza, o który nie pytał, nie rusza. Wartości dopisane
ręką przeżywają więc kolejne przebiegi z `-TylkoKonfiguracja`. Nie przeżywają
dwie rzeczy. **Komentarze własne** — plik jest generowany. **Klucze od kont**
(`ADMIN_LOGIN`, `ADMIN_HASLO`) — sekret konta aplikacji idzie przez API do bazy
i instalator usuwa go z pliku.

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

# Worker zapisu (lokalizacje; gdy SFERA_WORKER=0 bierze też zadania MM)
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

**Trzecia usługa — worker Sfery (opcjonalna, etap 2 z §6).** Dochodzi dopiero
przy automatyzacji dokumentów MM: samodzielny exe zbudowany wg
[`sfera-worker/README.md`](sfera-worker/README.md), wymaga licencji Sfery
i `SFERA_WORKER=1` w `wertis.env`:

```powershell
nssm install wertis-sfera 'C:\wertis\sfera-worker\wertis-sfera-worker.exe'
nssm set wertis-sfera AppDirectory 'C:\wertis'
nssm set wertis-sfera AppStdout 'C:\wertis\logs\wertis-sfera.log'
nssm set wertis-sfera AppStderr 'C:\wertis\logs\wertis-sfera.err.log'
nssm set wertis-sfera AppRotateFiles 1
nssm set wertis-sfera Start SERVICE_AUTO_START
nssm set wertis-sfera AppExit Default Restart
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
> i wszystkie procesy muszą widzieć ten sam plik `C:\wertis\server\data\wertis.db`.
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
DataCollection), trwały offline (bufor plikowy JSON + WorkManager), kiosk przez
Android lock-task/MDM.

**1. Zbuduj APK** (maszyna z Android SDK / Android Studio albo artefakt z CI
`.github/workflows/android.yml` — job „build" wystawia `wertis-kolektor-debug-apk`):

```bash
cd android
./gradlew :app:assembleDebug        # → app/build/outputs/apk/debug/app-debug.apk
```

**Podpis wydania jest od 0.48.0 warunkiem aktualizacji, nie ozdobą.** Android
odmawia instalacji aktualizacji podpisanej innym kluczem niż zainstalowana
aplikacja. Build debugowy z CI dostaje losowy klucz przy każdym biegu, więc
dwa kolejne artefakty nie zainstalują się jeden nad drugim.

Klucz robi się raz:

```bash
keytool -genkeypair -v -keystore wertis.keystore -alias wertis \
  -keyalg RSA -keysize 4096 -validity 10000
```

Build wydania czyta go ze zmiennych `WERTIS_KEYSTORE`, `WERTIS_KEYSTORE_HASLO`,
`WERTIS_KLUCZ_ALIAS` i `WERTIS_KLUCZ_HASLO`. Te same wartości przyjmuje plik
`local.properties` w katalogu `android/`, w polach `wertis.keystore`,
`wertis.keystore.haslo`, `wertis.klucz.alias` i `wertis.klucz.haslo`. W CI
keystore leży jako sekret `WERTIS_KEYSTORE_B64`.

> **Kopia klucza jest równie ważna jak kopia bazy.** Utrata keystore znaczy, że
> żaden przyszły APK nie zainstaluje się nad obecnym. Jedynym wyjściem jest
> wtedy odinstalowanie aplikacji na każdym kolektorze z osobna.

**Przejście na własny klucz jest jednorazowo bolesne.** Kolektory z buildem
debugowym odmówią aktualizacji komunikatem „App not installed". Każde
urządzenie trzeba odinstalować i zainstalować od nowa, a to kasuje dane
lokalne: adres serwera, listę ostatnio skanowanych i **bufor offline**.

Kolejność na urządzenie, bez skrótów:

1. Sprawdź, czy pasek bufora offline pokazuje zero operacji do wysłania.
2. Odinstaluj aplikację.
3. Zainstaluj nowy APK.
4. Podaj adres serwera na ekranie startowym.

Rób to po zmianie, urządzenie po urządzeniu. Każda kolejna aktualizacja wchodzi
już po wierzchu i niczego nie kasuje.

**2. Skaner sprzętowy** (bez konfiguracji w aplikacji — wybór wg producenta):
- **Zebra (DataWedge):** aplikacja sama tworzy profil `WERTIS` przy starcie
  (BARCODE→INTENT broadcast, wyjście klawiaturowe wyłączone). Gdy MDM blokuje
  zdalną konfigurację — profil ręcznie wg `android/README.md`.
- **Honeywell (DataCollection SDK):** wrzuć `DataCollection.aar` z portalu
  Honeywell do `android/app/libs/honeywell-datacollection.aar` **przed** buildem.
  Bez AAR-a aplikacja działa na skanerze klawiaturowym (wedge).

**3. Instalacja i konfiguracja na kolektorze:**
- **Pierwsza instalacja** przez MDM (SOTI / Honeywell / Zebra) albo
  `adb install`. Kolejne wersje kolektor bierze sam — patrz punkt 5.
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

**1. Zwykle konto admina zakłada już INSTALATOR.** Pyta o login i hasło zaraz
po starcie usług. Ten punkt dotyczy więc instalacji stawianej ręcznie albo
serwera, na którym instalator tego kroku nie wykonał.

**Załóż konta z KOLEKTORA — bez terminala.** Po instalacji APK i ustawieniu
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

- **pierwsza pozycja to konto administratora** — pole roli jest zablokowane.
  Serwer wymusza rolę `admin` na pierwszym koncie w pustej bazie, a konto biura
  umie założyć wyłącznie admin. Konto magazyniera na tej pozycji zamurowałoby
  administrację;
- kolejne osoby: imię, nazwisko, login, hasło, rola. Hasło jest wymagane dla
  każdej roli — konto bez hasła nie zaloguje się nigdy;
- po zatwierdzeniu kolektor pokazuje **loginy**. Haseł nie pokazuje ani razu:
  wpisałeś je przed chwilą, więc rozdaj je osobiście.

Kolejność wysyłki układa kreator: admin zawsze pierwszy. Kreator sam loguje się
nowym kontem admina, żeby móc założyć resztę.

Gdy coś padnie w połowie — zerwane Wi-Fi przy czwartej osobie z sześciu — ekran
pokazuje **co już powstało**. Tych osób nie zakładaj drugi raz. Dopisz tylko
brakujące.

Nowe osoby dochodzą później tą samą drogą: **Ustawienia → DODAJ OSOBY**
(widoczne dla konta biura i admina).

**1b. Alternatywa: `curl`,** gdy kolektora jeszcze nie ma pod ręką albo konta
zakłada się skryptem.

```bash
# pierwsze konto — bez sesji, ale TYLKO przy pustej bazie.
# Rola `admin` jest WYMUSZONA; cokolwiek wpiszesz w `role`, zostanie zignorowane.
curl -X POST http://<IP-serwera>:3001/api/users \
  -H 'content-type: application/json' \
  -d '{"name":"Właściciel","login":"wlasciciel","haslo":"tajnehaslo"}'
# → {"user":{"userId":1,"login":"wlasciciel","role":"admin","maHaslo":true}}

# zaloguj się nim i dopisz resztę
TOKEN=$(curl -s -X POST http://<IP-serwera>:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"login":"wlasciciel","haslo":"tajnehaslo"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -X POST http://<IP-serwera>:3001/api/users \
  -H "x-session: $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Jan Kowalski","login":"jkowalski","haslo":"tajnehaslo"}'

# konto biura — tę linię wykona TYLKO admin; biuro dostanie 403
curl -X POST http://<IP-serwera>:3001/api/users \
  -H "x-session: $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Biuro Zakupy","role":"biuro","login":"biuro","haslo":"tajnehaslo"}'

curl http://<IP-serwera>:3001/api/users -H "x-session: $TOKEN"   # lista kont
```

Hasła z przykładu zmień. `tajnehaslo` jest w tej instrukcji po to, żeby dało się
ją wykonać bez zastanawiania się — nie po to, żeby zostało w firmie.

**Żadnych domyślnych haseł i żadnych domyślnych kont.** Ta reguła nie była
dotąd nigdzie zapisana, choć kod trzymał się jej od początku. Instalator losuje
hasło konta SQL i **pyta o hasło admina zamiast je wymyślać**. Kreator nie
pokazuje haseł ani razu, a konto bez hasła nie zaloguje się nigdy. Nawet
`npm run seed` losuje hasło admina i pokazuje je raz, zamiast wpisywać stałe
demo — wyjątek „tylko na dev" jest dokładnie tym, który jedzie potem na
produkcję.

### Trzy role i to, co je dzieli

| rola | co może ponad poprzednią |
|---|---|
| `magazynier` | praca na hali: skanowanie, lokalizacje, zgłoszenia |
| `biuro` | lista kont, zakładanie kont magazynierów, ślad audytowy, widoczność magazynów, raport wydajności, zdjęcie dostawy z listy |
| `admin` | wszystko, co biuro, **plus** konta o roli `biuro` i `admin`, wyłączanie kont i odbieranie haseł |

Granica między biurem a adminem jest jedyną nieoczywistą i dlatego ma własne
uzasadnienie. Do 0.23.0 „zarządzanie kontami" było jedną operacją zastrzeżoną
dla biura — czyli **biuro zakładało konto biura z własnym hasłem**. Rola
strzegąca tożsamości rozdawała ją sama sobie i żadna reguła wyżej nic nie
znaczyła. Od 0.24.0 to dwa osobne uprawnienia.

**Cena jest jawna:** biuro nie zresetuje hasła magazynierowi, który je
zapomniał — musi poprosić admina. To był świadomy wybór, nie skutek uboczny.

Admin **nie dostaje** audytu ani raportu wydajności jako uprawnienia ponad
biuro. Dostaje dokładnie tyle, co biuro, żeby konto z instalatora nadawało się
do pracy — raport o pracy ludzi zostaje tam, gdzie był.

Rola przychodząca w `POST /api/users` jest **sprawdzana przeciw zamkniętej
liście**; słowo spoza niej to 400, a nie konto z rolą, której nikt nie zna.

`GET /api/setup` odpowiada `{"potrzebne":true}`, dopóki nie ma ani jednego
konta — tego samego pytania używa kolektor.

**Lista kont jest dostępna tylko dla biura i admina** i to nie jest przesada:
zwraca login każdej osoby, czyli połowę tego, czego trzeba do zalogowania.
Wystawiona hali byłaby listą celów.

**2. Zmiana hasła.** Swoje hasło każdy zmienia sam:

```bash
curl -X POST http://<IP-serwera>:3001/api/auth/haslo \
  -H "x-session: $TOKEN" -H 'content-type: application/json' \
  -d '{"stare":"tajnehaslo","nowe":"noweHaslo123"}'
```

Cudze ustawia **admin** przez `POST /api/users/:id/haslo` z ciałem
`{"haslo":"…"}`. Podanie `null` odbiera hasło: konto zostaje w bazie razem
z historią, ale nikt się nim nie zaloguje. Biuro dostanie na tej trasie 403 —
patrz tabela ról wyżej.

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

**5. Aktualizacja kolektorów (od 0.48.0).** Plik leży na serwerze WERTIS,
w `server\data\apk\`, pod nazwą niosącą wersję: `wertis-kolektor-0.48.0.apk`.
Kładzie go tam instalator przy `-Aktualizuj`; ręcznie wystarczy skopiować plik
do tego katalogu.

Kolektor pyta o nową wersję **przy otwarciu aplikacji** i proponuje pobranie.
Pytanie działa także przed zalogowaniem — urządzenie z zepsutą aplikacją da się
naprawić bez logowania się do niej.

Trzy rzeczy warto wiedzieć przed pierwszym takim wdrożeniem:

- Android poprosi o zgodę **„Instalowanie nieznanych aplikacji"** dla WERTIS.
  Zgoda jest jednorazowa, per urządzenie.
- Jeżeli MDM blokuje instalowanie spoza sklepu, kolektor powie to wprost i nic
  nie pobierze. Wtedy zostaje droga przez MDM, jak dotąd.
- Aktualizacja niczego nie kasuje: bufor offline, adres serwera i lista
  ostatnio skanowanych zostają na miejscu.

**3a. Co wymaga której roli.** Do codziennej pracy wystarcza zalogowanie.
Zastrzeżone są trzy rzeczy:

| operacja | kto | gdzie |
|---|---|---|
| zdjęcie dostawy z listy jako rozłożonej poza WERTIS | biuro, admin | przeglądarka: `/biuro` → DOSTAWY |
| zakładanie kont magazynierów | biuro, admin | kolektor: Ustawienia → DODAJ OSOBY, albo `curl` |
| konta o roli `biuro`/`admin`, wyłączanie kont, odbieranie haseł | **tylko admin** | `curl` |

Zdjęcie dostawy z listy wymaga powodu wpisanego z ręki i zapisuje go w `events`
razem z nazwiskiem. Cofnięcie jest jednym kliknięciem w tym samym miejscu.

Zakładanie kont nie schodzi na halę, bo to jedyna operacja tworząca tożsamość.
Magazynier mogący zakładać konta założyłby konto biura z własnym hasłem.
Reszta reguł przestałaby wtedy cokolwiek znaczyć — i ten sam argument o piętro
wyżej oddziela biuro od admina.

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

### Najważniejsze narzędzie: zatrzymany worker

`wertis-api` i `wertis-worker` to **dwie osobne usługi Windows**. API czyta bazę
i przyjmuje pracę. Worker jest jedynym procesem, który **zapisuje do Subiekta**.

Zatrzymanie workera daje więc przebieg próbny na żywych danych:

```powershell
nssm stop wertis-worker
```

Aplikacja czyta prawdziwą bazę i kolejkuje zamierzone zapisy. **Do Subiekta nie
idzie nic.** Kolejka staje się listą tego, co aplikacja zrobiłaby, gdyby jej
pozwolić:

```bash
curl -s -H "x-session: $TOKEN" http://localhost:3001/api/queue | jq '.items[] | {label, detail, status}'
```

`/api/health` zgłosi wtedy zatrzymany worker jako problem. Na etapach próbnych
z [`docs/wdrozenie.md`](docs/wdrozenie.md) to jest oczekiwane, a nie usterka
instalacji.

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

### Konto SQL, gdy nie ma hasła `sa`

**`sa` nie jest wymagane.** Wystarczy dowolne konto, które może założyć login
i nadać uprawnienia. W wielu firmach nikt nie wypuszcza `sa` z rąk i instalator
to przewiduje.

Na pytanie o hasło **wciśnij Enter**. Instalator zapisze wtedy gotowy skrypt:

```
C:\wertis\nadaj-uprawnienia-wertis.sql
```

Hasło konta jest już w środku i w `wertis.env`, więc nic nie trzeba podmieniać.
Przekaż plik administratorowi bazy. Po jego wykonaniu wystarczy restart usług:

```powershell
nssm restart wertis-api ; nssm restart wertis-worker
```

Do tego czasu aplikacja **nie połączy się z bazą**. To jest oczekiwane, a nie
nieudana instalacja.

### Czym grozi pomyłka w którym ustawieniu

Część wartości domyślnych to ustalenia, a część **założenia**. Te drugie są
oznaczone w kodzie jako `[WERYFIKUJ]` i wymagają jednego zapytania na własnej
bazie. Przejdź tę tabelę przed pierwszą pracą na produkcji:

| ustawienie | co ustala | czym grozi pomyłka |
|---|---|---|
| `MSSQL_LOC_COLUMN` | pole lokalizacji na kartotece | **nadpisanie cudzych danych** — aplikacja pisze bezwarunkowo |
| `MSSQL_DATABASE` | baza podmiotu | praca na kopii zamiast produkcji, bez objawu |
| `DOK_TYPY_DOSTAW` | typy dokumentów w zakładce DOSTAWY (domyślnie sama FZ) | obce dokumenty na liście pracy magazyniera |
| `DOK_DNI_WSTECZ` | okno importu i zakres listy dostaw | nic nie ginie — niedokończone dostawy zostają mimo okna |
| `MSSQL_ZD_ZREAL_COLUMN` | ilość już odebrana z zamówienia | zawyżone ilości na karcie towaru |
| `DOK_STATUS_ZD_OTWARTE` | które zamówienia uznajemy za otwarte | zamknięte zamówienie wisi na karcie |

Gdy kolumny ilości zrealizowanej nie ma wcale (patrz Etap 1 wyżej), zostaw
wartość pustą. Karta towaru opisze wtedy ilość jako oszacowanie, a `/api/health`
przestanie zgłaszać problem, którego nie da się rozwiązać ustawieniem.

**Etap 1a — zapis (automatyczny przy `SGT_MODE=mssql`):** ten sam jeden login
wykonuje `set_location` bezpośrednim UPDATE jednej kolumny objętej
`GRANT UPDATE`. Zadania MM zgłaszają czytelny błąd; do czasu wdrożenia workera
Sfery (etap 2 niżej) dokument MM wystawia biuro w Subiekcie. Osobnego
przełącznika trybu zapisu nie ma — jest tylko `SFERA_WORKER=1` z etapu 2,
który przenosi zadania MM do trzeciej usługi.

Konsekwencja dla przesunięć na tym etapie: adres na półce zapisuje aplikacja,
ale stan zjeżdża z magazynu źródłowego dopiero po ręcznym MM w biurze.
Kolejność jest bezpieczna (adres przed sprzedawalnością), więc opóźnienie
kosztuje utraconą szansę sprzedaży, a nie błędny stan. Arkusz przesunięcia mówi
o tym wprost, zanim ktokolwiek dotknie przycisku.

**Zdjęcia kartotek na karcie towaru (opcjonalne, niezależne od etapów).**
**Robi to kreator.** Instalator sprawdza, czy w bazie jest `tw_ZdjecieTw`
z kompletem czterech kolumn, i gdy jest — włącza zdjęcia sam, ustawiając
sześć kluczy `ZDJECIA_*` i nadając siódmy `GRANT SELECT`. Wypisuje przy tym,
ile zdjęć znalazł. Nie ma tabeli, nie ma grantu i funkcja zostaje wyłączona.

Sam odczyt, zero zapisu — wolno to przećwiczyć już na etapie 1 (kopia bazy,
worker zatrzymany). Ręcznie wpisuje się te klucze tylko wtedy, gdy zdjęcia
leżą w katalogu na dysku (`ZDJECIA_ZRODLO=plik`), o co kreator nie pyta.
Komplet wartości i zapytania rozpoznawcze:
[`docs/subiekt-gt-struktura.md`](docs/subiekt-gt-struktura.md).

Miniatura na karcie towaru wymaga APK w wersji **0.30.0 lub nowszej**.
Serwer wyda zdjęcia od razu po restarcie, starszy kolektor nie ma ich gdzie
narysować.

**Zdjęcie dodane w Subiekcie pojawia się z opóźnieniem** i to jest projektowe.
Serwer pamięta „ta kartoteka zdjęcia nie ma" przez `ZDJECIA_BRAK_TTL_H`
(12 godzin), a kolektor przez dobę. Inaczej setki kartotek bez zdjęcia
odpytywałyby bazę przy każdym otwarciu karty. Najdalej nazajutrz obraz jest na
ekranie. Gdy trzeba szybciej — na przykład przy sprawdzaniu, czy wdrożenie
zadziałało — wymuś ponowne pytanie:

```bash
curl -s -X POST -H "x-session: <token>" http://localhost:3001/api/admin/zdjecia/odswiez
```

Kasuje to wyłącznie wpisy „brak zdjęcia" i te po błędzie. Zdjęcia już pobrane
zostają, bo ich skasowanie kazałoby wszystkim kolektorom ściągnąć obrazy od
nowa. Po stronie kolektora dobowej pamięci nie da się dziś skrócić.

Po dniu pracy
`/api/health` w polu `zdjecia` poda, ile zdjęć wpadło do cache'u i jak duże
było największe — dopiero na tych liczbach dobiera się `ZDJECIA_MAX_KB`.

**Etap 2 — dokumenty MM przez Sferę (worker gotowy w `sfera-worker/`):**

Osobny proces C#/.NET czytający tę samą tabelę `sfera_queue` i wykonujący
**wyłącznie zadania `mm`**. Wymaga: licencji Sfery, Windows z Subiektem GT
(COM jest lokalny) i konta operatora Subiekta z prawem wystawiania MM.
Kompletna instrukcja: [`sfera-worker/README.md`](sfera-worker/README.md).
Kolejność — **wszystko najpierw na KOPII bazy**:

1. Zbuduj exe (`sfera-worker\build.ps1`, maszyna z .NET 8 SDK) i skopiuj do
   `C:\wertis\sfera-worker\`.
2. Przejdź listę `[WERYFIKUJ]` z `sfera-worker/README.md` — ProgID, logowanie
   operatora, model dodawania MM. Wszystko siedzi w jednym pliku
   `src/SferaComAdapter.cs`.
3. Dopisz do `wertis.env`: `SFERA_WORKER=1`, `SFERA_OPERATOR`,
   `SFERA_OPERATOR_HASLO`. Zarejestruj usługę `wertis-sfera` (instalator
   z `-TylkoKonfiguracja` zrobi to sam, gdy exe leży na miejscu — albo §3).
   Zrestartuj WSZYSTKIE usługi: przełącznik zmienia też zachowanie workera
   Node (przestaje dotykać zadań `mm`).
4. Przebieg próbny: `wertis-sfera-worker.exe --dry-run` — pętla, heartbeat
   i audyt działają, dokumenty NIE powstają (`sgt_doc_number` dostaje
   `MM DRY-RUN/n`).
5. **Jedno** MM na kartotece próbnej: numer z `sgt_doc_number` == numer
   w Subiekcie, stany zgadzają się po obu stronach, `queue_applied` w
   `GET /api/events`.
6. `GET /api/health` pokazuje blok `sfera` z `zyje: true`; zatrzymanie usługi
   ma dodać zdanie do `problemy`.

Bramki odbioru (bufor, guard kolejności, odporność na restart) —
[`docs/wdrozenie.md`](docs/wdrozenie.md), sekcja „Dołączenie workera Sfery".

**Etap 3 — pełny obieg:** rozkładanie dostaw z prawdziwych FZ/PZ i przesunięcia
stanu przez workera Sfery.

## 7. Backup i utrzymanie

### Aktualizacja do nowej wersji

W oknie **jako administrator**, na maszynie z serwerem:

```powershell
cd C:\wertis\instalator
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Aktualizuj
```

Zatrzymuje usługi, pobiera kod, buduje, uruchamia z powrotem i porównuje numery
wersji. **Nie zadaje pytań** i nie dotyka bazy aplikacji, konta SQL, GRANT-ów,
`wertis.env`, konfiguracji Subiekta ani kont użytkowników.

> `-ExecutionPolicy Bypass` dotyczy tego jednego uruchomienia. Bez niego Windows
> odmawia: `running scripts is disabled on this system`.

> Aktualizowany jest katalog z `-Katalog` (domyślnie `C:\wertis`), a **nie** ten,
> w którym leży skrypt. Uruchomienie z klonu repo na pulpicie zaktualizuje
> `C:\wertis`.

Podgląd bez zmian: ten sam wiersz z `-DryRun`. Po nieudanym `git pull` usługi
wracają na poprzedniej wersji; po nieudanym budowaniu zostają zatrzymane, bo
stary `dist` z nową bazą mieszałby dwie wersje.

**APK przynosi ten sam instalator** — ląduje w `server\data\apk\`, a kolektory
proponują go same przy otwarciu aplikacji (§5). Pasek na dole ekranu pokazuje
obie wersje i podświetla rozjazd; dotknięcie go pyta serwer od razu.

- **Backup:** nocna kopia `C:\wertis\server\data\wertis.db` (Harmonogram zadań):

  ```bash
  cp /c/wertis/server/data/wertis.db "/d/backup/wertis-$(date +%Y%m%d).db"
  ```

  Plik trzyma postęp rozkładania dostaw, wyjątki, kolejkę i audyt `events`.
  Źródłem prawdy o towarach i stanach pozostaje baza Subiekta, więc to lekki
  backup.
- **Cofnięcie zapisu lokalizacji opiera się o kopię bazy.** Ślad audytowy
  zapisuje przy każdej zmianie **starą i nową** zawartość pola oraz ekran,
  z którego zmiana wyszła:

  ```bash
  curl -s -H "x-session: $TOKEN" \
    'http://localhost:3001/api/events?twId=507&typ=location_set,location_removed' | jq
  ```

  Wartość „przed" jest zapisana surowa — przywrócenie polega na wpisaniu jej
  z powrotem bez zmian. Audyt mówi jednak tylko, **co** wpisać; wpisać trzeba
  samemu, z kartoteki albo z kopii bazy. Przy większej liczbie kartotek kopia
  jest jedyną rozsądną drogą — dlatego musi działać, **zanim** ruszą prawdziwe
  zapisy ([`docs/wdrozenie.md`](docs/wdrozenie.md), etap 4).
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

  **Kolektory biorą nowy APK z serwera** — plik kładzie tam `-Aktualizuj`,
  a urządzenia proponują aktualizację przy otwarciu aplikacji (sekcja 5).
- **Diagnoza:** `http://mag.wertis.local:3001/api/health` → `{ ok: true, mode: ... }`;
  tabela `sfera_queue` w `wertis.db` pokazuje pełną historię zadań.
- **Komputer pokazuje stary splash kolektora zamiast podglądu biura.** To ślad
  po PWA usuniętej w 0.3.0: jej service worker serwuje splash z cache. Serwer
  sprzątał to automatycznie trasą `/sw.js` (0.19.0–0.25.x); trasa wyszła
  w 0.26.0. Gdyby objaw gdzieś wrócił, wyrejestruj workera ręcznie
  (Chrome → DevTools → Application → Service workers → Unregister). Aplikację
  **zainstalowaną** jako osobne okno odinstaluj w przeglądarce
  (Chrome → Ustawienia → Aplikacje).

## 8. Odinstalowanie

Jedno polecenie, uruchomione **jako administrator**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Odinstaluj
```

> **Dlaczego nie po prostu `.\wertis-instalator.ps1`.** Windows domyślnie
> odmawia uruchamiania plików `.ps1` i odpowiada `running scripts is disabled on
> this system`. `-ExecutionPolicy Bypass` dotyczy **tego jednego uruchomienia** —
> polityka systemowa zostaje nietknięta. Przy instalacji tę samą osłonę daje
> `URUCHOM.cmd` (prawym → „Uruchom jako administrator"), ale deinstalacja
> potrzebuje argumentów, więc idzie wprost.

Zdejmuje usługi `wertis-api` i `wertis-worker`, regułę zapory „WERTIS kolektor"
oraz katalog `C:\wertis`. Pyta o potwierdzenie, zanim cokolwiek ruszy.

Ślad audytowy i zdjęcia problemów **zostają**. Instalator przenosi je obok, do
`C:\wertis-dane-<data>`, i wypisuje tę ścieżkę. Historia zmian lokalizacji bywa
potrzebna długo po tym, jak aplikacja zniknie z maszyny.

Kasowanie także jej wymaga osobnego przełącznika i drugiego potwierdzenia:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Odinstaluj -UsunDane
```

Przebieg próbny wypisze plan, nie ruszając niczego:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Odinstaluj -DryRun
```

### Instalatora nie uruchamia się z wnętrza kasowanego katalogu

Windows nie pozwoli usunąć katalogu, w którym **stoi powłoka** — a wcześniejsze
etapy każą wpisywać `cd C:\wertis` i `cd C:\wertis\tools`. Komunikat brzmi wtedy
tylko „jakiś proces używa tego folderu" i nie mówi, że tym procesem jesteś ty.

Wynieś instalator poza katalog i uruchom go stamtąd:

```powershell
cd C:\
Copy-Item C:\wertis\instalator C:\wertis-instalator -Recurse
powershell -NoProfile -ExecutionPolicy Bypass `
    -File C:\wertis-instalator\wertis-instalator.ps1 -Odinstaluj -Katalog C:\wertis
```

Ścieżka do `-File` jest tu **pełna**, a powłoka zostaje w `C:\` — dzięki temu
nie trzeba wchodzić do żadnego z tych katalogów.

Deinstalacja ostrzeże, jeśli mimo to wykryje powłokę w środku — zanim zapyta
o zgodę, nie po.

### Gdy katalog zostaje mimo wszystko

Procesy uruchomione z kasowanego katalogu instalator zatrzymuje sam: osierocony
`node.exe` potrafi przeżyć `nssm remove` i trzymać uchwyty na plikach. Zasięg
jest wąski celowo — tylko procesy, których plik wykonywalny leży **wewnątrz**
`C:\wertis`. `node.exe` obsługujący cudzą aplikację zostaje nietknięty.

Gdy katalog nadal nie znika, instalator wypisze nazwy i numery PID tego, co go
trzyma. Ubij je i powtórz:

```powershell
Get-Process | Where-Object { $_.Path -like 'C:\wertis\*' } |
    Select-Object Id, ProcessName, Path
Stop-Process -Id <numer> -Force
```

Pusta lista przy zablokowanym katalogu znaczy, że uchwyt trzyma coś bez własnego
pliku w środku: otwarte okno Eksploratora, edytor albo druga powłoka. Znajdziesz
to w Monitorze zasobów — `resmon`, zakładka **CPU**, sekcja **Skojarzone
dojścia**, szukaj `wertis`.

### Czego deinstalacja NIE cofa

To jest ważniejsze niż sama lista usuwanych rzeczy.

| co zostaje | dlaczego | jak usunąć ręcznie |
|---|---|---|
| **wartości w bazie Subiekta** | aplikacja je tam zapisała — to dane firmy, nie jej własne | wyłącznie z kopii bazy |
| **login SQL `wertis`** | stoi na poziomie **instancji**, nie bazy podmiotu | `DROP USER` i `DROP LOGIN` (niżej) |
| **ustawienia SQL Servera** | inne aplikacje mogą z nich korzystać | ręcznie, świadomie |
| **Node.js i Git** | instalator dokłada je systemowo | `winget uninstall` |

Pierwszy wiersz jest sednem. **Odinstalowanie aplikacji nie jest cofnięciem jej
pracy.** Pole lokalizacji na kartotekach zostaje dokładnie tam, gdzie je
wpisała — tak samo, jakby wpisał je człowiek.

Ustawienia SQL Servera to trzy rzeczy, które kreator przestawił, żeby w ogóle
dało się połączyć: uwierzytelnianie mieszane, protokół TCP i usługa SQL Browser
uruchamiana automatycznie. Zostają włączone. Cofnięcie któregokolwiek odcięłoby
każdą inną aplikację, która się na nim opiera.

Login usuwa administrator bazy, w bazie podmiotu:

```sql
DROP USER [wertis];
DROP LOGIN [wertis];
```

Instalator nie robi tego sam celowo. Login jest obiektem instancji, więc
pomyłka dotknęłaby wszystkich baz na serwerze, nie tylko tej jednej.

### Droga ręczna

Gdy skryptu nie ma pod ręką albo katalog zniknął wcześniej:

```powershell
nssm stop wertis-api ; nssm stop wertis-worker
nssm remove wertis-api confirm ; nssm remove wertis-worker confirm
Remove-NetFirewallRule -DisplayName "WERTIS kolektor"
Remove-Item C:\wertis -Recurse -Force
```

Bez `nssm.exe` (leży w kasowanym katalogu) usługi zdejmuje `sc.exe delete
wertis-api`. Kolejność jest wymuszona: katalog kasuje się **na końcu**, bo
inaczej znika narzędzie, którym usuwa się usługi.

## Dlaczego nie chmura

Worker musi rozmawiać ze Sferą przez COM na maszynie z Subiektem, a odczyt idzie
z MSSQL w LAN. Chmura nie ma dostępu do żadnego z nich. Hostowanie samego
frontendu na zewnątrz dodaje zależność od internetu w hali bez żadnej korzyści,
bo kolektory i tak są w LAN. Jedna maszyna on-premise = najprostsza
i najodporniejsza topologia dla tej skali.
