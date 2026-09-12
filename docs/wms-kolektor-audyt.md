# WMS na kolektorze Android — audyt istniejącego APK

Użytkownik potwierdził, że zbiórka odbywa się na kolektorach Zebra lub Honeywell.
Podstawowym klientem zbiórki jest istniejąca aplikacja Android. Przeglądarka pozostaje
narzędziem biura, stanowiska pakowania oraz pomocniczym klientem WMS.

## Sprawdzone artefakty

- Wydanie `v0.284.0`: `wertis-kolektor-0.284.0.apk`, pobrane z GitHub Releases.
  SHA-256 odpowiada sumie opublikowanej przy wydaniu:
  `c48a8ccb51e48ee6649229dbbeba887ef78e01f52cea46f274caba5f5ed69bba`.
- Build gałęzi `0.291.0`: artefakt `wertis-kolektor-debug-apk`, ID `10285854304`,
  bieg Android `34659259334`, commit `d51dbc459b9bd3699131d890a305cc607eec7e17`.
  SHA-256 pliku APK: `57ce75d8d60316692d5d69712234c736033dd24e5afbf780bf4136bccbd5cb9e`.

Sprawdzono binarny manifest, tablice tekstów DEX i odpowiadający im kod źródłowy.
Nie uruchomiono aplikacji na fizycznym kolektorze. APK nie był śledzonym plikiem
w tym checkoutcie; źródła oraz proces budowania znajdują się w repozytorium.

## Ustalenia

Oba APK mają pakiet `pl.wertis.kolektor`, minimalny SDK 26 i docelowy SDK 35.
Oba zawierają obecne ekrany dostaw, kartoteki, zwrotów, kartonów oraz zadań z biura.
Żaden nie zawiera ekranów kompletacji WMS ani wywołań `api/wms`.
Potwierdza to brak odpowiednich wpisów w `ApiService` i modelu nawigacji.

Zebra ma adapter `ZebraDataWedgeSource`, profil WERTIS i odbiór skanu przez intenty.
Źródło klawiaturowe `WedgeKeySource` jest obecne. Adapter `HoneywellSource` także
istnieje, lecz oba sprawdzone APK nie zawierają klas opcjonalnego SDK `com.honeywell.aidc`.
Obecna konfiguracja Honeywell opiera się wtedy na skanowaniu klawiaturowym.

Zdjęcia produktów są już obsługiwane przez `ZdjeciaRepository`, z trwałym cache
na urządzeniu i powiększeniem. Należy użyć tego mechanizmu w kompletacji.
Router `ScannerBus` przekazuje skan aktywnemu ekranowi przed globalnym otwarciem kartoteki.

## Wymagany dalszy zakres

- Natywny ekran WMS: skan wózka, wznowienie trasy, lokalizacja, zdjęcie, SKU i stała pozycja skrzynki.
- Skan lokalizacji → towaru → skrzynki, bez zależności od fokusu pola tekstowego.
- Trwałe ponowienie tego samego zapisu po utracie odpowiedzi, restarcie aplikacji lub zmianie zasięgu Wi-Fi.
- Ochrona kontekstu użytkownika i serwera przy zmianie sesji; brak cichego wysłania zapisu do innej instancji.
- Zgłoszenie braku oraz przekazanie wózka na stanowisko przez obecne API WMS.
- Testy logiki w `:core`, kompilacja APK oraz próba fizycznego skanera na wskazanych modelach.

Nie tworzymy osobnej aplikacji ani drugiego mechanizmu zdjęć.
Stan magazynu potwierdza serwer; brak sieci nie może udawać zakończonego pobrania.
