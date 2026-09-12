# Audyt przepływu: przyjęcie → wysyłka

Punkt wyjścia: `7c91a8a`, WMS 0.288.0. Magazyn 20 × 20 m, 5000 SKU,
docelowo 1500 zamówień dziennie. Praca i weryfikacja wyłącznie na danych seeded.
Poprzedni etap był postępem: wdrożył zdjęcia części i zweryfikował zbiórkę.
Nie stanowi to dowodu ukończenia całego audytu procesów.

## Zakres celu i wymagane dowody

| Obszar | Co ma być udowodnione | Stan audytu |
|---|---|---|
| Przyjęcie | Właściwy produkt i ilość, częściowe dostawy, nadwyżki, uszkodzenia, duplikat dokumentu, ponowienie skanu | Natywne przyjęcie i bufor działają ze wspólnym dziennikiem. Sprawdzono częściowe dostawy, korekty, kwarantannę, utratę odpowiedzi i dokument 5000 SKU. Fizyczny kolektor wymaga odbioru. |
| Odkładanie | Towar staje się dostępny dopiero we właściwej lokalizacji; nowy SKU i brak miejsca mają obsługę | Natywne odkładanie rozlicza partie, kwarantannę i pozostały bufor. Podpowiedzi uwzględniają pojemność i blokady; końcowy ruch ponawia kontrolę. Nowy SKU wymaga zarejestrowanego celu. |
| Uzupełnienia | Praca nie ginie po przyjęciu; przydzielone sztuki nie mogą zostać zabrane innym ruchem | Natywna kolejka rozróżnia popyt zamówień i minima. Obsługuje brak źródła, pełny cel, częściowe odłożenie i zwrot. Przydział chroni zapas oraz miejsce. |
| Rezerwacje i zbiórka | Priorytet, brak, pełna skrzynka, przerwanie pracy, współbieżność, zdjęcie i właściwa skrzynka | Istnieją testy wózków 20/30. Potrzebny dalszy przegląd zmian i anulowań zamówień podczas pracy. |
| Pakowanie i wysyłka | Właściwa zawartość, wielopaczkowość, poprawki etykiety, błędny przewoźnik, przekazanie kurierowi | Sprawdzono podział na paczki, częściowy odbiór, cofnięcie kontroli oraz wymianę uszkodzenia lub potwierdzonego braku. Rzeczywiste etykiety i odbiór kurierów pozostają do sprawdzenia. |
| UI/UX i uproszczenia | Mniej zbędnych decyzji, poprawna kolejność skanów, zachowana orientacja i odzyskiwanie po błędzie | Sześć procesów kolektora współdzieli dziennik i ochronę po pauzie. Browser E2E sprawdza kolejność skanów oraz jawne ilości. Dalszy odbiór ergonomii wymaga fizycznej pracy. |
| Analityka i skala | Czas od przyjęcia do dostępności, blokady i wiek zadań; skala z historią i współbieżnymi operatorami | Raport pokazuje kolejki, ich wiek, medianę, P95 i pokrycie. Próba 135000 zamówień działała w osobnym wątku. Pomiar rzeczywistej hali pozostaje otwarty. |
| Utrzymanie | Aktualizacja, kopia i odtworzenie, role, dziennik, awaria sieci, restart procesu | Kopie seeded przed i po migracji rozbieżności przeszły kontrolę historii, zapasu i relacji. Ponowienia oraz restart mają regresje. Produkcyjne odtworzenie pozostaje do odbioru. |

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


### Popyt przy kilku półkach tego samego SKU

Dalsza próba wykazała, że pierwsza pełna półka mogła przejąć cały popyt i pozostawić pusty plan pomimo miejsca na drugiej.
Przykład seeded: zaplecze ma dziesięć sztuk, pierwsza półka jedną z pojemności jednej, druga zero z pojemności dziesięciu.
Zamówienie wymaga czterech sztuk. Poprawiony plan kieruje trzy sztuki na drugą półkę.

