# WMS — realizacja zamówień

Moduł działa pod `/biuro`, w zakładce **REALIZACJA WMS**.
Wykorzystuje istniejące konta, katalog Subiekta i dziennik zdarzeń.
Przyjęcia dokumentowe, zwroty i obsługa klienta zachowują dotychczasowe ekrany.
WMS prowadzi cały przebieg samodzielnie, bez konta, abonamentu ani API Sellasist.
Zgodnie z decyzją właściciela obecna praca i odbiór wykorzystują wyłącznie dane seeded.

## Uszkodzona część przy pakowaniu

Pakujący otwiera **Uszkodzona część — odłóż do kwarantanny** w zamówieniu.
Skanuje skrzynkę oraz część, wpisuje uszkodzoną ilość i wybiera paczkę albo sztuki jeszcze niesprawdzone.
Odkłada uszkodzone sztuki, skanuje kwarantannę i opisuje uszkodzenie.
Zapis odejmuje tylko te pobrania i potwierdzenia. Dobre sztuki oraz ich potwierdzenia zostają przy stanowisku.

Kolektor ma **WYMIANY WMS — ZAMIENNIK DO SKRZYNKI**. Operator wybiera zadanie i podejmuje brakujące części.
Skanuje źródło → część → wpisuje faktyczną ilość → dostarcza i skanuje skrzynkę zamówienia.
Ostatni skan potwierdza pobranie. Pakujący musi jeszcze zeskanować zamiennik; dopiero kompletna kontrola pozwala przygotować etykiety.
Zdjęcie korzysta z istniejącego podglądu kartoteki. Enter w pomocniczym formularzu Biura prowadzi przez te same pola.

Brak zapasu odrzuca samo podjęcie, bez cofania kwarantanny. Niepokryta potrzeba pojawia się w uzupełnieniach przed rutynowymi minimami.
Analityka pokazuje wiek kolejki **Wymiany części przy pakowaniu** i przejście do zadań.
Jedno zamówienie ma jedną otwartą wymianę. Kolejne uszkodzenie można dopisać, dopóki operator nie podjął zadania.

Przed odświeżeniem lub wyjściem operator zwraca niepotwierdzone sztuki na źródło.
Jeśli wynik zapisu jest nieznany, używa **PONÓW** z trwałego dziennika, bez ponownego przenoszenia części.
Zwolnienie podjętego zadania wymaga zwrotu i skanu wszystkich źródeł. Dostarczone zamienniki zostają przy pakowaniu.
Spis źródła czeka na zwolnienie zadania. Biuro może następnie przerwać wymianę z uzasadnieniem.
Przerwanie wstrzymuje zamówienie i zeruje kontrolę paczek; dobre pobrania trzeba rozliczyć przed anulowaniem zamówienia.
Historia uszkodzenia i jego kwarantanny pozostaje także po zmianie pozycji anulowanego zamówienia.

Ta operacja dotyczy faktycznie obecnej uszkodzonej części. Brakującej fizycznie sztuki nie zapisuj jako przyjętej do kwarantanny.

### Potwierdzony brak przy pakowaniu

Pakujący wstrzymuje zamówienie i opisuje rozbieżność. Sprawdź skrzynkę, stanowisko oraz możliwą pomyłkę przy odkładaniu.
Biuro otwiera **Potwierdzony brak — rozlicz po przeliczeniu**, także na wstrzymanym zamówieniu innego pakującego.
Skanuje skrzynkę, wybiera część z listy oraz paczkę albo niesprawdzone sztuki poza paczkami.
Wpisuje faktycznie obecne sztuki tej części wyłącznie we wskazanej zawartości. Pole jest puste; zero trzeba wpisać świadomie.
Nie trzeba skanować nieobecnej części. Ilość równa zapisanej lub większa nie jest brakiem i nie tworzy korekty.

Zapis odejmuje różnicę z pobrań i potwierdzeń wybranej zawartości. Dobre sztuki, inne paczki i półki pozostają bez zmian.
Brak nie tworzy przyjęcia na półkę ani kwarantannę. Historia zachowuje ilość, autora oraz wynik wyjaśnienia.
Powstaje zwykłe zadanie zamiennika do tej samej skrzynki. Kolektor pobiera go dotychczasową sekwencją.
Niezależne wstrzymanie pozostaje; biuro wznawia zamówienie po wyjaśnieniu, bez wymogu uprzedniego zarezerwowania udokumentowanego zamiennika.
Niepełny przydział niezwiązany z wymianą nadal wymaga naprawy rezerwacji.

W analityce **Ruchy i rozbieżności → Rozbieżności przy pakowaniu** pokazują osobno potwierdzone braki i fizyczne uszkodzenia w kwarantannie.
Liczby dotyczą zgłoszeń zapisanych w wybranym okresie. Pozostała potrzeba zamienników dotyczy nadal otwartych zadań tych zgłoszeń.

## Wygląd i nawigacja

Biuro korzysta z tego samego języka wizualnego co panel obsługi klienta.
Poziomy grafitowy nagłówek, jasne powierzchnie i neutralne zaznaczenia ułatwiają zmianę stanowiska.
Oba panele pokazują oryginalne logo WERTIS.
Kolory marki to #FF9100 i #303030; statusy zachowują osobne, czytelne oznaczenia.

Na telefonie nawigacja przewija się poziomo.
Wybrane zamówienie przełącza ekran na skanowanie; **Pokaż kolejkę** przywraca pozostałe widoki.
Pola i przyciski skanowania zachowują co najmniej 48 px wysokości.
Logo jest lokalnym zasobem, więc nie potrzebuje połączenia z serwerem zewnętrznym.

### Zdjęcie podczas zbiórki

Wózek 20/30, zbiórka ręczna i pojedyncze zamówienie pokazują zdjęcie aktualnej części
obok lokalizacji, SKU i ilości. Dotknij zdjęcia, aby powiększyć je bez utraty etapu pracy.
Zamknięcie przyciskiem lub Escape przywraca ostatnie pole skanu. Kod nadal potwierdza towar;
zdjęcie pomaga odróżnić podobne części, ale nie zastępuje skanowania.

Obrazy korzystają z istniejącej, chronionej sesją trasy zdjęć kartotek.
Nie potrzeba Sellasist. Pobieranie działa niezależnie od skanera.
Brak obrazu i błąd pobrania mają różne komunikaty oraz przycisk ponowienia.
Cache przeglądarki mieści 24 obrazy; wylogowanie zwalnia je wszystkie.
Przejście do kolejnego SKU usuwa poprzedni obraz od razu.
Kolejna skrzynka z tym samym SKU korzysta z tego samego pobrania.

Demo zawiera jeden wygenerowany obraz fikcyjnego koła `WMS-0030`.
Nie przypisujemy tego obrazu do innych części. Pozostałe SKU bez zdjęć pokazują jawny brak.
Rzeczywiste zdjęcia katalogowe pozostają poza obecnym odbiorem na danych seeded.

## Uruchomienie

Wymagany Node.js co najmniej 24.15.0.
Ta wersja dostarcza SQLite 3.51.3 oraz mechanizm kopii działającej bazy.

```powershell
npm ci
npm run build
npm start
```

Konfiguracja połączeń i kont pozostaje w `wertis.env` oraz dotychczasowej administracji.
Pierwsze uruchomienie dodaje tabele `wms_*`. Nie podmienia stanów ani dokumentów Subiekta.

