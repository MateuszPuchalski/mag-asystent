# Audyt przepływu: przyjęcie → wysyłka

Punkt wyjścia: `7c91a8a`, WMS 0.288.0. Magazyn 20 × 20 m, 5000 SKU,
docelowo 1500 zamówień dziennie. Praca i weryfikacja wyłącznie na danych seeded.
Poprzedni etap był postępem: wdrożył zdjęcia części i zweryfikował zbiórkę.
Nie stanowi to dowodu ukończenia całego audytu procesów.

## Zakres celu i wymagane dowody

| Obszar | Co ma być udowodnione | Stan audytu |
|---|---|---|
| Przyjęcie | Właściwy produkt i ilość, częściowe dostawy, nadwyżki, uszkodzenia, duplikat dokumentu, ponowienie skanu | Dokumentowe przyjęcie ma idempotencję. Pełny przebieg przyjęcia i odkładania wymaga dalszego przeglądu. |
| Odkładanie | Towar staje się dostępny dopiero we właściwej lokalizacji; nowy SKU i brak miejsca mają obsługę | Do dalszego przeglądu; plan uzupełnień pomija SKU bez istniejącego wiersza półki kompletacji. |
| Uzupełnienia | Praca nie ginie po przyjęciu; przydzielone sztuki nie mogą zostać zabrane innym ruchem | Odtworzono i naprawiono oba błędy. Testy regresji opisano niżej. |
| Rezerwacje i zbiórka | Priorytet, brak, pełna skrzynka, przerwanie pracy, współbieżność, zdjęcie i właściwa skrzynka | Istnieją testy wózków 20/30. Potrzebny dalszy przegląd zmian i anulowań zamówień podczas pracy. |
| Pakowanie i wysyłka | Właściwa zawartość, wielopaczkowość, poprawki etykiety, błędny przewoźnik, przekazanie kurierowi | Podstawowy przebieg i duplikaty numerów są testowane; wyjątki wymagają dalszego przeglądu. |
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
