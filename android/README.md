# WERTIS Kolektor — natywna aplikacja Android

**Jedyny klient kolektora** WERTIS: Kotlin i Jetpack Compose, czysty klient
REST serwera z `server/`. Skan jest wyłącznie sprzętowy, bez kamery i głosu.
Zasady zmian w tym katalogu stoją w `android/CLAUDE.md`.

## Moduły

| Moduł | Co zawiera | Build |
|---|---|---|
| `:core` | czysta logika JVM: klasyfikacja skanów, walidacja adresów, DTO REST, nawigacja, sesja, bufor offline, reguły rozkładania, przesunięcia i kartonu, diagnoza łączności | bez Android SDK (`./gradlew :core:test`) |
| `:app` | aplikacja Compose: ekrany, skanery, czujniki | wymaga Android SDK (`ANDROID_HOME` albo `local.properties`) |

Bez SDK `settings.gradle.kts` konfiguruje tylko `:core`, więc testy logiki
przechodzą wszędzie. Pełny APK buduje `.github/workflows/android.yml`.

## Co robi kolektor

Dolny pasek ma cztery zakładki: SKAN, DOSTAWY, ZWROTY i KARTON. WSTECZ stoi
w prawym dolnym rogu, żeby wracać jedną ręką.

- **Karta towaru** ma w nagłówku symbol, dostępne sztuki i adres pickingowy.
  Sekcje HISTORIA, POZOSTAŁE MAGAZYNY oraz ZAMIENNIKI I OPIS są zwinięte.
- **„W dostawie, nierozłożone”** mówi, ile sztuk przyszło w ostatnich 14 dniach
  i nie trafiło w regał, z dostawcą. Na palecie widać nazwę dostawcy, nie numer.
- **„Zamówione u dostawcy”** mówi, czego nie ma i kiedy przyjedzie.
- **Wyszukiwarka wybacza** polskie znaki, kolejność słów i myślnik w symbolu.
  Literówkę wybacza dopiero wtedy, gdy nic innego nie wyszło. Skan tej furtki
  nie ma, bo otwiera kartę przy jednym wyniku.
- **Zmiana adresu to skan półki przy otwartej karcie.** Przy jednym adresie
  zastępuje, przy kilku pyta arkuszem. Chip „+ DODAJ” dokłada adres.
- **Adres „w drodze”** ma przerywaną ramkę. Nieudany zapis świeci na czerwono
  i pulsuje, a dotknięcie prowadzi do kolejki z PONÓW.
- **DOSTAWY** pokazują typy z `DOK_TYPY_DOSTAW` z okna `DOK_DNI_WSTECZ`.
  Ścieżka codzienna to dwa skany na pozycję: towar, potem półka.
- **Niejednoznaczny kod kreskowy zatrzymuje operację.** Jedyne automatyczne
  zawężenie: dokładnie jeden kandydat stoi w otwartym dokumencie.
- **Skan innej półki niż w kartotece** pyta PRZED zapisem: ZAMIEŃ podmienia
  adres pickingowy, DODAJ dokłada nowy na końcu.
- **Wyjątki** mają pięć kategorii firmowego formularza i zawsze ilość. Przy
  uszkodzeniu i błędnym artykule zdjęcie jest obowiązkowe.
- **Brak w przesyłce** kolejkuje MM na magazyn serwisowy (`MAG_ID_SERWIS`),
  bo Subiekt księguje fakturę w całości.
- **POPRAW ILOŚĆ** poprawia własną pomyłkę w liczeniu bez Subiekta i bez
  wyjątku. COFNIJ cofa ostatnie odłożenie.
- **KARTON** zbiera towar źle zebrany pod zamówienia. Po ZATWIERDŹ rozkłada
  się jak kosz i zapisuje wyłącznie adresy, bez żadnego dokumentu.
- **Przesunięcie stanu** między magazynami kolejkuje MM. Kolejka jest zarazem
  rezerwacją, a przesunięcie nie idzie przez bufor offline.
- **Czas skan → odpowiedź mierzy kolektor** (`scan_timing`), bo serwer nie
  widzi sieci ani rysowania.

Reguły i powody: `docs/analiza-rozkladanie.md` i `docs/architektura.md`.

## Budowanie

**Gotowy APK wychodzi z CI** (Actions → **Android** → **Artifacts**).
`wertis-kolektor-debug-apk` powstaje przy każdym biegu i służy do pracy nad
kodem. `wertis-kolektor-apk` powstaje tylko na `main` i **tylko on idzie na
kolektory**. Build debugowy podpisuje klucz losowany w CI, więc wyłącza
samoaktualizację: kolejny APK ma inny podpis.

Build lokalny wymaga **JDK 17** (Temurin, jak w CI). Nowszy JDK nie zadziała,
bo moduły są przypięte do `VERSION_17`. Po instalacji otwórz nowy terminal.

