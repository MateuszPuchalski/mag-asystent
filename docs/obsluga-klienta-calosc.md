# Obsługa klienta od końca do końca — dekalog i spoiwo

Ten dokument rozstrzyga spory o kształt obsługi klienta jako CAŁOŚCI. Nie jest
projektem ekranu ani rejestrem decyzji. Jest listą reguł, które obowiązują
WSZYSTKIE cztery kolejki naraz, i zapisem tego, co je spina.

Trzy dokumenty dzielą się pracą tak:

| dokument | odpowiada na pytanie |
|---|---|
| `docs/obsluga-klienta.md` | dlaczego tak postanowiono i jaki dowód za tym stoi |
| `docs/panel-obslugi-klienta.md` | jak wygląda docelowy panel i co już działa |
| ten plik | co obowiązuje MIĘDZY kolejkami i co je spina |

Reguły o JEDNEJ rozmowie stoją w `panel-obslugi-klienta.md` §27 i ten plik ich
nie powtarza. Reguła zapisana w dwóch miejscach starzeje się w jednym z nich.

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

## Przegląd z 0.426.1 — pięć punktów zamiast dziesięciu

Przegląd porównał każdy punkt z kodem. W pięciu punktach akapit „u nas"
opisywał stan sprzed 0.386.0 albo mylił się o kodzie. Pięć punktów nie mówiło
o przejściu MIĘDZY kolejkami, tylko o jednej rozmowie albo o ekranie.

Te drugie przeszły do §27 projektu panelu albo do spoiwa. Nazwa „dekalog"
zostaje, bo pod nią cytuje go kod. Stare numery w starszych wpisach
`CHANGELOG.md` tłumaczy ta tabela.

| był | jest | dlaczego |
|---|---|---|
| 1. Jeden klient, jedna historia | 1 | — |
| 2. Każdy przeskok jest faktem | w punkcie 1 | od 0.386.0 przeskok jest odczytem drogi zakupu, więc oba punkty mówiły to samo |
| 3. Kontekst za sprawą | 2 | — |
| 4. Zegar rządzi kolejnością | 3 | — |
| 5. Eskalacja podlega pomiarowi | S5 niżej | miara stoi od 0.386.0; jej zakaz zostaje przy niej |
| 6. Jedna droga na zewnątrz | 4 | — |
| 7. Kto ma ruch, wylicza się z faktów | §27, punkt 11 | dotyczy jednej rozmowy |
| 8. Zdarzenia wiszą przy źródle | 5 | — |
| 9. Nieodwracalne pyta, odwracalne się cofa | §27, punkt 12 | reguła ekranu, nie przejścia |
| 10. Czego nie wiemy, ekran mówi wprost | §27, punkt 9 | trzecie sformułowanie tej samej myśli |

**Opis stanu przy punkcie wskazuje test, a nie prozę.** Akapity „u nas"
zestarzały się w czterdziestu wydaniach, bo nikt ich nie czytał przy zmianie
kodu. Nazwa testu nie zestarzeje się po cichu: zniknie albo zaświeci na czerwono.

## Stan wiązań

Mostkiem między kolejkami jest numer zamówienia: `message.related_order_id`,
`zwrot_klienta.order_id` i `reklamacja_klienta.order_id`. Od 0.386.0 każda
z czterech kolejek widzi trzy pozostałe, czyli dwanaście przejść z dwunastu.
Wszystkie idą przez `services/droga-klienta.ts` i jeden blok na ekranie,
`panel/src/sprawy/Spoiwo.tsx`.

Drugim mostkiem jest login kupującego. Chodzą po nim zakładka KLIENT (S2)
i kandydaci zamówień rozmowy bez numeru (S1). Czy ten mostek jest pewny, nie
wiadomo — mówi o tym rozdział „Sprzeczność: login kupującego" niżej.

Nakładka spraw (`sprawa_klienta`) odeszła w 0.388.0. Droga zakupu robi to
samo sama i przez cztery kolejki. Cena jest zapisana jawnie: dwóch rozmów
o jednym problemie BEZ wspólnego zamówienia nikt już nie sklei.

## Dekalog obsługi klienta

### 1. Jeden klient, jedna historia, a przeskok jest faktem

Podział na cztery kolejki jest NASZ, nie jego. Pytanie staje się dyskusją,
dyskusja reklamacją, reklamacja zwrotem. To jest ta sama sprawa w czwartym
ubraniu.

**Zabrania.** Kazania agentowi otwierać drugi ekran po to, żeby dowiedzieć
się, czy ten klient już u nas był. Traktowania nowej sprawy jako początku:
sprawa po reklamacji tego samego zamówienia zaczyna się z historią.

