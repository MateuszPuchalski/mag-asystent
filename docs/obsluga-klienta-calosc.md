# Obsługa klienta od końca do końca — dekalog i spoiwo

Ten dokument rozstrzyga spory o kształt obsługi klienta jako CAŁOŚCI. Jest
listą reguł, które obowiązują WSZYSTKIE cztery kolejki naraz, i zapisem tego,
co je spina. Dlaczego tak postanowiono, mówi `docs/obsluga-klienta.md`. Jak
wygląda panel, mówi `docs/panel-obslugi-klienta.md`. Reguły o JEDNEJ rozmowie
stoją w jego §27, a nie tutaj, bo reguła w dwóch miejscach starzeje się
w jednym z nich.

## Zakres

Dekalog obowiązuje panel obsługi (`panel/`), trasy obsługi
(`server/src/routes/`) i serwisy, które one wołają. Obowiązuje też każdy nowy
ekran, na którym biuro pracuje nad sprawą klienta. Czyta się go przed zmianą,
nie po niej. Magazyn ma własny dekalog — `docs/ergonomia-magazynu.md`. Punkty
1, 2, 5, 6 i 10 tamtego obowiązują biuro i ten dekalog ich nie unieważnia.

Przy każdym punkcie stan opisuje test, a nie proza. Nazwa testu nie zestarzeje
się po cichu: zniknie albo zaświeci na czerwono.

## Stan wiązań

**Pierwszym mostkiem jest numer zamówienia**: `message.related_order_id`,
`zwrot_klienta.order_id` i `reklamacja_klienta.order_id`. Każda z czterech
kolejek widzi trzy pozostałe, czyli dwanaście przejść z dwunastu. Wszystkie
idą przez `services/droga-klienta.ts` i jeden blok `panel/src/sprawy/Spoiwo.tsx`.
Ręczne wskazanie zamówienia rozmowy czyta każda strona z jednej relacji
`ROZMOWA_ZAMOWIENIA` (test o tej nazwie w `droga-klienta.test.ts`).

**Zwrot staje na osi rozmowy.** Decyzja, korekta i pieniądze zwrotu są
zdarzeniami w pasku rozmowy i faktem w szkicu Copilota
(`services/zwrot-na-osi.ts`). Ocena, kwota robocza i notatka biura zostają
w zwrocie — to nasza kuchnia. Zwrot, reklamacja i dyskusja zlecają hali
przyciskiem „Zleć hali" (`panel/src/sprawy/ZlecHali.tsx`), a karta zadania
prowadzi z powrotem do sprawy. Dostawa zostaje przy „notatce do hali", żeby
nie mieć dwóch kanałów o jednym dokumencie.

**Drugim mostkiem jest login kupującego.** `interlocutor.login` z listy
wątków to login, a `client:44300444` to kupujący bez konta, nie maska —
potwierdził to właściciel na żywym koncie (`docs/allegro-ksztalt.md`,
rozdział `GET /messaging/threads`). Porównanie idzie zawsze bez wielkości
liter. Po loginie chodzą zakładka KLIENT (S2), kandydaci zamówień (S1)
i sprawa klienta (S6), która spina rozmowy BEZ wspólnego zamówienia.

**Trzecim mostkiem jest towar (`tw_id`).** Symbol otwiera szufladę
(`panel/src/towar/Szuflada.tsx`): stan, dostawy, otwarte sprawy o nim
i liczby z 90 dni. Szuflada to wgląd, nie kolejka. **Wgląd prowadzi do
pracy:** liczba w Analizie o stanie BIEŻĄCYM otwiera listę, którą liczy.
Liczby z minionego okna odnośnika nie mają, bo lista dziś znaczy co innego.

## Dekalog obsługi klienta

### 1. Jeden klient, jedna historia, a przeskok jest faktem

Podział na cztery kolejki jest NASZ, nie klienta. Pytanie staje się dyskusją,
dyskusja reklamacją, reklamacja zwrotem: to ta sama sprawa w czwartym ubraniu.
**Zabrania** kazania agentowi otwierać drugi ekran, żeby sprawdzić, czy klient
już u nas był. Sprawa po reklamacji tego samego zamówienia zaczyna się
z historią. **Pilnują** `droga-klienta.test.ts` i `klient-historia.test.ts`.
Przeskok jest ODCZYTEM, nie zapisem — S3.

