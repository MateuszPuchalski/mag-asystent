# WMS — zakres i dowody odbioru

Gałąź: `codex/robust-wms`. Cel: 5000 SKU i 1500 zamówień dziennie.

Zachowujemy katalog, integracje Subiekta, przyjęcia, zwroty, konta i audyt.
Operacje WMS mieszkają w istniejącym `/biuro` oraz w API `/api/wms`.
Interfejs pozostaje polski i działa ze skanerem klawiaturowym.

## Kryteria odbioru

- Zamówienia: import, wyszukiwanie, terminy wysyłki, priorytety i anulowanie.
- Stany: lokalizacje, przyjęcia, przesunięcia, spis i niezmienny dziennik ruchów.
- Rezerwacje: transakcje, brak nadrezerwacji i pełne wycofanie przy niedoborze.
- Kompletacja: przypisanie osoby, pojemnik, kolejność lokalizacji i kontrola skanów.
- Wózki: do 12 zamówień na wspólnej trasie, atomowe przypisanie i kontrola docelowego pojemnika.
- Jakość: kwarantanna i zaplecze wyłączone z rezerwacji; jawne zwolnienie przez biuro.
- Pakowanie: niezależna kontrola SKU oraz ilości; wysyłka dopiero po sprawdzeniu całości.
- Wyjątki: braki, blokada, wznowienie, przejęcie i bezpieczny zwrot pobranego towaru.
- Analityka: przepływ zamówień, terminowość, czas realizacji, rotacja, zapasy i błędy.
- Bezpieczeństwo: role, walidacja, odporność na powtórzenia oraz konflikt wersji.
- Ergonomia: klawiatura, dotyk, telefon, widoczne błędy i zachowanie pracy po przerwie.
- Weryfikacja: testy usług/API, prawdziwy przebieg w przeglądarce i próba obciążenia.
- Eksploatacja: instrukcja uruchomienia, kopii, odtworzenia i granic integracji.

## Granica ewidencji

Subiekt pozostaje źródłem kartotek i dokumentów handlowych.
WMS prowadzi fizyczne ilości na lokalizacjach i rezerwacje zamówień.
Import Subiekta nie nadpisuje tych ilości. Otwarcie ewidencji wymaga jawnego spisu.
To zapobiega odtworzeniu sprzedanego zapasu przy kolejnym imporcie stanów ERP.
Różnice obu ewidencji wymagają raportu i uzgodnienia przed produkcyjnym uruchomieniem.

## Dowody i pozostały odbiór

Usługi i API pokrywają rezerwacje, skany, pakowanie, wyjątki, import partii i ewidencję lokalizacji.
Test dwóch procesów wyklucza podwójną rezerwację ostatniej sztuki.
Test kopii odtwarza całą bazę i sprawdza dziennik.
Test przeglądarki przechodzi od logowania do wysyłki, także po utracie odpowiedzi i odświeżeniu strony.
Widok 390 px nie ma poziomego przepełnienia.
Próba pojemności: 5000 SKU i 1500 pełnych zamówień; 16650 żądań przy 16 klientach.
Wynik próby: 78,26 s, p95 93,18 ms, zgodny dziennik.
Raport 90 dni przy 136500 zamówieniach i 409500 pozycjach: 613 ms.
Pełny zestaw serwera: 2037 testów, zero błędów. Panel: 640 testów, bez zmian w jego źródłach.
Build produkcyjny przechodzi również test przeglądarki, wraz z wygaśnięciem sesji podczas ponowienia skanu.
Aktualny audyt zależności produkcyjnych: zero zgłoszonych podatności.
Zapis wyników: `docs/wms-evidence.json`; scenariusze i zrzuty można odtworzyć przez `tools/wms-e2e.mjs`.

Ograniczenia integracji i instrukcja odbioru stoją w `docs/wms.md`.
Odbiór produkcyjny pozostaje otwarty: rzeczywiste pliki sklepu, dokumenty ERP i sprzęt nie zostały przetestowane.
Nowy WMS pracuje w przeglądarce; natywne ekrany kompletacji Androida nie zostały dodane.
