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
| `:core` | czysta logika JVM: klasyfikacja skanów, walidacja lokalizacji, DTO REST, model nawigacji, model wyjątków (pięć kategorii formularza), reguły przesunięcia stanu, logowanie i sesja urządzenia, tryb wiersza listy rozkładania, ostatnie znane odpowiedzi odczytów (cache ekranów), teksty karty towaru, lista „ostatnio skanowane", jednostka miary przy ilościach, porównanie wersji APK, widoczna ramka logo dostawcy, reguły dodania zdjęcia kartoteki, ilość wpisana z klawiatury, dopasowanie tekstu przy szukaniu na liście, faza, kolejność i podpis półek w kartonie — **268 testów** | działa bez Android SDK (`./gradlew :core:test`) |
| `:app` | aplikacja Compose (15 ekranów, skanery, czujniki) | wymaga Android SDK (`ANDROID_HOME` albo `local.properties`) |

Bez SDK `settings.gradle.kts` konfiguruje tylko `:core` — dlatego testy logiki
przechodzą także w środowiskach bez Androida (CI sandbox). Pełny build APK robi
workflow `.github/workflows/android.yml` (ubuntu-latest ma SDK preinstalowany)
albo dowolna maszyna z Android Studio.

## Budowanie

### Najpierw sprawdź, czy w ogóle musisz

**Gotowy APK wychodzi z CI**, i są dwa różne. Wybór nie jest kwestią wygody.

| artefakt | kiedy powstaje | do czego |
|---|---|---|
| `wertis-kolektor-debug-apk` | każdy bieg, także z PR | praca nad kodem, emulator |
| `wertis-kolektor-apk` | tylko push na `main` | **kolektory na hali** |

> Actions → **Android** → ostatni zielony bieg → **Artifacts**

**Na kolektory idzie wyłącznie ten drugi.** Build debugowy jest podpisywany
kluczem, który runner CI losuje przy każdym biegu. Zainstalowany na urządzeniu
wyłącza samoaktualizację z serwera: kolejny APK ma inny podpis, więc Android
odmówi instalacji. Pobranie artefaktu **nie wymaga ani Javy, ani Android SDK**;
build lokalny ma sens przy pracy nad kodem, nie przy wdrożeniu.

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

**Build wydania wymaga klucza.** Od 0.52.0 kolektory aktualizują się z serwera,
a Android odrzuca aktualizację podpisaną innym kluczem niż zainstalowana
aplikacja. `assembleRelease` odmawia bez keystore i mówi, czego brakuje.

```bash
WERTIS_KEYSTORE=/sciezka/wertis.keystore WERTIS_KEYSTORE_HASLO=... \
WERTIS_KLUCZ_ALIAS=wertis WERTIS_KLUCZ_HASLO=... \
./gradlew :app:assembleRelease
```

**Wydanie nie jest minifikowane.** R8 i `shrinkResources` są wyłączone
w `app/build.gradle.kts`. Reguły `proguard-rules.pro` nie przeszły nigdy
żadnego builda wydania, a Retrofit i kotlinx.serialization łamią się po
minifikacji dopiero w czasie działania. Plik jedzie sam na całą halę, więc do
czasu sprawdzenia zminifikowanego APK na fizycznym kolektorze zostaje pełny.
Rozmiar nie jest tu ceną: transfer idzie po sieci magazynu, nie przez sklep.

`keytool` przychodzi z JDK, więc na maszynie bez Javy tego polecenia nie ma.
Instrukcja wraz z komendą instalującą JDK stoi w `DEPLOY.md` §5.

Zamiast zmiennych te same wartości przyjmuje plik `local.properties`
w katalogu `android/`, w polach `wertis.keystore`, `wertis.keystore.haslo`, `wertis.klucz.alias`
i `wertis.klucz.haslo`. Plik jest poza gitem. Skąd wziąć klucz: `DEPLOY.md` §5.

## Uruchomienie przeciwko serwerowi dev

1. W katalogu głównym repo: `npm install && npm run seed && npm run dev` (API na `:3001`).
2. Adres serwera:
   - emulator: `http://10.0.2.2:3001` — wpisz go, adres fabryczny wskazuje
     serwer magazynu,
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
- [ ] pod kartą NIE MA już przycisku „ZMIEŃ LOKALIZACJĘ" (0.41.0 — był
      duplikatem skanu półki),
- [ ] pasek górny ekranu skanu mówi „DODANIE LOKALIZACJI" na każdej drodze,
- [ ] po skanie półki NIE ma zielonego kafla na środku ekranu,
- [ ] chip nowego adresu jest przygaszony i bez cienia,
- [ ] po przejściu kolejki Sfery ten sam chip robi się normalny,
- [ ] po relokacji i powrocie na ekran główny „Ostatnio skanowane" pokazuje
      **nowy** adres (regresja: lista była migawką z chwili otwarcia karty),
- [ ] odświeżony wpis **zostaje na swoim miejscu** listy, nie wskakuje na górę,
- [ ] dotknięcie pozycji „Ostatnio skanowane" nie gubi nazwy towaru.