**Pilnuje.** `droga-klienta.test.ts` (brakujące wiązania, droga w kolejności
czasu) i `klient-historia.test.ts`. Przeskok jest ODCZYTEM, nie zapisem — S3.

### 2. Kontekst wchodzi za sprawą, nie za ekranem

Zamówienie, oferta, kartoteka, zdjęcia i zegar mają wyglądać tak samo
w każdej z czterech kolejek. To ta sama wiedza o tym samym zakupie.

**Zabrania.** Drugiego mapowania tych samych pól pod inną nazwą. Pole opisane
raz ma jedną drogę odczytu, tak jak ma jedną drogę zapisu.

**Stan: punkt ŁAMANY i bez strażnika.** `kontekstZamowienia` z
`services/reklamacje.ts` obsługuje reklamacje i dyskusje. Skrzynka czyta
zamówienie po swojemu (`zamowienieRozmowy` w `services/zamowienia.ts`,
`services/skrzynka.ts`). Zwroty też (`services/zwroty.ts`).

To jest dług, nie wyjątek. Nowy odczyt zamówienia nie dokłada czwartej drogi,
tylko korzysta z którejś z istniejących. Blok spoiwa jest już jeden dla
czterech kolejek.

### 3. Zegar rządzi kolejnością, a sprawa bez zegara dostaje własny

Termin jest osobnym bytem i to on ustawia pracę. Reklamacja bierze go
z Allegro (`decisionDueDate`), zwrot z ustawy. Dyskusja liczy pilność bez
zegara (§25c.4), a rozmowa nie ma terminu odpowiedzi w ogóle.

**Zabrania.** Sortowania po dacie wpływu tam, gdzie istnieje termin. Blizna
0.121.0 mówi, co kosztuje nazwanie jednego zegara drugim.

**Pilnuje.** `droga-klienta.test.ts`: sprawa z terminem staje nad sprawą
ruszoną dawniej, bez terminu (S4).

### 4. Jedna droga na zewnątrz

Odpowiedź do klienta wychodzi jedną maszynerią: skrzynka nadawcza, klucz
idempotencji liczony przez serwer, kontrola świeżości i jawna zgoda przy
konflikcie. Świeżość liczy się od ostatniej NIE naszej wiadomości.

**U nas.** Odpowiedź wychodzi dwiema drogami i obie biorą klucz z
`services/idempotencja.ts`. Skrzynka idzie przez `services/wysylka.ts`,
reklamacje i dyskusje przez `services/reklamacje-wysylka.ts`.

Werdykt i prośba o zakończenie dyskusji nie są odpowiedzią. To jednorazowe
zapisy statusu, a strażnik dubletu stoi na wierszu sprawy.

**Zabrania.** Trzeciej drogi odpowiedzi z własnym kluczem. Droga bez kontroli
świeżości cicho nadpisuje odpowiedź kolegi.

### 5. Zdarzenia wiszą przy źródle

Klamra nad sprawami niczego nie przechwytuje. Historia zostaje przy rozmowie,
przy zwrocie i przy reklamacji, a wspólny widok ją tylko CZYTA. Cztery byty
mają czterech właścicieli danych i to jest cecha, nie usterka.

**Zabrania.** Piątej tabeli ze wspólnym statusem nad czterema kolejkami.
Pierwsza odpowiedź o tym kształcie kosztowała cztery tabele nakładki
(0.140.0). Druga, nakładka spraw, odeszła w 0.388.0 (blizna 0.130.0).

**Pilnuje.** `droga-klienta.test.ts`: droga zakupu i lista „Moje" niczego
nie zapisują.

## Spoiwo — pięć kroków stoi, szósty czeka

Historia budowy stoi w `CHANGELOG.md` (0.386.0–0.397.0) i w komentarzach kodu.
Tu zostaje to, czego przy zmianie nie wolno zgubić.

### S1. Kontekst posprzedażowy w każdej kolejce

`sprawyZakupu` w `droga-klienta.ts`, na ekranie `Spoiwo.tsx`. Rozmowa, której
zamówienia jeszcze nie pobraliśmy, spraw nie pokaże. Dwie różne odpowiedzi
o tym samym zakupie na jednym ekranie byłyby gorsze od jednej spóźnionej.

Rozmowa BEZ NUMERU zamówienia (0.397.0) dostaje kandydatów po loginie
(`services/zamowienia-kandydaci.ts`). Wiąże kliknięcie agenta, nie automat:
ten sam login nie znaczy „ta paczka".

### S2. Historia klienta kompletna

`services/klient-historia.ts` składa zakupy, rozmowy, zwroty, reklamacje
i dyskusje po loginie kupującego.

### S3. Przeskok jako ODCZYT

