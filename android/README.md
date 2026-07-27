# WERTIS Kolektor — natywna aplikacja Android

**Jedyny klient kolektora** WERTIS — natywna aplikacja (Kotlin + Jetpack
Compose), czysty klient REST istniejącego serwera (`server/`, Fastify).
Skanowanie wyłącznie sprzętowe (Zebra DataWedge / Honeywell DataCollection,
fallback klawiaturowy); bez funkcji głosowych i skanu kamerą. (Historycznie
aplikacja powstała jako port PWA — dawny kod webowy usunięto z repo, więc
odniesienia „jak w PWA" niżej opisują tylko pochodzenie rozwiązania.)

## Moduły

| Moduł | Co zawiera | Build |
|---|---|---|
| `:core` | czysta logika JVM: klasyfikacja skanów, walidacja lokalizacji, DTO REST, model nawigacji, model wyjątków (które typy wymagają zdjęcia), badge i sesja urządzenia, tryb wiersza listy rozkładania — **92 testy** | działa bez Android SDK (`./gradlew :core:test`) |
| `:app` | aplikacja Compose (13 ekranów, skanery, czujniki) | wymaga Android SDK (`ANDROID_HOME` albo `local.properties`) |

Bez SDK `settings.gradle.kts` konfiguruje tylko `:core` — dlatego testy logiki
przechodzą także w środowiskach bez Androida (CI sandbox). Pełny build APK robi
workflow `.github/workflows/android.yml` (ubuntu-latest ma SDK preinstalowany)
albo dowolna maszyna z Android Studio.

## Budowanie

```bash
cd android
./gradlew :core:test          # testy logiki (bez SDK)
./gradlew :app:assembleDebug  # APK (wymaga SDK) → app/build/outputs/apk/debug/
```

## Uruchomienie przeciwko serwerowi dev

1. W katalogu głównym repo: `npm install && npm run seed && npm run dev` (API na `:3001`).
2. Adres serwera:
   - emulator: `http://10.0.2.2:3001` (domyślne, nic nie trzeba robić),
   - fizyczny kolektor: `http://<IP-serwera-w-LAN>:3001` — wpisz go na
     **ekranie startowym** (`ZMIEŃ ADRES SERWERA`). Ustawienia siedzą pod
     paskiem górnym, a paska nie ma przed zalogowaniem, więc na świeżej
     instalacji ekran startowy jest jedynym wejściem. Po zalogowaniu ten sam
     adres jest w **Ustawienia → Serwer WERTIS**.
3. Manifest zezwala na cleartext HTTP (sieć magazynowa on-premise). HTTPS przez
   Caddy działa bez zmian — podaj `https://mag.wertis.local` jako adres.

### Symulacja skanera bez sprzętu

Skaner klawiaturowy (wedge) emuluje się przez adb:

```bash
adb shell input text 'E08-03-01' && adb shell input keyevent 66   # etykieta lokalizacji
adb shell input text '5905947595303' && adb shell input keyevent 66  # EAN
```

Uwaga: `input text` na wolnym emulatorze potrafi wpisywać znaki wolniej niż
300 ms — wtedy bufor wedge się zresetuje. Pewniejsza jest fizyczna klawiatura
podpięta do emulatora albo prawdziwy kolektor.

## Skanery sprzętowe

Aplikacja wybiera źródło po `Build.MANUFACTURER`; wedge klawiaturowy działa
zawsze jako fallback (skaner skonfigurowany jako klawiatura z sufiksem Enter).

### Zebra (DataWedge)

Zero zależności — czyste intenty. Przy starcie aplikacja sama tworzy profil
**WERTIS** przez `SET_CONFIG` (BARCODE→INTENT broadcast
`pl.wertis.kolektor.SCAN`, wyjście klawiaturowe wyłączone). Jeśli MDM blokuje
zdalną konfigurację DataWedge, utwórz profil ręcznie:

1. DataWedge → nowy profil `WERTIS`, powiąż z aplikacją `pl.wertis.kolektor` (wszystkie aktywności).
2. Barcode input: włączony. Keystroke output: **wyłączony**.
3. Intent output: włączony, action `pl.wertis.kolektor.SCAN`, delivery **Broadcast intent**.

### Honeywell (DataCollection SDK)

SDK jest własnościowe — pobierz **DataCollection.aar** z portalu Honeywell
(Mobility SDK for Android) i wrzuć jako:

```
android/app/libs/honeywell-datacollection.aar
```

Build automatycznie go podepnie (patrz `app/build.gradle.kts`); bez AAR-a
aplikacja też się buduje i działa (integracja przez refleksję —
`HoneywellSource`), a skany lecą przez wedge. Plik `.aar` jest w `.gitignore`
(licencja nie zezwala na redystrybucję).

### Checklist smoke-test na sprzęcie

Jedna pozycja = jedna rzecz do sprawdzenia. Nawias na końcu nazywa regresję,
przed którą ta pozycja broni.

**Skan**

- [ ] skan EAN na ekranie głównym otwiera kartę towaru (beep OK),
- [ ] skan etykiety regału **na ekranie głównym** otwiera zawartość tego regału,
- [ ] skan etykiety regału na karcie towaru zmienia adres (chip-duch → potwierdzony),
- [ ] skan **symbolu towaru** tam, gdzie oczekiwana jest lokalizacja, mówi
      „To kod towaru, nie etykieta regału",
- [ ] ten sam skan **nie zapisuje** widmowego adresu,
- [ ] Zebra: profil WERTIS widoczny w DataWedge,
- [ ] Zebra: kod NIE jest „wpisywany" do pól tekstowych,
- [ ] Honeywell: skaner działa po `onPause`/`onResume` (claim/release),
- [ ] tryb samolotowy → zapis lokalizacji → baner „operacja czeka na sieć",
- [ ] po powrocie sieci bufor się opróżnia (flush).

**Kontekst = otwarty ekran**

- [ ] karta towaru otwarta → skan regału zmienia adres TEGO towaru,
- [ ] ten sam skan bez otwartej karty pokazuje zawartość regału,
- [ ] karta towaru A → wstecz → karta towaru B → skan regału: adres dostaje
      **B**, nigdy A (regresja: kontekst przyklejony),
- [ ] podgląd regału otwarty → skan INNEGO regału przełącza widok
      (regresja: `locCode` nieobserwowalny, ekran zostawał na pierwszym).

**Zapis adresu**

- [ ] towar z JEDNYM adresem → „+ DODAJ" → skan półki → towar ma **dwa** adresy,
- [ ] skan wprost z karty, bez „+ DODAJ", nadal **zastępuje** adres,
- [ ] po skanie półki NIE ma zielonego kafla na środku ekranu,
- [ ] chip nowego adresu jest przygaszony i bez cienia,
- [ ] po przejściu kolejki Sfery ten sam chip robi się normalny.

**Rozkładanie**

- [ ] skan towaru z dostawy rozwija wiersz W MIEJSCU, z ilością i lokalizacją
      dużym drukiem,
- [ ] reszta listy zostaje widoczna pod spodem,
- [ ] skan półki zwija wiersz jako odłożony,
- [ ] rozwinięty wiersz idzie pod górną krawędź (ma się dać odczytać w drodze
      do regału),
- [ ] powtórny tap w rozwinięty wiersz zwalnia pozycję dla drugiej osoby,
      bez czekania na 30-minutowy TTL,
- [ ] skan innej półki niż w kartotece pokazuje ZAMIEŃ / DODAJ **pod wierszem**,
      nie na pełnym ekranie,
- [ ] PROBLEM wysuwa się jako arkusz od dołu, z listą dostawy widoczną pod
      spodem,
- [ ] aparat w arkuszu PROBLEM działa,
- [ ] po zgłoszeniu problemu wiersz zostaje oznaczony i NIE zwija się.

**Układ ekranu**

- [ ] dostawa 10 pozycji mieści się na jednym ekranie bez przewijania,
- [ ] odłożone wiersze są cienkie i przekreślone, ale zostają na swoim miejscu,
- [ ] lista nie przeskakuje po żadnym odłożeniu,
- [ ] nie ma nagłówków alejek; lokalizacja jest pastylką przy każdym wierszu,
- [ ] „BEZ LOKALIZACJI (n)" zostaje osobną sekcją na końcu,
- [ ] WSTECZ jest w prawym DOLNYM rogu, nie w lewym górnym,
- [ ] da się wrócić jedną ręką, nie przekładając kolektora,
- [ ] wejdź w podekran i wróć: SKAN i ROZKŁADANIE zostają na swoich miejscach
      (slot WSTECZ jest zarezerwowany zawsze).

**Tożsamość**

- [ ] skan plakietki na ekranie startowym loguje,
- [ ] skan własnej plakietki przy czynnej sesji nie robi nic,
- [ ] skan cudzej plakietki pyta o przejęcie pracy,
- [ ] 10 min bezczynności pokazuje ekran „Sesja zablokowana",
- [ ] pod tym ekranem dalej widać otwartą dostawę,
- [ ] skan własnego badge'a wraca do pracy bez straty postępu,
- [ ] skan towaru zajętego przez kogoś innego proponuje odebranie,
- [ ] magazynier dostaje odmowę, a brygadzista z PIN-em przechodzi.

**Pierwsze uruchomienie**

- [ ] pusty serwer: ekran startowy proponuje ZAŁÓŻ KONTA, nie skan plakietki,
- [ ] kreator zakłada całą listę i pokazuje kody badge'ów,
- [ ] po wyjściu z kreatora ta sama instalacja prosi już o skan,
- [ ] świeża instalacja z adresem fabrycznym `10.0.2.2` pokazuje „Nie widzę
      serwera pod adresem…" i ROZWINIĘTE pole adresu,
- [ ] nie pokazuje samego napisu „Zeskanuj swój badge" (bez konta nie dało się
      z niego wyjść),
