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
| `:core` | czysta logika JVM: klasyfikacja skanów, walidacja lokalizacji, DTO REST, model nawigacji, model wyjątków (pięć kategorii formularza), reguły przesunięcia stanu, logowanie i sesja urządzenia, tryb wiersza listy rozkładania, ostatnie znane odpowiedzi odczytów (cache ekranów), teksty karty towaru, lista „ostatnio skanowane" — **178 testów** | działa bez Android SDK (`./gradlew :core:test`) |
| `:app` | aplikacja Compose (11 ekranów, skanery, czujniki) | wymaga Android SDK (`ANDROID_HOME` albo `local.properties`) |

Bez SDK `settings.gradle.kts` konfiguruje tylko `:core` — dlatego testy logiki
przechodzą także w środowiskach bez Androida (CI sandbox). Pełny build APK robi
workflow `.github/workflows/android.yml` (ubuntu-latest ma SDK preinstalowany)
albo dowolna maszyna z Android Studio.

## Budowanie

### Najpierw sprawdź, czy w ogóle musisz

**Gotowy APK wychodzi z CI.** Workflow `android.yml` buduje go przy każdej
zmianie i wystawia jako artefakt:

> Actions → **Android** → ostatni zielony bieg → **Artifacts** →
> `wertis-kolektor-debug-apk`

Do wgrania na kolektory to wystarcza i **nie wymaga ani Javy, ani Android SDK**.
Build lokalny ma sens przy pracy nad kodem aplikacji, nie przy wdrożeniu.

### Czego wymaga build lokalny

**JDK 17** — Temurin, ta sama dystrybucja co w CI (`android.yml:22`). Nowszy JDK
nie zadziała: moduły są przypięte do `VERSION_17` i `jvmTarget = "17"`.

```powershell
winget install EclipseAdoptium.Temurin.17.JDK   # Windows
```

Bez tego Gradle wita komunikatem `JAVA_HOME is not set and no 'java' command
could be found in your PATH`, który nie mówi, **której** wersji brakuje.
Po instalacji otwórz nowy terminal — zmienne środowiskowe nie wchodzą do już
otwartego.

```bash
cd android
./gradlew :core:test          # testy logiki — wystarczy sam JDK, bez SDK
./gradlew :app:assembleDebug  # APK → app/build/outputs/apk/debug/
```

Druga komenda potrzebuje **dodatkowo Android SDK** (Android Studio albo
command-line tools plus akceptacja licencji) — samo JDK jej nie wystarczy.

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
- [ ] po przejściu kolejki Sfery ten sam chip robi się normalny,
- [ ] po relokacji i powrocie na ekran główny „Ostatnio skanowane" pokazuje
      **nowy** adres (regresja: lista była migawką z chwili otwarcia karty),
- [ ] odświeżony wpis **zostaje na swoim miejscu** listy, nie wskakuje na górę,
- [ ] dotknięcie pozycji „Ostatnio skanowane" nie gubi nazwy towaru.

**W dostawie, nierozłożone**

- [ ] towar z nierozłożonej dostawy ma na karcie amber linię z numerem
      dokumentu, ilością i dostawcą,