### Osobne demo

Generator odmawia użycia istniejącego pliku bazy.
Hasło musi pochodzić ze zmiennej środowiskowej.

```powershell
$env:DB_PATH = Join-Path $env:TEMP 'moj-nowy-wms-demo.db'
$env:WMS_DEMO_PASSWORD = 'wybrane-przez-ciebie-haslo'
npm -w server run wms:demo
$env:WERTIS_ENV_FILE = Join-Path $env:TEMP 'nieistniejacy-wms-demo.local'
$env:SGT_MODE = 'seeded'
$env:SRODOWISKO = 'DEMO WMS'
$env:ALLEGRO_MODE = 'dev'
npm run dev:api
```

Adres: `http://localhost:3001/biuro`. Login: `wms-demo`.
Demo zawiera 40 części i 32 zamówienia na różnych etapach realizacji.
Opcja `npm -w server run wms:demo -- --scale` tworzy 5000 SKU i 1500 zamówień.
Wymaga nowego pliku bazy, tak samo jak mniejszy wariant.
Numery przesyłek DEMO służą do ćwiczeń i nie zamawiają usług przewoźnika.

## Ewidencja fizyczna i ERP

Subiekt jest źródłem kartotek i dokumentów handlowych.
WMS prowadzi ilości na lokalizacjach oraz rezerwacje zamówień.
Synchronizacja Subiekta nie nadpisuje tych ilości.
Usunięcie kartoteki ERP nie ukrywa jej pozostałego zapasu w WMS.

Przed rozpoczęciem pracy zarejestruj policzony zapas przez **Zapasy → Zmień → Przyjęcie**.
W powodzie podaj numer protokołu otwarcia.
Kolejne dostawy zapisuj z numerem dokumentu przyjęcia, raz dla każdej faktycznie odłożonej partii.
WMS nie pobiera automatycznie ilości z historycznych dokumentów przyjęcia.

### Otwarcie i dostawy z arkusza

**Zapasy → Przyjęcie lub spis z arkusza** przyjmuje do 5000 wierszy i plik do 2 MB.
Wklej trzy kolumny z arkusza lub wybierz plik UTF-8 ze średnikami, bez nagłówka:

```text
W32-0203;A01-01-02;20
50-111;B01-02-03;5
```

Podaj jednoznaczny numer, np. `OTWARCIE/2026-09-11` lub `DOSTAWCA/PZ/123/2026`.
Numer jest wspólny dla wszystkich dokumentów stanów; wielkość liter nie rozróżnia dokumentów.
**Przyjęcie** dodaje dostarczone sztuki. **Spis** ustawia policzone ilości wyłącznie na wymienionych półkach.
Brak wiersza nie zeruje stanu. Powtórzona para SKU i lokalizacji zatrzymuje dokument.

Na czas liczenia zatrzymaj obsługę liczonych lokalizacji.
Podgląd niczego nie zapisuje: pokazuje bieżący stan, rezerwację i wynik po zatwierdzeniu.
Tabela pokazuje pierwsze 100 pozycji; zatwierdzenie obejmuje cały wskazany dokument.
Zmiana formularza usuwa wcześniejszy podgląd.

Wszystkie ruchy, audyt i numer dokumentu zapisują się w jednej transakcji.
Zmiana zapasu od podglądu zatrzymuje całość i wymaga ponownego sprawdzenia.
Spis poniżej ilości zarezerwowanej wymaga wcześniejszego wyjaśnienia zamówień.
Ponowny import identycznego dokumentu nie zmienia zapasu, także z nowej karty przeglądarki.
Inna treść pod użytym numerem jest odrzucana; poprawkę wykonaj osobnym, opisanym dokumentem.

Na półce znajdują się `on_hand` sztuki, z czego `reserved` są przypisane do zamówień.
Dostępne wynosi `on_hand - reserved`.
Pobranie zmniejsza obie wartości i zwiększa ilość w pojemniku zamówienia.
Pakowanie sprawdza pobrane sztuki i nie odejmuje ich ponownie z półki.

**Analityka → Porównaj z Subiektem** porównuje półki i niewysłane pojemniki ze stanem ERP.
Brak wiersza stanu ERP jest oznaczony jako brak danych.
Raport nie wyrównuje automatycznie różnic.
Zdarzenia z ostatniej synchronizacji mogą jeszcze nie uwzględniać wszystkich dokumentów.

Ilości części są całkowite. Ułamkowe jednostki, partie i numery seryjne nie są obecnie obsługiwane przez nowe operacje WMS.

### Lokalizacje i kontrola jakości

Zakładka **Lokalizacje** rozróżnia kompletację, zapas zaplecza i kwarantannę.
Nieskonfigurowana lokalizacja jest domyślnie lokalizacją kompletacji.
Zdefiniuj kwarantannę przed pierwszym przyjęciem niesprawdzonego towaru.
Rezerwacja pomija zaplecze i kwarantannę; raport dostępności również je wyłącza.
Przesunięcie z kwarantanny oraz zmiana przeznaczenia wymagają biura i powodu.
Nie można wyłączyć kompletacji na lokalizacji mającej aktywne rezerwacje.
Przycisk **Historia** przy zapasie otwiera dziennik przyjęć, przesunięć, spisów i pobrań.
Starsze ruchy są dostępne przez kolejne strony bez ładowania całego dziennika.

## Zamówienia

Biuro tworzy zamówienie ręcznie lub importuje plik JSON.
Pojedyncza partia może zawierać 200 zamówień, każde do 200 pozycji.
Limit całego żądania importu wynosi 2 MB.
SKU musi jednoznacznie wskazywać istniejącą kartotekę.

Przykład importu:

```json
{
  "orders": [
    {
      "reference": "SKLEP-12345",
      "channel": "sklep",
      "priority": 0,
      "dueAt": "2026-09-11T14:00:00+02:00",
      "lines": [
        { "sku": "W32-0203", "quantity": 2 },
        { "sku": "50-111", "quantity": 1 }
      ]
    }
  ]
}
```

Tożsamość importu to kanał oraz numer zamówienia.
Identyczny import pomija istniejące zamówienia.
Inna treść istniejącego numeru powoduje konflikt i wycofanie całej partii.
Żadna pozycja nie jest pomijana bez komunikatu.

Rezerwacja pojedynczego zamówienia jest atomowa: niedobór jednej pozycji wycofuje wszystkie przydziały.
Przycisk **Zarezerwuj nowe z tej strony** obsługuje widoczne nowe zamówienia według kolejności listy.
Niedobór jednego zamówienia nie blokuje pozostałych. Wynik wymienia zamówienia wymagające uzupełnienia.

## Kompletacja i pakowanie

1. Wybierz zarezerwowane zamówienie i zeskanuj pusty pojemnik.
2. System przypisze zbiórkę do zalogowanej osoby.
3. Przejdź do wskazanej lokalizacji, zeskanuj ją, następnie SKU albo EAN.
4. Potwierdź pobraną ilość. Domyślna ilość to jedna sztuka.
5. Ostatnia pobrana pozycja kieruje pojemnik do pakowania.
6. Na stanowisku pakowania zeskanuj pojemnik i kolejno wkładane produkty.
7. Po kontroli całości wpisz przewoźnika, zeskanuj numer przesyłki i podaj masę.
8. Potwierdź przekazanie paczki do wysyłki.