### 2. Kontekst wchodzi za sprawą, nie za ekranem

Zamówienie, oferta, kartoteka, zdjęcia i zegar wyglądają tak samo w każdej
kolejce, bo to ta sama wiedza o tym samym zakupie. **Zabrania** drugiego
mapowania tych samych pól pod inną nazwą: pole opisane raz ma jedną drogę
odczytu, jak ma jedną drogę zapisu.

**Stan: punkt ŁAMANY i bez strażnika.** `kontekstZamowienia` z
`services/reklamacje.ts` obsługuje reklamacje i dyskusje. Skrzynka czyta
zamówienie po swojemu (`zamowienieRozmowy` w `services/zamowienia.ts`,
`services/skrzynka.ts`), zwroty też (`services/zwroty.ts`). To jest dług, nie
wyjątek: nowy odczyt nie dokłada czwartej drogi, tylko korzysta z istniejącej.

### 3. Zegar rządzi kolejnością, a sprawa bez zegara dostaje własny

Termin jest osobnym bytem i to on ustawia pracę. Reklamacja bierze go
z Allegro (`decisionDueDate`), zwrot z ustawy. Dyskusja liczy pilność bez
zegara (§25c.4), a rozmowa nie ma terminu odpowiedzi. **Zabrania** sortowania
po dacie wpływu tam, gdzie istnieje termin (blizna 0.121.0). **Pilnuje**
`droga-klienta.test.ts`: sprawa z terminem staje nad sprawą bez terminu (S4).

### 4. Jedna droga na zewnątrz

Odpowiedź do klienta wychodzi jedną maszynerią: skrzynka nadawcza, klucz
idempotencji liczony przez serwer, kontrola świeżości i jawna zgoda przy
konflikcie. Świeżość liczy się od ostatniej NIE naszej wiadomości.

**U nas** dwie drogi biorą klucz z `services/idempotencja.ts`: skrzynka przez
`services/wysylka.ts`, reklamacje i dyskusje przez
`services/reklamacje-wysylka.ts`. Werdykt i prośba o zakończenie dyskusji to
jednorazowe zapisy statusu ze strażnikiem dubletu na wierszu sprawy.
**Zabrania** trzeciej drogi z własnym kluczem, bo droga bez kontroli
świeżości cicho nadpisuje odpowiedź kolegi.

### 5. Zdarzenia wiszą przy źródle

Klamra nad sprawami niczego nie przechwytuje. Historia zostaje przy rozmowie,
zwrocie i reklamacji, a wspólny widok ją tylko CZYTA. Cztery byty mają
czterech właścicieli danych i to jest cecha, nie usterka.

