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


## Wiarygodność zdjęć od 0.295.0

Audyt wykrył pomijanie kontroli świeżości przy trafieniu w RAM oraz brak rozdzielenia serwerów w plikach zdjęć.
Klucz zdekodowanej miniatury również nie zawierał wersji obrazu. Nowe bajty mogły więc pozostawiać poprzedni podgląd.

Cache uwzględnia źródło i kontroluje świeżość także przy trafieniu w pamięć. Miniatura używa skrótu zawartości.
Żądanie zachowuje pierwotny adres i token, a ekran odrzuca wynik po zmianie serwera. Token nie trafia do indeksu zdjęć.
Odświeżenie trasy ponawia odczyt obrazu również przy niezmienionym SKU. Świeży wpis nadal oszczędza żądanie sieciowe.

Dotychczasowe okresy pozostają jawne: sześć godzin dla obrazu i doba dla potwierdzonego braku. Cofnięcie zegara wymusza ponowne sprawdzenie.
Nieudana rewalidacja może wyświetlić oznaczoną zapisaną kopię. Potwierdzone 404 usuwa obraz; 401 i 403 nie udają braku zdjęcia.
Przerwanie korutyny nie zamienia się w udany podgląd offline. Odpowiedzi i strumienie są zamykane, również przy błędzie.

Wspólny limit plików wynosi 32 MiB i 300 wpisów; obejmuje wszystkie serwery oraz wpisy o braku obrazu.
Pamięć bajtów ma limit 4 MiB oraz 32 obrazy, a zdekodowanych miniatur — 12 MiB. Pojedyncze pobranie ma limit 4 MiB.
Plik zapisuje się atomowo przed nowym ETagiem. Odmowa dysku nie pozwala potwierdzić starego obrazu nowym ETagiem.

