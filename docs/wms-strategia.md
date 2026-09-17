# WERTIS jako WMS — materiał do decyzji

Dokument dla właściciela. Odpowiada na jedno pytanie: **co trzeba zrobić, żeby
WERTIS był pełnym systemem magazynowym i zastąpił Sellasist.**

> **Jak czytać ten dokument.** Opis stanu WERTIS pochodzi z kodu tego repo.
> Opis roli Sellasist pochodzi z tego, co o nim mówi repo: import zbiórek
> (`server/src/services/zbiorki.ts`) i UUID zamówienia w uwagach dokumentu
> Subiekta (`docs/subiekt-gt-struktura.md`). Nikt nie czytał jego umowy ani
> pełnej listy funkcji, z których firma korzysta. Sekcja 10 wypisuje wprost,
> czego nie wiem.

> **Styl.** Dokument jest uzasadnieniem decyzji, jak [`architektura.md`](architektura.md).
> Trzyma mimo to limity z [`slownik.md`](slownik.md), bo czyta go właściciel
> przed wydaniem pieniędzy.


---

## 1. Streszczenie decyzyjne

**Pytanie łączy dwa różne projekty.** Sellasist nie jest systemem magazynowym.
Jest platformą sprzedaży: przyjmuje zamówienia, pilnuje ofert, tworzy dokumenty
w Subiekcie i obsługuje kurierów. WMS rządzi przestrzenią, zapasem i pracą
wewnątrz czterech ścian. Zbudowanie WMS-a nie odejmuje z budżetu ani złotówki
opłaty za Sellasist.

**Większość tego, co sprzedaje się dziś jako „state of the art", jest tu
marnotrawstwem.** Magazyn ma 342 m² i około tysiąca czynnych kartotek. Przy tej
skali planowanie fal, zarządzanie pracą i optymalizacja trasy nie mają pokrycia
w oszczędności. Repo wyliczyło to już raz: przejście róg–róg trwa około 20
sekund.

**Wygrana leży gdzie indziej i jest duża.** Dziś WERTIS kończy się na przyjęciu
i wyszukiwaniu. Wydanie towaru — pobranie, pakowanie, kontrola przed zaklejeniem
kartonu — nie istnieje w kodzie wcale. To jest jedyne miejsce, w którym błąd
kosztuje zwrot, reklamację i ocenę na Allegro.

**Rekomendacja.** Buduj WMS. Nie buduj zamiennika Sellasist, dopóki WMS nie
pracuje i nie pokaże liczb. Kolejność stoi w sekcji 9.

| pytanie | odpowiedź krótka |
|---|---|
| Czy WERTIS może być pełnym WMS-em? | tak, w zakresie, który ma sens przy tej skali |
| Czy WERTIS może zastąpić Sellasist? | tak, ale to osobny projekt na kilkanaście miesięcy |
| Czy warto robić oba naraz? | nie |
| Co blokuje start? | model zapasu i dług niefunkcjonalny (sekcje 4 i 8) |

---

## 2. Co Sellasist robi, a czego WMS nie robi

Granica jest ostra i warto ją postawić przed liczeniem pieniędzy.

| praca | kto to robi dziś | czy WMS to przejmuje |
|---|---|---|
| sklep i oferty w kanałach | Sellasist | nie |
| stan wysyłany do Allegro | Sellasist | nie |
| przyjęcie zamówienia klienta | Sellasist | nie |
| dokument sprzedaży w Subiekcie | Sellasist | nie |
| etykieta kurierska i manifest | Sellasist | nie |
| lista zbiórki | Sellasist | **tak** |
| gdzie leży towar | WERTIS | **tak** |
| pobranie, pakowanie, kontrola | nikt | **tak** |
| inwentaryzacja | nikt | **tak** |
| uzupełnianie strefy złotej | nikt | **tak** |

Z tej tabeli wynika wniosek nieoczywisty. WMS zabiera Sellasistowi **jedną**
pozycję z sześciu, które ten wykonuje. Reszta to praca integracyjna z kanałami
i kurierami, czyli osobny program prac z sekcji 7.