Enter ze skanera po lokalizacji przechodzi do pola towaru.
Enter po kodzie towaru zatwierdza formularz pobrania lub pakowania.
Nieznany kod, zła lokalizacja, nadmiar lub obcy pojemnik zatrzymują operację.
Wspólny EAN różnych kartotek wymaga skanu jednoznacznego symbolu SKU.

Zbiórka i pakowanie mogą należeć do różnych osób.
Zmianę osoby podczas rozpoczętej pracy wykonuje biuro przez jawne przejęcie z podaniem powodu.
Przejęcie przypisuje etap do konta wykonującego tę czynność.

Zamówienie można wstrzymać z opisem problemu.
Anulowanie pobranego zamówienia wymaga odłożenia sztuk na źródłowe lokalizacje.
Odłożenie wymaga skanu lokalizacji i towaru.
Kontrola pakowania zostaje wtedy wyzerowana, ponieważ zawartość paczki została naruszona.

### Przerwanie połączenia

Zapas zmienia się dopiero po zatwierdzeniu przez serwer.
Nierozstrzygnięta odpowiedź zachowuje klucz operacji w tej samej karcie przeglądarki.
Po odświeżeniu strony naciśnij **Ponów poprzednią operację**.
Serwer odtworzy pierwotny wynik, bez ponownego pobrania towaru.
Nie zamykaj karty przed wyjaśnieniem nierozstrzygniętej operacji.

WMS w przeglądarce wymaga połączenia z API.
Trwały bufor Androida nadal obsługuje wcześniejsze operacje kolektora.
Nowe operacje WMS nie zostały dodane do natywnych ekranów Androida.

Po zapisie formularz pozostaje zablokowany, aż pojawi się aktualny stan.
Następny skan wykonaj po powrocie kursora do pola skanowania.
Jeżeli odczyt zawiedzie, **Ponów odczyt** przywraca formularz bez ponawiania zatwierdzonego ruchu.

### Kompletacja kilku zamówień wózkiem

**Wózki 20 / 30** rozpoczynają zbiórkę skanem stałego kodu wózka.
Biuro rejestruje 20 albo 30 numerowanych pozycji oraz indywidualne kody skrzynek.
WMS automatycznie przydziela jedno gotowe zamówienie do każdej dostępnej skrzynki.
Kolejność wynika z priorytetu, terminu wysyłki i identyfikatora zamówienia.
Zamówienia z brakami lub blokadami nie zatrzymują przydziału dalszych gotowych zamówień.
Nie trzeba czekać na pełny wózek; niewykorzystane pozycje pozostają wolne.

Profil może obejmować wszystkie zamówienia, jedno SKU albo wiele SKU, z limitem sztuk.
Limit sztuk nie zastępuje sprawdzonych wymiarów części, skrzynek i udźwigu wózka.
Nie stosujemy automatycznego dopasowania gabarytów bez danych pomiarowych.

Duży numer wskazuje stałą pozycję odkładania.
Ekran sumuje pozostałą ilość wspólnego SKU w tej samej lokalizacji.
Pierwsze odłożenie wymaga skanu lokalizacji, towaru i skrzynki.
Kolejne skrzynki tego przystanku wymagają własnego kodu i potwierdzenia ilości.
Odświeżenie ekranu ponownie wymaga lokalizacji i towaru.
**Kolejność lokalizacji** pozwala zapisać kolejność przejścia właściwą dla hali.
Jest to skonfigurowana trasa; system nie wylicza najkrótszej drogi bez planu regałów.

Ponowny skan wózka przywraca otwartą trasę tego samego operatora.
Biuro może jawnie przejąć całą zbiórkę, podając powód.
Zmiana osoby pakującej pozostaje osobną operacją zamówienia.

Po zbiórce zeskanuj wózek oraz stanowisko pakowania.
**Pakowanie skrzynek** otwiera zamówienie po skanie stanowiska i skrzynki.
Nie można rozpocząć pakowania skrzynki, która nie została przekazana.
Można odłączyć pojedynczą skrzynkę na stanowisko, zachowując jej zamówienie.
Po odłączeniu pozycja wymaga nowej pustej skrzynki przed kolejną trasą.
Zwolnienie pustego wózka wymaga osobnego skanu; niezakończone zamówienia muszą wcześniej opuścić wózek.
Pełną skrzynkę można wymienić po skanach obu kodów i potwierdzeniu przełożenia zawartości.
Numer pozycji pozostaje stały; historia wymiany trafia do dziennika.

**Zbiórka ręczna → Przygotuj wózek** zachowuje starszy wybór od 1 do 12 zamówień.
To osobna metoda pracy; nie zastępuje automatycznego przydziału do zarejestrowanych wózków.
Rozpoczęcie przypisuje wszystkie zamówienia razem albo wycofuje całą operację, jeżeli ktoś zdążył przejąć zamówienie lub pojemnik.
Trasa uwzględnia skonfigurowaną kolejność lokalizacji, następnie SKU i zamówienia.
Stosuj kody o stałej szerokości, np. `A01-02-03`, aby kolejność odpowiadała układowi magazynu.
Każde pobranie wymaga skanu lokalizacji, towaru i docelowego pojemnika.
Enter przechodzi między polami; ostatni skan zatwierdza sztuki.
Wstrzymane zamówienia pozostają widoczne, a pozostałą trasę można dokończyć.
Po zakończeniu pojemniki trafiają do tej samej niezależnej kontroli pakowania co zwykła zbiórka.
Biuro może przejąć pojedyncze zamówienie w jego karcie; skan pojemnika nadal jest wymagany.

### Braki, przeliczenia i uzupełnienia

Na trasie można zgłosić brak, uszkodzenie albo pełną skrzynkę.
Brak i uszkodzenie blokują pobrania danego SKU z tej półki do przeliczenia.
Samo zgłoszenie nie zmienia zapasu ani nie zamyka zamówienia.

**Zadania zapasu** pokazują otwarte przeliczenia i plan uzupełnień z zaplecza.
Plan wynika z minimów półek oraz niezarezerwowanego zapotrzebowania otwartych zamówień.
Nie jest prognozą sezonową; nie wykorzystuje importowanego raportu Sellasist.
Otwieranie listy nie tworzy zadań i nie przesuwa sztuk.

Operator przyjmuje zadanie, następnie skanuje źródło, towar i cel oraz potwierdza przydzieloną ilość.
Druga osoba nie może zakończyć tego samego zadania.
Zmiana zapasu źródła może wymagać anulowania zadania i przygotowania aktualnego planu.
Przed anulowaniem towar musi fizycznie pozostać na źródle.
Zwykłe pobranie z półki docelowej nie blokuje addytywnego uzupełnienia.

Biuro przelicza sprawne sztuki fizycznie na półce, bez towaru znajdującego się w skrzynkach.
Odczyt wersji chroni przed zapisaniem nieaktualnego spisu.
Przed przeliczeniem trzeba rozliczyć otwarte zadania uzupełnień danej lokalizacji i SKU.
System zwalnia niezebrane rezerwacje tej półki, zapisuje stan i odbudowuje przydziały według priorytetu.
Zamówienia bez wystarczającego zapasu pozostają wstrzymane.
Po uzupełnieniu biuro naprawia rezerwację lub rozwiązuje zgłoszenie wózka.
Przeliczenie półki nie potwierdza zawartości skrzynki.
Anulowanie zebranego zamówienia nadal wymaga wcześniejszych skanów zwrotu wszystkich pobrań.