**Rozkładanie dostawy**

- [ ] pole „Szukaj w dostawie" zawęża listę po symbolu i po nazwie,
- [ ] licznik postępu dostawy NIE zmienia się przy pisaniu w polu szukania,
- [ ] „POKAŻ WSZYSTKIE POZYCJE" wraca do pełnej listy,
- [ ] w panelu odkładania **−** i **+** zmieniają ilość, domyślnie cała reszta,
- [ ] odłożenie 3 z 10 zostawia pozycję na liście z „odłożono 3",
- [ ] to samo w trybie samolotowym: pozycja NIE znika z listy (regresja:
      bufor zamykał całą pozycję),
- [ ] „ZAKOŃCZ DOSTAWĘ" pokazuje najpierw podsumowanie, dopiero potem zapisuje,
- [ ] pozycja odłożona częściowo trafia do zgłoszeń „zła ilość",
- [ ] pozycja nietknięta jest POMINIĘTA i NIE trafia do dostawcy,
- [ ] „ZGŁOŚ PROBLEM DOSTAWY" i „ZAKOŃCZ DOSTAWĘ" leżą POD listą pozycji,
      za ostatnim wierszem,
- [ ] po odłożeniu OSTATNIEJ pozycji przycisk zakończenia znika ze stopki,
- [ ] wtedy NA GÓRZE ekranu staje „WRÓĆ DO LISTY DOSTAW",
- [ ] to wyjście widać BEZ przewijania — zamkniętą dostawę da się opuścić od razu,
- [ ] ten przycisk wraca na listę dokumentów i nie zostawia po sobie
      kontekstu pracy,
- [ ] miniatura towaru stoi po LEWEJ, przy symbolu, także po rozwinięciu
      wiersza; po prawej nie ma już drugiego zdjęcia.

**Wybrana pozycja — układ po przebudowie** (0.57.0)

- [ ] rozwinięta pozycja ma nagłówek z kafelkiem zdjęcia, symbolem i ✕,
- [ ] ✕ zwija pozycję; powtórny tap w pasek robi to samo,
- [ ] pod nagłówkiem są DWA kafle: biały ze stepperem, ciemny z adresem,
- [ ] adres w ciemnym kaflu czyta się z odległości ramienia,
- [ ] „lub wpisz…" w ciemnym kaflu otwiera pole ręcznego wpisu,
- [ ] przy wyłączonym wpisie ręcznym zostaje samo „skanuj regał",
- [ ] `−` i `+` są trafialne w rękawicy i szarzeją na krańcach zakresu,
- [ ] nie ma już przycisków „INNA ILOŚĆ" ani „ANULUJ",
- [ ] „POPRAW ILOŚĆ (N)" jest tam, gdzie było — pod „PROBLEMEM".

**Kategorie problemu zależne od zakresu** (0.57.0)

- [ ] „PROBLEM" na pozycji pokazuje CZTERY kategorie, „Zła ilość" pierwsza,
- [ ] „ZGŁOŚ PROBLEM DOSTAWY" pokazuje JEDNĄ, od razu wybraną,
- [ ] nie da się zgłosić „Artykułu niezamówionego" na konkretnej pozycji,
- [ ] nie da się zgłosić „Złej ilości" bez wskazania pozycji.

**Logo dostawcy na liście dostaw** (0.56.0)

- [ ] dostawca z wgranym logo ma je po LEWEJ stronie wiersza,
- [ ] dostawca bez logo ma tam dotychczasowy kafelek z ikoną i kolorem stanu,
- [ ] logo nie jest przycięte do kwadratu — wąskie mieści się w całości,
- [ ] wejście na listę NIE zostawia w dzienniku wpisów o brakującym logo.

**Korekta ilości odłożonej**

- [ ] „POPRAW ILOŚĆ (N)" jest w rozwiniętej pozycji, pod „INNĄ ILOŚCIĄ",
- [ ] pozycja bez ani jednej odłożonej sztuki przycisku NIE ma,
- [ ] pozycja ze zgłoszonym wyjątkiem przycisku NIE ma,
- [ ] arkusz startuje od liczby zapisanej dziś, a **+** nie przekracza ilości
      z dokumentu,
- [ ] „ZAPISZ" jest wyszarzony, dopóki liczba się nie zmieni,
- [ ] korekta w dół wraca pozycję na listę, w górę potrafi domknąć dostawę,
- [ ] adres pozycji po korekcie do zera ZOSTAJE na miejscu,
- [ ] korekta na dostawie już zamkniętej odmawia z czytelnym komunikatem.

**Notatki biura**

- [ ] notatka dodana w `/biuro` pojawia się na GÓRZE ekranu rozkładania,
- [ ] nieodpowiedziana jest bursztynowa i klikalna,
- [ ] „ZAKOŃCZ DOSTAWĘ" odmawia i CYTUJE treść notatki,
- [ ] odłożenie ostatniej pozycji też NIE domyka dostawy (regresja: bramka
      musi stać w `closeIfComplete`, nie tylko przy przycisku),