---

## 3. Rozwidlenie, od którego zależy cała reszta: kto jest właścicielem stanu

To jest najważniejsza decyzja w całym dokumencie. Reszta projektu wynika z niej,
a nie odwrotnie.

Dziś właścicielem stanu jest Subiekt GT. WERTIS dokłada mu warstwę lokalizacji
i zapisuje dwa pola kartoteki. Tę granicę opisuje
[`architektura.md`](architektura.md) §1 i to ona daje dzisiejszemu systemowi
odporność. Najgorsze, co WERTIS może zrobić Subiektowi, to wpisać zły adres.

WMS tej granicy nie mieści. Pobranie z miejsca zmienia zapas w miejscu, a nie
tekst na kartotece. System musi wiedzieć, **ile czego leży pod adresem**, i musi
być tego zdania właścicielem.

### Trzy drogi

| droga | kto trzyma ilości | koszt | werdykt |
|---|---|---|---|
| A. cień z rozliczeniem | Subiekt sumy, WERTIS rozbicie na miejsca | stałe pilnowanie rozjazdu | **rekomendowana** |
| B. WERTIS trzyma stan | WERTIS, Subiekt dostaje dokumenty | Sfera COM na ścieżce krytycznej | odrzucona dziś |
| C. wyjście z Subiekta | WERTIS | przepisanie księgowości i KSeF | poza zakresem |

**Dlaczego A.** Subiekt zostaje księgą: faktury, VAT, KSeF, ceny. WERTIS zna
rozbicie sumy na miejsca i partie. Suma po miejscach musi się zgadzać z sumą
w Subiekcie, a rozjazd jest **zadaniem do wykonania**, nie cichym błędem.
Rekoncyliacja już istnieje w tym repo (`server/src/services/reconcile.ts`), więc
wzorzec jest znany.

**Dlaczego nie B.** Zapis dokumentów idzie przez COM Sfery, który nie jest
bezpieczny wątkowo i potrafi się zawiesić. Dziś zawieszenie kosztuje opóźnione
MM. Po przejściu na B kosztowałoby zatrzymanie wysyłki. Ostrzeżenie o tym stoi
w [`sfera-com.md`](sfera-com.md) i nie jest teoretyczne.

---

## 4. Czego brakuje w modelu danych

Dzisiejszy model lokalizacji to pole tekstowe kartoteki. Kody rozdziela spacja,
a pierwszy z nich jest lokalizacją pobrania (`server/src/locs.ts`). Kolumna ma
50 znaków, co opisuje [`subiekt-gt-struktura.md`](subiekt-gt-struktura.md).

To jest mapa „towar leży w tych miejscach". WMS potrzebuje odwrotnej: „w tym
miejscu leży tyle tego towaru". Różnica nie jest kosmetyczna. Bez ilości pod
adresem nie ma pobrania, nie ma inwentaryzacji i nie ma rezerwacji.

### Tabele do dołożenia

| tabela | po co | uwagi |
|---|---|---|
| `miejsce` | adres z typem, strefą, pojemnością i stanem | dziś adres jest ciągiem znaków bez bytu |
| `zapas` | ilość w układzie miejsce × kartoteka × partia | serce WMS-a |
| `ruch_zapasu` | każda zmiana jako zdarzenie, tylko dopisywane | saldo wylicza się z ruchów |
| `rezerwacja` | ile z miejsca jest obiecane zamówieniu | bez tego dwie zbiórki biorą tę samą sztukę |
| `zadanie` | pobranie, odłożenie, uzupełnienie, liczenie | `zadanie_terenowe` jest jego zalążkiem |
| `inwentura` | arkusz liczenia i jego rozliczenie | liczenie ciągłe, nie raz w roku |

**Najważniejsza z nich to `ruch_zapasu`.** Saldo, którego nie da się wyprowadzić
z listy zdarzeń, jest saldem, którego nie da się wytłumaczyć. Rozjazd z Subiektem
bez dziennika ruchów kończy się zdaniem „ktoś coś zrobił w zeszłym tygodniu".
Repo ma już ten nawyk w tabeli `events` i warto go dokończyć.

