# Wdrożenie WERTIS — on-premise (serwer w magazynie)

Instrukcja wdrożenia na firmowej maszynie Windows — tej, na której działa
**Subiekt GT ze Sferą**. API + worker działają na jednym hoście w sieci LAN
magazynu; kolektory (aplikacja Android) łączą się przez WiFi. Biuro **nie ma
własnego ekranu** — serwer wystawia wyłącznie API i eksporty CSV. Zero chmury,
zero frontendu.

```
Kolektory Zebra/Honeywell (APK, WiFi LAN) ─── http://mag.wertis.local:3001
        ▼
Maszyna z Subiektem GT (Windows)
  ├─ wertis-api     Fastify: REST (bez statyk — aplikacji webowej nie ma)
  ├─ wertis-worker  worker Sfery: kolejka → zapis do SGT
  ├─ wertis.db      SQLite: dostawy i zwroty z postępem per pozycja, koszyki
  │                 zwrotów, wyjątki, sesje trybu B, kolejka, audyt events
  ├─ data/photos/   zdjęcia dowodowe do reklamacji (poza gitem, w backupie)
  ├─ MSSQL Subiekta (odczyt: login read-only)
  └─ Sfera (COM)    (zapis: wyłącznie przez workera)
```

---

> **Jak to jest zbudowane i dlaczego tak** — [`docs/architektura.md`](docs/architektura.md).
> Ten dokument mówi tylko, jak to uruchomić.

## 1. Wymagania

