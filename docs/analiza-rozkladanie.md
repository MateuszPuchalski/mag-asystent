# Analiza rozkładania towaru

Rozkładanie skonfrontowane z realiami pracy magazyniera na kolektorze.
Dokument opisuje stan obecny; co zniknęło i dlaczego, mówi `CHANGELOG.md`.

**Rozkładanie jest jedno.** Wszystkie dostawy idą tą samą ścieżką: dokument
jest jednostką pracy, a zapisem jest sam adres. Magazyn skutku mówi tylko,
co zostaje PO rozłożeniu.

| magazyn skutku | co to jest | co zostaje po odłożeniu |
|---|---|---|
| `MAG` | dostawa krajowa | nic — towar leży na hali z adresem |
| `MGP` | kontener importowy | stan do przesunięcia na halę |

Kontener nie ma osobnej ścieżki, bo przychodzi cztery razy w roku. Rozkłada
się jak każda dostawa, a przesunięcie stanu jest osobną czynnością (§2).

Kolektor przy rozkładaniu:

- skanuje sprzętowo (Zebra/Honeywell), bez dotyku i chipów z adresami,
- odróżnia kod lokalizacji od EAN-u twardą walidacją,
- przy rozjeździe półek zostawia człowiekowi wybór „zamień / dodaj
  lokalizację",
- przetrwa dziury Wi-Fi dzięki trwałemu buforowi offline (Room).

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
   Pełnoekranowa karta gasiłaby listę.

   Rozwinięty wiersz ma nagłówek z ✕ i **dwa kafle**: biały ze
   stepperem ilości i stanem na hali, ciemny z adresem i podpowiedzią skanu.
   Po lewej to, co magazynier ustawia; po prawej to, dokąd towar idzie.
4. **Zapis** — wyłącznie zadanie `set_location` do `sfera_queue`. Żadnego MM,
   żadnego `waiting_for_doc`.
5. **Domknięcie** (`closeIfComplete`) — dostawa zamyka się sama, gdy nie ma już
   czego rozkładać. Nie zamknie się jednak, dopóki wisi nieodpowiedziana
   notatka biura — bramka stoi w tej funkcji, a nie tylko przy przycisku.
   Nie zamknie się też sama z NADMIAREM ani z pozycją z WYJĄTKIEM.
   Nadmiar jest twierdzeniem wobec dostawcy, a wyjątek czeka na decyzję.
   Obie takie dostawy zamyka wyłącznie ZAKOŃCZ z podglądem.
6. **Wyjątek** (`raiseProblem`) — kategoria zna swój ZAKRES. Cztery
   dotyczą pozycji: zła ilość, brak w przesyłce, uszkodzone, błędny artykuł.
   Jedna dotyczy dostawy: artykuł niezamówiony, czyli towar spoza dokumentu.
   Walidacja działa w obie strony, więc kategoria dostawy nie przypnie się do
   pozycji ani odwrotnie.
7. **Zakończenie z ręki** (`zakonczDostawe`) — przycisk ZAKOŃCZ DOSTAWĘ
   pokazuje najpierw, co powstanie. Braki ilościowe pojadą do dostawcy jako
   wyjątek „zła ilość", a nadmiary jako nadmiar. Dla pozycji nietkniętych
   człowiek MUSI wybrać: BRAK („brak w przesyłce" na całą ilość, z MM braku)
   albo POMIŃ (bez zgłoszenia). Bez wyboru serwer odmawia z kodem
   `wybor_nietknietych`. Przycisk jest
   dla dostawy OTWARTEJ; po domknięciu z punktu 5 kolektor pokazuje w jego
   miejscu wyjście na listę. Odmowa „już zamknięta" niesie kod `juz_zamknieta`
   i też prowadzi na listę — cel jest wtedy osiągnięty.
8. **Korekta ilości** (`korygujIlosc`) — poprawka pomyłki w liczeniu, dopóki
   faktura jest otwarta. Ustawia liczbę bezwzględną, nie różnicę, i nie tworzy
   wyjątku. Korekta do zera cofa też adres, gdy stos odłożeń pokrywa całą
   ilość. Anuluje wtedy zapis w kolejce albo pisze adres sprzed dostawy.
9. **Cofanie pomyłek** (`services/cofanie-dostawy.ts`) — COFNIJ
   kolejne odłożenia od ostatniego, ZMIEŃ PÓŁKĘ, OTWÓRZ PONOWNIE w dniu
   zamknięcia, WYCOFAJ własne zgłoszenie. Granica przez Subiekta jak przy
   koszu: czekający zapis się anuluje, wykonany dostaje zapis odwrotny.

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
