# Audyt przepływu: przyjęcie → wysyłka

Punkt wyjścia: `7c91a8a`, WMS 0.288.0. Magazyn 20 × 20 m, 5000 SKU,
docelowo 1500 zamówień dziennie. Praca i weryfikacja wyłącznie na danych seeded.
Poprzedni etap był postępem: wdrożył zdjęcia części i zweryfikował zbiórkę.
Nie stanowi to dowodu ukończenia całego audytu procesów.

## Zakres celu i wymagane dowody

| Obszar | Co ma być udowodnione | Stan audytu |
|---|---|---|
| Przyjęcie | Właściwy produkt i ilość, częściowe dostawy, nadwyżki, uszkodzenia, duplikat dokumentu, ponowienie skanu | Bezpośrednie przyjęcie WMS zweryfikowano testami, włącznie z korektą i utratą odpowiedzi. Przyjęcie na bufor i kolektor pozostają otwarte. |
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

Dalszy zakres celu: przyjęcia na strefę buforową z późniejszym odłożeniem, fizyczne
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
Natywne powiązanie z WMS pozostaje otwartym, priorytetowym zakresem celu.