- [ ] dostawca stoi między numerem a statusem („… · OGRÓD-POL · w toku"),
- [ ] dokument bez kontrahenta nie zostawia w linii wiszącej kropki,
- [ ] po odłożeniu części ilość w linii maleje o tyle, ile odłożono,
- [ ] po odłożeniu całości linia znika,
- [ ] pozycja ze zgłoszonym problemem ZOSTAJE, z dopiskiem „zgłoszony problem",
- [ ] karta nie reaguje na dotknięcie (wejście w dokument z karty otwierałoby
      rozkładanie w tle, bez zamiaru magazyniera).

**Karta towaru — nagłówek i sekcje**

- [ ] nagłówek pokazuje symbol, liczbę dostępnych sztuk i adres pickingowy,
- [ ] towar bez adresu ma w nagłówku pastylkę „+ DODAJ ADRES",
- [ ] ta pastylka otwiera skan półki, a rząd chipów pod spodem znika,
- [ ] adres w kolejce Sfery prowadzi z pastylki wprost do kolejki,
- [ ] trzy sekcje są zwinięte po wejściu na kartę,
- [ ] nagłówek sekcji niesie podsumowanie bez rozwijania,
- [ ] sekcja bez danych nie pokazuje się wcale,
- [ ] wejście w zamiennik zwija sekcje z powrotem.

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

**Kreator kont i rola admina**

- [ ] na pustej instalacji pierwszy wiersz kreatora ma rolę **Administrator**
      i pole roli jest zablokowane,
- [ ] lista bez konta admina nie przechodzi — komunikat mówi dlaczego,
- [ ] konto biura widzi DODAJ OSOBY i sekcję „Magazyny" w Ustawieniach,
- [ ] konto admina widzi to samo (regresja: dwa sprawdzenia `role == "biuro"`
      odbierałyby adminowi oba ekrany),
- [ ] konto magazyniera nie widzi ani jednego, ani drugiego.

**Przesunięcie stanu**

- [ ] kafel magazynu w sekcji „Pozostałe magazyny" otwiera arkusz przesunięcia,
- [ ] kafel pustego magazynu NIE reaguje na dotknięcie,
- [ ] podlinijka „MGP N — PRZESUŃ" w nagłówku karty otwiera ten sam arkusz,
- [ ] przy celu MAG przycisk jest nieaktywny do skanu półki,
- [ ] przy celu innym niż MAG strefa skanu znika i jest zdanie o hali,
- [ ] zmiana magazynu docelowego **czyści** zeskanowany kod
      (regresja: kod z poprzedniego wyboru leciał cicho w żądaniu),
- [ ] tryb samolotowy → przesunięcie **nie** trafia do bufora, tylko mówi
      o braku sieci (świadomie inaczej niż zapis lokalizacji),
- [ ] po przesunięciu karta pokazuje „⏳ w drodze" na MAG i mniejszy MGP,
- [ ] drugie przesunięcie tego samego towaru widzi mniejszy stan dostępny,
- [ ] w kolejce zadanie `set_location` ma NIŻSZY numer niż `mm`.

**Kontener na liście dostaw**

- [ ] w zakładce DOSTAWY nie ma już przycisku KONTENERY,
- [ ] dokument z MGP ma pastylkę „przyjęcia" i otwiera się jak każdy inny,
- [ ] rozwinięty wiersz kontenera ma przycisk „PRZESUŃ NA HALĘ",
- [ ] ten sam wiersz w dostawie krajowej przycisku NIE ma,
- [ ] przesunięcie z wiersza odkłada linię i zamyka ją jako `done`.

**Niezgodność w dostawie (arkusz PROBLEM)**

- [ ] arkusz pokazuje **pięć kafli**, nie siedem,
- [ ] INNA ILOŚĆ otwiera arkusz z zaznaczoną „Zła ilość",
- [ ] przy złej ilości widać „Zamówiono N szt" jako TEKST, a pole pyta o to,
      ile faktycznie przyszło,
- [ ] błędny artykuł pyta o numer katalogowy tego, co przyszło,
- [ ] „a miało przyjść" startuje **zwinięte** i rozwija się dopiero na tap,
- [ ] uszkodzenie w transporcie pyta o numer przesyłki i protokół kuriera,
- [ ] drugie uszkodzenie w TEJ SAMEJ dostawie o przesyłkę już **nie pyta**,
      tylko pokazuje zapisany numer,
- [ ] wyjście z aplikacji i powrót nie wskrzesza pytania o przesyłkę
      (regresja: stan pytany raz trzymany wyłącznie w pamięci ekranu),
- [ ] lista WYJĄTKI pokazuje nazwę, nie surowy klucz — także dla zgłoszeń
      sprzed 0.21.0 (`qty_short` → „Za mało").

**Układ ekranu**

- [ ] dostawa 10 pozycji mieści się na jednym ekranie bez przewijania,
- [ ] odłożone wiersze są cienkie, przekreślone i schodzą na **dół** listy,
- [ ] pozycja ze zgłoszonym problemem NIE schodzi na dół (czeka na decyzję),
- [ ] pozycje bez lokalizacji zostają osobną grupą tuż nad odłożonymi,
- [ ] nie ma nagłówków alejek; lokalizacja jest pastylką przy każdym wierszu,
- [ ] „BEZ LOKALIZACJI (n)" zostaje osobną sekcją na końcu,
- [ ] WSTECZ jest w prawym DOLNYM rogu, nie w lewym górnym,
- [ ] da się wrócić jedną ręką, nie przekładając kolektora,
- [ ] wejdź w podekran i wróć: SKAN i DOSTAWY zostają na swoich miejscach
      (slot WSTECZ jest zarezerwowany zawsze).

**Tożsamość**

- [ ] login i hasło logują, a pole loginu jest wypełnione ostatnią wartością,
- [ ] zły login i złe hasło dają TEN SAM komunikat,
- [ ] po pięciu pomyłkach ekran mówi, żeby odczekać chwilę,
- [ ] **hasło wpisane z klawiatury sprzętowej NIE trafia do wyszukiwarki
      towarów** — regresja na wedge, patrz `scan/WedgeKeySource.kt`,
- [ ] odłóż kolektor na godzinę: wraca do otwartej dostawy bez logowania i bez
      ekranu blokady (regresja: usunięty TTL sesji),
- [ ] skan towaru zajętego przez kogoś innego proponuje odebranie,
- [ ] magazynier dostaje odmowę, brygadzista przechodzi.

**Pierwsze uruchomienie**

- [ ] pusty serwer: ekran startowy proponuje ZAŁÓŻ KONTA obok pól logowania,
- [ ] kreator zakłada całą listę i pokazuje loginy, nigdy haseł,
- [ ] po wyjściu z kreatora ta sama instalacja prosi już o logowanie,
- [ ] świeża instalacja z adresem fabrycznym `10.0.2.2` pokazuje „Nie widzę
      serwera pod adresem…" i ROZWINIĘTE pole adresu,
- [ ] nie pokazuje samych pól logowania bez wyjścia (bez konta nie dało się
      z tego ekranu wyjść),
- [ ] wpisz właściwy adres LAN i naciśnij ZAPISZ I SPRAWDŹ,
- [ ] ekran przechodzi do ZAŁÓŻ KONTA albo do logowania, bez restartu
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
- **Tożsamość**: login i hasło → token sesji (`core/session/SessionModel.kt`
  + `data/SessionRepository.kt`). Kolektor zapamiętuje ostatni login, nigdy
  hasła — zapamiętane hasło byłoby plakietką pod inną nazwą, tylko bez
  możliwości świadomego oddania jej.
- **Offline**: `core/offline/OfflineQueue.kt`
  (bufor tylko przy awarii sieci; błędy serwera propagują do UI). Trwałość:
  plik JSON, flush: powrót sieci / tyker 15 s / start / ręcznie / WorkManager.
- **Polling**: kolejka Sfery 1.5 s (wspólna pętla dla pastylki i ekranu),
  karta towaru i sesja rozkładania 2 s — jak `refetchInterval` w PWA.
- **Kiosk**: aplikację można przypiąć przez Android lock-task/MDM — nie
  potrzeba Fully Kiosk Browser ani lokalnego CA (brak service workera).
