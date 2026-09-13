# Odbiór ekranów WMS

`WmsReceivingScreensTest` uruchamia rzeczywiste ekrany Compose przyjęcia i odkładania.
Graf korzysta z lokalnego `MockWebServer`, rzeczywistego repozytorium HTTP i pliku dziennika.
Testowa Application zapobiega połączeniu z domyślnym serwerem przed konfiguracją fixture.
Sesja i towar są sztuczne; test nie używa konta hali.

Sprawdzamy pustą ilość, cel dotyku 48 dp, przedwczesny skan, zapis częściowej partii i oddanie skanera po IME.
Odkładanie dodatkowo sprawdza powrót instrukcji po przewijaniu alternatyw oraz ponowną weryfikację bufora.
Przyjęcie kolejnej partii wymaga nowego liczenia. Sam odczyt nie wysyła polecenia WMS.

Uruchomienie z katalogu `android`, przy działającym emulatorze lub urządzeniu testowym:

```sh
./gradlew :app:connectedDebugAndroidTest
```

Używać wyłącznie odrębnego emulatora albo urządzenia bez danych operacyjnych.
Przygotowanie testu czyści sesję, ustawienia i dziennik aplikacji na urządzeniu testowym.

Workflow `Ekrany kolektora` używa Androida 10 i ekranu 720 × 1280 px przy gęstości 320 dpi.
To 360 × 640 dp przed odjęciem pasków systemowych.
Raporty, zrzuty ekranów i log urządzenia trafiają do artefaktu `wms-native-screen-evidence` na 14 dni.
Zrzuty zapisujemy w `additionalTestOutputDir`, który Gradle odbiera przed odinstalowaniem APK testowego.
Brak zrzutów przerywa bramkę nawet przy zielonych testach.

Skan produktu przechodzi przez `ScannerBus`, a skan po liczeniu przez rzeczywisty `WedgeKeySource`.
Nie udajemy transmisji z modułu Zebra/Honeywell ani pełnej nawigacji `MainActivity`.
IME sprawdzamy akcją semantyczną Compose; nie mierzymy szybkości pisania operatora.
Fixture odpowiada na HTTP, ale nie księguje zapasu. Rzeczywisty przebieg sprawdza `server/src/services/wms-inbound-to-dispatch.test.ts`.

Źródła konfiguracji: [Android — testy Compose](https://developer.android.com/develop/ui/compose/testing)
oraz [Android Emulator Runner](https://github.com/ReactiveCircus/android-emulator-runner).
