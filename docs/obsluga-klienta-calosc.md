# Obsługa klienta od końca do końca — dekalog i spoiwo

Ten dokument rozstrzyga spory o kształt obsługi klienta jako CAŁOŚCI. Nie jest
projektem ekranu ani rejestrem decyzji. Jest listą reguł, które obowiązują
WSZYSTKIE cztery kolejki naraz, i planem tego, co ma je połączyć.

Trzy dokumenty dzielą się pracą tak:

| dokument | odpowiada na pytanie |
|---|---|
| `docs/obsluga-klienta.md` | dlaczego tak postanowiono i jaki dowód za tym stoi |
| `docs/panel-obslugi-klienta.md` | jak wygląda docelowy panel i co już działa |
| ten plik | co obowiązuje MIĘDZY kolejkami i co je spina |

Zasady nadrzędne z `panel-obslugi-klienta.md` §27 zostają bez zmian. Tamte
mówią o jednej rozmowie. Ten dekalog mówi o drodze klienta przez cztery
kolejki i nie powtarza tamtych punktów bez potrzeby.

## Zakres

Dekalog obowiązuje panel obsługi (`panel/`), trasy obsługi
(`server/src/routes/`) i serwisy, które one wołają. Obowiązuje też każdy nowy
ekran, na którym pracuje biuro nad sprawą klienta.

Magazyn ma własny dekalog — `docs/ergonomia-magazynu.md`. Punkty 1, 2, 5, 6
i 10 tamtego obowiązują biuro i ten dekalog ich nie unieważnia.

> **Dlaczego osobny dokument, a nie kolejny rozdział panelu.** Projekt panelu
> ma ponad pięć tysięcy wierszy i rośnie z każdym wydaniem. Reguła schowana
> w rozdziale 25c przestaje bramkować cokolwiek po pierwszym sporze. Ten plik
> czyta się przed zmianą, nie po niej.

## Diagnoza: cztery kolejki, jeden klient

Panel prowadzi cztery kolejki: skrzynkę rozmów, zwroty, reklamacje
i dyskusje. Każda ma własny ekran, własne sito „Moje" i własny zegar. Klient
ma jedną sprawę i przechodzi przez nie po kolei.

**Wiązania między kolejkami są NIEPEŁNE i niesymetryczne.** Mostkiem jest
numer zamówienia: `message.related_order_id`, `zwrot_klienta.order_id`
i `reklamacja_klienta.order_id`. Mostek istnieje, ale nie każdy ekran po nim
przechodzi.

| z ekranu | widzi rozmowy | widzi zwroty | widzi reklamacje | widzi dyskusje |
|---|---|---|---|---|
| rozmowa | — | tak (0.221.0) | **0.386.0** | **0.386.0** |
| zwrot | tak (0.169.0) | — | **0.386.0** | **0.386.0** |
| reklamacja | tak | tak | — | **0.386.0** |
| dyskusja | tak | tak | **0.386.0** | — |

Reklamacja i dyskusja biorą starsze wiązania z jednej funkcji
`kontekstZamowienia` — dlatego tamte wiersze są bez numerów wydań, a nie
z domysłem.

**Do 0.386.0 zbudowanych było pięć przejść z dwunastu.** Brakujące siedem
miało jeden wspólny kształt: żaden ekran nie widział sprawy POSPRZEDAŻOWEJ.
Agent odpowiadający na pytanie nie wiedział, że ten sam klient ma otwartą
reklamację. Dowód stał w źródle: `services/skrzynka.ts` importował
`listaZwrotow`, a `reklamacje.ts` nie importowało niczego ze skrzynki.

Siedem brakujących domyka `services/droga-klienta.ts` jednym mostkiem po
numerze zamówienia. Zero nowych tabel i zero żądań do Allegro.

**Historia klienta pomijała trzy kolejki z czterech** — do 0.386.0.
`services/klient-historia.ts` składał oś z zakupów i rozmów, choć zwrot
i sprawa wiążą się tym samym loginem. Zakładka KLIENT obiecywała historię
i pokazywała jej połowę. Od 0.386.0 niesie wszystkie pięć rodzajów wpisów.

**Reklamacja i dyskusja leżą w JEDNEJ tabeli, a nie widziały się nawzajem.**
`reklamacja_klienta` rozróżnia je kolumną `typ`. Dyskusja, która urosła
w reklamację, jest osobnym wierszem, a przejścia nie zapisywał nikt. To jest
najważniejszy moment całej obsługi i nie zostawiał śladu.

