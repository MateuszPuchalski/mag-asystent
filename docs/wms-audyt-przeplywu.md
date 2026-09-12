# Audyt przepływu: przyjęcie → wysyłka

Punkt wyjścia: `7c91a8a`, WMS 0.288.0. Magazyn 20 × 20 m, 5000 SKU,
docelowo 1500 zamówień dziennie. Praca i weryfikacja wyłącznie na danych seeded.
Poprzedni etap był postępem: wdrożył zdjęcia części i zweryfikował zbiórkę.
Nie stanowi to dowodu ukończenia całego audytu procesów.

## Zakres celu i wymagane dowody

| Obszar | Co ma być udowodnione | Stan audytu |
|---|---|---|
| Przyjęcie | Właściwy produkt i ilość, częściowe dostawy, nadwyżki, uszkodzenia, duplikat dokumentu, ponowienie skanu | Bezpośrednie przyjęcie WMS zweryfikowano testami, włącznie z korektą i utratą odpowiedzi. Bufor z kolejką odkładania wdrożono; natywny kolektor przyjęć pozostaje otwarty. |
| Odkładanie | Towar staje się dostępny dopiero we właściwej lokalizacji; nowy SKU i brak miejsca mają obsługę | Bezpośrednie odłożenie obsługuje nowy SKU na zarejestrowanej półce. Plan uzupełnień nadal wymaga istniejącego miejsca kompletacji. |
| Uzupełnienia | Praca nie ginie po przyjęciu; przydzielone sztuki nie mogą zostać zabrane innym ruchem | Odtworzono i naprawiono oba błędy. Testy regresji opisano niżej. |
| Rezerwacje i zbiórka | Priorytet, brak, pełna skrzynka, przerwanie pracy, współbieżność, zdjęcie i właściwa skrzynka | Istnieją testy wózków 20/30. Potrzebny dalszy przegląd zmian i anulowań zamówień podczas pracy. |
| Pakowanie i wysyłka | Właściwa zawartość, wielopaczkowość, poprawki etykiety, błędny przewoźnik, przekazanie kurierowi | Oddzielono paczkę gotową od odbioru kuriera. Skan zapisuje podział SKU na paczki; częściowy odbiór odejmuje tylko ich zawartość. Historia bez podziału pozostaje oznaczona. |
| UI/UX i uproszczenia | Mniej zbędnych decyzji, poprawna kolejność skanów, zachowana orientacja i odzyskiwanie po błędzie | Usunięto dodatkowe otwieranie przyjętego zadania uzupełnienia; dalszy przegląd całej ścieżki pozostaje otwarty. |
| Analityka i skala | Czas od przyjęcia do dostępności, blokady i wiek zadań; skala z historią i współbieżnymi operatorami | Istnieją raporty WMS i testy przepustowości. Pełna zgodność z zakresem wymaga dalszego pomiaru. |
| Utrzymanie | Aktualizacja, kopia i odtworzenie, role, dziennik, awaria sieci, restart procesu | Dotychczasowe testy są punktem wyjścia; końcowy odbiór dotyczy finalnego kodu. |

## Źródła i wnioski projektowe

- [Microsoft: replenishment](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/replenishment)
  rozróżnia potrzeby wynikające z minimów oraz popytu. U nas oba powody muszą być widoczne
  i nie mogą generować pracy, która konkuruje o te same fizyczne sztuki.
- [Microsoft: mobile receiving](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/tasks/set-up-mobile-device-menu-item-register-received-items)
  łączy rejestrację przyjęcia z pracą odkładania. Sprawdzamy, czy przejście od dostawy do
  dostępnego zapasu ma u nas ciągłość i nie wymaga ponownego wpisywania informacji.
- [Microsoft: warehouse slotting](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/warehouse-slotting)
  opisuje planowanie miejsc kompletacji. Nie zastępujemy rzeczywistego planu regałów
  wymyśloną geometrią ani wymiarami części.
