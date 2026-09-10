# WMS — realizacja zamówień

Moduł działa pod `/biuro`, w zakładce **REALIZACJA WMS**.
Wykorzystuje istniejące konta, katalog Subiekta i dziennik zdarzeń.
Przyjęcia dokumentowe, zwroty i obsługa klienta zachowują dotychczasowe ekrany.

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
$env:WMS_SELLASIST_ENABLED = '0'
npm run dev:api
```

Adres: `http://localhost:3001/biuro`. Login: `wms-demo`.
Demo zawiera 40 części i 32 zamówienia na różnych etapach realizacji.

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

**Zbiórka wózkiem → Przygotuj wózek** pokazuje zarezerwowane zamówienia według priorytetu i terminu.
Zeskanuj pojemniki przy wybranych zamówieniach; jedna trasa obejmuje od 1 do 12 zamówień.
Rozpoczęcie przypisuje wszystkie zamówienia razem albo wycofuje całą operację, jeżeli ktoś zdążył przejąć zamówienie lub pojemnik.
Trasa porządkuje zadania według kodu lokalizacji, następnie SKU i zamówienia.
Stosuj kody o stałej szerokości, np. `A01-02-03`, aby kolejność odpowiadała układowi magazynu.
Każde pobranie wymaga skanu lokalizacji, towaru i docelowego pojemnika.
Enter przechodzi między polami; ostatni skan zatwierdza sztuki.
Wstrzymane zamówienia pozostają widoczne, a pozostałą trasę można dokończyć.
Po zakończeniu pojemniki trafiają do tej samej niezależnej kontroli pakowania co zwykła zbiórka.
Biuro może przejąć pojedyncze zamówienie w jego karcie; skan pojemnika nadal jest wymagany.

## Integracja sklepu i wysyłki

Automatyczny konektor Sellasist opisuje [`wms-sellasist.md`](wms-sellasist.md).
Obsługuje import, wykrywanie zmian, kontrolę paczek przed wysłaniem i potwierdzanie statusu.
Jest domyślnie wyłączony i wymaga rzeczywistych identyfikatorów statusów oraz klucza API.

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
| `GET /api/wms/sellasist` | Stan synchronizacji i propozycje zmian zamówień |

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
Numer przesyłki musi pochodzić z systemu przewoźnika.
Jedno zamówienie może mieć do 20 paczek, każda z osobnym numerem i masą.
Wszystkie paczki zamówienia zatwierdzają się razem.
WMS nie kupuje etykiet ani nie przesyła automatycznie dokumentów wydania do Subiekta.
Nie przechowuje adresów odbiorców w nowych tabelach realizacji.

## Analityka

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

Pomiar wersji 0.271.1: 5000 SKU, 1500 zamówień po trzy pozycje i 16 równoległych klientów.
16650 żądań ukończyło pracę w 76,97 s. Opóźnienie p95 wyniosło 90,5 ms.
Stan i rezerwacje zgodziły się z dziennikiem po wszystkich wysyłkach.
Sprzęt: Windows, Ryzen 7 7730U, Node 24.15.0, SQLite 3.51.3.
Pomiar dotyczy localhost oraz syntetycznych danych. Nie obejmuje usług przewoźników, Subiekta i fizycznych urządzeń.

Opcja `npm run test:wms:capacity -- --history` dodaje 90 dni danych raportowych.
Pełniejsza próba: `npm run test:wms:capacity -- --history --ledger-history`.
Obejmuje 136500 zamówień, 409500 pozycji, 1229000 ruchów i 1506501 zdarzeń audytu.
Raport 90-dniowy zajął 1337 ms, a 30-dniowy 435 ms. Kontrola dziennika zakończyła się poprawnie w 1009 ms.
Historyczne rekordy są osobnymi danymi testowymi; właściwe operacje zapisu sprawdza wcześniejszy przebieg 1500 zamówień.

Pełny odbiór produkcyjny wymaga próby z rzeczywistym eksportem sklepu, drukarką, skanerami i uzgodnionymi dokumentami ERP.