Potrzeby minimów i otwarte przydziały pokrywają część popytu. Pozostała potrzeba jest rozdzielana według wolnego miejsca kolejnych dozwolonych celów.
Pełny cel oraz zgłoszony brak miejsca nie zatrzymują alternatyw. Zmiana zadania na ukończone nie odtwarza pokrytej już potrzeby.
Trzy scenariusze najpierw odtworzyły błąd, następnie przeszły po zmianie planowania. E2E podjęło zadanie na alternatywnym celu.


### Brak zamówienia przed rutynowym minimum

Sortowanie wyłącznie po ilości stawiało rutynowe uzupełnienie 499 sztuk przed jedną sztuką potrzebną do zamówienia.
Plan teraz wyróżnia niepokryty popyt i porządkuje go według priorytetu oraz terminu zamówienia. Minima bez braków trafiają dalej.
Dostępny zapas i podjęte zadania pokrywają potrzeby według tej samej kolejności. Pokryte pilne zamówienie nie zawyża pilności pozostałego braku.
Nie powstaje nowa rezerwacja ani przypisanie fizycznej sztuki do zamówienia podczas odczytu.

Punktem odniesienia jest [Microsoft — Replenishment overview](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/replenishment).
Dokument rozróżnia minima i popyt zamówień oraz opisuje wykorzystanie istniejących prac uzupełnienia do pokrycia popytu.
W WERTIS oba powody pozostają w jednej kolejce, z pierwszeństwem braków i jawnym opisem na kolektorze oraz w Biurze.

Pięć regresji sprawdza wielkość minimum, priorytet, termin, pokrycie zapasem, zadania w drodze oraz wyłączenie zamówień wstrzymanych i anulowanych.
Cztery początkowe scenariusze zawodziły przed poprawką. Test kolektora sprawdza także odczyt starszego API i zachowanie niezmienionej komendy podjęcia.


### Omyłkowe potwierdzenie jednej sztuki przy pakowaniu

Dotychczas korekta ilości wymagała wyzerowania kontroli całego zamówienia. Przy kilku paczkach operator musiał ponownie skanować również prawidłowo sprawdzoną zawartość.
Dodano cofnięcie potwierdzenia wybranego SKU i ilości w jednej paczce, ze skanem części oraz uzasadnieniem.
Pozostała zawartość, pobrane sztuki i fizyczny zapas pozostają bez zmian. Ostatnia cofnięta sztuka usuwa wyłącznie jej wpis z paczki.

Kontrola gotowości wraca do pakowania; historia zachowuje korektę. Ponowny skan brakujących potwierdzeń pozwala przygotować etykiety.
Wysłanie z brakującym potwierdzeniem pozostaje niemożliwe. Zapisane etykiety i ich niezmienna zawartość wymagają dotychczasowego procesu wycofania.
Wspólne odejmowanie z paczki obsługuje teraz także przełożenie, usuwając zduplikowaną logikę granic ilości.

Punktem odniesienia jest [Microsoft — Pack containers for shipment](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/packing-containers).
Dokument opisuje weryfikację typu i ilości części oraz przypisanie zawartości do fizycznych pojemników.
Korekta WERTIS dotyczy potwierdzenia tej kontroli. Faktyczny brak lub uszkodzenie nadal wymaga wstrzymania i wyjaśnienia, bez pozornego zwrotu zapasu.

Regresje sprawdzają częściowe cofnięcie, usunięcie pustej pozycji, błędną paczkę, kod, ilość, właściciela i wersję.
Wymuszona awaria przywraca zawartość i pozwala ponowić ten sam klucz. E2E sprawdza korektę po utracie odpowiedzi i ponowne pakowanie jednej sztuki.

### Uszkodzona część na stanowisku pakowania

Stary zwrot kierował część na źródłową półkę i zerował całą kontrolę pakowania.
Nie rozdzielał uszkodzenia od omyłkowego potwierdzenia. Przekazany wózek nie zapewniał też prostej drogi ponownego pobrania.