## Integracja sklepu i wysyłki

Zamówienia można tworzyć, zmieniać i importować bezpośrednio w WMS.
Przebieg od rezerwacji do wysyłki nie wykonuje połączeń z platformą pośrednią.
Odbiór korzysta z lokalnego katalogu seeded i przykładowych numerów przesyłek.

API używa istniejącej sesji w nagłówku `x-session`.
Każdy zapis wymaga `Idempotency-Key`: 16–100 znaków ASCII, liter, cyfr, podkreśleń lub myślników.
Klucz musi pozostać taki sam przy ponowieniu tego samego żądania.
Nowa operacja wymaga nowego klucza.

| Trasa | Przeznaczenie |
|---|---|
| `POST /api/wms/orders` | Pojedyncze zamówienie |
| `POST /api/wms/import` | Partia zamówień |
| `GET /api/wms/orders?status=new&limit=50&offset=0` | Kolejka |
| `GET /api/wms/orders/:id` | Pozycje, przydziały, etap i wersja |
| `POST /api/wms/orders/:id/actions` | Rezerwacja, skany, pakowanie i wysyłka |
| `POST /api/wms/release` | Rezerwacja partii wskazanych numerów i wersji |
| `GET /api/wms/inventory?q=SKU` | Zapas i wersje lokalizacji |
| `POST /api/wms/inventory` | Przyjęcie, spis, minimum lub przesunięcie |
| `POST /api/wms/inventory/preview` | Podgląd dokumentu stanów; wyłącznie odczyt |
| `POST /api/wms/inventory/import` | Atomowy zapis dokumentu przyjęcia lub spisu |
| `GET /api/wms/shipments?after=0` | Eksport wysyłek z trwałym kursorem |
| `GET /api/wms/analytics?days=30` | Metryki operacyjne |
| `GET /api/wms/analytics/csv?days=30` | Dzienne wysyłki do arkusza |
| `GET /api/wms/movements?twId=123` | Ostatnie ruchy; starsze przez `before=id` |
| `GET/POST /api/wms/bins` | Lista i przeznaczenie lokalizacji |
| `GET/POST /api/wms/waves` | Własne otwarte wózki i atomowe rozpoczęcie trasy |
| `GET /api/wms/waves/:id` | Zamówienia, pojemniki i uporządkowana trasa |
| `POST /api/wms/waves/:id/pick` | Kontrola pojemnika i pobranie na wózku |
| `GET /api/wms/integrity` | Zgodność dziennika i rezerwacji |
| `GET /api/wms/reconciliation` | Różnice względem Subiekta |
| `GET /api/wms/dispatch?day=2026-09-11&q=DEMO` | Rejestr paczek z wyszukiwaniem i stronicowaniem |
| `GET /api/wms/dispatch/csv?day=2026-09-11&q=DEMO` | Cały przefiltrowany rejestr dzienny w CSV |

Przykładowa czynność: `{"action":"allocate","version":1}`.
Odpowiedź zawiera nową wersję zamówienia.
Konflikt `409` wymaga odczytania aktualnego stanu przed nową decyzją.
Przy błędzie sieci najpierw ponów pierwotne żądanie z pierwotnym kluczem.

Podgląd dokumentu stanów przyjmuje `reference`, `mode` (`receive` albo `count`) i tablicę `rows`.
Każdy wiersz zawiera `sku`, `bin` i `quantity`.
Zapis wymaga dodatkowo `version` z podglądu przy każdym wierszu, bez pozostałych pól informacyjnych.
Jeśli podgląd zwrócił `completed`, identyczny dokument został już zapisany.
Obie trasy wymagają uprawnień biura. Podgląd nie wymaga klucza ponowienia.

Eksporter wysyłek zwraca do 100 rekordów oraz `next`.
Integrator zapisuje ten kursor dopiero po obsłużeniu całej odpowiedzi.
W demonstracji używamy przykładowych numerów przesyłek.
Rzeczywisty numer przed przekazaniem fizycznej paczki musi pochodzić od przewoźnika.
Jedno zamówienie może mieć do 20 paczek, każda z osobnym numerem i masą.
Wszystkie paczki zamówienia zatwierdzają się razem.
WMS nie kupuje etykiet ani nie przesyła automatycznie dokumentów wydania do Subiekta.
Nie przechowuje adresów odbiorców w nowych tabelach realizacji.

## Rejestr paczek

Biuro otwiera **Rejestr paczek**, wybiera dzień UTC i skanuje numer przesyłki.
Wyszukiwanie obejmuje także zamówienie, kanał i przewoźnika.
Każda paczka ma własny wiersz; liczniki pokazują paczki, zamówienia oraz masę.
Przycisk z numerem zamówienia otwiera jego kartę i listę pakową do wydruku.

Eksport CSV obejmuje cały filtr, niezależnie od strony na ekranie.
Limit wynosi 30000 paczek; większy zbiór wymaga zawężenia wyszukiwania.
Formuły arkusza w tekstowych numerach są neutralizowane.
Odczyt oraz eksport nie zmieniają zamówień ani stanów.

## Analityka

Raport wózków pokazuje wykorzystanie pozycji, przydzielone zamówienia, przystanki lokalizacja/SKU oraz potwierdzone pobrania.
Przebieg liczony jest od przydziału do przekazania i obejmuje postoje oraz oczekiwanie.
Pobrane sztuki obejmują także ponowne pobrania po zwrocie.
Historia skrzynek pozwala odróżnić fizyczne odłączenie od zakończenia zamówienia.

Raport główny oddziela oczekiwanie na pakowanie od zarejestrowanej sesji pakowania.
Sesja zaczyna się przy otwarciu pakowania, a kończy potwierdzeniem ostatniej wymaganej sztuki.
Może obejmować przerwy; nie jest rozliczeniem roboczogodzin pracownika.
Stare zamówienia bez zdarzeń pozostają bez pomiaru.
System nie zastępuje brakujących timestampów umowną jedną minutą.

Raport obejmuje wysyłki, terminowość, czas realizacji, czas zbiórki z oczekiwaniem oraz oczekiwanie na kontrolę paczki.
Pokazuje kolejkę według etapów, zaległości, zapas dostępny, rezerwacje i lokalizacje poniżej minimum.
Uwzględnia kanały sprzedaży, najczęściej wysyłane części, ruchy, rozbieżności spisów oraz zatwierdzone pobrania według osoby.
Nie utożsamia liczby skanów z czasem pracy pracownika.
Uprawnienia do raportów mają biuro i administrator.

Okres obejmuje ostatnie 1–90 dni. Dzienne koszyki są oznaczone jako UTC.
Pierwszy i ostatni dzień mogą obejmować część dnia.
Brak wysyłek daje pusty wskaźnik terminowości, a nie pozorne 100%.
Odczyt raportu nie zmienia stanów ani zamówień.

## Kopie i odtworzenie

Plik bazy musi znajdować się na lokalnym dysku serwera.
API oraz worker korzystają z tego samego pliku i mechanizmu WAL.
Kopiowanie samego pliku `.db` podczas pracy nie zastępuje kopii SQLite.

```powershell
npm run wms:backup -- 'C:\wertis\server\data\wertis.db' 'D:\kopie\wertis-2026-09-10.db'
```