`drogaZakupu` wylicza drogę z momentów otwarcia, które i tak leżą w bazie.
Zdarzenie dopisywane przy synchronizacji byłoby drugą prawdą o tym samym
fakcie. Dwie prawdy rozjeżdżają się przy pierwszej poprawce jednej z nich.

### S4. Jedno „Moje" dla trzech kolejek

Ekran `/obsluga/moje` składa rozmowy, reklamacje i dyskusje. Zwrotu tam NIE MA:
w 0.370.0 właściciel zdjął ze zwrotu prowadzącego. Kolumny `prowadzi_*`
w `zwrot_klienta` zostały, ale nikt ich nie pisze.

Kolejność ma dwa piętra: najpierw sprawy z terminem, wedle terminu, potem
reszta, wedle ostatniego ruchu.

### S5. Miara eskalacji

Ile zakupów z rozmową skończyło się dyskusją albo reklamacją, miesiącami.
Liczy ZAKUPY, nie sprawy i nie wiadomości. Sprawa otwarta przed pierwszą
wiadomością nie liczy się wcale, bo nie wynika z naszej odpowiedzi. Bez osi
osobowej, celowo.

**Zabrania.** Liczenia wyłącznie spraw domkniętych. Kolejka pusta przy
rosnącej eskalacji jest miarą, która kłamie. Pilnują tego testy eskalacji
w `droga-klienta.test.ts`.

### S6. Zamknięcie sprawy klienta — czeka na decyzję właściciela

Kiedy sprawa klienta jest skończona, skoro składa się z bytów o czterech
właścicielach danych? „Zamknięte" znaczy co innego dla Allegro, dla ustawy
i dla biura. Droga zakupu (S3) jest materiałem do tej decyzji, nie decyzją.

## Sprzeczność: login kupującego

Repo mówi o loginie rozmówcy dwie przeciwne rzeczy i obie stoją w kodzie.

Blizna 0.56.6 (`CHANGELOG.md`) opisuje `interlocutor.login` z listy wątków
jako ZAMASKOWANY: `client:44300444` zamiast loginu z zamówienia. Stąd zakaz
w nagłówku `droga-klienta.ts` i w tabeli blizn `obsluga-klienta.md`.

Mimo tego dwie funkcje wiążą się po tym właśnie polu. Zakładka KLIENT zbiera
po nim rozmowy i zakupy (S2). Kandydaci zamówień szukają po nim zakupów (S1).
Wydanie 0.397.0 widziało w nim zwykły login.

Która strona ma rację, trzeba sprawdzić na żywym Allegro. Pytanie niesie
znacznik `[WERYFIKUJ]` w `docs/allegro-ksztalt.md`, rozdział
`GET /messaging/threads`.

**Do tego czasu obowiązuje jedno.** Żadna NOWA funkcja nie wiąże po loginie
rozmówcy. Dwie istniejące zostają, bo pomyłka daje w nich najpewniej pustą
historię, a nie cudze dane. Wiązanie w S1 zatwierdza zresztą człowiek.

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

Znacznik „reklamacyjna" (0.390.0) jest NASZ i zostaje przy rozmowie. Sprawy
w Allegro sprzedawca nie założy — `/sale/issues` ma wyłącznie GET.

**Dwie pozycje „NIGDZIE" są największe.** Wymiana towaru jest codzienna
w handlu częściami i nie ma dziś żadnego miejsca w aplikacji. Drugi kanał
przesądza o tym, czy panel jest obsługą klienta, czy obsługą Allegro.

## Otwarte decyzje właściciela

Czy wchodzi drugi kanał poza Allegro. Czy wymiana towaru dostaje własny byt.
Kiedy sprawa klienta jest zamknięta. Czy rozmowa dostaje termin odpowiedzi.
Czy dwa konta jednego człowieka wiążemy ręką.

Pierwsze dwa pytania są większe od reszty razem wziętej. Każde z nich zmienia
kształt aplikacji, nie kształt ekranu.

## Blizny, których to spoiwo nie ma kupić drugi raz

Blizny 0.130.0 i 0.140.0 stoją w punkcie 5 dekalogu i tu ich nie powtarzamy.

| blizna | czego pilnować przy łączeniu kolejek |
|---|---|
| 0.56.6 | login rozmówcy bywa zamaskowany; nowe wiązanie po nim czeka na `[WERYFIKUJ]` |
| 0.121.0 | dyskusja nie jest reklamacją; zegar jednej nie nazywa się zegarem drugiej |
| 0.152.0 | powód odmowy zapisuje się słowem, nie samym kodem odpowiedzi |
| 0.157.0 | ta sama rzecz zbudowana dwa razy w dwóch gałęziach; sprawdź, co już stoi |
| 0.224.1 | pole nieopisane w typie ciała znika po cichu na trasie |