**Pole w Subiekcie zostaje, ale schodzi do roli projekcji.** Worker wpisuje tam
adres pobrania, żeby Subiekt dalej coś pokazywał. Prawdą przestaje być.

---

## 5. Wydanie towaru — właściwa wygrana

Tu leżą pieniądze i tu WERTIS nie ma dziś nic. Ekrany kolektora obsługują
przyjęcie, kartę towaru, zwroty, kosze i zadania z biura. Pobrania pod
zamówienie nie ma w kodzie.

### Przebieg do zbudowania

1. Zamówienie wchodzi i dostaje rezerwację na konkretnych miejscach.
2. System składa zbiórkę zbiorczą z kilku zamówień naraz.
3. Kolektor prowadzi po miejscach w kolejności rosnącej po adresie.
4. Magazynier skanuje miejsce, potem towar, potem podaje liczbę sztuk.
5. Brak na miejscu tworzy wyjątek i propozycję innego miejsca.
6. Stanowisko pakowania sprawdza zawartość kartonu skanem przed zaklejeniem.
7. Waga na stanowisku porównuje masę z sumą mas kartotek.
8. Etykieta i list przewozowy zamykają zamówienie.

### Dlaczego zbiórka zbiorcza, a nie jedna po drugiej

Przy zamówieniach na jedną–dwie pozycje chodzenie jest całym kosztem pobrania.
Wózek z przegrodami na osiem zamówień zamienia osiem przejść w jedno. To jedyna
optymalizacja trasy, która przy 342 m² ma sens — bo skraca liczbę przejść, a nie
długość jednego.

### Dlaczego kontrola przy pakowaniu jest punktem numer jeden

Firma prowadzi w panelu obsługi zwroty i reklamacje, z osią zdarzeń i werdyktem.
Istnienie tak rozbudowanego aparatu znaczy, że pomyłki wysyłkowe kosztują dużo.
Skan przy pakowaniu jest najtańszym możliwym miejscem na złapanie pomyłki.
Waga kontrolna łapie jeszcze te, których skan nie złapie, bo dane wymiarowe już
są (`server/src/services/wymiary.ts`).

**Zanim to powstanie, zmierz stan dzisiejszy.** Bez liczby pomyłek na sto
przesyłek każda obietnica poprawy jest nie do sprawdzenia.

---

## 6. Inwentaryzacja, uzupełnianie, slotting

### Inwentaryzacja ciągła zamiast rocznej

Roczna inwentaryzacja zatrzymuje magazyn i myli się dokładnie tam, gdzie liczy
się najszybciej. Liczenie ciągłe rozkłada tę pracę na cały rok. Kartoteki
z górnych 15% rotacji liczy się co miesiąc, resztę raz na rok.

Wyzwalacze liczenia biorą się z pracy, a nie z kalendarza:

- pobranie znalazło mniej sztuk, niż miało;
- miejsce wyszło na zero przy niezerowym stanie;
- kartoteka nie ruszyła się przez rok.

Dane o rotacji już są w tabeli `zbiorka`, więc podział na klasy jest gotowy do
policzenia.

### Uzupełnianie strefy złotej

Analiza kandydatów do strefy złotej już działa
(`server/src/services/strefa-zlota.ts`). Brakuje jej drugiej połowy: **zadania**.
Dziś system mówi, że towar stoi źle. Nie mówi nikomu, żeby go przeniósł, i nie
sprawdza, czy ktoś to zrobił. Przesunięcie jako operacja istnieje
(`server/src/services/przesuniecie.ts`), więc brakuje połączenia, nie mechanizmu.

### Slotting, czyli co optymalizować naprawdę

Repo ustaliło, że koszt siedzi w pionie i w martwych kartotekach. Reguła
rozmieszczenia wynika z tego wprost:

1. Wysoka rotacja idzie na wysokość rąk.
2. Ciężki towar idzie nisko, niezależnie od rotacji.
3. Martwa kartoteka schodzi ze strefy złotej bezwarunkowo.
4. Towar kupowany razem stoi obok siebie.