```bash
winget install EclipseAdoptium.Temurin.17.JDK   # Windows
cd android
./gradlew :core:test          # testy logiki — wystarczy sam JDK
./gradlew :app:assembleDebug  # APK → app/build/outputs/apk/debug/, wymaga też Android SDK
```

**Build wydania wymaga klucza**, bo Android odrzuca aktualizację podpisaną
innym kluczem. `assembleRelease` bez keystore odmawia i mówi, czego brakuje.
Te same wartości przyjmuje plik `local.properties` w katalogu kolektora, w polach
`wertis.keystore`, `wertis.keystore.haslo`, `wertis.klucz.alias`
i `wertis.klucz.haslo`. Skąd wziąć klucz: `DEPLOY.md` §5.

```bash
WERTIS_KEYSTORE=/sciezka/wertis.keystore WERTIS_KEYSTORE_HASLO=... \
WERTIS_KLUCZ_ALIAS=wertis WERTIS_KLUCZ_HASLO=... \
./gradlew :app:assembleRelease
```

**Wydanie nie jest minifikowane**, bo Retrofit i kotlinx.serialization łamią
się po minifikacji dopiero w czasie działania. Plik idzie po sieci magazynu.

## Uruchomienie przeciwko serwerowi dev

1. W korzeniu repo: `npm ci && npm run seed && npm run dev` (API na `:3001`).
2. Emulator: wpisz `http://10.0.2.2:3001`, bo adres fabryczny wskazuje magazyn.
3. Fizyczny kolektor: wpisz `http://<IP-serwera>:3001` przez
   `ZMIEŃ ADRES SERWERA`.
4. Po zalogowaniu ten sam adres jest w **Ustawienia → Serwer WERTIS**.

Manifest zezwala na cleartext HTTP, bo sieć magazynowa jest on-premise. Skaner
klawiaturowy emuluje się przez adb. Na wolnym emulatorze `input text` bywa
wolniejsze niż 300 ms na znak i bufor wedge się resetuje.

```bash
adb shell input text 'E08-03-01' && adb shell input keyevent 66      # etykieta regału
adb shell input text '5905947595303' && adb shell input keyevent 66  # EAN
```

## Skanery sprzętowe

Aplikacja wybiera źródło po `Build.MANUFACTURER`. Wedge klawiaturowy z sufiksem
Enter działa zawsze jako fallback.

**Zebra (DataWedge).** Zero zależności, czyste intenty. Przy starcie aplikacja
tworzy profil **WERTIS** przez `SET_CONFIG`. Gdy MDM blokuje zdalną
konfigurację, utwórz profil ręcznie:

1. DataWedge → nowy profil `WERTIS`, powiązany z `pl.wertis.kolektor`.
2. Barcode input: włączony. Keystroke output: **wyłączony**.
3. Intent output: action `pl.wertis.kolektor.SCAN`, delivery **Broadcast intent**.

**Honeywell (DataCollection SDK).** SDK jest własnościowe. Pobierz
**DataCollection.aar** z portalu Honeywell i zapisz jako
`android/app/libs/honeywell-datacollection.aar`. Build podepnie go sam. Bez
AAR-a aplikacja też działa (`HoneywellSource` przez refleksję), a skany lecą
przez wedge. Plik jest w `.gitignore`, bo licencja zabrania redystrybucji.

## Checklist smoke-test na sprzęcie

Jedna pozycja to jedna rzecz do sprawdzenia. Nawias nazywa regresję.

**Skan i kontekst**

- [ ] na ekranie głównym EAN otwiera kartę, a etykieta regału jego zawartość,
- [ ] skan symbolu tam, gdzie oczekiwana jest półka, mówi „To kod towaru”,
- [ ] karta A → karta B → skan regału: adres dostaje B (kontekst przyklejony),
- [ ] skan INNEGO regału przełącza podgląd regału,
- [ ] Zebra: profil WERTIS istnieje, a kod NIE wpisuje się do pól,
- [ ] Honeywell: skaner działa po `onPause`/`onResume`,
- [ ] hasło z klawiatury sprzętowej NIE trafia do wyszukiwarki.

**Offline i łączność**

- [ ] zapis adresu offline daje baner, a po powrocie sieci bufor się opróżnia,
- [ ] DIAGNOSTYKA POŁĄCZENIA pyta serwer od razu i pokazuje adres kolektora,
- [ ] serwer z innej podsieci daje „INNA PODSIEĆ”, a podany nazwą — milczenie,
- [ ] 10 s bez sieci to JEDNA przerwa, także w DZIENNIKU (`siec_przerwa`).

**Karta towaru i adres**

- [ ] „+ DODAJ” dokłada drugi adres, a skan półki wprost z karty zastępuje,
- [ ] „+ DODAJ ADRES” ma wielkość pastylki z adresem i otwiera skan półki,
- [ ] linia „W dostawie …” maleje z odłożeniem i znika po całości,
- [ ] dotknięcie linii „W dostawie” otwiera dostawę z rozwiniętą pozycją.