- [ ] wpisz właściwy adres LAN i naciśnij ZAPISZ I SPRAWDŹ,
- [ ] ekran przechodzi do ZAŁÓŻ KONTA albo do prośby o skan, bez restartu
      aplikacji,
- [ ] wyłącz Wi-Fi w połowie zakładania kont: ekran pokazuje konta, które JUŻ
      powstały, a nie sam komunikat o błędzie.

## Architektura (skrót)

- **Nawigacja**: statyczna mapa powrotów, nie stos
  (`core/nav/NavModel.kt` + `nav/AppNavState.kt`) — bez Navigation Compose.
- **Skany**: `ScannerBus` = łańcuch handlerów
  (aktywny ekran ma pierwszeństwo, `false` = przekaż niżej, fallback globalny).
  Rozpoznanie kodu należy do serwera (`core/scan/ScanRules`). To, co skan
  ZNACZY, wynika z OTWARTEGO EKRANU: karta towaru bierze skan regału dla siebie,
  reszta spada do globalnego fallbacku (`ui/scan/ScanRouter.kt`). Nie ma
  ukrytego stanu między skanami — kontekst przyklejony został wycięty, bo dało
  się mieć przypięty jeden towar i otwartą kartę drugiego.
- **Tożsamość**: skan badge'a → token sesji (`core/session/SessionModel.kt`
  + `data/SessionRepository.kt`). Decyzja „zaloguj / odblokuj / zapytaj
  o przejęcie / nic" jest czystą funkcją, poza Androidem i z testami.
- **Offline**: `core/offline/OfflineQueue.kt`
  (bufor tylko przy awarii sieci; błędy serwera propagują do UI). Trwałość:
  plik JSON, flush: powrót sieci / tyker 15 s / start / ręcznie / WorkManager.
- **Polling**: kolejka Sfery 1.5 s (wspólna pętla dla pastylki i ekranu),
  karta towaru i sesja rozkładania 2 s — jak `refetchInterval` w PWA.
- **Kiosk**: aplikację można przypiąć przez Android lock-task/MDM — nie
  potrzeba Fully Kiosk Browser ani lokalnego CA (brak service workera).