- Windows z zainstalowanym Subiektem GT i licencją Sfery,
- [Node.js LTS 22](https://nodejs.org) (`node -v` ≥ 22),
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
npm run build      # server → server/dist (frontendu nie ma — samo API)
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

# API (serwuje też frontend)
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
> Do tego przykład `ENV_WERTIS` pomijał zmienne flag (kto wkleił go dosłownie,
> tracił flagi faktur), a niecytowana zmienna rozbijała się o spację w haśle.
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
klient natywny działa po zwykłym HTTP w LAN.

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

## 5a. Konta pracowników i badge'e (plan §7)

Bez kont kolektor nie ma czym podpisać operacji: ekran startowy prosi o skan
badge'a i nie przepuszcza dalej.

**1. Załóż konta z KOLEKTORA — bez terminala.** Po instalacji APK i ustawieniu
adresu serwera aplikacja sama sprawdza, czy instalacja jest pusta. Jeśli tak,
ekran startowy pokazuje **ZAŁÓŻ KONTA** zamiast prosić o skan plakietki
(których jeszcze nie ma).

> Przycisk **ZAŁÓŻ KONTA** pojawia się dopiero wtedy, gdy serwer odpowiedział.
> Jeśli widzisz sam napis „Zeskanuj swój badge", to znaczy, że kolektor NIE
> DOGADAŁ SIĘ Z SERWEREM — poprawny adres jest warunkiem wstępnym całego tego
> punktu. Brak odpowiedzi świadomie nie odblokowuje kreatora: martwe Wi-Fi
> wyglądałoby wtedy jak pusta instalacja i powstałby drugi komplet kont obok
> istniejącego.

W kreatorze wpisujesz wszystkich naraz:

- **pierwsza pozycja to konto biura z PIN-em** — pole roli jest zablokowane,
  bo to konto zakłada wszystkie następne i tylko ono widzi listę kodów.
  Konto magazyniera na tej pozycji zamurowałoby administrację;
- kolejne osoby: imię, nazwisko, rola. PIN wymagany tylko dla brygadzisty
  i biura — bez niego takie konto i tak nic nie zatwierdzi;
- po zatwierdzeniu kolektor pokazuje **kody badge'ów** — to jedyny moment,
  w którym widać je wszystkie naraz. Przepisz je albo sfotografuj.

Kolejność wysyłki układa kreator (biuro zawsze pierwsze) i sam loguje się
nowym kontem biura, żeby móc założyć resztę. Jeśli coś padnie w połowie —
zerwane Wi-Fi przy czwartej osobie z sześciu — ekran pokazuje **co już
powstało**; tych osób nie zakładaj drugi raz, dopisz tylko brakujące.

Nowe osoby dochodzą później tą samą drogą: **Ustawienia → DODAJ OSOBY**
(widoczne tylko dla konta biura, wymaga jego PIN-u).

**1b. Alternatywa: `curl`,** gdy kolektora jeszcze nie ma pod ręką albo konta
zakłada się skryptem.

```bash
# pierwsze konto — bez sesji, ale TYLKO przy pustej bazie
curl -X POST http://<IP-serwera>:3001/api/users \
  -H 'content-type: application/json' \
  -d '{"name":"Biuro Zakupy","role":"biuro","pin":"4821"}'
# → {"user":{"userId":1,"badgeCode":"PRC-0001-9","role":"biuro","maPin":true}}

# zaloguj się nim i dopisz resztę
TOKEN=$(curl -s -X POST http://<IP-serwera>:3001/api/auth/badge \
  -H 'content-type: application/json' \
  -d '{"badge":"PRC-0001-9"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -X POST http://<IP-serwera>:3001/api/users \
  -H "x-session: $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Jan Kowalski","pinAutora":"4821"}'

curl -X POST http://<IP-serwera>:3001/api/users \
  -H "x-session: $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Adam Nowak","role":"brygadzista","pin":"7315","pinAutora":"4821"}'

curl http://<IP-serwera>:3001/api/users -H "x-session: $TOKEN"   # lista do wydruku
```

`GET /api/setup` odpowiada `{"potrzebne":true}`, dopóki nie ma ani jednego
konta — tego samego pytania używa kolektor.

**Lista kont jest dostępna tylko dla biura** i to nie jest przesada: zwraca
`badgeCode` każdej osoby, a logowanie to sam skan badge'a. Wystawiona hali
byłaby listą tożsamości do przepisania na własną plakietkę.

**2. Wydrukuj plakietki.** Na plakietce ma być **kod kreskowy z `badgeCode`**
(Code 128 — ten sam symbol, co etykiety regałów) i pod nim ten sam kod tekstem,
na wypadek zdartej etykiety. **Nazwiska na plakietce nie drukuj**: badge się
gubi i zostaje na kurtce, a powiązanie kod → człowiek żyje wyłącznie w bazie.
Format `PRC-0000-0` jest stały, więc jedna szablonowa etykieta wystarczy.

**3. Migracja historii** (tylko przy aktualizacji istniejącej instalacji —
jednorazowo, idempotentnie). Zakłada konta dla nazw, które już są w `events`,
scala warianty tej samej osoby (`Jan`, `jan`, `Jan K`) w jedno konto i wypełnia
`events.user_ref`. Historii nie kasuje: `user_id` zostaje jako tekstowy
snapshot, a zdarzenia niedopasowane zostają z `user_ref = NULL`.

```bash
curl -X POST http://<IP-serwera>:3001/api/users/migrate-history \
  -H "x-session: $TOKEN" -H 'content-type: application/json' \
  -d '{"pinAutora":"4821"}'
# → {"zalozonychKont":4,"przypisanychZdarzen":1281,"nieprzypisanych":37,"nazwy":[...]}
```

Po migracji przejrzyj `nazwy` — wpisy w rodzaju „magazynier" albo „test"
wyłącz przez `POST /api/users/:id/active` z `{"active":false,"pinAutora":"4821"}`.
Konta się **nie kasuje**: historia w `events` musi mieć na co wskazywać.

**3a. Co wymaga PIN-u.** Sam badge wystarcza do codziennej pracy. PIN wchodzi
w dwóch miejscach, bo badge'e bywają pożyczane:

| operacja | kto | gdzie |
|---|---|---|
| odebranie koledze zajętej pozycji przed 30-min TTL | brygadzista lub biuro | kolektor: skan zajętego towaru → propozycja odebrania |
| zakładanie kont, PIN-y, wyłączanie kont | **tylko biuro** | kolektor: Ustawienia → DODAJ OSOBY, albo `curl` |

Odebranie pozycji zapisuje w `events` (`lock_forced`) **komu i przez kogo**.
Lock już wygasły zdejmuje się bez wpisu — po TTL nikomu nic nie odebrano.

Zarządzanie kontami jest zastrzeżone dla biura, bo to jedyna operacja tworząca
tożsamość: brygadzista mogący zakładać konta założyłby konto biura z własnym
PIN-em i reszta reguł przestałaby cokolwiek znaczyć.

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
1. Utwórz login SQL o minimalnych uprawnieniach — gotowy, idempotentny skrypt
   w [`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md) §2.
   `GRANT SELECT` na siedem tabel, `GRANT UPDATE` na jedną kolumnę
   (lokalizacja) i `GRANT INSERT, UPDATE` na `fl_Wartosc` (flagi). Aplikacja
   **nie potrzebuje żadnego prawa zapisu do `dok__Dokument`**.
2. Przejdź checklistę `[WERYFIKUJ]`. Jest krótka, bo nazwy tabel, kolumn oraz
   kody `dok_Typ` i `dok_Status` są odczytane wprost z oficjalnego opisu
   struktury InsERT dla wersji bazy 1.8731.31.6933 (tej, którą ma firma) —
   patrz [`docs/subiekt-gt-struktura.md`](docs/subiekt-gt-struktura.md).
   Domyślne w `config.ts` są z niego wzięte i nie trzeba ich ustalać:
   `DOK_TYP_FZ=1`, `DOK_TYP_PZ=10` (PZ, **nie** 5 = KFZ), `DOK_TYP_ZWROTY=14`
   (ZW), bufor = `dok_Status = 3` (odłożony).

   Do ustalenia na własnej bazie zostają **trzy** rzeczy:

   - **`mag_Id` magazynów MAG, MGP i Zwroty** (→ `MAG_ID_MAG` / `MAG_ID_MGP` /
     `MAG_ID_ZWROTY`). To magazyn skutku rozstrzyga, którym trybem idzie
     dokument, więc pomyłka wysyła dostawę do złej zakładki:

     ```sql
     SELECT mag_Id, mag_Symbol, mag_Nazwa, mag_Glowny FROM sl_Magazyn ORDER BY mag_Id;
     ```

     Główny poznasz po `mag_Glowny = 1`; MGP i Zwroty po nazwie firmowej.

   - **pole lokalizacji na `tw__Towar`.** W 1.87 SP3 HF1 (era KSeF) natywnej
     kolumny `tw_Lokalizacja` **nie ma** — trzeba wybrać jedno z ośmiu pól
     własnych `tw_Pole1..tw_Pole8`, każde `varchar(50)` (→ `MSSQL_LOC_COLUMN`,
     domyślnie `tw_Pole1`; `LOC_FIELD_LIMIT=50` wynika z rozmiaru kolumny).
     Wybierz pole, którego firma nie używa do niczego innego — worker nadpisuje
     je bezwarunkowo.

   - **flaga sprawdzenia faktury.** Kolumna „FW" na liście *Faktury zakupu*
     **nie odpowiada żadnej kolumnie `dok__Dokument`** — InsERT trzyma flagi
     w osobnej parze tabel: `fl__Flagi` (definicje) i `fl_Wartosc` (przypisania,
     klucz złożony grupa + typ obiektu + id dokumentu). Oflaguj ręcznie jedną
     fakturę i podstaw jej numer:

     ```sql
     SELECT w.flw_IdGrupyFlag, w.flw_TypObiektu, w.flw_IdFlagi, f.flg_Text, f.flg_Numer
     FROM fl_Wartosc w
     JOIN fl__Flagi  f ON f.flg_Id = w.flw_IdFlagi
     JOIN dok__Dokument d ON d.dok_Id = w.flw_IdObiektu
     WHERE d.dok_NrPelny = 'FZ 60/MAG/07/2026';
     ```

     → `MSSQL_FLAG_GRUPA` (`flw_IdGrupyFlag`) i `MSSQL_FLAG_TYP_OBIEKTU`
     (`flw_TypObiektu`). Potem wypisz wszystkie flagi i przypisz cztery używane
     przez WERTIS:

     ```sql
     SELECT flg_Id, flg_Text, flg_Numer, flg_IdGrupy FROM fl__Flagi ORDER BY flg_IdGrupy, flg_Numer;
     ```

     → `DOC_FLAG_IN_PROGRESS_SGT`, `DOC_FLAG_PAUSED_SGT`, `DOC_FLAG_DONE_SGT`,
     `DOC_FLAG_DONE_ERRORS_SGT` — wpisujesz `flg_Id` (liczbę), nie nazwę; nazwa
     idzie do `DOC_FLAG_*` i służy wyłącznie ludziom.

     Dopóki env jest puste, zadania `set_doc_flag` kończą się czytelnym błędem
     zamiast pisać w losową grupę flag. Reszta aplikacji działa normalnie —
     flaga jest jedyną rzeczą, która czeka.

     Dokumenty zwrotów flagują się tym samym mechanizmem (to ten sam typ
     obiektu), więc nie wymagają osobnej konfiguracji.

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
wykonuje `set_location` i `set_doc_flag` bezpośrednim UPDATE dwóch kolumn
objętych `GRANT UPDATE`. Zadania MM — z rundy wózka (kontener) i z zamkniętego
koszyka zwrotu — zgłaszają czytelny błąd; do czasu workera Sfery MM wystawia
biuro w Subiekcie. Osobnego przełącznika trybu zapisu nie ma.

Konsekwencja dla zwrotów na tym etapie: adres na półce zapisuje aplikacja, ale
towar zjeżdża z magazynu Zwroty dopiero po ręcznym MM w biurze. Kolejność jest
bezpieczna (adres przed sprzedawalnością), więc opóźnienie kosztuje utraconą
szansę sprzedaży, a nie błędny stan.

**Etap 2 — dokumenty MM przez Sferę (kontener + zwroty):**
1. Osobny proces na Windows (C# lub Python+pywin32 — COM Sfery najstabilniej
   działa z tych środowisk, spec §9), czytający tę samą tabelę `sfera_queue`
   i wykonujący wyłącznie zadania `mm`; kontrakt wywołań w
   `server/src/adapters/sfera.ts`.
2. Najpierw jedno MM testowe na kartotece próbnej, potem produkcyjnie.

**Etap 3 — pełny obieg:** rozkładanie dostaw z prawdziwych FZ/PZ; MM per wózek
(kontener) i MM per koszyk (zwroty) przez workera Sfery.

## 7. Backup i utrzymanie

- **Backup:** nocna kopia `C:\wertis\server\data\wertis.db` (Harmonogram zadań):

  ```bash
  cp /c/wertis/server/data/wertis.db "/d/backup/wertis-$(date +%Y%m%d).db"
  ```

  Plik trzyma postęp rozkładania dostaw i zwrotów (łącznie z tym, który koszyk
  pojechał już MM-em), wyjątki, sesje trybu B, kolejkę i audyt `events`; źródłem
  prawdy o towarach i stanach pozostaje baza Subiekta, więc to lekki backup.
- **Zdjęcia dowodowe:** `C:\wertis\server\data\photos\` — to jedyne dane, których
  nie da się odtworzyć z Subiekta ani z seedu (dowód do reklamacji u dostawcy),
  więc kopiuj ten katalog razem z bazą:

  ```bash
  cp -r /c/wertis/server/data/photos "/d/backup/photos-$(date +%Y%m%d)"
  ```

  Kolektor skaluje kadr do 1280 px / JPEG 70 (~200 KB), więc katalog rośnie
  wolno; po zamknięciu reklamacji stare zdjęcia można archiwizować ręcznie.
- **Logi:** `C:\wertis\logs\` (rotacja przez NSSM). Błędy zapisu Sfery widać
  też na kolektorze (czerwona pastylka + PONÓW).
- **Nocna rekoncyliacja — ustaw ją, zanim ruszy praca na prawdziwych danych.**
  Aplikacja pisze do Subiekta przez kolejkę, ale bez tego kroku **nikt nie
  sprawdza, czy stan po stronie Subiekta odpowiada temu, co aplikacja myśli, że
  zapisała**. To najtańsza obrona przed cichym błędem: kod działa, wygląda
  dobrze i przez trzy tygodnie rozjeżdża dane.

  ```bash
  # Harmonogram zadań Windows / cron, raz na dobę:
  cd /c/wertis && npm run reconcile
  ```

  Sprawdza cztery rzeczy: adres w Subiekcie kontra ostatni udany zapis (24 h),
  zadania w `error` starsze niż doba, `waiting_for_doc` starsze niż trzy dni
  (dokument raczej nie wyjdzie już z bufora) oraz koszyki zwrotów rozłożone bez
  MM. Ostatnia pozycja mierzy niezmiennik „adres przed sprzedawalnością" —
  niezmienniki trzeba mierzyć, nie deklarować.

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
  listami. Liczy **pion, nie odległość**: przy 342 m² przejście róg–róg to ~20 s,
  a pobranie z podłogi albo z drabiny 10–25 s wobec ~3 s ze strefy złotej.

  **Kolejność ma znaczenie i jest w nagłówku pliku:** najpierw eksmisja martwych
  indeksów ze strefy złotej (daje ~80% korzyści i jest bezpieczna — przenosisz
  towar, którego nikt nie ruszał), dopiero potem awanse, bo te wymagają
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

  **Klient natywny (APK)** aktualizuje się osobno — nowy
  build z CI/`./gradlew :app:assembleRelease` i rozesłanie przez MDM (sekcja 5).
- **Diagnoza:** `http://mag.wertis.local:3001/api/health` → `{ ok: true, mode: ... }`;
  tabela `sfera_queue` w `wertis.db` pokazuje pełną historię zadań.

## Dlaczego nie chmura

Worker musi rozmawiać ze Sferą przez COM na maszynie z Subiektem, a odczyt
idzie z MSSQL w LAN — chmura nie ma dostępu do żadnego z nich. Hostowanie
samego frontendu na zewnątrz dodaje zależność od internetu w hali bez żadnej
korzyści (kolektory i tak są w LAN). Jedna maszyna on-premise = najprostsza
i najodporniejsza topologia dla tej skali.