Od 0.386.0 ślad jest, ale NIE JAKO ZAPIS. Przeskok wylicza się z momentów
otwarcia, które i tak leżą w bazie — `drogaZakupu` w `droga-klienta.ts`.
Zdarzenie dopisywane przy synchronizacji dokładałoby drugą prawdę o tym samym
fakcie, a dwie prawdy rozjeżdżają się przy pierwszej poprawce jednej z nich.

**Nakładka spraw spinała wyłącznie rozmowy — i odeszła w 0.388.0.**
`sprawa_klienta` była klamrą z tytułem i listą wątków, zakładaną ręką. Droga
zakupu robi to samo automatycznie i przez cztery kolejki, więc dwa paski nad
jedną rozmową zostały jednym. To punkt 3 dekalogu zastosowany do nas samych.

Cena jest zapisana jawnie: dwóch rozmów o jednym problemie BEZ wspólnego
zamówienia nikt już nie sklei.

## Dekalog obsługi klienta

### 1. Jeden klient, jedna historia

Podział na cztery kolejki jest NASZ, nie jego. Klient pisze o jednej sprawie
i oczekuje, że wiemy o niej wszystko.

**U nas.** Zakładka KLIENT w rozmowie zbiera zakupy i rozmowy po loginie
(`services/klient-historia.ts`). Zwrot pokazuje wiadomości o tym zakupie.

**Zabrania.** Kazania agentowi otwierać drugi ekran po to, żeby dowiedzieć
się, czy ten klient już u nas był.

### 2. Każdy przeskok między kolejkami jest faktem

Pytanie staje się dyskusją, dyskusja reklamacją, reklamacja zwrotem. To jest
ta sama sprawa w czwartym ubraniu.

**U nas.** Dziś przeskok da się odczytać wyłącznie z numeru zamówienia
i z czasu. Zapisu nie ma po żadnej stronie.

**Zabrania.** Traktowania nowej sprawy jako początku. Sprawa, która przyszła
po reklamacji tego samego zamówienia, zaczyna się z historią.

### 3. Kontekst wchodzi za sprawą, nie za ekranem

Zamówienie, oferta, kartoteka, zdjęcia i zegar mają wyglądać tak samo
w każdej z czterech kolejek. To ta sama wiedza o tym samym zakupie.

**U nas.** `kontekstZamowienia` z `services/reklamacje.ts` obsługuje już
reklamacje i dyskusje. Skrzynka i zwroty składają kontekst po swojemu.

**Zabrania.** Drugiego mapowania tych samych pól pod inną nazwą. Pole opisane
raz ma jedną drogę odczytu, tak jak ma jedną drogę zapisu.

### 4. Zegar rządzi kolejnością, a sprawa bez zegara dostaje własny

Termin jest osobnym bytem i to on ustawia pracę. Reklamacja bierze go
z Allegro, zwrot z ustawy, dyskusja nie ma go wcale.

**U nas.** `decisionDueDate` przy reklamacji i termin ustawowy przy zwrocie
sterują kolejnością. Dyskusje liczą pilność bez zegara (§25c.4), a rozmowy nie
mają terminu odpowiedzi w ogóle.

**Zabrania.** Sortowania po dacie wpływu tam, gdzie istnieje termin. Blizna
0.121.0 mówi, co kosztuje nazwanie jednego zegara drugim.

### 5. Eskalacja jest sygnałem i podlega pomiarowi

Klient, który po pytaniu składa reklamację, powiedział nam coś o naszej
odpowiedzi. Ta liczba jest miarą obsługi, nie porażką agenta.

**U nas.** Skuteczność doboru mierzymy od 0.267.0, czas wymiany z halą od
0.361.0. Eskalacji nie mierzy nic.

**Zabrania.** Liczenia wyłącznie spraw domkniętych. Kolejka pusta przy rosnącej
eskalacji jest miarą, która kłamie.

### 6. Jedna droga na zewnątrz

Odpowiedź do klienta wychodzi jedną maszynerią: skrzynka nadawcza, klucz
idempotencji liczony przez serwer, kontrola świeżości i jawna zgoda przy
konflikcie.

**U nas.** `services/idempotencja.ts` jest wspólny dla skrzynki i spraw
posprzedażowych od 0.224.0. Świeżość liczy się od ostatniej NIE naszej
wiadomości.

**Zabrania.** Piątego kanału wysyłki z własnym kluczem. Kanał bez kontroli
świeżości cicho nadpisuje odpowiedź kolegi.

### 7. Kto ma ruch, wylicza się z faktów