Polecenie używa mechanizmu kopii SQLite, sprawdza spójność oraz tworzy manifest SHA-256.
Nie nadpisuje istniejącego celu.
Kopia obejmuje całą bazę aplikacji, w tym wcześniejsze moduły.
Zdjęcia, konfiguracja i pliki innych usług wymagają osobnej kopii według `DEPLOY.md`.

Odtworzenie do nowego pliku:

```powershell
npm run wms:backup -- 'D:\kopie\wertis-2026-09-10.db' 'C:\wertis\odtworzone\wertis.db'
```

Przed przełączeniem zatrzymaj API i wszystkie workery.
Zachowaj dotychczasową bazę, zmień `DB_PATH`, uruchom API, następnie workery.
Sprawdź `/api/health`, zgodność WMS oraz różnice względem Subiekta.
Po odtworzeniu uzgodnij fizyczne operacje wykonane później niż kopia.

## Dowody lokalnej weryfikacji

```powershell
npm run test:wms
npx playwright install chromium
npm run test:wms:e2e
npm run test:wms:capacity
```

Test przeglądarki używa prawdziwego API i osobnej bazy.
Sprawdza cały przebieg, zły kod, utratę odpowiedzi, odświeżenie, przyjęcie i widok 390 px.
Sprawdza także historię zapasu, konfigurację kwarantanny i trasę dwóch zamówień z odrzuceniem złego pojemnika.
Zrzuty oraz wyniki zapisuje w `.wms-artifacts`.
Test usług sprawdza także wyścig dwóch procesów oraz kopię i odtworzenie bazy.

Telefon przełącza wybrane zamówienie w skupiony widok skanowania.
Przy 390 × 844 px potwierdzenie pobrania mieści się bez przewijania.
Przycisk **Pokaż kolejkę** przywraca filtry i pozostałe zamówienia.

Pomiar wersji 0.285.0: 5000 SKU, 1500 zamówień po trzy pozycje i 16 równoległych klientów.
16650 żądań ukończyło pracę w 80,92 s. Opóźnienie p95 wyniosło 95,63 ms.
Stan i rezerwacje zgodziły się z dziennikiem po wszystkich wysyłkach.
Sprzęt: Windows, Ryzen 7 7730U, Node 24.15.0, SQLite 3.51.3.
Pomiar dotyczy localhost oraz syntetycznych danych. Nie obejmuje usług przewoźników, Subiekta i fizycznych urządzeń.

Opcja `npm run test:wms:capacity -- --history` dodaje 90 dni danych raportowych.
Pełniejsza próba: `npm run test:wms:capacity -- --history --ledger-history`.
Obejmuje 136500 zamówień, 409500 pozycji, 1229000 ruchów i 1506501 zdarzeń audytu.
Raport 90-dniowy zajął 1331 ms, a 30-dniowy 428 ms. Kontrola dziennika zakończyła się poprawnie w 995 ms.
Historyczne rekordy są osobnymi danymi testowymi; właściwe operacje zapisu sprawdza wcześniejszy przebieg 1500 zamówień.

Zakres tego odbioru kończy się na danych seeded.
Rzeczywiste kanały sprzedaży, usługi przewoźników, sprzęt i dokumenty ERP pozostają osobnym etapem wdrożenia.
## Przyjęcia i odkładanie

Obszar **Przyjęcia** prowadzi dostawę do fizycznego zapasu WMS. Biuro tworzy
dokument z unikalnym numerem, dostawcą oraz oczekiwanymi pozycjami `SKU;ilość`.
Można wkleić dwie kolumny z arkusza, do 5000 SKU. Numer musi być unikalny
także między dostawcami, np. `DOSTAWCA/2026/123`.

Magazynier otwiera dokument i skanuje produkt. Zdjęcie pomaga rozpoznać część.
Wpisuje odłożoną ilość i skanuje istniejącą lokalizację. Potwierdzenie tworzy ruch
i aktualizuje przyjęcie w jednej transakcji. Towar na kompletacji staje się dostępny,
a odłożony na zapleczu wymaga uzupełnienia. Sam dokument nie dodaje zapasu.

Uszkodzony towar wymaga kwarantanny i opisu. Nadwyżkę zatwierdza biuro z powodem.
Częściową dostawę można pozostawić otwartą; zamknięcie z brakiem wymaga decyzji biura.
Przy błędzie sieci użyj **PONÓW**, zachowując tę samą operację.

Biuro może wycofać konkretne odłożenie w historii dokumentu, po skanie SKU,
lokalizacji i wpisaniu powodu. Korekta cofa całe wskazane odłożenie; następnie przyjmij
poprawną ilość. System zachowuje historię i chroni sztuki zarezerwowane dla zamówień.
Zamknięty dokument trzeba wcześniej otworzyć ponownie z uzasadnieniem.

Nie rejestruj tego samego dokumentu przez import w **Zapasach**. Wspólny numer
jest blokowany w obu kierunkach. Nie używaj innego numeru do obejścia tej kontroli.
Dotychczasowy obszar **Dostawy** obsługuje proces Subiekta; jego odłożenia nie zasilają
automatycznie WMS. Dla samodzielnego WMS używaj **Przyjęć**.

Demo zawiera oczekiwaną dostawę `DEMO-PZ-001`, jeszcze bez ruchów przyjęcia.
## Wydania kurierowi

Po kontroli pakowania zapisz numery i masy przygotowanych paczek. Zamówienie nadal
czeka na odbiór; skrzynka zbiórkowa jest już wolna. W **Wydaniach** otwórz
przekazanie dla przewoźnika i skanuj etykiety podczas fizycznego przekazywania.
Powtórzenie tego samego skanu nie dodaje drugiej paczki.

Usuń z listy paczki, które zostają na hali. Przed zamknięciem potwierdź, że kurier
odebrał wszystkie paczki wskazane na liście. Dopiero odbiór całego zamówienia
ustawia stan **Wysłane**. Możesz pobrać pełną listę przekazania jako CSV.

Korektę numeru lub masy wykonuje biuro w kolejce paczek oczekujących.
Najpierw usuń paczkę z otwartego przekazania. Poprzednia etykieta pozostaje w historii.
Korekta zmienia ewidencję WMS; nie kupuje ani nie anuluje etykiety u przewoźnika.

Gdy trzeba otworzyć paczkę i sprawdzić zawartość, użyj **Wycofaj paczki do ponownej kontroli**
w zamówieniu. Usuń stare etykiety, zeskanuj pojemnik poza wózkiem i wpisz powód.
Wszystkie paczki muszą pozostać w magazynie. Po zmianie zawartość wymaga ponownej kontroli.

Historia starsza od skanowanych odbiorów pozostaje oznaczona jako niepotwierdzona.
Wszystkie operacje i obecny odbiór funkcjonalny dotyczą danych seeded.

## Zawartość paczek

Kontrola zaczyna się od **Paczki 1**. Skanowany towar trafia do paczki wskazanej
nad polem skanera. Dla kolejnego kartonu wybierz następny numer przed skanowaniem.
Wybór pozostaje aktywny pomiędzy skanami. **Zawartość paczek** pokazuje SKU i ilości.

Przed zapisem etykiet można fizycznie przełożyć sprawdzone sztuki, używając
**Przełóż towar lub powtórz kontrolę**. Wskaż SKU, ilość, paczkę źródłową i docelową.
W razie niepewności rozpocznij całą kontrolę od nowa z podaniem powodu.
Zapas nie wraca wtedy automatycznie na półkę.