Nowa ścieżka zachowuje dobre sztuki, a uszkodzone przyjmuje do skanowanej kwarantanny.
Jedno otwarte zadanie zamówienia rezerwuje zamienniki i prowadzi operatora kolektora do tej samej skrzynki.
Fizyczny brak zamiennika nie wycofuje kwarantanny. Powstaje widoczna potrzeba uzupełnienia oraz kolejka w analityce.
Pakujący sprawdza tylko dostarczone zamienniki. Wersje, właściciel, kod źródła, części i skrzynki zabezpieczają potwierdzenie.

Spis źródła nie może zwolnić rezerwacji niesionego zamiennika. Blokadę sprawdza także zatwierdzanie przeliczenia, przed usunięciem przydziałów.
Po fizycznym zwrocie wszystkich niepotwierdzonych sztuk operator zwalnia zadanie; biuro może potem przerwać wymianę i rozliczyć zamówienie.
Kontrola kopii sprawdza zgodność otwartych spraw z brakującymi pobraniami. Odrzuca częściowy schemat i nadal czyta kopię sprzed tej funkcji.

Punkt odniesienia: [Microsoft — Cancel warehouse work](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/cancel-warehouse-work).
Dokument rozdziela anulowanie pracy od fizycznego przeniesienia zapasu.
[Konfiguracja urządzeń mobilnych](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/configure-mobile-devices-warehouse) opisuje oddzielne potwierdzanie kwarantanny.
WERTIS stosuje te zasady do uszkodzenia wykrytego podczas pakowania części, bez ręcznej naprawy bazy.

Dziewięć testów serwera obejmuje ilości, paczki, właścicieli, brak zapasu, przydział, częściową wymianę, zwrot, spis, anulowanie oraz kopię.
Wymuszone awarie wycofują całą transakcję; ponowienie odtwarza ten sam wynik.
Pięć testów JVM sprawdza skany, jawne ilości, restart, dysk, nieudany odczyt oraz izolację konta, serwera i procesu.
Osiem wspólnych prób cyklu życia obejmuje teraz sześć procesów, łącznie 48 przypadków.
E2E gubi odpowiedzi po kwarantannie oraz dostarczeniu, odzyskuje zapis i pakuje zamiennik jednym skanem.
Formularze oraz przejście Enter sprawdzono przy 320, 390 i 1440 px. Fizyczny kolektor wymaga osobnego odbioru.

### Nieobecna część przy pakowaniu

Fizyczny zwrot lub kwarantanna nie rozlicza braku: tworzyłby zapas, którego nie ma.
Biuro potwierdza brak po przeliczeniu wskazanej zawartości i wyjaśnieniu stanowiska. Pakujący ma dotychczasowe wstrzymanie z opisem.
Wybór pozycji zamówienia zastępuje niemożliwy skan nieobecnej części. Rzeczywista ilość dotyczy wybranej paczki albo jeszcze niesprawdzonych sztuk.
Puste pole nie oznacza zera. Dobre zawartości pozostają, a korekta nie zmienia półki ani kwarantanny.
Wspólna kolejka prowadzi zamiennik na stanowisko; pakujący sprawdza tylko dostarczone sztuki.

Historia wymian ma teraz jeden format spraw, z rodzajem uszkodzenia albo potwierdzonego braku.
Migracja zachowuje identyfikatory, częściowe dostarczenia, autora i kwarantannę; usuwa starą tabelę dopiero po udanym przeniesieniu całej historii.
Awaria wycofuje migrację. Dwie niepuste historie zatrzymują start zamiast nadpisywać dane. Kopia starego formatu nadal jest sprawdzana bez migracji.
API pozostawia pusty tekst adresu przy braku, aby starsze APK przyjmowało zadanie. W bazie brak lokalizacji jest zapisany jako NULL.

