# WMS na kolektorze Android — audyt istniejącego APK

Użytkownik potwierdził, że zbiórka odbywa się na kolektorach Zebra lub Honeywell.
Podstawowym klientem zbiórki jest istniejąca aplikacja Android. Przeglądarka pozostaje
narzędziem biura, stanowiska pakowania oraz pomocniczym klientem WMS.

## Kolejność odkładania według zapotrzebowania

Kolejka wcześniej sortowała wyłącznie według czasu przyjęcia. Nowsza dostawa brakującej części mogła czekać za rutynowym zatowarowaniem.
Serwer teraz wylicza niepokryte potrzeby wspólnie z uzupełnieniami. Priorytet zamówienia i termin rozstrzygają kolejność braków, potem decyduje wiek zadania.
Zapas i podjęte uzupełnienia pokrywają najpierw pilniejsze zamówienia. Wstrzymane nowe zamówienia nie podnoszą pilności.
Kolektor i Biuro podają brak SKU przy zadaniu. Liczba dotyczy całego zapotrzebowania SKU, bez obietnicy skompletowania zamówienia z tej partii.
Nie zmieniają się właściciel, przydział ani wymagane skany. Kolejka pozostaje odczytem; odłożenie do zaplecza samo nie udostępnia części zbiórce.

Kierunek usprawnienia: [Microsoft — planowane przeładunki bez składowania](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/planned-cross-docking).
Bezpośredni przeładunek wymaga powiązania dostawy z zamówieniem. Ta zmiana porządkuje istniejące odkładanie; nie dodaje takiego przeładunku.
Regresje sprawdzają pierwszeństwo, zapas, wstrzymania, terminy, zmianę pilności po odłożeniu i sortowanie przed limitem 50.
Próba zapytania obejmowała 5000 SKU, 1512 zamówień oraz 5002 zadania: mediana 31 ms, P95 34 ms, maksimum 49 ms.
Wiersze zadań utworzono syntetycznie w izolowanej kopii. Wynik dotyczy odczytu kolejki, nie kompletnego księgowania dostawy ani przepustowości hali.

## Hierarchia odkładania na małym ekranie

Audyt źródła wykazał listę do ośmiu miejsc przed polem i potwierdzeniem ilości. Problem obejmował odkładanie oraz przyjęcie bezpośrednio na półkę.
Każda dodatkowa podpowiedź odsuwała bieżącą czynność. To ustalenie z kodu, bez pomiaru ekranu fizycznego kolektora.

Pole, potwierdzenie i błąd stoją teraz przed podpowiedziami. Oba ekrany używają wspólnego komponentu `WmsLocationHints`.
Pierwsze miejsce pozostaje widoczne, pozostałe rozwija przycisk z liczbą alternatyw.
Zmiana kroku zwija alternatywy i przewija do bieżącej instrukcji. Nowy odczyt i partia również resetują ten widok.
Podpowiedzi zachowują pojemność oraz informację o ostatnim odczycie. Skan innej zarejestrowanej półki nadal podlega regułom serwera.
Nie zmienia się kolejność źródło → część → policzona ilość → cel. Nie dodano automatycznego fokusu pola, który przejmowałby skaner klawiaturowy.