Punkt czwarty wymaga danych o koszykach, które import zbiórek już przynosi.

---

## 7. Co musiałoby powstać, żeby wyłączyć Sellasist

Ta lista jest kosztorysem, nie planem. Każda pozycja to osobna integracja
z cudzym API, własnym umownym kształtem i własnym utrzymaniem.

| co | stan w WERTIS | trudność |
|---|---|---|
| przyjęcie zamówień z Allegro | częściowo — `zamowienie_klienta` służy zwrotom, nie wysyłce | średnia |
| wysyłanie stanu do kanałów | brak | **wysoka** — sprzedaż towaru, którego nie ma, to koszt natychmiastowy |
| ceny i treść ofert | brak | wysoka |
| dokument sprzedaży w Subiekcie | brak, i świadomie | **wysoka** — to jest droga B z sekcji 3 |
| etykiety kurierskie | brak | średnia razy liczba kurierów |
| śledzenie przesyłki | częściowo (`server/src/services/allegro-tracking.ts`) | niska |
| zwroty pieniędzy | częściowo (`server/src/services/zwrot-pieniedzy.ts`) | średnia |
| sklep własny | brak | poza zakresem tego zespołu |

Dwie pozycje z tej tabeli zmieniają charakter całego systemu.

**Stan wysyłany do kanałów.** Dziś awaria WERTIS znaczy, że nie widać
lokalizacji. Po przejęciu tej pozycji awaria znaczy, że Allegro sprzedaje towar,
którego nie ma. To jest inna klasa ryzyka i wymaga innej gotowości.

**Dokument sprzedaży.** Wystawianie go oznacza wejście na drogę B, czyli
postawienie COM Sfery na ścieżce krytycznej wysyłki. Nie robimy tego bez
wcześniejszego dowodu wydajności i stabilności tego kanału.

---

## 8. Dług niefunkcjonalny, który blokuje wszystko

Ta sekcja jest warunkiem wstępnym, a nie listą życzeń. WMS jest systemem
produkcyjnym w innym znaczeniu niż podgląd lokalizacji.

| rzecz | stan dziś | co się zmienia po WMS |
|---|---|---|
| baza | jeden plik SQLite na jednym hoście | awaria zatrzymuje wysyłkę, nie podgląd |
| sieć | LAN bez szyfrowania | zamówienia klientów to inna klasa danych |
| kopie zapasowe | opisane w [`DEPLOY.md`](../DEPLOY.md) | potrzebny zmierzony czas odtworzenia |
| tryb awaryjny | brak | potrzebna procedura pracy na papierze |
| wsparcie | brak umowy, jeden autor | dyżur staje się obowiązkiem firmy |

**Procedura awaryjna jest tańsza niż nadmiarowy serwer.** Wydrukowana lista
zbiórki i ołówek pozwalają wysłać paczki przy padniętym serwerze. Bez tej
procedury pierwszy dłuższy przestój zatrzyma sprzedaż.

### Osobno: sposób pracy nad kodem

Repo ma ponad trzydzieści gałęzi zdalnych. Numery wydań zderzyły się cztery razy
w jeden dzień, a jedną funkcję zbudowano dwa razy i raz wyrzucono. Historia stoi
w [`CLAUDE.md`](../CLAUDE.md).

Projekt tej wielkości tego nie wytrzyma. Numer wydania powinien przydzielać
mechanizm przy scalaniu, a nie zwyczaj przy commicie. Ta sama lekcja co
z komentarzem „zgodnie z wersją monorepo": deklaracja nie jest mechanizmem.

---

## 9. Kolejność prac z bramkami

Każdy etap ma bramkę. Bramka jest liczbą, nie wrażeniem. Etap bez zaliczonej
bramki nie przepuszcza następnego.

### Etap 0 — pomiar stanu dzisiejszego

1. Policz pomyłki wysyłkowe na sto przesyłek.
2. Policz pozycje pobrane na godzinę pracy.
3. Przelicz zapas w pięćdziesięciu losowych miejscach.
4. Zbierz z umowy Sellasist listę realnie używanych funkcji.