- [NN/g: recognition and recall](https://www.nngroup.com/articles/recognition-and-recall/)
  uzasadnia pozostawienie lokalizacji, zdjęcia, SKU i następnej czynności na ekranie.
- [NN/g: preventing slips](https://www.nngroup.com/articles/slips/)
  wspiera ograniczenia zapobiegające błędom. Przyjęcie pracy powinno prowadzić do jej
  pierwszego skanu bez ponownego szukania zadania na liście.

To wnioski projektowe zastosowane do naszego kodu, nie gwarancja optymalnej organizacji hali.

## Odtworzone przypadki

1. **Dostawa w czasie uzupełnienia.** Pracownik ma zadanie przeniesienia 4 sztuk.
   Dodatkowa sztuka przyjęta na zaplecze zmienia wersję stanu. W 0.288.0 zakończenie
   zadania wymagało anulowania i ponownego planowania mimo wystarczającego zapasu.
2. **Ręczne przesunięcie zabiera przydział.** Zaplecze ma 8 sztuk, z których 4 należą
   do zadania uzupełnienia. Ręczne przeniesienie 5 sztuk było dozwolone. Pracownik
   nie mógł już rozliczyć wcześniej przyjętej pracy.
3. **Dodatkowe otwieranie zadania.** Po przyjęciu uzupełnienia operator musiał znaleźć
   i otworzyć właśnie utworzone zadanie. Pierwszy skan nie był gotowy do użycia.
4. **Obejście blokady półki.** Ręczne przesunięcie omijało sprawdzenie otwartego
   przeliczenia, które obowiązywało zadania uzupełnień. Kontrola dotyczy teraz obu końców ruchu.
5. **Zmiana roli lokalizacji podczas pracy.** Zapas zaplecza z otwartym zadaniem
   można było zmienić na kompletację. Zmiana wymaga teraz zakończenia lub anulowania pracy.

## Poprawki i weryfikacja

`move` sprawdza również przydziały otwartych uzupełnień. Indeks po SKU i źródle
ogranicza koszt tej kontroli. Zwykłe przyjęcie i bezpieczne przesunięcie zachowują
aktualność przydzielonej pracy. Przeliczenie pozostaje osobnym przypadkiem wymagającym
weryfikacji. Zakończenie zadania zwalnia własny przydział i przesuwa towar w jednej
transakcji, zachowując ochronę pozostałych zadań.

Przyjęcie zadania otwiera jego formularz i ustawia fokus na źródle. Enter prowadzi
od źródła przez towar do półki. Usunięto jeden obowiązkowy klik przy każdym przydziale;
wpływ na czas pracy fizycznej wymaga pomiaru na hali.

Dwa testy odtworzyły błędy przed poprawką i przeszły po niej. Dodatkowy scenariusz
sprawdza dwa zadania z tego samego źródła, próbę przeliczenia poniżej przydziału
oraz awarię w środku przesunięcia. Ponowienie rozliczonej komendy nie przesuwa towaru drugi raz.
Test przeglądarki obejmuje automatyczne otwarcie i kolejność fokusu skanów.
Tabela zapasów pokazuje przydział do uzupełnień osobno od rezerwacji zamówień.

Weryfikacja 0.289.0: 2180 testów serwera, 727 testów panelu, oba sprawdzenia
TypeScript, kompilacja oraz test przeglądarkowy przeszły. Test skali zakończył
2000 zamówień przy 5000 SKU i 8 klientach: 12 258 żądań, p95 66,5 ms,
p99 120,4 ms, spójny dziennik stanów i rezerwacji. Przydział wózka miał
p95 392,1 ms. To pomiar lokalnego scenariusza syntetycznego, nie wydajności
pracowników ani odbiór obciążenia produkcyjnego z pełną historią.

Pełny cel pozostaje aktywny. Ta poprawka rozwiązuje część ustaleń; nie kończy audytu
przyjęć, odkładania, pakowania, wysyłek ani całego zakresu analityki.

## Następny przegląd: odłożenie dostawy

`server/src/services/delivery.ts:647` zapisuje ilość odłożoną, lokalizację i zdarzenie,
ale nie dodaje zapasu do `wms_stock`. WMS ma oddzielne przyjęcie dokumentowe.
Trzeba ustalić i przetestować jeden przepływ, który nie wymaga ponownego wpisywania
tego samego przyjęcia i nie podwaja zapasu podczas powtórzenia lub korekty odłożenia.
Dotychczasowe funkcje korekt i nadwyżek oraz bufor offline kolektora muszą być
uwzględnione przed połączeniem tych zapisów.

## Przyjęcia WMS — wynik kolejnego przeglądu

WMS ma teraz własny przepływ: dokument oczekiwany → skan SKU → ilość → skan
lokalizacji → ruch zapasu. Samo otwarcie dokumentu nie przyjmuje towaru.
Nie trzeba przepisywać odłożonej partii do tabeli Zapasów. Dotychczasowe Dostawy
pozostają procesem Subiekta; ich licznik odłożenia nie jest automatycznie dodawany do WMS.

To świadomy wybór bezpośredniego odłożenia, opisany również w
[Microsoft: receiving and putaway](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/configure-mobile-devices-warehouse).
Rejestracja na osobnej strefie przyjęcia i późniejszy transport pozostają innym procesem.
Nie udajemy, że dokument oczekiwany potwierdza fizyczny przyjazd dostawy.

Sprawdzone przypadki:

- Brak zapasu przed odłożeniem; częściowe partie pozostają na jednym dokumencie.
- Ten sam numer i treść wznawiają dokument. Zmieniona treść wymaga wyjaśnienia.
- Numer przyjęcia nie może być ponownie użyty w imporcie Zapasów; kontrola działa w obu kierunkach.
- Powtórzenie tej samej komendy odtwarza odpowiedź. Inny klucz z dawną wersją pozycji nie dodaje kolejnej partii.
- Różne SKU mogą rozliczać różni operatorzy. Wersja pozycji chroni równoległe liczenie tego samego SKU.
- Obcy SKU, niejednoznaczny EAN, obca pozycja dokumentu i nieznana półka nie tworzą ruchu.
- Uszkodzenie wymaga uzasadnienia i kwarantanny. Takie sztuki nie są dostępne do zbiórki.
- Nadwyżka wymaga biura i uzasadnienia. Zakończenie z niedoborem również wymaga decyzji biura.
- Przeliczana półka blokuje odłożenie; pracownik może wybrać inną zarejestrowaną lokalizację.
- Korekta zachowuje oryginalne odłożenie i dopisuje ruch przeciwny. Zarezerwowany zapas nie może zostać zabrany.
- Zamknięte przyjęcie wymaga jawnego ponownego otwarcia z powodem przed korektą lub kolejną partią.
- Awaria po ruchu wycofuje także licznik przyjęcia i zapis ponowienia.
- Dokument 5000 SKU można odczytać i rozliczyć poza pierwszą stroną listy.

Próba przeglądarki odtworzyła konflikt kolejności Enter z obsługą zbiórki.
Po naprawie Enter w polu półki potwierdza odłożenie. Utrata odpowiedzi po zapisie
została odtworzona przez przerwanie odpowiedzi HTTP; ponowienie nie podwoiło przyjęcia.
Na ekranie 390 × 844 zdjęcie, ilość, półka i potwierdzenie mieszczą się razem,
również przy komunikacie błędnej lokalizacji. Już zeskanowany SKU nie wymaga drugiego skanu.

Weryfikacja 0.290.0: pełne 2191 testów serwera i 727 testów panelu przeszło.
Testy przyjęć obejmują 5000 SKU w jednym dokumencie, bez tworzenia zapasu przed skanem.
Historia ma stronicowanie, a ruchy odłożenia i korekty są niezmienne.
Osobna próba 101 odłożeń sprawdziła przejście do starszych zapisów i korektę pierwszego ruchu.
Lokalny axe-core 4.13.0 nie zgłosił naruszeń wybranych reguł WCAG A/AA i 2.1 AA
na aktywnym formularzu przy 320, 390 i 1440 px. Nie stwierdzono przewijania całej strony w poziomie.

Dalszy zakres celu: natywne przyjęcia Android, fizyczne
próby organizacji hali, powiązanie kolektora Android oraz pełna analityka przyjęcie–wysyłka.
WMS obsługuje obecnie bezpośrednie odłożenie przez przeglądarkę i dane seeded.

## Pakowanie i odbiór kuriera

Odtworzony błąd: zapis numeru przesyłki ustawiał zamówienie jako wysłane, chociaż
nie istniał dowód odbioru kuriera. Test przed zmianą oczekiwał `packed`, otrzymał `shipped`.

W nowym przepływie zapis etykiet pozostawia zamówienie spakowane. Pusta skrzynka
wraca do użycia i zachowuje historię przydziału. Pracownik otwiera przekazanie dla
przewoźnika, skanuje przekazywane paczki i potwierdza odbiór widocznej liczby paczek.
Dopiero odebranie wszystkich paczek ustawia datę wysyłki zamówienia.

[Oracle: outbound](https://docs.oracle.com/cloud/owm20b/owmcs_gs-cloud/OWMSU/outbound.html)
opisuje osobne przetrzymywanie spakowanych pojemników i przekazania według przewoźnika.
[FedEx: przygotowanie etykiety](https://www.fedex.com/en-us/shipping/create-shipping-label.html)
oddziela przygotowanie etykiety od dalszego oddania paczki lub odbioru.
Wnioskiem dla WMS jest osobny dowód fizycznego opuszczenia magazynu.

Kontrole obejmują powtórzenie skanu, obce przekazanie, innego przewoźnika,
wstrzymanie po skanie, nieaktualną liczbę paczek oraz awarię podczas zamknięcia.
Paczka pozostawiona na hali wraca do kolejki po usunięciu z przekazania.
Zamknięta lista i tożsamość skanu mają ochronę przed nadpisaniem i usunięciem.

Biuro poprawia etykietę przed odbiorem, po usunięciu paczki z otwartego przekazania.
Zmiana zachowuje poprzednie dane. Ponowna kontrola wycofuje cały zestaw etykiet,
przydziela osobny pojemnik i wymaga ponownego sprawdzenia zawartości. Nie można
zwrócić części do zapasu, pozostawiając ważne etykiety na wysyłkę.

Historia sprzed tej zmiany nie otrzymuje wymyślonych dat odbioru. Rejestr pokazuje
ją osobno, a analityka podaje pokrycie potwierdzonymi odbiorami. Przy częściowym
odbiorze wielu paczek porównanie fizycznego zapasu z ERP pozostaje nieznane,
ponieważ nie ma jeszcze podziału SKU pomiędzy paczki. Zapas półek i rezerwacje
pozostają prowadzone w dzienniku; tego ograniczenia raport nie ukrywa.

Próba obciążenia objęła 5000 SKU, 2000 zamówień, 84 trasy i 8 klientów.
Po dodaniu odbiorów wykonała 14 274 żądania w 82,88 s; p95 HTTP wyniosło
66,90 ms, a p95 przydziału wózka 376,77 ms. Wszystkie zamówienia miały potwierdzony
odbiór, a ewidencja pozostała zgodna. To test lokalnego obciążenia syntetycznego.

Weryfikacja 0.291.0: 2199 testów serwera i 727 testów panelu przeszło.
Oba sprawdzenia TypeScript oraz kompilacja zakończyły się powodzeniem.
Próba przeglądarki sprawdziła skan paczki, duplikat, nieznaną etykietę, eksport
oraz ponowienie po utracie odpowiedzi zatwierdzonego odbioru. Kontrola układu
obejmuje 12 obszarów przy szerokościach 320, 390, 768 i 1440 px.

## Zawartość poszczególnych paczek

Kolejny test ujawnił brak zawartości przy zapisanej przesyłce: zamiast SKU i ilości
otrzymał `undefined`. Sam licznik sprawdzenia zamówienia nie pozwalał ustalić,
które części pozostały na hali po częściowym odbiorze.

[Microsoft: pakowanie kontenerów](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/packing-containers)
opisuje wkładanie pozycji do konkretnego kontenera. Dla WERTIS oznacza to zapis
numeru paczki przy dotychczasowym skanie części. Zwykłe zamówienie używa paczki 1
bez dodatkowego skanu. Numer pozostaje wybrany pomiędzy kolejnymi potwierdzeniami.

Zamiast tekstowej listy dodatkowych etykiet formularz pokazuje paczki i ich zawartość.
Każda wymaga etykiety i masy. Brakujące numery, puste paczki i niepełny podział
blokują zapis. Przełożenie sprawdzonych sztuk nie podwaja licznika kontroli.
Powtórzenie kontroli czyści roboczy podział, pozostawiając pobrania przy stanowisku.

Zapis etykiet utrwala SKU, nazwę i ilość każdej paczki. Wycofanie etykiety,
korekta numeru i późniejsza zmiana zamówienia nie zmieniają tego dowodu.
Częściowy odbiór odejmuje tylko odebrane sztuki od towaru oczekującego na hali.
Stare przesyłki bez podziału nadal mają nieznaną zawartość; nie dopisujemy jej historycznie.

Stara kontrola może potwierdzić jedną paczkę obejmującą całe zamówienie.
Podział na wiele paczek wymaga kompletnego zapisu albo ponownego sprawdzenia.
Testy obejmują utratę odpowiedzi, wersje, właściciela pracy, awarię drugiego zapisu,
niezmienność historii i zmianę zamówienia po wycofaniu paczek.

Weryfikacja 0.292.0: 2208 testów serwera i 727 testów panelu przeszło.
TypeScript, kompilacja oraz pełny scenariusz przeglądarki zakończyły się poprawnie.
Skanowanie dwóch paczek zachowuje wybór numeru, a przełożenie usuwa wykrytą lukę w numeracji.
Test utraty odpowiedzi po zapisie etykiet zachował jedną zawartość każdej przesyłki.

Kontrola wizualna ujawniła kolejkę nad skanerem po wybraniu zamówienia na telefonie.
Wybór otwiera teraz od razu skanowanie; przycisk potwierdzenia mieści się na ekranie 390 × 844.
Axe wykrył niedozwolony podpis ARIA na pasku etapów; dodano właściwą rolę.
Ponowna kontrola przy 320, 390 i 1440 px nie zgłosiła naruszeń wybranych reguł WCAG.
Przy 1440 px część kontroli kontrastu wymaga oceny ręcznej; automat nie potwierdza całej dostępności.

Próba 5000 SKU i 2000 zamówień wykonała 14 274 żądania w 82,08 s, przy 8 klientach i 84 trasach.
P95 HTTP wyniosło 63,95 ms, a p95 przydziału wózka 365,36 ms.
Każda z 2000 paczek zachowała zgodną zawartość; dziennik i rezerwacje pozostały zgodne.
Zweryfikowana kopia tej bazy zachowała 2000 zamówień, 2000 paczek i 3999 sztuk zawartości.
Są to pomiary syntetyczne, nie tempo pracy ludzi ani próba skanerów sprzętowych.

Zbiórka docelowo odbywa się w istniejącym APK na Zebra lub Honeywell.
Audyt rzeczywistych plików wydania i gałęzi: [kolektor WMS](wms-kolektor-audyt.md).
Natywne powiązanie z WMS wdrożono w 0.293.0. Odbiór na fizycznych modelach kolektorów pozostaje otwarty.


## Powtórzone skany przy jednej półce

Audyt kolektora wykazał trzy skany na każdą skrzynkę, również przy kolejnych zamówieniach tego samego SKU.
[Microsoft — system-directed cluster picking](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/system-directed-cluster-pick) opisuje potwierdzenie wspólnego pobrania oraz osobne potwierdzanie pozycji.
W 0.294.0 kolektor zachowuje zweryfikowany przystanek wyłącznie między potwierdzonymi zapisami tej samej części i półki.

Każda skrzynka nadal wymaga skanu. Ilości pochodzą z aktualnej trasy, a nie z lokalnego odejmowania.
Przerwanie aplikacji, zmiana kontekstu, ponowienie i odświeżenie usuwają weryfikację. Testy obejmują przerwanie podczas zapisu dziennika i żądania sieciowego.
Syntetyczny przystanek 30 skrzynek wymaga 32 zamiast 90 skanów, bez przypisywania temu wynikowi oszczędności czasu pracy.
Zdjęcie części pozostaje widoczne podczas zapisu. Nieznany wynik nadal blokuje następne pobranie.


## Rozdzielenie przyjęcia i odkładania od 0.297.0

Kontrola aktualizacji wykryła odrzucanie starszej bazy przez nowe zapytanie spójności bufora. Poprawka 0.297.1 nie migruje źródła podczas kopii.
Brak obu tabel oznacza poprzedni schemat; brak jednej nadal powoduje błąd. Trzy regresje i pełny zestaw 2224 testów serwera przeszły.
Sprawdzona kopia aktualnego demo zachowała 1501 zamówień oraz otwarte zadanie: 12 sztuk w BUF-01, właściciela i wersję 2.

Audyt wykazał wymuszone łączenie liczenia z potwierdzeniem półki docelowej. Dostawa nie miała własnej kolejki pozostałych odłożeń.
Dodano przyjęcie do bufora zaplecza, osobne podjęcie pracy i częściowe odłożenia. Zapas pozostaje niedostępny dla zbiórki do potwierdzenia półki kompletacji.
Przydziały odkładania są uwzględnione w ruchach, spisie, zmianach lokalizacji, planie uzupełnień i kontroli spójności.
Braki oraz uszkodzenia mają odmienne rozliczenie; powtórzenie nie podwaja ilości. Podgląd nie podejmuje pracy.

Podstawą rozdzielenia jest [Microsoft: mobile receiving and putaway](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/configure-mobile-devices-warehouse).
Dokumentacja opisuje przyjęcie tworzące pracę odkładania dla innej osoby. Ochrona bufora i sposób korekt są decyzjami WERTIS.
Nie zmierzono jeszcze czasu pracowników; testy dowodzą poprawności przepływu i liczników. Natywne przyjęcia Android są dostępne od 0.299.0.

Dowody: [wyniki przyjęcia i odkładania](wms-putaway-evidence.json). Przeszło 2221 testów serwera, 727 panelu, oba sprawdzenia TypeScript i build.
E2E obejmuje bufor, podjęcie, częściowe odłożenie, utratę odpowiedzi oraz korektę. Aktywny formularz sprawdzono przy 320, 390 i 1440 px.
Przy tych szerokościach potwierdzenie pozostaje widoczne, bez przewijania poziomego. Wybrane reguły axe-core nie zgłosiły naruszeń; nie jest to certyfikat całego systemu.
Próba 5000 SKU i 2000 zamówień zachowała zgodny dziennik oraz zawartość wszystkich paczek. Inne lokalne sprawdzenia działały równolegle.

## Kolejki i pomiary przepływu

Audyt znalazł średnie czasów wyłącznie dla wysłanych zamówień, brak wieku bufora oraz mylące określenie operacji pobrania jako skanów.
Dodano bieżące kolejki, wiek najstarszej pracy i przejście do obszaru. Pomiary ukończonych etapów pokazują medianę, P95 oraz braki zdarzeń.
Przyjęcia i częściowe odłożenia mają osobne liczniki; korekty nie udają odłożeń. Sesje mierzą upływ czasu, nie pracę ludzi.

[ASCM: 8 KPIs for an Efficient Warehouse](https://www.ascm.org/ascm-insights/8-kpis-for-an-efficient-warehouse/) opisuje czas realizacji od zamówienia do wysyłki.
[Microsoft: Warehouse performance](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/analytics/warehouse-power-bi-content) rozdziela między innymi wysyłki terminowe i spóźnione.
Rozdzielenie kolejek, pokrycia zdarzeń i percentyli jest decyzją WERTIS. Bez ewidencji partii nie odtwarzamy pochodzenia części w konkretnym zamówieniu.

Próba 135 000 zamówień, 5000 SKU i 90 dni ujawniła średnio 7,24 s synchronicznego raportu na głównym wątku.
Przeniesiono obliczenie do pojedynczego wątku z połączeniem tylko do odczytu, zgodnie z mechanizmem [Node: worker threads](https://nodejs.org/api/worker_threads.html).
Trzy odczyty trwały 7,81 s, 6,12 s i 6,23 s. Równoległe zapisy głównego wątku trwały 12,62 ms, 5,33 ms i 5,25 ms.
Próbnik głównej pętli ustawiony na 20 ms miał P95 32,16 ms i maksimum 44,86 ms. To test syntetyczny, nie gwarancja czasu skanera.
Odczyt zachował wszystkie 135 000 wysyłek i potwierdzeń, bez zapisów raportu. Wynik zajmował około 10,6 kB.

Regresje obejmują częściowe odbiory, stare etykiety, prawdziwe zero, odwrócone daty, korekty dawnych przyjęć i zmianę czasu w Warszawie.
Osobne testy czytnika sprawdzają wspólne obliczenie, świeżość kolejnego raportu, brak migracji, limit kolejki, awarię oraz timeout.

Weryfikacja 0.300.0: 2237 testów serwera, 727 panelu, oba sprawdzenia TypeScript, build i cztery strażnice przeszły.
E2E sprawdziło przejście z raportu do kolejki bufora i pobranie CSV. Podgląd z 5000 SKU zachował 14 sztuk w buforze.
Ekran nie wychodzi poza widok przy 320, 390 i 1440 px; szerokie tabele przewijają się we własnym obszarze.
Wyniki obciążenia: [dane próby analityki](wms-flow-evidence.json).

## Brak na jednej półce, zapas na innej

Audyt wykazał kierowanie zamówienia do wyjaśnień również wtedy, gdy dostępny zapas tego SKU leżał na innej półce kompletacji.
[Microsoft: work exceptions](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/work-exceptions-log) opisuje automatyczny ponowny przydział jako możliwą reakcję na wyjątek zbiórki.
WERTIS zachowuje osobno zgłoszenie braku i przeliczenie półki. Zgłoszenie nie koryguje fizycznego stanu.

Nowy przydział obejmuje wyłącznie niezebrane sztuki, także w innych zamówieniach dotkniętych wspólną półką.
Przetwarzanie respektuje priorytet, termin i kolejność zamówień. Nie bierze cudzych rezerwacji ani zapasu spoza dostępnych półek kompletacji.
Niepełna próba zostaje wycofana; uszkodzenia, pełne skrzynki i niezależne wstrzymania zachowują dotychczasową obsługę.
Pobrane sztuki, skrzynki i ich pozycje pozostają bez zmian. Podejrzana półka nadal wymaga przeliczenia.

Osiem regresji obejmuje częściowe pobranie, kilka źródeł, brak pełnego przydziału, zapas chroniony, priorytety i wstrzymania.
Sprawdzono także awarię późniejszej zmiany, powtórzenie klucza i odrzucenie zgłoszenia już zebranej pozycji.
Dwa testy kolektora potwierdzają wymaganie nowej półki po zgłoszeniu oraz odrzucenie starego skanu po przekierowaniu przez inną osobę.
Komunikat odróżnia niepotwierdzone sztuki od wcześniej zapisanych pobrań, aby operator nie rozliczył ich dwukrotnie.

Przeszło 2245 testów serwera, 727 panelu, 392 Android core, oba sprawdzenia TypeScript, build i cztery strażnice.
E2E sprawdziło 20 zamówień, wcześniejsze częściowe pobranie, utratę odpowiedzi, ponowienie i kontynuację w tej samej skrzynce.
W katalogu 5000 SKU przekierowanie 30 zamówień trwało 27,01 ms. Skrajna próba 1500 zamówień jednego SKU trwała 1085,91 ms.
Obie zachowały zgodny dziennik oraz niezmienny fizyczny stan; ponowienie nie wykonało zapisu. To test syntetyczny, nie wydajność pracowników.


### Liczenie na hali i decyzja biura

Audyt wykazał, że otwarte przeliczenia można było zakończyć wyłącznie kontem biura. Kolektor nie miał procesu liczenia półek.
Dodano ślepe liczenie z pustym polem ilości oraz osobną decyzją biura. Stan oczekiwany nie trafia do odpowiedzi procesu kolektora.
Wynik oczekuje bez korekty stanu. Jedna oczekująca obserwacja chroni przed nadpisaniem przez drugą osobę.
Wersja zapasu łączy odczyt, obserwację i akceptację. Zmiana zapasu albo otwarte uzupełnienie wymagają ponownej weryfikacji fizycznej.
Historia zachowuje autora, ilość, czas, wersję i decyzję. Akceptacja nie pozwala podmienić ilości w formularzu.
Wspólny dziennik APK chroni przed zgubieniem odpowiedzi i ponowieniem na innym koncie lub serwerze.

Źródło procesu: [Microsoft — Cycle counting](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/cycle-counting).
Dokument opisuje rejestrowanie liczenia na urządzeniu mobilnym oraz rozstrzyganie różnic oczekujących na przegląd.
W naszym wdrożeniu każda obserwacja wymaga biura. Nie wprowadzono automatycznego progu tolerancji różnic.
Testy obejmują zerowy wynik, brak skanów, kolizję operatorów, utratę odpowiedzi, nieaktualne dane i awarię transakcji.
Próba przeglądarki prowadzi od zgłoszonego braku przez ponowne liczenie do akceptacji z utraconą odpowiedzią.
Fizyczny odbiór na Zebra/Honeywell pozostaje do wykonania.


### Uśpienie kolektora podczas operacji

Odczyt kończący się po pauzie mógł ponownie ustawić gotowość przyjęcia lub odkładania. Zbiórka usuwała skany bez wyłączenia komend.
Cztery ekrany miały oddzielne kopie obsługi powrotu. Zastąpiono je wspólną obsługą widoczności i jedną bramką wersji wejścia.
Skan sprzętowy jest konsumowany bez działania poza stanem RESUMED. Kontroler sprawdza uprawnienie do kontynuacji także po odczycie dziennika.
Pauza anuluje odczyt uruchomiony przy wejściu, ale nie anuluje rozpoczętego utrwalania komendy ani potwierdzania jej wyniku.
Zapis rozpoczęty przed pauzą może się rozliczyć. Jego odpowiedź nie uruchamia kolejnych skanów po wyjściu lub szybkim powrocie.
Po powrocie każdy proces odczytuje świeży stan. Nieznany wynik nadal wymaga pierwotnego klucza, konta i serwera.

Osiem scenariuszy JVM obejmuje cztery procesy: zbiórkę, przyjęcie, odkładanie i liczenie półki.
Sprawdzają pauzę przed zapisem, podczas odczytu dziennika, utrwalania komendy, odpowiedzi sieciowej oraz oczekiwania na wspólną blokadę.
Sprawdzają także ponowienie i szybki powrót przed odpowiedzią. Pierwsze sześć scenariuszy odtworzyło błędy przed poprawką.

Źródło: [Android — cykl życia i korutyny](https://developer.android.com/topic/libraries/architecture/coroutines).
Dokument opisuje wiązanie pracy interfejsu z cyklem życia. Dziennik mutacji WMS zachowuje osobną odpowiedzialność za nieznany wynik zapisu.
Fizyczne testy uśpienia, DataWedge i klawiatury na docelowym kolektorze pozostają wymagane.


### Uzupełnienie bez pełnej ilości na źródle

Dotychczas uzupełnienie wymagało całego przydziału, a natywny kolektor nie miał tego procesu.
Dodano kolejkę własnych zadań i propozycji, podjęcie oraz sekwencję źródło → część → ilość → cel.
Plan i kolejka są stronicowane. Odczyt nie zapisuje zadania ani rezerwacji.
Częściowe potwierdzenie przesuwa faktyczną ilość i kieruje źródło do przeliczenia. Zero nie tworzy ruchu ani korekty zapasu.
Otwarte zadania innych osób wymagają fizycznego zwrotu i anulowania przed liczeniem wspólnego źródła.
Przerwane podjęcie odzyskuje numer zadania tym samym kluczem. Nieznany wynik blokuje także zbiórkę, przyjęcie, odkładanie i liczenie.

Regresje obejmują stronicowanie, obcego operatora, konkurencyjne podjęcie, niepełną ilość, zero, błędne skany i brak opisu.
Awaria zapisu przeliczenia wycofuje również wcześniejszy transfer i zamknięcie przydziału.
Przeglądarka sprawdza częściowe odłożenie z utratą odpowiedzi, przeliczenie oraz osobne zgłoszenie pustego źródła.
Test migracji zachowuje dawne pełne zadania. Osiem scenariuszy cyklu życia obejmuje teraz wszystkie pięć procesów kolektora.
Fizyczny odbiór na Zebra/Honeywell nadal pozostaje wymagany.


### Pełny cel i części będące w drodze

Audyt wykazał brak limitu pojemności części na półce. Minimum oraz popyt mogły wywołać plan większy od fizycznie dostępnego miejsca.
Dodano opcjonalny limit sztuk SKU na lokalizacji. Stan fizyczny i otwarte uzupełnienia zajmują miejsce; rezerwacja zamówienia go nie zwalnia.
Plan, przyjęcie, odkładanie i transfer korzystają z tego samego ograniczenia. Nie odgadujemy gabarytów ani pojemności starych lokalizacji.

Źródło odniesienia: [Microsoft — Replenishment over location capacity](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/replenishment-over-location-capacity).
Dokument opisuje udostępnianie uzupełnień zależnie od zajętości celu i blokowanie pracy przekraczającej jego pojemność.
W WERTIS przyjęto prosty limit sztuk dla części, bez jednostek paletowych i szacowania objętości.

Pełny cel jest osobnym zgłoszeniem, które blokuje dokładanie, lecz pozwala zbierać towar.
Operator potwierdza odłożoną ilość, skanuje cel i zwraca nadmiar na skanowane źródło.
Jeden zapis przechowuje ruch, ilość zwróconą oraz ewentualny rzeczywisty brak źródła. Biuro rozstrzyga zgłoszenie miejsca z zachowaniem historii.
Analityka pokazuje liczbę i wiek pełnych celów, niezależnie od przeliczeń.

Przy okazji ujawniono możliwość ręcznego spisu podczas uzupełnienia. Części mogły znajdować się fizycznie na celu przed ostatnim potwierdzeniem.
Wszystkie spisy źródła oraz celu czekają teraz na rozliczenie otwartych uzupełnień. Chroni to przed podwójnym policzeniem niepotwierdzonego odłożenia.

Testy obejmują rezerwacje zajmujące miejsce, konkurencyjne ruchy, zero i nieustalony limit, migrację, rollback oraz zwrot po utracie odpowiedzi.
Pełny cel bez braku źródła nie otwiera przeliczenia. Scenariusz mieszany zachowuje oba niezależne problemy.
Spis po zakończeniu zadania zachowuje faktyczną ilość ponad limitem; dalsze dokładanie nadal jest ograniczone.