Po sprawdzeniu wszystkich sztuk formularz pokazuje etykietę i masę dla każdej paczki.
Używaj kolejnych numerów od 1. Nie można zapisać pustej paczki ani pominąć jej etykiety.
Zapisana zawartość pozostaje przy przesyłce także po korekcie lub wycofaniu etykiet.
Po częściowym odbiorze w magazynie pozostają tylko sztuki z nieodebranych paczek.

Historia sprzed tej funkcji nie ma automatycznie odtworzonej zawartości.
Stare, trwające pakowanie wielopaczkowe wymaga pełnego podziału lub ponownej kontroli.


## Przyjęcie do bufora i odkładanie

Przed skanowaniem pozycji wybierz **Do bufora — odkładanie później**. Policz towar i zeskanuj lokalizację zaplecza, np. **BUF-01** w demo.
Wybór pozostaje aktywny dla kolejnych pozycji. Uszkodzenia przyjmuj bezpośrednio do kwarantanny, z opisem.
Policzone sztuki są widoczne w zapasie, ale czekają na odłożenie. Zamknięcie dokumentu przyjęcia nie zamyka kolejki odkładania.

Otwórz **Odkładanie z bufora**, wybierz zadanie i podejmij je na swoje konto.
Zeskanuj bufor oraz część, potwierdź przenoszoną ilość, odłóż i zeskanuj półkę docelową.
Możesz odłożyć część ilości albo rozdzielić partię między półki. Każdy ruch zachowuje historię.
Kolejka pokazuje najstarszą pracę oraz pozostałe sztuki. Filtr pozwala znaleźć SKU, dokument lub bufor i wyświetlić własne zadania.

Po utracie odpowiedzi ponów tę samą operację. Nie wykonuj drugiego fizycznego odłożenia tylko dlatego, że odpowiedź nie dotarła.
Inna osoba nie może zakończyć podjętego zadania. Biuro przejmuje je na swoje konto z uzasadnieniem.

Brak policzonych sztuk rozlicza biuro przez **Brakuje policzonych sztuk — korekta**.
Korekta dotyczy wyłącznie pozostałej ilości w buforze; zamknięte przyjęcie trzeba najpierw otworzyć ponownie.
Uszkodzenie wykryte później wybierz w formularzu odkładania, podaj opis i zeskanuj kwarantannę.
Odłożone sztuki rozliczaj przez właściwy spis lub zwrot. Nie wycofuj całej pierwotnej partii przez historię bezpośrednich odłożeń.

Odkładanie chroni swoje ilości przed równoległym ruchem, spisem i uzupełnieniem. Samo podjęcie zadania nie zmienia fizycznego zapasu.
Zapas staje się dostępny do zbiórki po potwierdzeniu półki kompletacji. Odłożenie na zaplecze pozostawia go zapasem rezerwowym.

### Odkładanie na kolektorze Android

Na ekranie głównym wybierz **ODKŁADANIE WMS — Z BUFORA**. Zeskanuj SKU, EAN lub kod bufora; możesz też wpisać numer przyjęcia.
Wybierz wiersz, podejmij zadanie i wykonaj cztery kroki: bufor, część, policzona ilość, półka docelowa.
Potwierdzenie ilości jest osobnym krokiem. Skan półki zapisuje ruch; sygnał sukcesu oznacza potwierdzony zapis i świeży odczyt pozostałych sztuk.

Po częściowym odłożeniu ponownie zeskanuj bufor i część dla kolejnej partii. Po powrocie z tła lub odświeżeniu obowiązują te same kontrole.
W opcjach wybierz uszkodzony towar, potwierdź jego ilość i zeskanuj kwarantannę. Brakującą ilość zostaw w zadaniu i zgłoś biuru.
Przycisk powrotu do kolejki nie zwalnia przypisania na serwerze. Podjęte zadanie nadal pokazuje właściciela i można je wznowić.

Nieznany wynik blokuje zarówno zbiórkę, jak i odkładanie. Przycisk wskazuje właściwy proces; tam użyj **SPRAWDŹ OSTATNI ZAPIS**.
Nie przenoś towaru drugi raz. Zmiana konta lub serwera wymaga powrotu do pierwotnej tożsamości przed ponowieniem.
Natywne liczenie dostaw jest dostępne od 0.299.0. Oczekiwany dokument nadal przygotowuje biuro.

### Liczenie dostawy na kolektorze

Wybierz **PRZYJĘCIE WMS — POLICZ DOSTAWĘ**, wyszukaj dokument lub zeskanuj jego numer i otwórz przyjęcie.
Domyślnie liczysz do bufora. W opcjach możesz wybrać przyjęcie od razu na półkę; tryb pozostaje aktywny po restarcie.
Zeskanuj SKU lub EAN części. Policz faktycznie przyjmowane sztuki, potwierdź ilość i zeskanuj bufor lub półkę, na której je zostawiasz.

Sygnał sukcesu oznacza zapis i świeży odczyt licznika. Zeskanuj kolejną część albo tę samą dla następnej partii.
Ten sam kod po pełnym policzeniu pokazuje zakończoną pozycję i nie dopisuje zapasu. Zmiana trybu wymaga ponownego skanu części.
Uszkodzenia wybierz w opcjach, potwierdź ich ilość i zeskanuj kwarantannę. Nie są rejestrowane jako dobry towar czekający w buforze.

Nieznaną część, nadwyżkę lub kolizję EAN zgłoś biuru. Przy nieczytelnym albo wspólnym EAN wpisz w opcjach SKU odczytany z etykiety części.
Brakującą partię pozostaw nieprzyjętą. Biuro rozstrzyga zamknięcie z niedoborem; kolektor kończy dokument dopiero po rozliczeniu oczekiwanych sztuk.
Zamknięcie przyjęcia nie usuwa oczekującej pracy odkładania z bufora.

Po utracie odpowiedzi użyj **SPRAWDŹ OSTATNI ZAPIS**, bez ponownego fizycznego odkładania tej partii.
Przerwane liczenie blokuje zbiórkę i odkładanie do rozliczenia na pierwotnym koncie i serwerze. Restart nie tworzy nowego klucza zapisu.

### Analityka przepływu

W **Analityce** tabela **Gdzie czeka praca** pokazuje stan teraz, niezależnie od wybranego okresu.
Wybierz nazwę etapu, aby przejść do odpowiedniego obszaru. Bufor otwiera kolejkę wszystkich zadań, bez wcześniejszych filtrów.
Wiek dokumentu dostawy nie oznacza czasu od przyjazdu auta. Wiersze mają różne jednostki; nie sumuj dokumentów, zadań, zamówień i paczek.

Mediana i P95 opisują ukończone etapy w wybranym okresie. Tabela podaje liczbę pomiarów, brakujących zdarzeń oraz błędnych dat.
Okres kończy rezerwacja, zakończenie zbiórki, pakowania, wysyłka albo częściowe odłożenie. Nie trzeba czekać na wysyłkę, aby zobaczyć zakończone pakowanie.
Kreska oznacza brak pomiaru; zero oznacza zdarzenia zapisane w tej samej chwili. Czas obejmuje przerwy, nie mierzy roboczogodzin.

Potwierdzony odbiór wymaga wszystkich niewycofanych paczek. Historia samych etykiet zachowuje stare daty w dotychczasowych zestawieniach, z osobną informacją o pokryciu.
Czas bufora kończy każde częściowe odłożenie, bez korekt i kwarantanny. Cel na zapleczu nie oznacza dostępności do zbiórki.
Bez ewidencji partii nie przypisujemy konkretnej dostawy do konkretnego zamówienia klienta.