E2E ujawniło zakleszczenie procesu: wznowienie wymagało pełnej rezerwacji, a podjęcie wymiany wymagało wcześniejszego wznowienia.
Regresja najpierw odtworzyła odmowę. Teraz wznowienie rozpoznaje dokładnie udokumentowany brak pobrań; nie powstaje przy tym rezerwacja ani ruch.
Niepowiązane niedobory i niespójna ilość sprawy nadal odrzucają wznowienie. Niezależne wstrzymanie zachowuje powód do decyzji biura.

Punkt odniesienia: [Microsoft — Work exceptions log](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/work-exceptions-log).
Opis rozróżnia zgłoszenie rozbieżności, decyzję dotyczącą zapasu oraz dalszy przydział pracy.
Wniosek dla WERTIS: rozliczenie nieobecnej sztuki należy oddzielić od jej fizycznego zwrotu, zachowując historię i uprawnienia.

Trzy regresje serwera obejmują rzeczywiste ilości, paczki, role, wersje, zachowany zapas, ponowienie, awarię i wznowienie.
Trzy testy migracji sprawdzają starą historię, częściowy postęp, rollback, starszą kopię oraz sprzeczne schematy.
Test core odczytuje stare uszkodzenie i nowy brak przez ten sam proces pobrania.
E2E obejmuje wstrzymane zamówienie, pustą ilość, utraconą odpowiedź, analitykę, zamiennik oraz ponowny skan jednej sztuki w drugiej paczce.


### Pełne półki w podpowiedziach odkładania

Końcowy ruch sprawdzał pojemność, lecz trzy odczyty nadal podpowiadały pełne lub zablokowane miejsca.
Osiem wcześniejszych pełnych adresów mogło ukryć właściwą półkę. Operator poznawał odmowę dopiero przy odłożeniu.
Przyjęcie biura, przyjęcie kolektora i zadanie odkładania korzystają teraz z jednej reguły podpowiedzi.
Reguła odrzuca kwarantannę, otwarte przeliczenie, zgłoszony brak miejsca oraz wyczerpany limit przed wyborem ośmiu adresów.
Wolne miejsce to pojemność pomniejszona o fizyczny stan oraz przydzielone uzupełnienia. Rezerwacje zamówień nadal zajmują półkę.
Brak limitu oznacza potrzebę sprawdzenia miejsca, nie obietnicę nieograniczonej pojemności.
Kolektor pokazuje ilość przed wpisaniem partii; podpowiedź nie ustawia ilości ani nie zastępuje skanu.
Odczyt nie rezerwuje miejsca. Równoległe przyjęcie może zmienić sytuację, więc końcowy ruch ponownie kontroluje cel.

Punkt odniesienia: [Microsoft — lokalizacje i szablony pracy](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/control-warehouse-location-directives).
Dokument opisuje reguły wyboru celu, ograniczenia ilości oraz podział pomiędzy lokalizacjami.
Wniosek dla WERTIS: znane ograniczenia należy pokazać przed drogą do półki i wyborem odkładanej partii.

Dwie regresje najpierw odtworzyły wadliwe podpowiedzi. Sprawdzają wspólny wynik trzech odczytów, brak zapisów i wycofanie odłożenia po równoległej dostawie.
Test JVM odczytuje nowe oraz starsze API. Starsza odpowiedź nie udaje wiedzy o pojemności.


### Policzone sztuki zamiast domyślnej ilości

Próba przeglądarki odtworzyła trzy niejawne wartości: całe pozostałe odłożenie, jedną sztukę przyjęcia i tę samą jedynkę po przełączeniu na spis.
Ostatnia wartość oznaczała stan całej półki, więc zwykła zmiana czynności mogła przygotować niezamierzoną korektę zapasu.

