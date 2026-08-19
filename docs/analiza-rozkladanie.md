# Analiza rozkładania towaru

Rozkładanie skonfrontowane z realiami pracy magazyniera na kolektorze.
Dokument opisuje **stan po redesignie v2.0**. Sekcja 3 mówi,
czym to się różni od pierwszej wersji analizy (lipiec 2026). Czytelnik starszych
PR-ów dowie się z niej, co zniknęło i dlaczego.

**Rozkładanie jest jedno.** Wszystkie dostawy idą tą samą ścieżką: dokument
jest jednostką pracy, a zapisem jest sam adres. Magazyn skutku mówi tylko,
co zostaje PO rozłożeniu.

| magazyn skutku | co to jest | co zostaje po odłożeniu |
|---|---|---|
| `MAG` | dostawa krajowa | nic — towar leży na hali z adresem |
| `MGP` | kontener importowy | stan do przesunięcia na halę |

Do 0.22.0 kontener miał własną zakładkę, własne tabele i sesję z wózkiem.
Cała ta machineria obsługiwała proces zdarzający się cztery razy w roku
i prowadziła do jednego wywołania, które na produkcji i tak rzucało wyjątkiem.

## 1. Dostawa krajowa — dokument jako jednostka pracy

`server/src/services/delivery.ts`, ekrany `android/app/…/ui/delivery/`.

1. **Lista dokumentów** (`listDocuments`) — FZ/PZ na MAG z ostatnich 14 dni
   z paskiem postępu liczonym z `delivery_line`. Dokument **w buforze** też jest
   do wzięcia: skutek magazynowy niesie sam dokument w Subiekcie, więc
   rozkładanie nie czeka na księgowość.
2. **Otwarcie** (`openDelivery`) — pozycje snapshotowane w chwili otwarcia
   i agregowane po `tw_id` (różne partie/ceny → jedna linia robocza). Zmiana
   dokumentu przez księgowość w trakcie pracy nie rozjeżdża postępu.
3. **Dwa skany na pozycję.** Skan towaru (`resolveScan`) rozwija wiersz
   z ilością i lokalizacją docelową. Skan etykiety regału (`putawayLine`)
   zapisuje adres i zwija wiersz jako odłożony.

   Zero dialogu potwierdzającego, zero tapnięć i **zero podmieniania ekranu**.
   Lista zostaje widoczna, bo to na niej widać, ile jeszcze zostało w kartonie.
   Wcześniej wchodziła tu pełnoekranowa karta, która listę gasiła.

   Rozwinięty wiersz ma od 0.57.0 nagłówek z ✕ i **dwa kafle**: biały ze
   stepperem ilości i stanem na hali, ciemny z adresem i podpowiedzią skanu.
   Po lewej to, co magazynier ustawia; po prawej to, dokąd towar idzie.
4. **Zapis** — wyłącznie zadanie `set_location` do `sfera_queue`. Żadnego MM,
   żadnego `waiting_for_doc`.
5. **Domknięcie** (`closeIfComplete`) — dostawa zamyka się sama, gdy nie ma już
   czego rozkładać. Nie zamknie się jednak, dopóki wisi nieodpowiedziana
   notatka biura — bramka stoi w tej funkcji, a nie tylko przy przycisku.
6. **Wyjątek** (`raiseProblem`) — kategoria zna swój ZAKRES (0.57.0). Cztery
   dotyczą pozycji: zła ilość, brak w przesyłce, uszkodzone, błędny artykuł.
   Jedna dotyczy dostawy: artykuł niezamówiony, czyli towar spoza dokumentu.
   Walidacja działa w obie strony, więc kategoria dostawy nie przypnie się do
   pozycji ani odwrotnie.
7. **Zakończenie z ręki** (`zakonczDostawe`) — przycisk ZAKOŃCZ DOSTAWĘ
   pokazuje najpierw, co powstanie. Braki ilościowe pojadą do dostawcy jako
   wyjątek „zła ilość", a pozycje nietknięte zostaną pominięte. Przycisk jest
   dla dostawy OTWARTEJ; po domknięciu z punktu 5 kolektor pokazuje w jego
   miejscu wyjście na listę. Odmowa „już zamknięta" niesie kod `juz_zamknieta`
   i też prowadzi na listę — cel jest wtedy osiągnięty (0.54.0).
8. **Korekta ilości** (`korygujIlosc`) — poprawka pomyłki w liczeniu, dopóki
   faktura jest otwarta. Ustawia liczbę bezwzględną, nie różnicę, i nie tworzy
   ani zadania w kolejce, ani wyjątku.

## 2. Przesunięcie stanu między magazynami

`server/src/services/przesuniecie.ts`, arkusz
`android/app/…/ui/przesuniecie/PrzesuniecieSheet.kt`.

Jedyne miejsce, w którym powstaje dokument MM. Wychodzi z trzech miejsc: kafla
magazynu na karcie towaru, podlinijki „MGP N" w nagłówku karty oraz z wiersza
kontenera na liście dostawy.

1. **Ile wolno** — stan magazynu źródłowego minus przesunięcia, które już
   czekają w kolejce. Kolejka jest zarazem rezerwacją.
2. **Dokąd** — dowolny magazyn poza ukrytymi; hala jest wybrana z góry.
3. **Adres** — skan półki obowiązkowy przy celu MAG, zabroniony przy innym.
   Pole lokalizacji w kartotece jest jedno na towar i opisuje regał na hali.