Przyjęcia pokazują przepływy brutto według daty zdarzenia. Wycofanie lub korekta może dotyczyć towaru przyjętego przed wybranym okresem.
Potwierdzone pobrania według osoby są operacjami, a nie liczbą fizycznych skanów.
Wysyłki dzienne i ich CSV używają dat Warszawy; skrajne dni obejmują część doby. Rejestr paczek zachowuje osobny, opisany filtr UTC.
**Eksportuj czasy etapów** pobiera pomiary w minutach oraz dokładny zakres UTC. Kolejki i eksporty nie podejmują ani nie zmieniają pracy.

Raport działa w osobnym wątku z bazą tylko do odczytu. Równoległe prośby o ten sam okres współdzielą trwające obliczenie.
Wynik nie jest zachowywany jako pamięć podręczna. Limit czterech okresów i 45 sekund chroni API przed narastającą kolejką raportów.

### Brak części na półce podczas zbiórki

Potwierdź osobno sztuki już odłożone do skrzynki. Następnie wybierz **Brak**, opisz sytuację i zeskanuj skrzynkę.
WMS blokuje pobrania tego SKU z podejrzanej półki i sprawdza wolny zapas na innych półkach kompletacji.
Zgłoszenie nie zmniejsza fizycznego stanu. Półka pozostaje w **Zadaniach zapasu → Półki do przeliczenia**.

System sprawdza również inne zamówienia z niezebranym przydziałem tego SKU na tej półce. Najpierw obsługuje priorytet, następnie termin i numer zamówienia.
Zapas już zarezerwowany innym zamówieniom, zaplecze, kwarantanna i zablokowane półki nie są źródłem zastępczym.
Niezależne wstrzymania pozostają do decyzji biura. Skrzynka, pozycja na wózku, właściciel oraz potwierdzone pobrania nie zmieniają się.

Jeżeli wystarczy zapasu, trasa prowadzi do nowej półki. Zeskanuj jej kod i część przed następnym pobraniem do skrzynki.
Jeżeli brakuje choć części potrzebnego przydziału, jego próba zostaje wycofana. Dotychczasowy przydział pozostaje zablokowany do wyjaśnienia.
Uszkodzenie i pełna skrzynka nadal wymagają dotychczasowego rozstrzygnięcia; nie powodują automatycznego wznowienia.

Inny kolektor może mieć otwarty stary przydział. Jego nieaktualny skan zostanie odrzucony, a trasa odczytana ponownie.
Po komunikacie **Tego pobrania nie zapisano** odłóż tylko niepotwierdzone sztuki na wskazane źródło. Zachowaj wcześniej potwierdzoną zawartość skrzynki.
Po utracie odpowiedzi ponów tę samą operację. WMS odtworzy wynik bez ponownego przekierowania lub zmiany zapasu.


### Przeliczenie półki z kolektora

Na kolektorze wybierz **PRZELICZENIA WMS — SPRAWDŹ PÓŁKĘ**. Skan półki lub części filtruje kolejkę po 50 zadań.
Wybierz zadanie, zeskanuj jego półkę i SKU albo EAN. Policz sprawne sztuki fizycznie na półce, bez zawartości skrzynek.
Wpisz rzeczywistą ilość; pole zaczyna puste. Pusta półka wymaga jawnego wpisania **0**. Ekran nie pokazuje stanu oczekiwanego.
Uszkodzenia pozostaw oddzielnie do wyjaśnienia z biurem. Nie przesuwaj zapasu podczas liczenia.

**WYŚLIJ WYNIK DO BIURA** zapisuje obserwację. Nie zmienia stanu, rezerwacji ani blokady półki.
Druga osoba nie może przykryć wyniku oczekującego na decyzję. Możesz przejść do kolejnego zadania.
Po utracie odpowiedzi wybierz **SPRAWDŹ OSTATNI ZAPIS**. Restart zachowuje klucz, konto i serwer.
Nierozliczona operacja blokuje inne procesy WMS. Powrót z tła i odświeżenie wymagają nowych skanów.

W biurze otwórz **Zadania zapasu → SPRAWDŹ WYNIK LICZENIA**.
Widzisz ilość operatora, autora, czas oraz bieżący stan. Zatwierdź wynik z uzasadnieniem albo zleć ponowne liczenie.
Nie edytujesz ilości przesłanej przez operatora. Powód ponownego liczenia pojawi się na kolektorze; poprzedni wynik pozostaje w historii.
Zmiana wersji zapasu od liczenia blokuje akceptację i wymaga ponownego liczenia. Najpierw rozlicz także otwarte uzupełnienie tej półki.
Akceptacja koryguje stan i odbudowuje rezerwacje w jednej transakcji. Zgłoszenia zawartości skrzynek wymagają osobnego wyjaśnienia.


### Przerwa i powrót do kolektora

Zablokowanie urządzenia, wyjście z aplikacji lub przejście na inny ekran odbiera prawo wykonywania kolejnych skanów WMS.
Nie skanuj następnej części podczas przerwy. Po powrocie poczekaj na świeży stan i rozpocznij wskazaną sekwencję skanów.
Wynik już rozpoczętego zapisu może zostać potwierdzony w tle. Nie oznacza to utraty operacji.
Gdy odpowiedź pozostaje nieznana, wybierz **SPRAWDŹ OSTATNI ZAPIS**. Nie czyść danych kolektora ani nie twórz drugiej operacji.


### Uzupełnianie zaplecze → półka na kolektorze

**UZUPEŁNIENIA WMS** pokazują własne zadania oraz propozycje wynikające z minimów i niezarezerwowanego popytu.
Kolejka pokazuje po 50 pozycji. Można skanować lub wpisać SKU, EAN albo lokalizację.
Podjęcie propozycji zabezpiecza dostępne sztuki zaplecza. Nie zmienia jeszcze fizycznego zapasu.

1. Zeskanuj źródło zaplecza i kod części.
2. Potwierdź faktycznie pobraną ilość, nie większą od przydziału.
3. Odłóż towar na wskazanej półce kompletacji i zeskanuj jej kod.

Mniejsza ilość wymaga opisu braku. Potwierdzenie przesuwa wyłącznie znalezione sztuki i zamyka cały przydział.
Źródło tego SKU zostaje zablokowane do przeliczenia. Brakujące sztuki nie są automatycznie odpisywane ze stanu.
Dla zera zeskanuj etykietę źródła i kod części, wpisz opis oraz wybierz **ZGŁOŚ PUSTE ŹRÓDŁO**.
Nie trzeba iść do pustego celu: nie powstaje żaden ruch zapasu.

**PROBLEM / ANULOWANIE** wymaga odłożenia wszystkich niepotwierdzonych sztuk na źródło, opisu i skanu źródła.
Jeśli inni operatorzy mają przydziały tego SKU z zablokowanego źródła, muszą je najpierw zwrócić i anulować.
Dopiero wtedy można policzyć źródło i zatwierdzić wynik w biurze.

Utrata odpowiedzi nie wymaga ponownego podjęcia. **PONÓW ZAPIS** odzyskuje pierwotny numer zadania i wynik tym samym kluczem.
Wspólny dziennik blokuje inne procesy WMS do wyjaśnienia wyniku. Powrót po pauzie wymaga świeżego odczytu i skanów.
Biuro udostępnia częściową ilość, zgłoszenie pustego źródła i anulowanie w **Zadaniach zapasu**.


