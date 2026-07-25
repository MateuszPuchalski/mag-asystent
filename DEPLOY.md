# Wdrożenie WERTIS — on-premise (serwer w magazynie)

Instrukcja wdrożenia na firmowej maszynie Windows — tej, na której działa
**Subiekt GT ze Sferą**. API + worker działają na jednym hoście w sieci LAN
magazynu; kolektory (aplikacja Android) łączą się przez WiFi, biuro używa
strony `/lookup` w przeglądarce. Zero chmury, zero builda frontendu.

```
Kolektory Zebra/Honeywell (APK, WiFi LAN) ─┐
Biuro (przeglądarka → /lookup)            ─┴─ http://mag.wertis.local:3001
        ▼
Maszyna z Subiektem GT (Windows)
  ├─ wertis-api     Fastify: REST + statyki web/public (lookup)
  ├─ wertis-worker  worker Sfery: kolejka → zapis do SGT
  ├─ wertis.db      SQLite: dostawy i zwroty z postępem per pozycja, koszyki
  │                 zwrotów, wyjątki, sesje trybu B, kolejka, audyt events
  ├─ data/photos/   zdjęcia dowodowe do reklamacji (poza gitem, w backupie)
  ├─ MSSQL Subiekta (odczyt: login read-only)
  └─ Sfera (COM)    (zapis: wyłącznie przez workera)
```

---

## 1. Wymagania