4. **Zapis** — `set_location` do kolejki, a dopiero po nim `mm` (patrz
   niezmiennik niżej). Skan półki, którą towar już ma, jest dowodem, nie
   zapisem.

Przesunięcie **nie ma bufora offline**. Walidacja „dostępne minus w drodze"
liczy się na serwerze w chwili zapisu. Operacja odtworzona po dwóch godzinach
zbudowałaby dokument na stan, którego już nie ma.

## 3. Czym to się różni od pierwszej analizy (lipiec 2026)

Tamta wersja opisywała jeden proces (MGP→MAG, sesja z wózkiem) w kliencie PWA.
Zniknęły od tego czasu:

- **klient PWA** — zastąpiony natywnym kolektorem Android, a jego kod usunięty
  z repo; aplikacji webowej nie ma — `/lookup` i serwowanie statyk usunięte,
- **tryb „ROZKŁADAJ CAŁE MGP"** — sesja bez dokumentu; jednostką pracy jest
  dokument, a strefa przyjęć przestała być workiem bez ewidencji,
- **`POST /api/mm`** (MM ad-hoc z karty towaru) — wycięte jako nieużywane.
  W 0.22.0 **wróciło** jako `POST /api/przesuniecie`; wtedy jedynym wejściem
  miał być wózek, a dziś wózka nie ma,
- **cały tryb kontenerowy** (0.22.0) — sesja z wózkiem, `putaway_sessions`
  i `putaway_items`, osiem tras i dwa ekrany. Kontener rozkłada się dziś jak
  każda inna dostawa, a przesunięcie stanu jest osobną czynnością,
- **tryb marszu** — nakładka „NASTĘPNE" po zatwierdzeniu wózka; istniała
  wyłącznie w sesji i nie ma dokąd jej przenieść,
- **rozkładanie zwrotów koszykami** — wejścia do tej ścieżki nie było od
  d131f75. Jej finał wymagał workera Sfery, którego wtedy nie było. Zwroty
  rozlicza biuro w Subiekcie (0.17.0).

Problemy P1–P4 z tamtej analizy są naprawione, a większość backlogu wykonana:

- skanowanie sprzętowe (Zebra/Honeywell) zastąpiło dotyk i chipy `DEMO_LOCS`,
- rozróżnienie kodu lokalizacji od EAN-u to dziś twarda walidacja,
- przełącznik „zamień / dodaj lokalizację" jest decyzją człowieka przy
  rozjeździe półek,
- odporność na dziury Wi-Fi daje trwały bufor offline (Room).

## 4. Backlog — co nadal boli

> **Przeslotowanie ma już narzędzie.** `npm run reslot` (opis w README
> i DEPLOY §7) liczy pion, nie odległość. Przy 342 m² przejście róg–róg to
> ~20 s. Pobranie z drabiny albo z podłogi trwa 10–25 s wobec ~3 s ze strefy
> złotej. Klasyczny argument za slottingiem ABC „po alejkach" nie broni się tu
> liczbowo.


1. **Podpowiedzi dla BRAK LOK.** Towar bez lokalizacji wymaga znalezienia
   miejsca. Aplikacja może podpowiadać pozostałe lokalizacje tego towaru.
   Może też podpowiadać lokalizacje towarów o podobnym symbolu.
2. **Korekta po przesunięciu.** Pomyłkowej lokalizacji nie trzeba cofać —
   wystarczy zeskanować właściwą półkę (dlatego mechanizm COFNIJ i jego karencja
   zostały usunięte). Pomyłkową ILOŚĆ poprawia od 0.45.0 przycisk POPRAW ILOŚĆ:
   podaje się liczbę całkowitą, a status pozycji przelicza się z niej sam. Ale
   pomyłkowego przesunięcia odkręcić się nie da — to wymagałoby drugiego,
   odwrotnego.
3. **Świeżość snapshotu.** Pozycje dostawy to snapshot z chwili
   otwarcia; korekta dokumentu przez księgowość w trakcie pracy nie dochodzi.
   Świadomy kompromis (postęp się nie rozjeżdża), ale przydałby się sygnał
   „dokument zmieniony od otwarcia".
4. **Dług danych w kartotece — większy, niż się wydawało.** Audyt z 2026-07-26
   naliczył **93 kody adresowe w 158 kartotekach**, których walidator nie
   przyjmuje. Wcześniejszy zapis („około 16 literówek") mylił się co do skali
   i co do rodzaju. Większość to nie pomyłki, lecz **trzy martwe konwencje**
   (`PALETA22`, `PAL38II`, `KT1`). Literówek jest 21.

   Żadna z tych konwencji nie jest już używana, więc odrzucanie ich jest
   poprawne. Poprawia się je po stronie Subiekta, nie aplikacji. Lista:
   [`adresy-do-poprawy.md`](adresy-do-poprawy.md).
5. **Dokumenty MM czekają na WŁĄCZENIE workera Sfery.** Proces istnieje
   (`sfera-worker/`). `SFERA_WORKER` zostaje jednak wyłączony do etapu 2
   wdrożenia (weryfikacja COM — [DEPLOY.md](../DEPLOY.md)); do tego czasu
   dokument wystawia biuro ręcznie. Otwarte pytanie: czy wystarczyłby
   **import EPP/EDI++** bez licencji Sfery. Rozstrzyga to jeden test na
   instalacji 1.87 SP3 HF1.