Kopie sprzed aktualizacji nie zawierają źródła. Są usuwane wyłącznie z rozpoznanego katalogu cache zdjęć aplikacji; pierwszy podgląd wymaga sieci.
Podejście zachowuje pamięć oraz dysk zgodnie z [zaleceniami Android dotyczącymi bitmap](https://developer.android.com/topic/performance/graphics/cache-bitmap).
Klucze źródła, kontrola świeżości i zasady błędów są decyzjami WERTIS sprawdzanymi w testach JVM.

Skrót SHA-256 wiąże zapisany plik z jego ETag. Przerwany zapis indeksu wymusza pełne pobranie zamiast potwierdzania niezgodnej pary odpowiedzią 304.


## Przejęcie trasy i wznowienie pracy od 0.296.0

Dotychczas przejęcie wózka przez biuro pozostawiało poprzedni kolektor w pętli odświeżania.
Potwierdzone przejęcie pokazuje **ROZPOCZNIJ KOLEJNY WÓZEK**. Przycisk zamyka jedynie lokalny widok, po przekazaniu wózka następnej osobie.
Nie zmienia właściciela, przydziałów ani zapasu. Brak sieci, zwykłe 403 i nieznana trasa nie udostępniają tego przycisku.

Oczekujący zapis trzeba najpierw rozliczyć. Serwer sprawdza pierwotny klucz przed ponowną oceną uprawnień do trasy.
Zatwierdzony skan zwraca zapisany wynik, również po przejęciu. Nowa odmowa 403 dostaje kod `WMS_COMMAND_REJECTED` dopiero po udanym rollbacku.
Kod `WMS_RUN_REASSIGNED` z odczytu oznacza brak przypisania tej trasy do zalogowanej osoby; nie ujawnia listy zamówień.
Kolektor nie rozpoznaje znaczenia błędów po treści komunikatu. Starsze API bez kodów zachowuje bezpieczną blokadę.

Testy obejmują utratę odpowiedzi przed przejęciem, identyczne ponowienie, brak drugiego pobrania, odmowę dysku i zmianę konta.
Pełny dziennik pozostaje wymagany; czyszczenie danych aplikacji nie jest sposobem wznowienia pracy.

## Natywne odkładanie od 0.298.0

Kolektor korzysta z kolejki WMS utworzonej podczas przyjęcia do bufora. Lista ma strony po 50 zadań i wyszukiwanie SKU, EAN, dokumentu lub bufora.
Odczyt nie podejmuje pracy. Operator wybiera zadanie, podejmuje je, skanuje bufor i część, potwierdza ilość oraz skanuje docelową półkę.
Wspólne komponenty zachowują cele dotyku co najmniej 48 dp. Znane półki pomagają wybrać cel; serwer sprawdza rejestrację, przeznaczenie i blokady.

Potwierdzenie lokalizacji przy odłożeniu opisuje [Microsoft — work confirmation](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/tasks/set-up-mobile-device-menu).
Oddzielenie przyjęcia od późniejszej pracy opisuje [Microsoft — mobile warehouse work](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/configure-mobile-devices-warehouse).
Wspólny dziennik, jawne potwierdzenie ilości i blokada między procesami są decyzjami WERTIS.

Audyt wykrył ryzyko zastąpienia oczekującego zapisu po przejściu między procesami. Zbiórka i odkładanie współdzielą plik oraz jedną blokadę.
Przed zapisem oba procesy ponownie czytają dziennik. Ponowienie jest dostępne tylko we właściwym procesie, na pierwotnym koncie i serwerze.
Dawny dziennik bez nazwy procesu nadal oznacza zbiórkę. Zakończenie wózka nie usuwa wskaźnika wznowienia odkładania.

Dodano 22 testy JVM. Obejmują kolejność skanów, ilości, właściciela, uszkodzenie, restart, odmowę dysku, utratę odpowiedzi, zmianę konta i równoległe procesy.
Pełny zestaw obejmuje 367 testów. Kompilacja aplikacji oraz fizyczna próba Zebra/Honeywell są osobnymi dowodami odbioru.
Natywne liczenie nowej dostawy pozostaje otwartym zakresem. Nie potwierdzono fizycznej ergonomii na urządzeniu użytkownika.

Próba seeded na kolektorze: podejmij zadanie w BUF-01, odłóż część ilości, następnie odłącz Wi-Fi po skanie celu.
Uruchom aplikację ponownie i sprawdź ten sam zapis; licznik nie może maleć drugi raz. Zbiórka powinna wskazać powrót do odkładania.
Sprawdź również przejęcie zadania w biurze, skan niewłaściwego bufora, brakującą sztukę oraz kwarantannę.

## Liczenie dostaw od 0.299.0

Nowy ekran obsługuje oczekiwane przyjęcia WMS bez Subiekta i Sellasist. Biuro tworzy dokument, a kolektor rejestruje policzone partie.
Przebieg: część, ilość, bufor albo półka. Domyślny bufor oddziela liczenie od późniejszego odkładania; tryb jest zapamiętany dla dokumentu.
Uszkodzenie trafia do kwarantanny. Zamknięcie z brakiem i nadwyżki wymagają rozstrzygnięcia biura, zamiast przypadkowego zatwierdzenia przez skaner.

Audyt wykrył pobieranie całej dostawy po każdym skanie. Nowy odczyt zwraca stronę do 50 pozycji albo pojedynczą część z sumami dokumentu.
Próba 5000 SKU sprawdza ostatnią pozycję i odpowiedź skanowania poniżej 4 KB. Odczyty nie zmieniają stanów ani dziennika serwera.
Kolizja EAN bierze pod uwagę także pozycje już policzone. Pełne policzenie jednej części nie przekierowuje następnego skanu na inną.

Przyjęcie współdzieli plik i blokadę z pozostałymi procesami WMS. Wspólny komunikat zastępuje powielone fragmenty ekranów odzyskania.
Dodano 23 testy JVM i dwa testy serwera. Kontrole obejmują utratę odpowiedzi, dysk, konto, serwer, zamknięcie i szybki drugi skan.
Odpowiedź wyszukiwania po pauzie nie przywraca potwierdzenia części. Stan ekranu zmienia się po otrzymaniu pozycji, aby ilość odpowiadała świeżemu skanowi.

Źródłem rozdzielenia procesów jest wcześniejsza dokumentacja Microsoft wskazana powyżej. Reguły kolizji, wersji i odzyskiwania są decyzjami WERTIS.
Próba fizycznego urządzenia pozostaje do wykonania. Pełna analityka przyjęcie–wysyłka i dalsze wyjątki realizacji nadal należą do celu.