Status bierze się z tego, co i tak zapisujemy: przyszła wiadomość, poszła
odpowiedź, zlecono pomiar, wrócił wynik. Ręką stawia się wyłącznie to, czego
automat nie ma z czego policzyć.

**U nas.** `statusZKierunku` liczy piłkę od 0.225.0, a trasa przyjmuje tylko
`STATUSY_RECZNE`. Autoodpowiedź nie liczy się jako nasz ruch (0.227.0).

**Zabrania.** Pola statusu, które agent musi pamiętać przestawić. Status, który
kłamie, jest gorszy od jego braku.

### 8. Zdarzenia wiszą przy źródle

Klamra nad sprawami niczego nie przechwytuje. Historia zostaje przy rozmowie,
przy zwrocie i przy reklamacji, a wspólny widok ją tylko CZYTA.

**U nas.** Sprawa klienta nie ma własnej osi i to jest decyzja, nie brak
(blizna 0.130.0). Oś zwrotu składa się ze zdarzeń zwrotu (0.313.0).

**Zabrania.** Piątej tabeli ze wspólnym statusem nad czterema kolejkami.
Poprzednia odpowiedź o tym kształcie kosztowała cztery tabele nakładki.

### 9. Nieodwracalne pyta, odwracalne się cofa

Potwierdzenie dostaje wyłącznie to, czego nie da się odkręcić: pieniądze,
odmowa, werdykt, zakończenie dyskusji. Reszta ma cofnięcie.

**U nas.** Zwroty mają cofnięcia od 0.79.0, notatka i korekta swoje własne.
Werdykt reklamacji stoi za `autoryzuj("reklamacja_werdykt")`.

**Zabrania.** Dialogu „czy na pewno" przy czynności, którą i tak da się cofnąć
jednym kliknięciem. Potwierdzenie zapalane zawsze uczy klikać „tak".

### 10. Czego nie wiemy, ekran mówi wprost

Sprawa niepełna ma to napisać zdaniem. Obietnica bez pokrycia kosztuje
zaufanie do całego ekranu.

**U nas.** Rozmowa dłuższa niż pięćset wiadomości dostaje `czat_urwany`
zamiast obietnicy (0.273.0). Zwrot mówi wprost, że pełnej kwoty nie zna bez
zamówienia.

**Zabrania.** Pustej linii w miejscu odmowy integracji. Powód zapisuje się
SŁOWEM, nie samym kodem HTTP (blizna 0.152.0).

## Spoiwo — sześć kroków, stan na 0.386.0

Kolejność była od najtańszego. Pięć kroków stoi, szósty czeka na decyzję —
i to jest jedyny, którego nie da się rozstrzygnąć kodem.

### S1. Kontekst posprzedażowy w każdej z czterech kolejek — **stoi**

Rozmowa i zwrot pokazują sprawy posprzedażowe tego zamówienia, a sprawa
posprzedażowa — swoje rodzeństwo bez siebie samej. Siedem brakujących przejść
zamknęło jedno zapytanie po `order_id` w `services/droga-klienta.ts`.

Bez nowej tabeli. Blok na ekranie jest JEDEN dla czterech kolejek
(`panel/src/sprawy/Spoiwo.tsx`) — agent rozpoznaje go, zamiast uczyć się
drugiego układu.

**Czego to spoiwo nie zrobi.** W rozmowie mostek rusza dopiero wtedy, gdy
zamówienie jest u nas pobrane — tak samo, jak blok zwrotu od 0.221.0.
Rozmowa z numerem zamówienia, którego jeszcze nie dociągnęliśmy, nie pokaże
spraw. Dwie różne odpowiedzi o tym samym zakupie na jednym ekranie byłyby
gorsze od jednej spóźnionej.

**Druga dziura, zamknięta w 0.397.0: rozmowa BEZ NUMERU zamówienia.** Zgłoszenie
właściciela ze zrzutem — klient napisał pod ofertą „otrzymałem paczkę, ale nie
było w zestawie świecy", a rozmowa nie miała zakupu wcale. Powód leży po
stronie Allegro: wątek niesie JEDEN obiekt powiązany i przy pytaniu spod oferty
jest nim oferta. Numeru zamówienia w tym ładunku nie ma i nie będzie.

Mostkiem zastępczym jest LOGIN kupującego — ten sam, którym chodzi zakładka
KLIENT (S2). `services/zamowienia-kandydaci.ts` układa zakupy tego loginu,
podnosi ten, który niesie ofertę z rozmowy, a wiąże dopiero kliknięcie agenta.
Automat wybierający za człowieka pomyliłby się cicho, i to przy sprawie
o pieniądze.

