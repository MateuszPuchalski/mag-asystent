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
| rozmowa | — | **tak** (0.221.0) | nie | nie |
| zwrot | **tak** (0.169.0) | — | nie | nie |
| reklamacja | **tak** | **tak** | — | nie |
| dyskusja | **tak** | **tak** | nie | — |

Reklamacja i dyskusja biorą oba wiązania z jednej funkcji
`kontekstZamowienia` — dlatego wiersze są tu bez numerów wydań, a nie z domysłem.
Dwanaście możliwych przejść, z tego pięć zbudowanych. Brakujące siedem ma
jeden wspólny kształt: **żaden ekran nie widzi sprawy posprzedażowej**.
Agent odpowiadający na pytanie nie wie, że ten sam klient ma otwartą
reklamację. Dowód stoi w źródle: `services/skrzynka.ts` importuje
`listaZwrotow`, a `reklamacje.ts` nie importuje niczego ze skrzynki.

**Historia klienta pomija trzy kolejki z czterech.** `services/klient-historia.ts`
składa oś z zakupów i rozmów. Zwrotu, reklamacji ani dyskusji na niej nie ma,
choć wiążą się tym samym loginem. Zakładka KLIENT obiecuje historię, a pokazuje
jej połowę.

**Reklamacja i dyskusja leżą w JEDNEJ tabeli i nie widzą się nawzajem.**
`reklamacja_klienta` rozróżnia je kolumną `typ`. Dyskusja, która urosła
w reklamację, jest osobnym wierszem, a przejścia nikt nie zapisuje. To jest
najważniejszy moment całej obsługi i dziś nie zostawia śladu.

**Sprawa klienta spina wyłącznie rozmowy.** `sprawa_klienta_rozmowa` ma klucz
główny na `conversation_id` i nic poza rozmowami nie przyjmie. Klamra zrobiona
z rozmów nie obejmie zwrotu ani reklamacji — i tak miało być, bo tamte mają
własnych właścicieli danych.

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

## Spoiwo — co połączyć i w jakiej kolejności

Kolejność jest od najtańszego. Każdy krok ma dawać wartość sam z siebie, bez
kroku następnego.

### S1. Kontekst posprzedażowy w każdej z czterech kolejek

Rozmowa i zwrot mają pokazywać sprawy posprzedażowe tego zamówienia, a sprawa
posprzedażowa — swoje rodzeństwo. Siedem brakujących przejść z tabeli wyżej
zamyka się jednym zapytaniem po `order_id`.

Kosztu tabeli tu nie ma. Jest jedno złączenie i jeden blok na ekranie, taki
sam jak `skrzynka/ZwrotRozmowy.tsx`.

### S2. Historia klienta kompletna

`services/klient-historia.ts` dokłada do osi zwroty, reklamacje i dyskusje po
loginie kupującego. Zakładka KLIENT zaczyna odpowiadać na pytanie, które sama
zadaje.

Historia zostaje ODCZYTEM. Nowej tabeli nie ma i mieć nie będzie — to jest
zapisane w preambule tamtego pliku.

### S3. Przeskok jako zdarzenie

Dyskusja, po której powstaje reklamacja na tym samym zamówieniu, dopisuje
zdarzenie do obu. Zwrot po reklamacji tak samo.

Liczy to synchronizacja, nie człowiek. Dane potrzebne do wyliczenia już
przyjeżdżają: numer zamówienia, typ sprawy i moment otwarcia.

### S4. Jedno „Moje" ponad czterema kolejkami

Agent ma jedną listę tego, co prowadzi, złożoną z czterech źródeł. Dziś sita
„Moje" są cztery i każde trzeba odwiedzić osobno.

To jest ODCZYT z czterech zapytań, nie piąta kolejka. Kliknięcie prowadzi na
ekran właściwy dla rodzaju sprawy.

### S5. Miara eskalacji

Liczba spraw, w których po rozmowie powstała dyskusja albo reklamacja, w ujęciu
miesięcznym. Stoi obok skuteczności doboru, za zębatką.

Bez S3 tej liczby nie ma z czego policzyć. To jedyna zależność w tej liście.

### S6. Zamknięcie sprawy klienta

Kiedy sprawa klienta jest skończona, skoro składa się z czterech bytów o czterech
właścicielach. To pytanie wymaga decyzji właściciela i nie ma tu odpowiedzi.

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
| dyskusja przed reklamacją | dyskusje (0.245.0) | zegara i wiązania z reklamacją |
| prośba o rabat zamiast zwrotu | rabat transakcyjny (0.164.0) | — |
| wymiana na inny towar | NIGDZIE | decyzji: zwrot z nowym zamówieniem czy osobny byt |
| brak towaru na stanie | rozmowa plus zadanie terenowe | — |
| klient wraca po miesiącu | rozmowa nowa, bez historii | S2 |
| klient pisze z drugiego konta | dwie historie, bez wiązania | świadomej odpowiedzi „nie wiążemy" |
| klient milczy po naszym pytaniu | kubełek BEZ RUCHU w reklamacjach | tego samego w skrzynce i zwrotach |
| doradca Allegro w rozmowie | rola autora inna niż `SELLER` | — |
| spam i zaczepka | status `spam`, ręcznie | — |
| sprawa poza Allegro: telefon, e-mail | NIGDZIE | decyzji o drugim kanale |
| sprawa trafia do sądu albo do UOKiK | NIGDZIE | eksportu całej historii sprawy |

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
