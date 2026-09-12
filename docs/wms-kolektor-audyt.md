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

## Natywna zbiórka dodana w gałęzi

- Natywny ekran WMS: skan wózka, wznowienie trasy, lokalizacja, zdjęcie, SKU i stała pozycja skrzynki.
- Skan lokalizacji → towaru → skrzynki, bez zależności od fokusu pola tekstowego.
- Trwałe ponowienie tego samego zapisu po utracie odpowiedzi, restarcie aplikacji lub zmianie zasięgu Wi-Fi.
- Ochrona kontekstu użytkownika i serwera przy zmianie sesji; brak cichego wysłania zapisu do innej instancji.
- Zgłoszenie braku oraz przekazanie wózka na stanowisko przez obecne API WMS.
- Testy logiki w `:core`: zła skrzynka, ilość, blokada zapasu, restart, awaria dysku, odpowiedź utracona po zapisie oraz zmiana konta.

Nie tworzymy osobnej aplikacji ani drugiego mechanizmu zdjęć.
Stan magazynu potwierdza serwer; brak sieci nie może udawać zakończonego pobrania.


Wejście z ekranu głównego: **ZBIÓRKA WMS — SKANUJ WÓZEK**. Podstawowy cykl nie wymaga pola tekstowego ani dotykania ekranu.
Zdjęcie zachowuje proporcje, a dotknięcie otwiera pełny ekran. Podczas podglądu skany są przechwytywane bez wykonania operacji.
Brak zdjęcia nie zastępuje części podobnym obrazem; widoczne pozostają SKU i nazwa.

Ilość początkowa odpowiada pozostałej ilości dla wskazanej skrzynki. Przyciski plus i minus pozwalają potwierdzić część pobrania.
Wszystkie cele dotykowe mają co najmniej 48 dp. Po zapisie ekran pobiera aktualną trasę. Kolejna skrzynka tej samej części na tej samej półce zachowuje weryfikację przystanku.
Zgłoszenie braku, uszkodzenia lub pełnej skrzynki wymaga zweryfikowanej lokalizacji i skanu właściwej skrzynki.
Biuro rozpatruje zgłoszenie przez istniejący panel WMS. Gotowy wózek przekazuje się przez skan wózka i stanowiska pakowania.

Dziennik zapisuje się atomowo w `noBackupFilesDir`, przed wysłaniem operacji. Nie przechowuje tokenu sesji.
Nieznany wynik blokuje dalsze pobrania; przycisk **SPRAWDŹ OSTATNI ZAPIS** ponawia ten sam klucz i treść.
Zmiana konta lub serwera wymaga powrotu do kontekstu oczekującego zapisu. Żądanie w locie zachowuje pierwotny adres i token.
Po potwierdzonym zapisie awaria odczytu wymaga tylko odświeżenia trasy. Nie wysyła ponownie pobrania pod nowym kluczem.

## Odbiór na urządzeniu

Kompilacja APK nie zastępuje próby fizycznego skanera. Modele Zebra i Honeywell pozostają nieustalone.
Należy sprawdzić profil DataWedge lub wyjście klawiaturowe z Enterem, rękawice, czytelność zdjęć, utratę Wi-Fi oraz restart po zapisie.
Testować wyłącznie na serwerze seeded, z kontem testowym. Nie podłączać kolektora testowego do rzeczywistych zamówień.
Debug APK z PR nie zastępuje podpisanego wydania dla hali; dotychczasowy proces aktualizacji pozostaje bez zmian.

Od poprawki 0.293.1 WMS sprawdza oryginalny kod części i skrzynki, sprzed klasyfikacji lokalizacji.
Prefiks lokalizacji działa wyłącznie w kroku półki. W tym trybie skaner klawiaturowy przyjmuje także krótkie kody, np. A1.


## Kontynuacja przystanku od 0.294.0

Kolejne skrzynki tej samej części wymagają tylko skanu skrzynki. Ilość jest zawsze pobierana z nowego zadania potwierdzonego przez serwer.
Nowa część, półka, kod EAN, właściciel, blokada albo przekazanie wózka kończą ten przystanek.
Częściowe pobranie wymaga zgodnego ubytku ilości i nowszej wersji zamówienia.

Weryfikacja nie trafia do dziennika. Ponowienie po utracie odpowiedzi, odświeżenie, restart i wyjście z aplikacji wymagają nowych skanów.
Wyjście podczas zapisu na dysku lub serwerze również usuwa prawo kontynuacji. Powrót odczytuje aktualną trasę.
Przycisk **SPRAWDŹ PÓŁKĘ I TOWAR PONOWNIE** pozwala ręcznie zacząć weryfikację od nowa.

Podczas zapisu zdjęcie i pozycja pozostają widoczne, ale skany oraz przyciski czekają na sygnał potwierdzenia.
Test 30 skrzynek jednego SKU potwierdza 32 skany: półka, część i 30 skrzynek. Poprzedni wariant wymagał 90 skanów.
Wynik dotyczy liczby czynności w syntetycznym przystanku, bez skanu rozpoczęcia wózka i przekazania. Nie określa wydajności pracownika.

Podstawa procesu: [Microsoft — system-directed cluster picking](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/system-directed-cluster-pick).
Źródło opisuje wspólne pobranie części i potwierdzenie pozycji; reguły przerwania oraz trwały dziennik są decyzjami WERTIS.