To jest wyjątek od reguły „dokładając kolejkę, dopisujesz wiązania po numerze
zamówienia w obie strony": tutaj numeru po prostu nie ma. Wiązanie po loginie
wolno nam wyłącznie dlatego, że oba pola przychodzą wprost z Allegro —
`allegro_inbox_thread.interlocutor_login` i `zamowienie_klienta.kupujacy_login`.

### S2. Historia klienta kompletna — **stoi**

`services/klient-historia.ts` dokłada do osi zwroty, reklamacje i dyskusje po
loginie kupującego. Zakładka KLIENT zaczyna odpowiadać na pytanie, które sama
zadaje.

Wiązanie po LOGINIE wolno tu i tylko tu: zwrot i sprawa niosą `kupujacy_login`
wprost z Allegro. Przy rozmowach ten sam ruch byłby błędem — `conversation`
loginu nie trzyma, a rozmówca bywa zamaskowany (blizna 0.56.6).

### S3. Przeskok jako fakt — **stoi, ale jako ODCZYT**

Projekt mówił „zdarzenie dopisywane przy synchronizacji". Zapis okazał się
zbędny: moment otwarcia każdego bytu leży w bazie, więc droga wylicza się
z kolejności (`drogaZakupu`). Ekran pokazuje ją jednym paskiem.

Drugi zapis tego samego faktu rozjechałby się z pierwszym przy pierwszej
poprawce. Odczyt ma też drugą zaletę: otwarcie ekranu niczego nie mutuje.

### S4. Jedno „Moje" ponad kolejkami — **stoi, dla TRZECH kolejek**

Ekran `/obsluga/moje` składa jedną listę z rozmów, reklamacji i dyskusji.
Kliknięcie prowadzi na ekran właściwej kolejki, bo tam stoją bramki sprawy.

**Zwrotu na tej liście NIE MA i to poprawka do tego projektu.** Projekt mówił
„cztery źródła", a w 0.370.0 właściciel zdjął ze zwrotu znacznik prowadzącego:
zwrot przechodzi przez biuro jako kolejka decyzji, nie jako czyjaś sprawa.
Kolumny `prowadzi_*` zostały w tabeli, ale nikt ich nie pisze. Wskrzeszenie
znacznika przy okazji innej funkcji odwracałoby tamtą decyzję bez słowa.

Kolejność ma DWA PIĘTRA: najpierw sprawy z terminem, wedle terminu, potem
reszta, wedle ostatniego ruchu. Jedno pole na oba zegary postawiłoby sprawę
ruszoną wczoraj nad sprawą, której termin mija jutro — blizna 0.121.0.

### S5. Miara eskalacji — **stoi**

Ile zakupów z rozmową skończyło się dyskusją albo reklamacją, miesiącami.
Karta stoi za zębatką, pod skutecznością doboru: tamta mierzy naszą pracę,
ta jej skutek u klienta.

Liczy ZAKUPY, nie sprawy i nie wiadomości. Trzy wiadomości i jedna reklamacja
przy jednym zamówieniu to jedna eskalacja — inaczej miara nagradzałaby
milczenie agenta. Sprawa otwarta przed pierwszą wiadomością nie liczy się
wcale, bo nie wynika z naszej odpowiedzi.

**Bez osi osobowej, celowo.** Ta liczba mówi o naszych odpowiedziach jako
całości; rozbita na ludzi byłaby oceną pracownika liczoną z cudzej decyzji.

### S6. Zamknięcie sprawy klienta — **czeka na decyzję właściciela**

Kiedy sprawa klienta jest skończona, skoro składa się z bytów o czterech
właścicielach danych. Kodem tego nie da się rozstrzygnąć: „zamknięte" znaczy
co innego dla Allegro, dla ustawy i dla biura.

Droga zakupu (S3) jest materiałem do tej decyzji i dlatego powstała pierwsza.
Pokazuje, ile przystanków ma typowa sprawa i gdzie się kończy — a bez tych
liczb każda definicja zamknięcia byłaby domysłem. Od domysłów ten projekt
właśnie odchodzi.

## Mapa możliwości

Tabela odpowiada na pytanie „gdzie to ląduje". Kolumna trzecia jest ważniejsza
od drugiej: nazywa dziurę, a nie funkcję.