- Windows z zainstalowanym Subiektem GT i licencją Sfery,
- [Node.js LTS 22](https://nodejs.org) (`node -v` ≥ 22),
- [Git](https://git-scm.com) (albo kopia repo z pendrive'a),
- [NSSM](https://nssm.cc) do rejestracji usług (pojedynczy `nssm.exe`),
- stały adres maszyny w LAN (rezerwacja DHCP).

## 2. Instalacja aplikacji

```powershell
cd C:\
git clone https://github.com/MateuszPuchalski/mag-asystent.git wertis
cd C:\wertis
npm ci
npm run build      # server -> server\dist (frontend bez builda: web\public serwowane wprost)
npm run seed       # pierwszy start: zasila SQLite danymi (tryb seeded)
```

Szybki test ręczny (przed rejestracją usług):

```powershell
node server\dist\index.js          # w drugim oknie: node server\dist\worker\worker.js
# przeglądarka: http://localhost:3001/lookup  → podgląd magazynu powinien działać
```

## 3. Rejestracja usług Windows (NSSM)

```powershell
# API (serwuje też frontend)
nssm install wertis-api "C:\Program Files\nodejs\node.exe" "C:\wertis\server\dist\index.js"
nssm set wertis-api AppDirectory C:\wertis
nssm set wertis-api AppStdout C:\wertis\logs\api.log
nssm set wertis-api AppStderr C:\wertis\logs\api.err.log
nssm set wertis-api AppRotateFiles 1
nssm set wertis-api AppRotateBytes 10485760
nssm set wertis-api Start SERVICE_AUTO_START
nssm set wertis-api AppExit Default Restart

# Worker Sfery
nssm install wertis-worker "C:\Program Files\nodejs\node.exe" "C:\wertis\server\dist\worker\worker.js"
nssm set wertis-worker AppDirectory C:\wertis
nssm set wertis-worker AppStdout C:\wertis\logs\worker.log
nssm set wertis-worker AppStderr C:\wertis\logs\worker.err.log
nssm set wertis-worker AppRotateFiles 1
nssm set wertis-worker Start SERVICE_AUTO_START
nssm set wertis-worker AppExit Default Restart

mkdir C:\wertis\logs
nssm start wertis-api
nssm start wertis-worker
```

Zmienne środowiskowe usług (gdy trzeba, np. przejście na MSSQL):

```powershell
nssm set wertis-api AppEnvironmentExtra SGT_MODE=mssql PORT=3001
nssm set wertis-worker AppEnvironmentExtra SGT_MODE=mssql
```

> **Uwaga:** worker Sfery musi działać na TEJ maszynie (COM Sfery jest lokalny)
> i oba procesy muszą widzieć ten sam plik `C:\wertis\server\data\wertis.db`.
> Nie przenoś API na inny host bez migracji kolejki na Postgres.

## 4. Sieć: stały adres + zapora + DNS

1. **Rezerwacja DHCP** dla maszyny (po MAC) w routerze.
2. **Wpis DNS** `mag.wertis.local → <IP maszyny>` w routerze / serwerze AD DNS.
   Bez własnego DNS: wpis w plikach hosts kolektorów albo używanie samego IP.
3. **Zapora Windows** — wpuść port 3001 tylko z sieci LAN:

```powershell
netsh advfirewall firewall add rule name="WERTIS kolektor" dir=in action=allow protocol=TCP localport=3001 remoteip=localsubnet
```

Kolektory i biuro otwierają: `http://mag.wertis.local:3001` (biuro:
`/lookup`). HTTPS nie jest wymagane — klient natywny i statyczna strona
`/lookup` działają po zwykłym HTTP w LAN (nie ma service workera).

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
- Przy pierwszym starcie: **Ustawienia → Serwer WERTIS** → adres API w LAN
  (`http://mag.wertis.local:3001` lub `http://<IP-serwera>:3001`).

Checklist smoke-test i szczegóły integracji skanerów: [`android/README.md`](android/README.md).

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

3. Ustaw env połączenia `MSSQL_*` (patrz `docs/subiekt-gt-edu-setup.md` §4);
   importer `server/src/adapters/subiekt.mssql.ts` zasila read-model `sgt_*`
   przy starcie API, co `MSSQL_SYNC_MS` i przez `POST /api/admin/resync`.
4. `nssm set wertis-api AppEnvironmentExtra SGT_MODE=mssql MSSQL_SERVER=… …`
   + restart.

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

  ```powershell
  Copy-Item C:\wertis\server\data\wertis.db "D:\backup\wertis-$(Get-Date -Format yyyyMMdd).db"
  ```

  Plik trzyma postęp rozkładania dostaw i zwrotów (łącznie z tym, który koszyk
  pojechał już MM-em), wyjątki, sesje trybu B, kolejkę i audyt `events`; źródłem
  prawdy o towarach i stanach pozostaje baza Subiekta, więc to lekki backup.
- **Zdjęcia dowodowe:** `C:\wertis\server\data\photos\` — to jedyne dane, których
  nie da się odtworzyć z Subiekta ani z seedu (dowód do reklamacji u dostawcy),
  więc kopiuj ten katalog razem z bazą:

  ```powershell
  Copy-Item C:\wertis\server\data\photos "D:\backup\photos-$(Get-Date -Format yyyyMMdd)" -Recurse
  ```

  Kolektor skaluje kadr do 1280 px / JPEG 70 (~200 KB), więc katalog rośnie
  wolno; po zamknięciu reklamacji stare zdjęcia można archiwizować ręcznie.
- **Logi:** `C:\wertis\logs\` (rotacja przez NSSM). Błędy zapisu Sfery widać
  też na kolektorze (czerwona pastylka + PONÓW).
- **Aktualizacja aplikacji:**

  ```powershell
  cd C:\wertis
  git pull
  npm ci
  npm run build
  nssm restart wertis-api
  nssm restart wertis-worker
  ```

  Strona `/lookup` aktualizuje się razem z repo (statyk, bez builda — wystarczy
  `git pull` + restart). **Klient natywny (APK)** aktualizuje się osobno — nowy
  build z CI/`./gradlew :app:assembleRelease` i rozesłanie przez MDM (sekcja 5).
- **Diagnoza:** `http://mag.wertis.local:3001/api/health` → `{ ok: true, mode: ... }`;
  tabela `sfera_queue` w `wertis.db` pokazuje pełną historię zadań.

## Dlaczego nie chmura

Worker musi rozmawiać ze Sferą przez COM na maszynie z Subiektem, a odczyt
idzie z MSSQL w LAN — chmura nie ma dostępu do żadnego z nich. Hostowanie
samego frontendu na zewnątrz dodaje zależność od internetu w hali bez żadnej
korzyści (kolektory i tak są w LAN). Jedna maszyna on-premise = najprostsza
i najodporniejsza topologia dla tej skali.