**Bramka.** Cztery liczby na papierze. Bez nich nie ma czego poprawiać.

### Etap 1 — model zapasu

Tabele z sekcji 4 wchodzą w trybie cichym. Kolektor liczy i zapisuje, ale nic
w Subiekcie się nie zmienia. Rozjazd z Subiektem jest raportem.

**Bramka.** Zgodność zapasu w policzonych miejscach powyżej 98%.

### Etap 2 — wydanie towaru

Zbiórka, pobranie, pakowanie i kontrola. Zamówienia wchodzą **eksportem
z Sellasist**, dokładnie tak jak dziś wchodzą zbiórki. Sellasist zostaje.

**Bramka.** Pomyłki wysyłkowe spadły, pozycje na godzinę wzrosły. Porównanie
z etapem 0.

### Etap 3 — praca sama się rozdziela

Liczenie ciągłe, uzupełnianie strefy złotej, zadania z analizy rozmieszczenia.

**Bramka.** Magazynier bez zleceń z biura ma co robić i wie to z ekranu.

### Etap 4 — kanały, jeden po drugim

Dopiero teraz. Najpierw Allegro, bo token, specyfikacja i dyscyplina kształtu
już są. Każdy kanał osobno, z możliwością powrotu do Sellasist.

**Bramka.** Kanał pracuje miesiąc bez sprzedaży towaru, którego nie ma.

### Etap 5 — decyzja o Sellasist

Wyłączenie albo pozostawienie sklepu. Decyzja z liczbami, nie z ambicji.

---

## 10. Czego nie wiem

Dokument jest w tych miejscach warunkowy celowo. Odpowiedzi zmieniają wnioski,
a nie tylko szczegóły.

1. Czy Sellasist prowadzi też sklep, czy tylko zamówienia?
2. Ile zamówień dziennie wychodzi i ile mają pozycji?
3. Którzy kurierzy i z jakim udziałem?
4. Kto dziś wysyła stan do Allegro i jak często myli się o sztukę?
5. Ile kosztuje Sellasist i jaki ma okres wypowiedzenia?
6. Czy faktury wychodzą z Subiekta, a Sellasist tylko zakłada dokumenty?

Odpowiedź na pytanie piąte rozstrzyga sens całej sekcji 7. Zamiennik Sellasist
napisany po to, żeby przestać płacić abonament, jest opłacalny dopiero przy
kwocie, której nie znam.

---

## 11. Jak WMS łączy się z OMS i z Subiektem

Sekcje 1–10 mówią, CO zbudować. Ta mówi, JAK to spiąć z systemem sprzedaży
i z Subiektem. Pytanie techniczne sprowadza się do jednego pytania
organizacyjnego: **który system ma prawo się mylić w danej sprawie.**

### 11.1. Tabela własności faktów

Tę tabelę pisze się przed pierwszą linijką kodu integracji.

| fakt | właściciel | reszta |
|---|---|---|
| kartoteka: symbol, nazwa, kod kreskowy, jednostka | Subiekt | kopia do odczytu |
| cena, kontrahent, faktura, VAT, KSeF | Subiekt | kopia do odczytu |
| stan na magazynie — liczba księgowa | Subiekt | liczy z niej |
| **ilość pod adresem, w partii, na palecie** | **WMS** | Subiekt tego nie widzi |
| **która sztuka jest obiecana któremu zamówieniu** | **WMS** | OMS widzi status |
| zamówienie, kanał, płatność, sposób wysyłki | OMS | WMS dostaje zlecenie |
| **ilość wolna do sprzedaży w kanale** | **OMS, liczona z WMS** | — |
| etykieta kurierska i numer listu | OMS | WMS drukuje |

Wiersz trzeci i czwarty wyglądają na tę samą rzecz i nią nie są. Subiekt trzyma
**saldo księgowe**, a WMS **wynik liczenia**. Zgadzają się dopiero po
zaksięgowanym dokumencie, a między dokumentami różnią się zawsze. Ta różnica
jest normalna i ma być MIERZONA, a nie zakazana.