Przyjęcie, odkładanie, korekta bufora, uzupełnienie i ręczny ruch wymagają teraz jawnej ilości.
Oczekiwana ilość pozostaje instrukcją na ekranie, lecz nie zastępuje policzonej partii w formularzu.
Enter zatrzymuje się na pustym lub nieprawidłowym polu. Zmiana czynności usuwa poprzednią ilość i cel.
Spis jasno opisuje cały stan półki i dopuszcza jawne zero. Przyjęcie oraz przesunięcie wymagają dodatniej liczby.
Zmiana dobrego towaru na uszkodzony usuwa ilość i skan celu, aby operator potwierdził właściwą partię oraz kwarantannę.

Uzupełnienie prowadzi teraz przez źródło, część, policzoną ilość i końcowy skan półki.
Częściowa ilość ujawnia wymagany powód przed skanem celu; pełna partia pomija to pole.
Zmiana ilości wymaga ponownego skanu celu. Błąd walidacji pozostawia wpisane dane do poprawienia.
Nie dodano pytania potwierdzającego po końcowym skanie ani drugiego procesu dla kolektora.

Punkty odniesienia:
[Microsoft — potwierdzenie ilości i lokalizacji](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/configure-mobile-devices-warehouse)
oraz [NN/g — zapobieganie pomyłkom przy powtarzalnej pracy](https://www.nngroup.com/articles/slips/).
Wniosek dla WERTIS: stan policzony nie powinien dziedziczyć wartości z innej operacji, a walidacja powinna zatrzymywać pomyłkę przed ruchem zapasu.

Browser E2E sprawdza brak POST przy pustej ilości, zmianę przyjęcie → przesunięcie → spis, jawne zero oraz poprawne przyjęcie pięciu sztuk.
Przyjęcie i odkładanie sprawdzają także zmianę stanu towaru, ułamek, przekroczenie pozostałej ilości i pusty wynik po odświeżeniu.
Uzupełnienie sprawdza pełną i częściową partię, wymagany powód, kolejność Enter oraz utratę odpowiedzi po końcowym skanie.


### Mniejsza planowana partia uzupełnienia

Kolektor i Biuro podejmowały zawsze całą propozycję. Operator nie mógł zaplanować krótszego przejścia dla większych lub cięższych części.
Wpisanie mniejszej ilości dopiero po pobraniu oznaczało brak na źródle i uruchamiało przeliczenie.

Pełna propozycja nadal wymaga jednego naciśnięcia. Opcja mniejszej partii pozwala przed podjęciem wpisać dodatnią ilość w granicach propozycji.
Przydział chroni tylko tę partię oraz odpowiadające jej miejsce. Po ukończeniu pozostała potrzeba wraca do planu bez zgłoszenia rozbieżności.
Ilość planowana nie potwierdza pobrania. Natywne pole faktycznej ilości zaczyna się puste, również po porzuceniu skanów przez opcję anulowania.
Liczby spoza zakresu są odrzucane, bez obcinania cyfr. Zmiana konta, odczytu lub planu zamyka poprzedni wybór partii.

Nie założono masy części ani dopuszczalnego ciężaru. Operator dobiera partię do rzeczywistych warunków; fizyczny odbiór nadal jest potrzebny.
Punkt odniesienia: [Microsoft — ograniczenia i podział pracy](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/control-warehouse-location-directives).
Dokument opisuje ograniczanie pracy według ilości, jednostki, objętości i masy.
Wniosek dla WERTIS: ilość pojedynczego przejścia należy oddzielić od całkowitej potrzeby półki oraz stwierdzonego braku zapasu.

Regresja serwera obejmuje potrzebę dwudziestu, podjęcie i odłożenie pięciu, powrót piętnastu do planu oraz odrzucenie starych wersji.
Nie powstaje fałszywe przeliczenie. Ponowienie podjęcia i zakończenia nie zmienia ilości drugi raz.
Testy JVM obejmują zakres, stare szybkie podjęcie, mniejszą partię, brak powodu niedoboru oraz zachowanie partii w dzienniku po restarcie.
Browser E2E sprawdza błędne ilości, utraconą odpowiedź podjęcia, skany pięciu sztuk i pozostały plan.