Zmiana używa istniejących kolorów, typografii oraz przycisków z minimum 48 dp.
Źródło: [Android — dostępność domyślnych komponentów Compose](https://developer.android.com/develop/ui/compose/accessibility/api-defaults).
Do odbioru na sprzęcie: zero, jedno i osiem miejsc, długa nazwa, większa czcionka, rozwinięta lista oraz przejście skanem.
Sprawdzić także błąd ilości, zmianę dyspozycji i częściowe odłożenie. Nie przypisujemy niezmierzonej oszczędności czasu ani oceny wizualnej.

## Dyspozycja części przy zwrocie

Istniejący ekran zwrotu rozróżnia sprawne części i uszkodzenia. Zmiana dyspozycji resetuje liczbę oraz skan części.
Uszkodzenie wymaga opisu i skanu kwarantanny. Wykorzystuje ten sam dziennik, blokadę zapisów oraz ochronę po pauzie.
Normalny potwierdzony zapis zachowuje skrzynkę; ponowienie po nieznanym wyniku wymaga jej świeżego skanu.
Brak fizyczny trafia do przeliczenia biura po oddaniu skrzynki. Kolektor nie proponuje skanowania nieobecnego produktu.
Testy core sprawdzają walidację dyspozycji i odzyskanie kwarantanny po utracie odpowiedzi. Fizyczny odbiór ekranu pozostaje otwarty.

## Zlecone zwroty z pakowania

Siódmy proces WMS obsługuje odbiór wstrzymanej skrzynki po przekazaniu do pakowania.
Biuro zleca zwrot; dowolny uprawniony magazynier podejmuje go skanami stanowiska i skrzynki.
Kolektor prowadzi po częściach: SKU → jawna ilość → półka. Wybór innej półki korzysta ze wspólnej reguły zwrotu.
Oddanie reszty wymaga pierwotnego stanowiska, skrzynki i powodu. Zakończenie nie wznawia zamówienia.

Proces używa istniejącego trwałego dziennika oraz blokady zapisów. Nieznany wynik nie pozwala przejść do innej operacji.
Testy obejmują utratę odpowiedzi podjęcia i częściowego odłożenia, restart, ponowienie tego samego klucza oraz błąd dysku przed POST.
Siedem procesów przechodzi wspólną próbę cyklu życia. Ponowienie, odczyt i powrót po pauzie wymagają świeżej skrzynki.
Potwierdzone partie w ciągłej sesji zachowują skrzynkę. Nie wykonano odbioru ekranu na fizycznym urządzeniu.

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

## Wymiana uszkodzonej części przy pakowaniu

Nowy ekran **WYMIANY WMS — ZAMIENNIK DO SKRZYNKI** korzysta z istniejących skanerów i zdjęć.
Kolejka ma strony po 50 zadań i wyszukiwanie zamówienia lub skrzynki.
Podjęcie rezerwuje brakujące części. Źródło → część → faktyczna ilość → skrzynka potwierdzają dostarczenie.
Ilość jest początkowo pusta. Zła skrzynka i pominięte kroki nie tworzą komendy.

Zadanie korzysta ze wspólnego dziennika przed POST oraz wspólnej blokady zapisu.
Restart, utracona odpowiedź, awaria dysku, inne konto lub serwer nie pozwalają wysłać drugiego ruchu.
Pauza i spóźniony odczyt nie przywracają gotowości; obowiązuje wspólna weryfikacja po powrocie.
Zwolnienie wymaga zwrotu niepotwierdzonych części i skanów wszystkich źródeł. Potwierdzone dostarczenia pozostają przy pakowaniu.
Pakujący oddzielnie sprawdza zamiennik. Kolektor nie potwierdza za niego zawartości paczki.

Do odbioru sprzętowego dodano: uszkodzenie jednej z trzech sztuk, podjęcie wymiany, utratę Wi-Fi po dostarczeniu oraz restart.
Oczekiwany wynik: jedna sztuka w kwarantannie, trzy dobre przy zamówieniu i tylko jeden dodatkowy skan pakowania.

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

### Podjęcie przez skan źródła

Audyt odtworzył odrzucenie poprawnego skanu bufora przed naciśnięciem przycisku podjęcia. Operator musiał osobno dotknąć przycisku, a potem zeskanować ten sam bufor.
Skan właściwego źródła podejmuje teraz wybrane wolne zadanie. Serwer sprawdza bufor, wersję i właściciela; sam przydział nie przenosi zapasu.
Po potwierdzeniu tej operacji kolektor wymaga skanu części. Przycisk podjęcia usunięto z tego kroku, pozostawiając jedną wskazaną czynność.

Potwierdzenie źródła żyje tylko w pamięci bieżącej, nieprzerwanej operacji. Nie wraca z dziennika po restarcie ani ponowieniu.
Odmowa, nowsza wersja, inny bufor, błąd odczytu i powrót z tła wymagają świeżego skanu źródła.
Po częściowym odłożeniu kolejna partia również wymaga nowych skanów. Kod części z prefiksem `LOC:` nadal pozostaje literalny w kroku produktu.

Pięć nowych testów JVM i regresja serwera sprawdzają ten skrót oraz jego ograniczenia. Usunięto jedno dotknięcie na podjęcie zadania.
Połączenie podjęcia z fizycznym potwierdzeniem lokalizacji jest decyzją WERTIS, opartą na zasadzie potwierdzania lokalizacji opisanej poniżej.
Nie jest to dowód szybkości ani wygody fizycznego urządzenia.

Audyt ciągłości pracy wykrył wymuszony powrót do listy przed skanem następnej części. Wybór zadania usuwał także filtr bufora i numer strony.
Test odtworzył powrót z `BUF-01`, strona 50, do pustego filtra i strony zero.
Zakończone zadanie przyjmuje teraz skan wyszukiwania następnej części lub bufora. Powrót ręczny zachowuje kontekst listy w pamięci bieżącej sesji.
Nowy filtr resetuje stronę. Nowe konto lub serwer nie dziedziczą poprzedniego kontekstu; restart aplikacji może przywrócić zadanie, ale nie filtr listy.

Zmiana usuwa jedno dotknięcie przed kolejnym skanem. Nie pomija podjęcia zadania, weryfikacji bufora, części, ilości ani celu.
Pięć regresji JVM sprawdza ciągłość listy, pełne i częściowe odłożenie, utratę odpowiedzi, stare skany, tło oraz zmianę operatora.
Kompilacja Compose i fizyczna próba kolektora pozostają osobnymi dowodami.

Microsoft opisuje [wyszukiwanie wewnątrz procesu](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/warehouse-app-data-inquiry)
oraz [powrót z zachowaniem kontekstu](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/warehouse-app-detours).
Zastosowanie tych zasad do kolejnego zadania WERTIS jest decyzją projektową. Nie stanowi pomiaru przepustowości magazynu.

Kolektor korzysta z kolejki WMS utworzonej podczas przyjęcia do bufora. Lista ma strony po 50 zadań i wyszukiwanie SKU, EAN, dokumentu lub bufora.
Odczyt nie podejmuje pracy. Operator wybiera zadanie, skanuje bufor i część, potwierdza ilość oraz skanuje docelową półkę.
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