- [ ] po odpowiedzi dostawa domyka się normalnie,
- [ ] odpowiedź widać w `/biuro` z nazwiskiem i czasem.

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
- [ ] ta pastylka jest **tej samej wielkości** co pastylka z adresem — ta sama
      wysokość, ten sam cień, ten sam obrys (0.41.0),
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
- [ ] powtórny tap w rozwinięty wiersz zwija go z powrotem,
- [ ] skan innej półki niż w kartotece pokazuje ZAMIEŃ / DODAJ **pod wierszem**,
      nie na pełnym ekranie,
- [ ] PROBLEM wysuwa się jako arkusz od dołu, z listą dostawy widoczną pod
      spodem,
- [ ] aparat w arkuszu PROBLEM działa,
- [ ] po zgłoszeniu problemu wiersz zostaje oznaczony i NIE zwija się.
- [ ] pobranie aktualizacji kończy się w hali, nie tylko przy biurku,
- [ ] wyłączone Wi-Fi nadal daje SZYBKI komunikat o braku sieci,
- [ ] linia „W dostawie …" na karcie towaru ma szewron i jest klikalna,
- [ ] klik otwiera dostawę z ROZWINIĘTĄ pozycją tego towaru,
- [ ] linia zamówienia i linia przeslotowania szewronu NIE mają,
- [ ] pozycja szybko rotująca ma pod kaflami radę o strefie złotej,
- [ ] ta rada brzmi identycznie jak na karcie towaru.
- [ ] kafel ilości i kafel lokalizacji mają **tę samą wysokość**, także gdy
      biały niesie linijkę „reszta zostaje",
- [ ] linijka „na hali N" dostaje strzałkę, gdy stan różni się od dokumentu,
- [ ] nadwyżka jest bursztynowa i ma ▲, niedobór czerwony i ma ▼,
- [ ] przy zgodnych liczbach linijka jest szara i bez strzałki (wskaźnik
      zapalony bez powodu przestaje być czytany),
- [ ] przy liczbie w kaflu nie ma „szt."; metry i komplety zostają.
- [ ] `+` ponad ilość z faktury pyta raz i mówi o zgłoszeniu do biura,
- [ ] po potwierdzeniu licznik idzie dalej bez kolejnych pytań,
- [ ] ANULUJ zostawia liczbę z faktury i niczego nie zapisuje,
- [ ] po zamknięciu dostawy nadmiar jest w wyjątkach w `/biuro`,
- [ ] pozycja z nadmiarem jest odłożona, nie wraca do roboty.
- [ ] logo dostawcy na liście dostaw jest szersze niż wysokie,
- [ ] wiersz bez logo ma kafelek stanu w tym samym miejscu i nie przeskakuje.
- [ ] po wpisaniu czegoś w filtr dostawy widać pasek „Skaner milczy",
- [ ] GOTOWE oddaje fokus i skan znów działa,
- [ ] wybranie pozycji z filtra samo oddaje fokus,
- [ ] po tym da się nadać lokalizację skanem regału.

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
- [ ] skan towaru rozkładanego przez kolegę otwiera pozycję normalnie —
      blokad pozycji nie ma od 0.47.0 i nic już nie „proponuje odebrania",
- [ ] w kreatorze kont są TRZY role: magazynier, biuro, administrator.

**Aktualizacja z serwera**

- [ ] serwer z nowszym APK: karta pojawia się zaraz po otwarciu aplikacji,
- [ ] karta wychodzi też przy żywej sesji, nie tylko na ekranie logowania,
- [ ] serwer z tą samą wersją: karty NIE ma (regresja: proponowany downgrade),
- [ ] serwer bez APK: karty NIE ma i nic się nie dzieje,
- [ ] „NIE TERAZ" chowa kartę, a logowanie pod spodem działa przez cały czas,
- [ ] po ponownym otwarciu aplikacji karta wraca,
- [ ] dotknięcie paska wersji na dole pyta serwer od razu,
- [ ] brak zgody na nieznane źródła: karta prosi o zgodę PRZED pobraniem,
- [ ] wyłączone Wi-Fi w trakcie pobierania: komunikat, plik częściowy znika,
- [ ] po instalacji zostają adres serwera i bufor offline,
- [ ] kolektor z MDM blokującym instalacje: komunikat o dziale IT.

**Pierwsze uruchomienie**

- [ ] pusty serwer: ekran startowy proponuje ZAŁÓŻ KONTA obok pól logowania,
- [ ] kreator zakłada całą listę i pokazuje loginy, nigdy haseł,
- [ ] po wyjściu z kreatora ta sama instalacja prosi już o logowanie,
- [ ] świeża instalacja w sieci magazynu **łączy się bez wpisywania adresu**
      (od 0.72.1 fabryczny wskazuje serwer produkcyjny),
- [ ] instalacja z BŁĘDNYM adresem nadal pokazuje „Nie widzę serwera" i
      ROZWINIĘTE pole adresu,
- [ ] to jedyna droga wyjścia z tego ekranu i nie wolno jej stracić,
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
