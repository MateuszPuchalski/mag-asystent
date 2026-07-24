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
  ├─ wertis.db      SQLite: kolejka, sesje rozkładania, audyt events
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
działa od razu po instalacji; dane z eksportu `mag.xlsx`. Magazynier testuje
wyszukiwanie, kartę towaru, rozkładanie. Zero ryzyka.

**Etap 1 — odczyt z MSSQL (`SGT_MODE=mssql`):**
1. Utwórz login SQL **read-only** (GRANT SELECT wyłącznie na: `tw__Towar`,
   `tw_Stan`, `dok__Dokument`, `dok_Pozycja`, `kh__Kontrahent`).
2. Przejdź checklistę `[WERYFIKUJ]` ze spec §11 — na własnej bazie sprawdź:
   - wartości `dok_Typ` dla FZ i PZ (po znanym numerze dokumentu) i który typ
     niesie skutek magazynowy (→ env `DOK_TYP_FZ` / `DOK_TYP_PZ`),
   - kolumnę/flagę bufora w `dok__Dokument` (→ env `MSSQL_BUFFER_EXPR`),
   - `mag_Id` magazynów MAG i MGP (→ env `MAG_ID_MAG` / `MAG_ID_MGP`),
   - `SELECT COL_LENGTH('tw__Towar','tw_Lokalizacja')` (ustaw `LOC_FIELD_LIMIT`),
   - czy używacie dodatkowych kodów kreskowych poza `tw_PodstKodKresk`.
3. Ustaw env połączenia `MSSQL_*` (patrz `docs/subiekt-gt-edu-setup.md` §4);
   importer `server/src/adapters/subiekt.mssql.ts` zasila read-model `sgt_*`
   przy starcie API, co `MSSQL_SYNC_MS` i przez `POST /api/admin/resync`.
4. `nssm set wertis-api AppEnvironmentExtra SGT_MODE=mssql MSSQL_SERVER=… …`
   + restart.

**Etap 1a — zapis lokalizacji bez Sfery (`SFERA_MODE=sql`, plan B ze spec §9):**
login z `GRANT UPDATE` wyłącznie na kolumnę `tw__Towar(tw_Lokalizacja)`
(env `MSSQL_WRITE_USER` / `MSSQL_WRITE_PASSWORD`); worker wykonuje
`set_location` bezpośrednio po SQL, a zadania MM zgłaszają czytelny błąd.
Domyślne przy `SGT_MODE=mssql`.

**Etap 2 — zapis przez Sferę:**
1. Test 10-linijkowym skryptem, czy Sfera eksponuje pole lokalizacji na
   obiekcie towaru (wczytaj → zmień → zapisz → sprawdź w SGT). Jeśli nie —
   plan B ze spec §9: UPDATE jednej kolumny `tw_Lokalizacja` osobnym loginem
   z GRANT UPDATE tylko na nią.
2. Implementacja `server/src/adapters/sfera.com.ts`. Rekomendacja: pętla
   workera zostaje w Node, a sam zapis COM jako mały helper C# lub
   Python+pywin32 wołany przez adapter (COM Sfery najstabilniej działa
   z tych środowisk — spec §9).
3. Najpierw włącz tylko `set_location` na jednej kartotece testowej, potem MM.

**Etap 3 — pełny obieg:** rozkładanie dostaw z prawdziwych FZ/PZ, MM per wózek.

## 7. Backup i utrzymanie

- **Backup:** nocna kopia `C:\wertis\server\data\wertis.db` (Harmonogram zadań):

  ```powershell
  Copy-Item C:\wertis\server\data\wertis.db "D:\backup\wertis-$(Get-Date -Format yyyyMMdd).db"
  ```

  Plik trzyma kolejkę, sesje i audyt `events`; źródłem prawdy o towarach
  i stanach pozostaje baza Subiekta, więc to lekki backup.
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
