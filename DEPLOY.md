# Wdrożenie WERTIS — on-premise (serwer w magazynie)

Instrukcja wdrożenia na firmowej maszynie Windows — tej, na której działa
**Subiekt GT ze Sferą**. Cała aplikacja (API + worker + frontend) działa na
jednym hoście w sieci LAN magazynu; kolektory łączą się przez WiFi. Zero chmury.

```
Kolektory Honeywell (WiFi LAN)
        │  http(s)://mag.wertis.local:3001
        ▼
Maszyna z Subiektem GT (Windows)
  ├─ wertis-api     Fastify: REST + serwuje frontend (web/dist)
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
npm run build      # web -> web\dist, server -> server\dist
npm run seed       # pierwszy start: zasila SQLite danymi (tryb seeded)
```

Szybki test ręczny (przed rejestracją usług):

```powershell
node server\dist\index.js          # w drugim oknie: node server\dist\worker\worker.js
# przeglądarka: http://localhost:3001  → aplikacja powinna działać
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

Kolektory otwierają: `http://mag.wertis.local:3001`.

## 5. HTTPS (opcjonalnie, zalecane docelowo)

Po HTTP wszystko działa, ale bez HTTPS przeglądarka nie zainstaluje PWA
„jak aplikacji" i nie włączy cache offline (service worker wymaga secure
context). Rozwiązanie lekkie: [Caddy](https://caddyserver.com) jako
reverse-proxy z lokalnym CA.

`C:\caddy\Caddyfile`:

```
mag.wertis.local {
    tls internal
    reverse_proxy localhost:3001
}
```

```powershell
nssm install wertis-caddy C:\caddy\caddy.exe "run --config C:\caddy\Caddyfile"
nssm set wertis-caddy Start SERVICE_AUTO_START
nssm start wertis-caddy
```

Certyfikat root Caddy (`%AppData%\Caddy\pki\authorities\local\root.crt`)
zainstaluj raz na każdym kolektorze (Ustawienia → Zabezpieczenia → Zainstaluj
certyfikat CA). Od tej pory kolektory używają `https://mag.wertis.local`.

## 6. Kolektory (Honeywell / Zebra)

Dwie ścieżki instalacji na kolektorze — serwer (sekcje 1–5) jest **wspólny**:
- **6a. PWA w przeglądarce kiosku** — bez instalacji APK, wymaga HTTPS (sekcja 5)
  do trybu „jak aplikacji" i offline; obejmuje komendy głosowe.
- **6b. Natywna aplikacja Android (APK)** — skan przez SDK producenta, trwały
  offline i kiosk bez przeglądarki i lokalnego CA; **bez** funkcji głosowych.

### 6a. PWA w przeglądarce kiosku

- Zainstaluj **Fully Kiosk Browser** (lub tryb kiosku Honeywell Enterprise
  Browser): Start URL = adres aplikacji, pełny ekran, bez paska adresu,
  autostart po włączeniu urządzenia.
- Skaner pracuje jako klawiatura (keyboard wedge) z sufiksem Enter — aplikacja
  tego oczekuje; nic nie trzeba konfigurować w samej appce.
- WiFi: kolektory i serwer w tym samym VLAN/podsieci.

#### Komendy głosowe — wagi modelu ASR (offline, tylko PWA)

Rozpoznawanie mowy działa w całości na kolektorze (Whisper ONNX). Backendem jest
ONNX Runtime **WASM** (pewny na każdym kolektorze), a ten obsługuje bez problemu
tylko wagi **fp32** — kwantyzowany enkoder oraz kwantyzowany (4-bit/MatMulNBits)
dekoder modeli `onnx-community/*` nie tworzą sesji. Dlatego domyślnie pobieramy
enkoder i dekoder w fp32 (whisper-tiny ≈ 150 MB — jednorazowo, potem z cache).
Magazyn nie ma internetu, więc wagi trzeba wgrać na serwer WERTIS:

```bash
# na dowolnej maszynie Z INTERNETEM (w repo):
node tools/fetch-asr-model.mjs                       # domyślnie whisper-tiny, fp32
node tools/fetch-asr-model.mjs onnx-community/whisper-base   # lepsza polszczyzna, większy
```

Powstaje katalog `web/public/models/<id-modelu>/…` — skopiuj go na serwer
przed `npm run build` (trafi do `web/dist/models/`) albo bezpośrednio do
`web/dist/models/` na działającej instalacji. Aplikacja ładuje wagi najpierw
z własnego serwera (`models/…`), a huggingface.co jest tylko fallbackiem.
Po pierwszym załadowaniu przeglądarka trzyma wagi w cache (offline).
Przy zmianie modelu ustaw `VITE_ASR_MODEL=<id>` podczas builda frontu.
W Ustawieniach kolektora wiersz „Komendy głosowe" pokazuje postęp pobierania,
a przy błędzie — przyczynę i przycisk PONÓW PRÓBĘ.

**Wariant lżejszy (mniejszy download, ~60 MB):** dekoder w int8 (q8) — działa
na WASM tylko z **modelami Xenova** (standardowy int8, bez MatMulNBits):

```bash
node tools/fetch-asr-model.mjs Xenova/whisper-tiny q8
# oraz build frontu z:  VITE_ASR_MODEL=Xenova/whisper-tiny  VITE_ASR_DECODER_DTYPE=q8
```

### 6b. Natywna aplikacja Android (APK)

Alternatywa dla PWA — natywny klient z [`android/`](android/README.md).
**Serwer bez zmian** (sekcje 1–4); aplikacja to czysty klient REST. Zalety na
kolektorze: skan przez SDK producenta zamiast heurystyki wedge, trwały offline
bez service workera, kiosk przez Android lock-task/MDM — **HTTPS/Caddy (sekcja 5)
nie jest wymagane** (brak service workera, więc cleartext HTTP w LAN wystarcza).
**Bez** komend głosowych i skanu kamerą.

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

## 7. Przejście na prawdziwe dane Subiekta (etapy wg spec §10)

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

## 8. Backup i utrzymanie

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

  Aktualizacja PWA idzie z buildem serwera (kolektory dostają nowy frontend po
  odświeżeniu). **Klient natywny (APK)** aktualizuje się osobno — nowy build
  z CI/`./gradlew :app:assembleRelease` i rozesłanie przez MDM (sekcja 6b).
- **Diagnoza:** `http://mag.wertis.local:3001/api/health` → `{ ok: true, mode: ... }`;
  tabela `sfera_queue` w `wertis.db` pokazuje pełną historię zadań.

## Dlaczego nie chmura

Worker musi rozmawiać ze Sferą przez COM na maszynie z Subiektem, a odczyt
idzie z MSSQL w LAN — chmura nie ma dostępu do żadnego z nich. Hostowanie
samego frontendu na zewnątrz dodaje zależność od internetu w hali bez żadnej
korzyści (kolektory i tak są w LAN). Jedna maszyna on-premise = najprostsza
i najodporniejsza topologia dla tej skali.