### 11.2. Trzy powierzchnie integracji mają różną fizykę

| powierzchnia | mechanizm | koszt błędu |
|---|---|---|
| odczyt z Subiekta | `SELECT` co 60 s, konto tylko do odczytu | żaden, powtórz |
| zapis do Subiekta | kolejka zadań i worker Sfery | dokument do wycofania ręką |
| zlecenie z OMS i wynik do OMS | wąski kontrakt pracy | zamówienie stoi |

Odczyt wolno powtarzać, gubić i opóźniać. Zapis nie: jest wolny, bywa się
zawiesza, a jego skutek zostaje w księgach. Dlatego zapis idzie przez kolejkę
z ponowieniem, nigdy wprost z trasy HTTP.

**To już stoi w repo.** `sfera_queue` ma stany, trzy próby, backoff i numer
dokumentu w odpowiedzi. Tabele `sgt_*` są modelem odczytu, a `sgt_stan` pokazuje
liczbę Subiekta skorygowaną o kolejkę (`server/src/services/stock.ts`). Nowy
WMS nie wymyśla tego drugi raz — dokłada do tego własny dziennik ruchów.

### 11.3. WMS a system sprzedaży

OMS nie ma wiedzieć o adresach regałowych. WMS nie ma wiedzieć o formach
płatności. Kontrakt jest wąski w obie strony.

Z systemu sprzedaży do WMS:

1. Zamówienie ZWOLNIONE do realizacji, z pozycjami i sposobem wysyłki.
2. Anulowanie pozycji albo całego zamówienia, jako PROŚBA.

Punkt drugi jest miejscem, w którym tanie integracje pękają. WMS musi mieć
prawo odpowiedzieć „za późno, jest spakowane". Anulowanie bez tej odpowiedzi
wysyła paczkę, za którą nikt nie zapłacił.

Z WMS do systemu sprzedaży:

1. Rezerwacja potwierdzona albo braki na pozycji.
2. Zbiórka skończona, karton spakowany, masa i wymiary zmierzone.
3. Przesyłka nadana, numer listu przewozowego znany.

**Ilość wolna do sprzedaży to WYNIK WMS, nie liczba z Subiekta.** Liczy się ją
tak: stan w miejscach nadających się do sprzedaży, minus rezerwacje, minus
kwarantanna, minus towar liczony w tej chwili. Wysłanie do kanału liczby
z Subiekta sprzedaje zwrot leżący w kwarantannie i ostatnią sztukę dwa razy.

Wysyłaj **wartość bezwzględną, nie różnicę**. Zgubiona różnica zostaje w danych
na zawsze, a zgubiona wartość bezwzględna poprawia się przy następnej wysyłce.

### 11.4. WMS a Subiekt: odczyt i zapis to dwie różne technologie

| | odczyt | zapis |
|---|---|---|
| kanał | MSSQL, konto tylko do odczytu | COM Sfery, proces C# |
| czas | milisekundy | sekundy, czasem zawieszenie |
| równoległość | dowolna | **szeregowo, COM nie jest bezpieczny wątkowo** |
| błąd | powtórz | dokument częściowy, trzeba wycofać |

Dwie cechy Subiekta rozstrzygają kształt zapisu i obie stoją już w tym repo.

**Nie ma transakcji obejmującej dwa dokumenty.** Mówi to wprost komentarz
w `server/src/adapters/sfera.ts`: gdy MM się nie uda, korekta zostaje usunięta
ręką implementacji. Każda operacja WMS tworząca dwa dokumenty potrzebuje tego
samego wzorca — jedno zadanie kolejki z własnym wycofaniem.

**Bufor dokumentu to maszyna stanów, nie znacznik.** Znaczenia `dok_Status`
opisuje [`subiekt-gt-struktura.md`](subiekt-gt-struktura.md). Dokument w buforze
NIE przesunął stanu. Kto uzna „dokument powstał" za „towar się ruszył", zobaczy
skutek dopiero przy liczeniu.