### Pojemność półki i pełny cel

W **Zapasach** wybierz wiersz części i lokalizacji, następnie **Minimum i pojemność**.
Pojemność oznacza sztuki konkretnego SKU w tym miejscu. Nie jest sumą gabarytów wszystkich części ani automatycznym pomiarem regału.
Puste pole pozostawia limit nieustalony. Zero zatrzymuje nowe odłożenia; minimum nie może być większe od pojemności.

Miejsce zajmuje fizyczny stan oraz przydzielone uzupełnienia. Rezerwacja zamówienia nadal leży na półce; miejsce zwalnia dopiero pobranie.
Plan uzupełnia najwyżej dostępne miejsce, nawet gdy popyt zamówień jest większy.
Pełny cel oddaje potrzebę innym dozwolonym półkom części. Minima i już przydzielone dostawy pokrywają popyt przed planowaniem pozostałej ilości.
Ten sam limit chroni bezpośrednie przyjęcie, odkładanie z bufora i ręczne przesunięcie.
Odmowa celu wycofuje również wcześniejszą zmianę źródła. Przy odkładaniu można odczytać zadanie i wybrać inną właściwą półkę.

Spis zapisuje rzeczywiście policzony stan, także ponad limitem. Tabela pokazuje przekroczenie i blokuje kolejne dokładanie.
Spis źródła i celu czeka na rozliczenie otwartego uzupełnienia, aby nie policzyć dwa razy części będących w drodze.

Na kolektorze, po potwierdzeniu pobranej ilości, użyj **BRAK MIEJSCA NA CELU**, jeśli część towaru nie mieści się na półce.

1. Wpisz liczbę sztuk pozostawionych na celu, także zero, oraz opis braku miejsca.
2. Zeskanuj wskazany cel.
3. Zwróć pozostałe pobrane sztuki na źródło i zeskanuj źródło.

Dopiero ostatni skan rozlicza ruch. Historia zadania rozdziela odłożenie, zwrot oraz ewentualny brak na źródle.
Przykład: przydzielono cztery, pobrano cztery, odłożono dwie i zwrócono dwie. Nie powstaje zgłoszenie braku na źródle.
Jeżeli znaleziono tylko dwie, odłożono jedną i zwrócono jedną, źródło wymaga przeliczenia dwóch brakujących sztuk.

Pełny cel trafia do **Zadań zapasu → Brak miejsca na dokładanie** i osobnej kolejki analityki.
Zbiórka pozostaje dostępna. Biuro po sprawdzeniu miejsca skanuje lokalizację i uzasadnia odblokowanie dokładania; limit oraz historia pozostają.
Biuro ma także formularz **Cel pełny — odłożenie i zwrot reszty** do tego samego rozliczenia.
Po przerwie przed zapisem wróć z wszystkimi niepotwierdzonymi sztukami z celu i wózka na źródło, zanim rozpoczniesz ponownie.
Nieznany wynik już wysłanej operacji rozlicz przez ponowienie, bez powtarzania fizycznego ruchu.


### Kolejność uzupełnień

Propozycje z brakami zamówień wyprzedzają rutynowe minima półek. Kolejność uwzględnia priorytet zamówienia, potem termin wysyłki.
Wolny zapas i otwarte uzupełnienia pokrywają najpierw pilniejsze potrzeby tego SKU. Już pokryte zamówienie nie podnosi pilności pozostałych braków.
Biuro i kolektor pokazują powód: zamówienia albo minimum półki. Liczba brakujących sztuk dotyczy całego SKU, nie pojedynczego celu.
Jedno uzupełnienie może pokryć tylko część potrzeby. Nie obiecuje gotowości całego zamówienia, które może czekać na inne części.
Odczyt propozycji nie rezerwuje zapasu; dopiero podjęcie zadania zabezpiecza jego sztuki.


### Korekta pojedynczej kontroli pakowania

W sekcji **Popraw zawartość lub kontrolę** można cofnąć potwierdzenie wybranych sztuk z konkretnej paczki.
Zeskanuj część, wpisz numer paczki, ilość i powód. Pozostałe potwierdzenia zostają; wskazane sztuki wymagają ponownego skanu.
Towar pozostaje przy stanowisku. Operacja nie zwraca go na półkę ani nie rozlicza braku lub uszkodzenia; taki problem wymaga wstrzymania zamówienia.
Przygotowanie etykiet czeka na ponowne potwierdzenie wszystkich sztuk. Gotowych etykiet nie można zmieniać tą korektą.
Po utracie odpowiedzi użyj **PONÓW**. Powtórzenie odzyskuje wynik tej samej korekty, bez kolejnego odejmowania.


### Miejsce przy przyjęciu i odkładaniu

Podpowiedzi pomijają pełne półki, kwarantannę i otwarte blokady. Najpierw pokazują kompletację, potem zaplecze, do ośmiu znanych adresów.
Ilość „do … szt.” uwzględnia zapas fizyczny oraz przydzielone uzupełnienia. „Sprawdź miejsce” oznacza brak zapisanego limitu.
Na kolektorze podpowiedź jest widoczna przed wpisaniem ilości. Policz tylko partię odkładaną teraz; reszta zadania pozostaje w buforze.
Podpowiedź pochodzi z ostatniego odczytu i nie rezerwuje półki. Zapis ponownie sprawdza miejsce i blokady.
Brak podpowiedzi nie oznacza zakazu innych zarejestrowanych lokalizacji. Sprawdź fizyczne miejsce i zeskanuj właściwy cel.


### Ilość w przeglądarce

Przy przyjęciu, odkładaniu, korekcie bufora i uzupełnieniu wpisz ilość fizycznie obsługiwanej partii. Puste pole nie oznacza jednej sztuki ani całego planu.
Enter nie przejdzie dalej bez poprawnej liczby. Uzupełnienie wymaga powodu przy braku sztuk, a dopiero potem skanu półki docelowej.
Zmiana ilości uzupełnienia usuwa poprzedni skan celu. Zmiana stanu dobry/uszkodzony usuwa ilość i lokalizację z poprzedniej partii.
W ręcznych ruchach zmiana czynności czyści pola do ponownego wpisania, bez zapisu zera do zapasu.
Spis oznacza cały fizyczny stan półki. Zero trzeba wpisać jawnie; przyjęcie i przesunięcie wymagają dodatniej ilości.


### Wielkość partii uzupełnienia

Pełną propozycję podejmiesz jednym naciśnięciem. Dla mniejszego przejścia wybierz „Mniejsza partia” i wpisz ilość przed podjęciem.
Po podjęciu policz faktycznie pobrane sztuki. Cała wybrana partia nie wymaga opisu braku; mniejsza faktyczna ilość oznacza rozbieżność źródła.
Przykład: potrzeba dwudziestu, planujesz pięć i odkładasz pięć. Pozostałe piętnaście wraca do planu, a źródło nie wymaga przeliczenia.
Jeśli po podjęciu pięciu znajdziesz tylko trzy, opisz brak dwóch. Pełny cel ma osobną opcję odłożenia i zwrotu.
Wybór partii nie określa masy ani bezpieczeństwa transportu. Uwzględnij rzeczywiste części, sposób przenoszenia i warunki magazynu.