| sytuacja klienta | gdzie ląduje dziś | czego brakuje |
|---|---|---|
| pytanie przed zakupem | skrzynka, rozmowa bez zamówienia | terminu odpowiedzi (§26) |
| pytanie o dobór części | skrzynka, zakładka Dobór | — |
| pytanie o dostawę i termin | skrzynka | — |
| prośba o fakturę albo korektę | skrzynka, ręcznie | drogi do Subiekta bez przepisywania |
| paczka nieodebrana | zwroty, `zrodlo` osobne (0.172.0) | — |
| zwrot ustawowy w 14 dni | zwroty, kubełki bramek | — |
| zwrot częściowy | zwroty, zaznaczenie pozycji | — |
| towar uszkodzony w transporcie | reklamacje albo dyskusja | wskazania przewoźnika jako winnego |
| reklamacja z rękojmi i gwarancji | reklamacje, `prawo` | — |
| dyskusja przed reklamacją | dyskusje (0.245.0), wiązanie od 0.386.0 | zegara |
| prośba o rabat zamiast zwrotu | rabat transakcyjny (0.164.0) | — |
| pytanie reklamacyjne bez sprawy w Allegro | skrzynka, znacznik „reklamacyjna" (0.390.0) | zegara — rozmowa nie ma terminu (§26) |
| wymiana na inny towar | NIGDZIE | decyzji: zwrot z nowym zamówieniem czy osobny byt |
| brak towaru na stanie | rozmowa plus zadanie terenowe | — |
| klient wraca po miesiącu | rozmowa plus pełna historia (0.386.0) | — |
| klient pisze z drugiego konta | dwie historie, bez wiązania | świadomej odpowiedzi „nie wiążemy" |
| klient milczy po naszym pytaniu | kubełek BEZ RUCHU w reklamacjach | tego samego w skrzynce i zwrotach |
| doradca Allegro w rozmowie | rola autora inna niż `SELLER` | — |
| spam i zaczepka | status `spam`, ręcznie | — |
| sprawa poza Allegro: telefon, e-mail | NIGDZIE | decyzji o drugim kanale |
| sprawa trafia do sądu albo do UOKiK | NIGDZIE | eksportu całej historii sprawy |

**Czwarta zeszła w 0.390.0.** Klient pytający „mam składać reklamację, czy
inaczej to załatwimy" nie miał gdzie zostać oznaczony. Sprawy w Allegro
sprzedawca nie założy — `/sale/issues` ma wyłącznie GET — więc znacznik jest
NASZ i zostaje przy rozmowie.

**Trzy dziury zeszły z tej tabeli w 0.386.0.** Historia klienta bez zwrotów
i spraw, dyskusja bez wiązania z reklamacją, brak jednego miejsca na własną
pracę. Reszta stoi.

**Dwie pozycje „NIGDZIE" są największe.** Wymiana towaru jest codzienna
w handlu częściami i nie ma dziś żadnego miejsca w aplikacji. Drugi kanał
przesądza o tym, czy panel jest obsługą klienta, czy obsługą Allegro.

## Czego ten projekt NIE robi

Nie buduje piątej kolejki ani wspólnej tabeli spraw ze wspólnym statusem.
Cztery byty mają czterech właścicieli danych i to jest cecha, nie usterka.

Nie buduje trzeciego frontu. Nie przenosi obsługi klienta do `biuro.html`
i nie przenosi magazynu do panelu.

Nie zmienia granicy automatu. Do klienta nadal mówi wyłącznie człowiek.

## Otwarte decyzje właściciela

Czy wchodzi drugi kanał poza Allegro. Czy wymiana towaru dostaje własny byt.
Kiedy sprawa klienta jest zamknięta. Czy rozmowa dostaje termin odpowiedzi.
Czy dwa konta jednego człowieka wiążemy ręką.

Pierwsze dwa pytania są większe od reszty razem wziętej. Każde z nich zmienia
kształt aplikacji, nie kształt ekranu.

## Blizny, których to spoiwo nie ma kupić drugi raz

| blizna | czego pilnować przy łączeniu kolejek |
|---|---|
| 0.121.0 | dyskusja nie jest reklamacją; zegar jednej nie nazywa się zegarem drugiej |
| 0.130.0 | zdarzenia wiszą przy źródle, a wspólny widok wyłącznie je czyta |
| 0.140.0 | nakładka spraw z własnym statusem kosztowała cztery tabele |
| 0.152.0 | powód odmowy zapisuje się słowem, nie samym kodem odpowiedzi |
| 0.157.0 | ta sama rzecz zbudowana dwa razy w dwóch gałęziach; sprawdź, co już stoi |
| 0.224.1 | pole nieopisane w typie ciała znika po cichu na trasie |