**Rozkładanie dostawy**

- [ ] skan towaru rozwija wiersz w miejscu, reszta listy zostaje widoczna,
- [ ] inna półka niż w kartotece pokazuje ZAMIEŃ / DODAJ pod wierszem,
- [ ] odłożenie 3 z 10 zostawia pozycję z „odłożono 3”, także offline,
- [ ] `+` ponad fakturę pyta raz, a nadmiar trafia do wyjątków w panelu,
- [ ] ZAKOŃCZ z nietkniętymi wymaga wyboru BRAK albo POMIŃ,
- [ ] po ostatniej pozycji na górze stoi „WRÓĆ DO LISTY DOSTAW” bez przewijania,
- [ ] PROBLEM na ostatniej pozycji NIE zamyka dostawy,
- [ ] filtr dostawy pokazuje „Skaner milczy”, a GOTOWE oddaje fokus skanerowi.

**Cofanie i korekta**

- [ ] pasek „ODŁOŻONO … → półka” ma COFNIJ; na ostatniej pozycji otwiera dostawę,
- [ ] OTWÓRZ PONOWNIE działa w dniu zamknięcia, dzień później stoi zdanie,
- [ ] POPRAW ILOŚĆ nie istnieje na pozycji bez odłożeń ani z wyjątkiem,
- [ ] korekta do zera zostawia adres, a na zamkniętej dostawie odmawia.

**Wyjątki i notatki**

- [ ] PROBLEM na pozycji ma cztery kategorie, „Zła ilość” pierwsza,
- [ ] ZGŁOŚ PROBLEM DOSTAWY ma jedną kategorię, od razu wybraną,
- [ ] drugie uszkodzenie w tej samej dostawie nie pyta o przesyłkę,
- [ ] notatka biura stoi na górze rozkładania, a ZAKOŃCZ ją cytuje,
- [ ] ostatnie odłożenie NIE domyka dostawy z notatką bez odpowiedzi.

**Przesunięcie stanu**

- [ ] kafel magazynu i „MGP N — PRZESUŃ” otwierają arkusz przesunięcia,
- [ ] przy celu MAG przycisk czeka na skan półki,
- [ ] zmiana magazynu docelowego czyści zeskanowany kod,
- [ ] offline przesunięcie mówi o braku sieci i nie idzie do bufora,
- [ ] w kolejce `set_location` ma niższy numer niż `mm`,
- [ ] kontener z MGP ma pastylkę „przyjęcia” i przycisk „PRZESUŃ NA HALĘ”.

**Konta i tożsamość**

- [ ] zły login i złe hasło dają ten sam komunikat,
- [ ] po pięciu pomyłkach ekran każe odczekać,
- [ ] kolektor odłożony na godzinę wraca do dostawy bez logowania,
- [ ] pusty serwer proponuje ZAŁÓŻ KONTA z rolą Administrator w pierwszym wierszu,
- [ ] biuro i admin widzą DODAJ OSOBY i „Magazyny”, magazynier nie,
- [ ] błędny adres serwera daje „Nie widzę serwera” z rozwiniętym polem adresu.

**Zgubiony kolektor**

- [ ] Ustawienia pokazują znak kolektora, np. `#A3F9`,
- [ ] ZADZWOŃ: syrena drugiego kolektora gra po ≤10 s, także bez głośności,
- [ ] dotknięcie nakładki ucisza syrenę i nie otwiera niczego pod spodem,
- [ ] DZIENNIK ma `kolektor_wezwany` i `kolektor_odnaleziony`.

**Aktualizacja z serwera**

- [ ] nowszy APK na serwerze: karta pojawia się zaraz po otwarciu aplikacji,
- [ ] ta sama wersja albo brak APK: karty NIE ma; „NIE TERAZ” ją chowa,
- [ ] brak zgody na nieznane źródła: karta prosi o nią PRZED pobraniem,
- [ ] po instalacji zostają adres serwera i bufor offline.

## Architektura (skrót)

- **Nawigacja**: statyczna mapa powrotów (`core/nav/NavModel.kt`), nie stos.
- **Skany**: `ScannerBus` to łańcuch handlerów z pierwszeństwem aktywnego
  ekranu. Znaczenie skanu wynika z otwartego ekranu (`ui/scan/ScanRouter.kt`).
- **Tożsamość**: token sesji (`core/session/SessionModel.kt`). Kolektor pamięta
  ostatni login, nigdy hasła.
- **Offline**: `core/offline/OfflineQueue.kt`, plik JSON opróżniany po powrocie
  sieci, co 15 s, przy starcie, ręcznie i przez WorkManager.
- **Polling**: kolejka Sfery co 1,5 s, karta towaru i rozkładanie co 2 s.
- **Kiosk**: Android lock-task albo MDM, bez lokalnego CA.