### 11.5. Ile dokumentów przybędzie

| zdarzenie fizyczne | dokument | dziś | po etapie 2 |
|---|---|---|---|
| przyjęcie dostawy | PZ albo adnotacja na FZ | ręcznie, 7–8 na tydzień | tak samo |
| odłożenie MGP → MAG | MM | rzadko | przy każdej dostawie |
| **pobranie i wysyłka** | **WZ albo dokument sprzedaży** | **nie ma** | **przy każdym zamówieniu** |
| powrót zwrotu na stan | MM i korekta sprzedaży | jest | tak samo |
| różnica z liczenia | PW albo RW | nie ma | co tydzień |

Ostatni wiersz tabeli zmienia ryzyko całego systemu. Dziś Sfera wystawia kilka
dokumentów tygodniowo. Po etapie 2 stoi między spakowanym kartonem a wysłanym
zamówieniem, czyli na ścieżce krytycznej.

**Zmierz jej przepustowość i zachowanie przy zawieszeniu, zanim się na niej
oprzesz.** To jest ta sama granica, którą sekcja 3 odrzuca jako drogę B.

### 11.6. Pięć rzeczy, które psują integracje

1. **Powtórzone polecenie tworzy drugi dokument.** Klucz sprawy przed
   wywołaniem, sprawdzenie po niejasnym błędzie.
2. **Brak rekoncyliacji.** Suma z miejsc musi się równać stanowi z Subiekta,
   codziennie i automatycznie.
3. **Ekran pokazujący surową liczbę z Subiekta.** Pokaż ją skorygowaną
   o kolejkę i nazwij to, co jest w drodze.
4. **Jednostki.** Sprzedaż idzie w sztukach, dostawa w kartonach po dwadzieścia
   cztery; hierarchia opakowań należy do WMS.
5. **Zwroty dotykają trzech systemów naraz.** OMS zgadza się na zwrot, WMS mówi
   co wróciło, Subiekt oddaje pieniądze.

Rekoncyliacja nie jest skryptem na później. `server/src/services/reconcile.ts`
ma dziewięć rodzajów rozjazdu i właściwą zasadę w komentarzu: niezmienniki
trzeba mierzyć, nie deklarować. WMS dokłada do tej listy jeden wpis i jest to
wpis najważniejszy.

### 11.7. Czego nie robić

- **Dwukierunkowej synchronizacji stanu.** Jedna strona liczy, druga zapisuje.
- **Zapisu wprost do tabel Subiekta.** Pominięcie Sfery pomija numerację
  i skutki magazynowe.
- **Wspólnej bazy między OMS a WMS.** Wspólna tabela to wspólna awaria.
- **Zapisu synchronicznego na ścieżce wysyłki.** Zawieszenie COM zatrzyma
  wtedy pakowanie.
- **Porządkowania zdarzeń po czasie z zegara.** Numeruj je rosnąco.

### 11.8. Co z tego WERTIS ma już dziś

| powierzchnia | stan |
|---|---|
| model odczytu z Subiekta | jest — tabele `sgt_*`, odświeżanie co 60 s |
| kolejka zapisu do Subiekta | jest — `sfera_queue` i worker |
| rekoncyliacja | jest — `server/src/services/reconcile.ts` |
| klucz idempotencji | jest dla Allegro — `server/src/services/idempotencja.ts` |
| dziennik ruchów zapasu | **brak** — `events` jest audytem, nie saldem |
| kontrakt z systemem sprzedaży | **brak** — dziś plik CSV w jedną stronę |

Brakuje więc nie techniki integracji, tylko własnej liczby do zintegrowania.
Dopóki nie ma `zapas` i `ruch_zapasu`, nie ma czego rozliczać ze stanem
Subiekta ani z czego liczyć ilość wolną do sprzedaży.

Stąd kolejność z sekcji 9. Najpierw dziennik ruchów, potem kontrakt z systemem
sprzedaży w jedną stronę, a zapis dokumentów wydania dopiero po zmierzeniu
Sfery.