**Zabrania** wspólnego statusu przepisanego z kolejek i ręcznego scalania
spraw (blizny 0.130.0 i 0.140.0). Sprawa klienta z S6 nie łamie tego punktu:
nie przepisuje statusu i nie scala bez klucza. **Pilnują**
`droga-klienta.test.ts` (droga zakupu i „Moje" niczego nie zapisują) oraz
test „odczyty niczego nie zapisują" w `prowadzenie-klienta.test.ts`.

## Spoiwo — sześć kroków

### S1. Kontekst posprzedażowy w każdej kolejce

`sprawyZakupu` w `droga-klienta.ts`, na ekranie `Spoiwo.tsx`. Rozmowa, której
zamówienia jeszcze nie pobraliśmy, spraw nie pokaże. Dwie różne odpowiedzi
o tym samym zakupie byłyby gorsze od jednej spóźnionej. Rozmowa BEZ NUMERU
zamówienia dostaje kandydatów po loginie (`services/zamowienia-kandydaci.ts`).
Wiąże kliknięcie agenta, nie automat: ten sam login nie znaczy „ta paczka".

### S2. Historia klienta kompletna

`services/klient-historia.ts` składa zakupy, rozmowy, zwroty, reklamacje
i dyskusje po loginie kupującego.

### S2a. Profil klienta

`services/profil-klienta.ts`, ekran `panel/src/ekrany/ProfilKlienta.tsx`
pod `/obsluga/klient/:login`: jeden klient na jednym ekranie. Tożsamością jest
LOGIN, nie konto sprzedawcy. **Sygnały się wylicza, nie zapisuje**, bo
zapisany sygnał byłby drugą prawdą o reklamacji czy zwrocie. Paczka
„niedoręczona" wymaga pytania przewoźnika, bez niego znaczy tylko, że nie
pytaliśmy.

**Notatka o kliencie** jest jedna na login, bez statusu i kolejki. Trzyma
poprzednią treść, bo agent nadpisuje cudzą notatkę jednym kliknięciem.
Dziennik dostaje długość, bo dziennik czyta analiza. Sprawa (S6) ma osobną
tabelę, bo mówi, co robimy i do kiedy. **Zabrania** adresu, danych z `buyer`
i kwot z anulowanych zamówień (`profil-klienta.test.ts`, test ekranu).

### S3. Przeskok jako ODCZYT

`drogaZakupu` wylicza drogę z momentów otwarcia, które i tak leżą w bazie.
Zdarzenie dopisywane przy synchronizacji byłoby drugą prawdą o tym samym
fakcie. Dwie prawdy rozjeżdżają się przy pierwszej poprawce jednej z nich.

### S4. Jedno „Moje" dla trzech kolejek i spraw klienta

`/obsluga/moje` składa rozmowy, reklamacje, dyskusje i sprawy klienta tej
osoby. Zwrotu tam NIE MA, bo zwrot nie ma prowadzącego; kolumn `prowadzi_*`
w `zwrot_klienta` nikt nie pisze. Sprawy scala `mojaLista`
w `services/prowadzenie-klienta.ts`, bo `droga-klienta.ts` nie może znać
serwisu sprawy: pętla importów daje pusty zbiór. Wiersz sprawy nie ma
przycisku. Kolejność ma cztery piętra:

1. sprawy klienta z nowym zdarzeniem, najdłużej czekające pierwsze;
2. terminy: kolejki z terminem i kroki na dziś albo po terminie, wedle daty;
3. reszta kolejek, wedle ostatniego ruchu;
4. kroki na przyszłość, z dopiskiem „czeka do".

Przy równym terminie wygrywa kolejka, bo jej termin stawia Allegro albo
ustawa. Pilnuje test kolejności „Moje" w `prowadzenie-klienta.test.ts`.
Tożsamość idzie z sesji — test „sprawa klienta na „Moje"…" w `skrzynka.test.ts`.

### S5. Miara eskalacji

Ile zakupów z rozmową skończyło się dyskusją albo reklamacją, miesiącami.
Liczy ZAKUPY, nie sprawy i nie wiadomości. Sprawa otwarta przed pierwszą
wiadomością nie liczy się, bo nie wynika z naszej odpowiedzi. Bez osi
osobowej, celowo. **Zabrania** liczenia wyłącznie spraw domkniętych, bo pusta
kolejka przy rosnącej eskalacji kłamie (testy eskalacji w
`droga-klienta.test.ts`).

### S5a. Bez ponownego pytania

Druga miara skutku, w Analizie przy czasie odpowiedzi: czy klient po naszej
odpowiedzi musiał pisać jeszcze raz w tej samej rozmowie. Eskalacja liczy
powrót INNĄ drogą, a razem mówią, czy odpowiedź zamknęła sprawę
(`services/czas-odpowiedzi.ts`). **Zabrania** liczenia podziękowania jako powrotu i chowania niepewności
w wyniku (testy `losOdpowiedzi` w `czas-odpowiedzi.test.ts`).

### S5b. Test na żywym Allegro

Raz dziennie serwer przechodzi drogi produkcji wobec prawdziwego Allegro, bez
atrap: wątki, sprawę i zdjęcia tak, jak pobiera je Copilot
(`services/sonda-rzeczywistosci.ts`). Wynik stoi na ekranie Stan, a krok
z błędem — w DO DECYZJI. Powód: bramki sprawdzają kod wobec kodu. **Zabrania**
atrap w sondzie, zapisu u Allegro i trzymania treści, nazw plików albo
adresów w wyniku. Limit 429 i brak danych to „pominięty", bo czerwień znaczy:
droga nie działa.

### S6. Sprawa klienta i jej zakończenie

**Powód.** Jedna osoba w biurze prowadzi braki towaru, kontakt z klientem
i reklamacje. Jej listą zadań były powiadomienia Allegro w Gmailu. **Kluczem
jest klient, nie zamówienie**: pytanie o dobór przychodzi przed zamówieniem,
a dosyłka bywa osobną przesyłką. Kluczem jest więc login, jak w S2a.

**Sprawa trzyma cztery rzeczy:** kto ją prowadzi, następny krok z terminem,
zakończenie stawiane przez człowieka i ponowne otwarcie przy zdarzeniu
klienta. Nie trzyma stanu kolejek (S3), historii (punkt 5) ani ręcznego
scalania. Tabela `klient_prowadzenie` ma wiersz na login, a regułę niesie
`services/prowadzenie-klienta.ts`. Nazwa nie brzmi `sprawa_klienta`, bo
`migrate()` kasuje tamtą tabelę przy każdym starcie.

**Krok jest jedyną drogą założenia i wznowienia**; kto nie ma kroku, kończy
sprawę. Termin leży najdalej sześćdziesiąt dni naprzód, bo na dostawcę czeka
się tygodniami. „Zakończ sprawę" cofa przez osiem sekund pasek „Cofnij".
Prowadzącym zostaje autor pierwszego ruchu, a „Przejmij" widać przy cudzej
sprawie w toku. Karta stoi na profilu, a sprawę niosą też „Moje" i historia
klienta.

**Zapis sprawdza świeżość.** Każdy zapis niesie numer wersji i odcisk faktów
z ekranu, więc cudzy ruch albo nowa wiadomość daje 409 ze świeżą sprawą. Brak
klucza w ciele to 400 bez zapisu (blizna 0.224.1). Odmowa z kodem dosyłki
i „Śledź dosyłkę" przy zwrocie idą bez wersji, bo agent sprawy nie widzi.
Podnoszą ją jednak, więc otwarty profil dostaje przy zapisie 409.

**Budzi sprawę** wyłącznie zdarzenie, o którym prowadzący może nie wiedzieć:
wiadomość klienta w dowolnej rozmowie, nowy zwrot, jego nadanie i doręczenie.
Budzą nowa reklamacja albo dyskusja i wiadomość w nich. Budzą doręczenie
dosyłki, kłopot z nią i jej powrót do nadawcy. Sprawa wraca na „Moje"
z powodem słowami panelu, np. „Klient napisał 26.09 14:10".

**Nie budzą**, decyzją właściciela: zakup, nasz ruch, paczka nieodebrana,
podziękowanie (S5a) i rozmowa dowiązana wstecz ręką. O każdym z nich
prowadzący już wie albo nie ma w nim pracy. Obudzenie bez pracy uczy je
ignorować.

**Obudzenie liczy się przy odczycie, bez tickera.** Wiersz trzyma odcisk
faktów z ostatniego ruchu człowieka, a „nowe" to różnica z odciskiem teraz.
Ticker, który raz nie wstanie, zostawiłby sprawę uśpioną na zawsze. Okno
obudzenia to trzydzieści dni od zakończenia, bo „Moje" liczy odcisk co 30
sekund. Miesiąc mieści ustawowe 14 dni i drogę paczki.

**Odcisk liczy sztuki, nie daty Allegro**, bo część dat nadpisuje każda
synchronizacja. Wiadomość idzie po NASZYM czasie wstawienia, a znacznik bez
strefy czyta się jako UTC, jak SQLite. Klucze `k` i `q` liczą PRZEJŚCIA dosyłek
w doręczenie i w kłopot i nigdy nie maleją. „Cofnij" oddaje odcisk sprzed
zakończenia, więc niczego nie potwierdza.

**Otwarte: obudzona zakończona sprawa zostaje zakończona** i staje na „Moje"
z powodem. Kończy się ją znów jednym kliknięciem, bez „Cofnij". Otwarcie
wymagałoby kroku z terminem, który automat musiałby zmyślić.

**Zakończenie zależy od tego, co klient dostał:**

| rozwiązanie | sprawa kończy się, gdy | skąd to wiemy |
|---|---|---|
| sam zwrot | pieniądze wróciły do klienta | oś zwrotu, `zwrot-pieniedzy.ts` |
| wymiana | poprawny towar doszedł na ten sam adres | tracking dosyłki, `dosylka.ts` |
| odpowiedź | klient dostał odpowiedź i nie dopisał | skrzynka, S5a |

Wymiana to zwrot przez Allegro i krok „dosłać" ze śledzeniem, bez osobnej
kolejki. Kończy zawsze człowiek. Profil pyta „Zakończ sprawę?", gdy kolejki
są puste i nadszedł dzień kroku albo doszła dosyłka. Otwarty zwrot TEGO
zamówienia pytania nie gasi, bo zwrot wymiany stoi otwarty. Doba jest
lokalna, a na czerwono stoi tylko „po terminie".

**Pilnują** `prowadzenie-klienta.test.ts`, `spoiwo.test.ts`,
`skrzynka.test.ts`, w panelu `ProfilKlienta.test.tsx`, `Moje.test.tsx`
i `Klient.test.tsx`. Dosyłkę pilnują `dosylka.test.ts`,
`dosylka-opis.test.ts`, `zwroty.test.ts` i `zwrot-pieniedzy.test.ts`.

**Miara (punkt 10 z `docs/ergonomia-magazynu.md`).** Pierwsza liczba to udział
obudzeń zakończonych znów w ciągu dziesięciu minut (`klient_sprawa_zakonczona`
z `ponownie: true`); wysoki znaczy szum. Druga to kroki po terminie na
tydzień. Trzecia to udział numerów dosyłki wpisanych ręką
(`klient_dosylka_numer` wobec `klient_dosylka_wykryta`). Czwarta to czas od
odmowy do numeru. Liczy się je bez osi osobowej, a dziś nie liczy ich nic.

**Zabrania** statusu przepisanego ze źródeł, kończenia przez automat
i zapisu przy otwarciu ekranu. Zabrania list i liczb spraw w podziale na
osoby, poza własnym „Moje" z tożsamością z sesji. Taki podział to monitoring
pracowniczy z art. 22² Kodeksu pracy (`docs/architektura.md` §9).

### S6: dosyłka ze śledzeniem

**Odmowa zakłada dosyłkę.** Przy złym towarze biuro odmawia wypłaty za zwrot
kodem `NEW_ITEM_SENT` albo `MISSING_PART_SENT`, bo część też jedzie drugą
paczką. Ta sama odmowa stawia krok „dosłać" (`zapiszKrokSprawy`) i zakłada
śledzenie. Termin to trzy dni robocze na 8:00: dzień na etykietę i dwa
kuriera. Krok ustawiony wcześniej zastępuje, a ekran mówi, co zastąpił.

**Odmowa z panelu Allegro staje w „Do decyzji"**, bo biuro odmawia tam
z nawyku. Wiersz „Śledzić dosyłkę?" ma jedyny na tej liście przycisk, bo
rejestruje odmowę, która już zapadła. Automatu nie ma: Allegro nie mówi, kto
odmówił. Porażka zapisu dosyłki nie zamienia odmowy w błąd, bo odmowa
w Allegro już poszła. Odmowa przejmuje dosyłkę zwrotu, a starszą zastępuje.

Wznowienie zakończonej sprawy zaczyna nowy epizod i odkłada skończone
dosyłki; dosyłka w drodze zostaje żywa. „Po ruchu człowieka" liczy chwila
zapisu doręczenia na serwerze, bo data kuriera bywa wcześniejsza od numeru.

**Tabela `klient_dosylka` trzyma numer i wynik śledzenia, nie historię**,
wiersz na sprawę i zamówienie. Ticker `dosylki` w `main()` szuka numeru co
siedemnaście minut (`ALLEGRO_DOSYLKI_SYNC_MS`), o jedną dosyłkę najwyżej co
pół godziny. Pyta `GET /order/checkout-forms/{id}/shipments` i odrzuca numery
zwrotu, wcześniejszych dosyłek i pierwszej paczki. Kilku kandydatów bez daty
nie rozstrzyga, a po dwóch dniach roboczych ekran prosi o numer.

**Śledzenie idzie drogą zwrotów** (`odpytajTracking`
w `services/allegro-tracking.ts`), przez trzydzieści dni. Przewoźnika `OTHER`
Allegro nie śledzi, a limit 429 idzie do `uruchomTakt`. Ticker pisze tylko
przy sprawie w toku. Wpisany ręką numer jest drogą zapasową.

`services/przesylka-zamowienia.ts` pokazuje dosyłkę obok pierwszej paczki,
a „doręczona przebija", bo przy reklamacji pytanie brzmi „czy on to w ogóle
dostał". **Niesprawdzone na żywym koncie**: że numer dosyłki stoi przy tym
samym zamówieniu i że przewoźnik jest „prawie zawsze tym samym". Pierwsze ma
znacznik weryfikacji w `docs/allegro-ksztalt.md`.

## Mapa możliwości

Tabela nazywa dziury. Bez dziury lądują: dobór części, dostawa i termin,
paczka nieodebrana, zwrot ustawowy i częściowy, rękojmia i gwarancja oraz
rabat transakcyjny. Brak na stanie idzie zadaniem terenowym, powrót po
miesiącu ma pełną historię, a spam — status `spam`.

| sytuacja klienta | gdzie ląduje dziś | czego brakuje |
|---|---|---|
| pytanie przed zakupem | skrzynka, rozmowa bez zamówienia | terminu odpowiedzi (§26) |
| prośba o fakturę albo korektę | skrzynka, ręcznie | drogi do Subiekta bez przepisywania |
| towar uszkodzony w transporcie | reklamacje albo dyskusja | wskazania przewoźnika jako winnego |
| dyskusja przed reklamacją | dyskusje, wiązanie drogą zakupu | zegara |
| pytanie reklamacyjne bez sprawy w Allegro | skrzynka, znacznik „reklamacyjna" (nasz; `/sale/issues` ma tylko GET) | zegara (§26) |
| wymiana na inny towar | zwrot przez Allegro, krok „dosłać" ze śledzeniem dosyłki (S6) | potwierdzenia, że numer dosyłki stoi przy zamówieniu |
| brak towaru do sprzedanego zamówienia | Sellasist; Ctrl+K po numerze zamówienia daje kupującego | drogi braku z Sellasist do sprawy klienta |
| klient pisze z drugiego konta | dwie historie, bez wiązania | świadomej odpowiedzi „nie wiążemy" |
| klient milczy po naszym pytaniu | kubełek BEZ RUCHU w reklamacjach | tego samego w skrzynce i zwrotach |
| sprawa poza Allegro: telefon, e-mail | NIGDZIE | decyzji o drugim kanale |
| sprawa trafia do sądu albo do UOKiK | NIGDZIE | eksportu całej historii sprawy |

**Drugi kanał nie jest pilny.** Z Allegro jest 99% zamówień, a pytania
przychodzą przez Allegro z odnośnikiem do zamówienia.

## Otwarte decyzje właściciela

Czy wchodzi drugi kanał poza Allegro. Czy rozmowa dostaje termin odpowiedzi.
Czy dwa konta jednego człowieka wiążemy ręką. Czy obudzona zakończona sprawa
otwiera się na nowo (S6).

## Blizny, których to spoiwo nie ma kupić drugi raz

Blizny 0.130.0 i 0.140.0 stoją w punkcie 5 dekalogu.

| blizna | czego pilnować przy łączeniu kolejek |
|---|---|
| 0.56.6 | `client:<liczba>` to login kupującego bez konta, nie maska; login porównuje się bez wielkości liter |
| 0.121.0 | dyskusja nie jest reklamacją; zegar jednej nie nazywa się zegarem drugiej |
| 0.152.0 | powód odmowy zapisuje się słowem, nie samym kodem odpowiedzi |
| 0.157.0 | ta sama rzecz zbudowana dwa razy w dwóch gałęziach; sprawdź, co już stoi |
| 0.224.1 | pole nieopisane w typie ciała znika po cichu na trasie |
