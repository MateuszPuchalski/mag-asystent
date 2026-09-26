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

**Od 0.502.0 rozmowa należy do zamówienia także przez ręczne wskazanie.**
Skrzynka czytała wskazanie od 0.397.0, a zwrot, reklamacja, droga zakupu
i szukanie — tylko numer z wiadomości. Rozmowa ze wskazanym zamówieniem
widziała więc zwrot, a zwrot jej nie. Teraz każda strona czyta jedną relację
`ROZMOWA_ZAMOWIENIA`. Pilnuje jej test „rozmowy zamówienia tylko przez
ROZMOWA_ZAMOWIENIA" w `droga-klienta.test.ts`.

**Od 0.502.0 zwrot staje na osi rozmowy, a hala odpowiada sprawie, która ją
wezwała.** Decyzja, korekta i pieniądze zwrotu tego zamówienia są zdarzeniami
w pasku rozmowy i faktem w szkicu Copilota (`services/zwrot-na-osi.ts`).
Ocena, kwota robocza i notatka biura zostają w zwrocie — to nasza kuchnia.
Zwrot, reklamacja i dyskusja zlecają hali przyciskiem „Zleć hali"
(`panel/src/sprawy/ZlecHali.tsx`). Karta zadania prowadzi z powrotem do
sprawy, wynik ze zwrotu staje na jego osi, a odesłanie — w Do zrobienia.
Dostawa zostaje przy „notatce do hali", żeby nie mieć dwóch kanałów o jednym
dokumencie.

Drugim mostkiem jest login kupującego. Chodzą po nim zakładka KLIENT (S2)
i kandydaci zamówień rozmowy bez numeru (S1). Właściciel potwierdził go na
żywym koncie 24 września 2026 — rozdział „Sprzeczność: login kupującego"
niżej. Nowe wiązania po loginie są więc dozwolone, bez wielkości liter.

Trzecim mostkiem jest od 0.502.0 towar (`tw_id`). Stał na dziewięciu
ekranach i nigdzie nie był odnośnikiem. Teraz jego symbol otwiera szufladę
(`panel/src/towar/Szuflada.tsx`): stan, dostawy, wiedzę, otwarte zwroty,
reklamacje i rozmowy o nim oraz liczby z 90 dni. Szuflada to wgląd, nie
kolejka — nie ma statusu ani decyzji, a każdy wiersz prowadzi do sprawy.
Oferty towaru to pamięć człowieka i sygnatura równa symbolowi, więc liczba
sprzedaży mówi wprost, z ilu ofert powiązanych jest liczona
(`services/przekroj-towaru.ts`).

**Wgląd prowadzi do pracy (0.502.0).** Liczba w Analizie, która opisuje
stan BIEŻĄCY, otwiera listę, którą liczy: klient czeka teraz → skrzynka,
problemy dostaw → dostawy. Dostawca w tabeli dostaw otwiera archiwum jego
dokumentów. Liczby z minionego okna — tydzień, eskalacje, tarcie — odnośnika
nie mają. Otworzyłyby listę, która dziś znaczy co innego.

Nakładka spraw (`sprawa_klienta`) odeszła w 0.388.0. Droga zakupu robi to
samo sama i przez cztery kolejki. Cena jest zapisana jawnie: dwóch rozmów
o jednym problemie BEZ wspólnego zamówienia nikt już nie sklei. Tę cenę
zdejmie sprawa klienta z S6, bo jej kluczem jest login, nie zamówienie.

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

**Zabrania.** Wspólnego statusu przepisanego z czterech kolejek i ręcznego
scalania spraw. Pierwsza odpowiedź o tym kształcie kosztowała cztery tabele
nakładki (0.140.0). Druga, nakładka spraw, odeszła w 0.388.0 (blizna 0.130.0).

**Nie zabrania sprawy klienta z S6.** Do 26 września 2026 stał tu zakaz
każdej piątej tabeli nad kolejkami. Obie blizny dotyczyły jednak statusu
przepisanego ze źródeł i scalania bez klucza. Sprawa klienta nie ma żadnego
z nich, a historia dalej wisi przy źródle.

**Pilnuje.** `droga-klienta.test.ts`: droga zakupu i lista „Moje" niczego
nie zapisują.

## Spoiwo — pięć kroków stoi, szósty ma kształt

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

### S2a. Profil klienta (0.484.0)

`services/profil-klienta.ts`, ekran `panel/src/ekrany/ProfilKlienta.tsx`
pod `/obsluga/klient/:login`. To punkt 1 dekalogu doprowadzony do końca:
jeden klient na jednym ekranie, bez względu na kolejkę, z której przyszedł.

Tożsamością jest LOGIN, nie konto sprzedawcy. Ten sam kupujący u dwóch kont
to jeden klient. Login porównuje się bez wielkości liter, jak od 0.483.0.

**Sygnały się wylicza, nie zapisuje.** Zapisany sygnał byłby drugą prawdą
o reklamacji czy zwrocie — tej samej, której zabrania S3. Paczka
„niedoręczona” wymaga sprawdzenia przewoźnika. Bez niego brak doręczenia
znaczy tylko, że nie pytaliśmy.

**Notatka to jedyny zapis.** Jedna na login, bez statusu i bez kolejki, więc
nie jest piątą tabelą nad kolejkami. Trzyma poprzednią treść, bo agent
nadpisuje cudzą notatkę jednym kliknięciem. Dziennik zdarzeń dostaje długość,
nie treść: notatka o kliencie to dane osobowe, a dziennik czyta analiza.

**Zabrania.** Adresu, danych z `buyer` i kwot z anulowanych zamówień.
Pilnują tego `profil-klienta.test.ts` i test ekranu (zero zapisu przy
otwarciu).

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

### S5a. Bez ponownego pytania (0.495.0)

Druga miara skutku obok eskalacji, w Analizie przy czasie odpowiedzi. Mówi,
czy klient po naszej odpowiedzi musiał pisać jeszcze raz w tej samej rozmowie.
Eskalacja liczy powrót INNĄ drogą: dyskusją albo reklamacją. Razem mówią,
czy odpowiedź zamknęła sprawę. Reguła stoi w `services/czas-odpowiedzi.ts`.

**Zabrania.** Liczenia podziękowania jako powrotu i chowania niepewności
w wyniku. Pilnują tego testy `losOdpowiedzi` w `czas-odpowiedzi.test.ts`.

### S5b. Test na żywym Allegro (0.495.0)

Raz dziennie serwer przechodzi drogi produkcji wobec prawdziwego Allegro, bez
atrap: wątki, sprawę i zdjęcia tak, jak pobiera je Copilot. Wynik stoi na
ekranie Stan, a krok z błędem — w DO DECYZJI. Kod: `services/sonda-rzeczywistosci.ts`.

Powód jest jeden i drogi. Nasze bramki sprawdzają kod wobec kodu. Copilot
„widział zdjęcia” od 0.330.0 do 0.484.6 tylko w testach z podstawionym
pobieraczem, a ani jedno zdjęcie nie doszło do modelu.

**Zabrania.** Atrap w samej sondzie poza jej testem, zapisu czegokolwiek
u Allegro i trzymania treści, nazw plików albo adresów w wyniku. Limit 429
i brak danych to „pominięty”, bo czerwień ma znaczyć jedno: droga nie działa.

### S6. Sprawa klienta i jej zamknięcie (decyzja z 26 września 2026)

Pytanie stało tu otwarte: kiedy sprawa klienta jest skończona, skoro składa
się z bytów o czterech właścicielach danych? Rozstrzygnął je wywiad
z właścicielem z 26 września 2026. Kształt stoi niżej, kodu jeszcze nie ma.

**Powód.** Biuro nazywa swój główny problem wprost: intuicyjne śledzenie
i prowadzenie sprawy danego klienta. Jedna osoba prowadzi braki towaru,
kontakt z klientem i reklamacje. Jej listą zadań są dziś powiadomienia Allegro
w Gmailu. Droga zakupu, „Moje" i profil klienta tego nie zastąpiły.

**Jednostką jest klient, nie zamówienie.** Typowy łańcuch to pytanie o dobór,
potem zły towar w paczce, zwrot, dosyłka, reklamacja i dyskusja. Pytanie
o dobór przychodzi przed zamówieniem, a dosyłka bywa osobną przesyłką. Numer
zamówienia takiego łańcucha nie sklei. Kluczem jest login Allegro, jak w S2a.

**Sprawa trzyma cztery rzeczy i nic więcej:**

- kto ją prowadzi;
- następny krok z terminem, na przykład „czekamy na zwrot" albo „dosłać";
- zamknięcie, które stawia człowiek;
- ponowne otwarcie przy każdym nowym zdarzeniu dowolnego źródła.

**Czego sprawa nie trzyma.** Stanu kolejek, bo ten liczy się przy odczycie,
jak droga zakupu (S3). Historii, bo wisi przy źródle (punkt 5). Ręcznego
scalania, bo login jest kluczem naturalnym i nie ma czego sklejać.

**Zamknięcie zależy od tego, co klient dostał:**

| rozwiązanie | sprawa kończy się, gdy | skąd to wiemy |
|---|---|---|
| sam zwrot | pieniądze wróciły do klienta | oś zwrotu, `zwrot-pieniedzy.ts` |
| wymiana | poprawny towar doszedł na ten sam adres | dziś znikąd — dosyłka idzie poza aplikacją |
| odpowiedź | klient dostał odpowiedź i nie dopisał | skrzynka, S5a |

Wymiana to zwrot przez Allegro i dosyłka poprawnego towaru. Nie dostaje
osobnej kolejki, tylko staje jako następny krok sprawy z numerem przesyłki.
System podpowiada zamknięcie, gdy przyjdzie ostatni fakt, na który sprawa
czeka. Zamyka zawsze człowiek.

**Zabrania.** Statusu przepisanego ze źródeł, zamykania przez automat
i otwarcia ekranu, które cokolwiek zapisuje. Test zera zapisów przy otwarciu
dostaje ekran sprawy tak jak każdy inny. Najbliższy punkt zaczepienia to
`klient_notatka`: jedyna tabela, której kluczem już jest login.

## Sprzeczność: login kupującego

Repo mówi o loginie rozmówcy dwie przeciwne rzeczy i obie stoją w kodzie.

Blizna 0.56.6 (`CHANGELOG.md`) opisuje `interlocutor.login` z listy wątków
jako ZAMASKOWANY: `client:44300444` zamiast loginu z zamówienia. Stąd zakaz
w nagłówku `droga-klienta.ts` i w tabeli blizn `obsluga-klienta.md`.

Mimo tego dwie funkcje wiążą się po tym właśnie polu. Zakładka KLIENT zbiera
po nim rozmowy i zakupy (S2). Kandydaci zamówień szukają po nim zakupów (S1).
Wydanie 0.397.0 widziało w nim zwykły login.

**Rozstrzygnięte 24 września 2026.** Właściciel potwierdził na żywym koncie,
że to login kupującego. `client:44300444` to login kupującego bez konta,
nie maska. Rozbieżność brała się z wielkości liter, więc login porównuje się
wszędzie bez niej. Opis stoi w `docs/allegro-ksztalt.md`, rozdział
`GET /messaging/threads`.

**Od 26 września 2026 nowe wiązania po loginie są dozwolone.** Zakaz stał
tu tylko do weryfikacji, a ta zapadła 24 września. Login porównuje się
zawsze bez wielkości liter. Rozmowę BEZ numeru z konkretnym zamówieniem
dalej wiąże kliknięcie agenta (S1): ten sam login nie znaczy „ta paczka".

## Mapa możliwości

Tabela odpowiada na pytanie „gdzie to ląduje". Kolumna trzecia jest ważniejsza
od drugiej: nazywa dziurę, a nie funkcję.

| sytuacja klienta | gdzie ląduje dziś | czego brakuje |
|---|---|---|
| pytanie przed zakupem | skrzynka, rozmowa bez zamówienia | terminu odpowiedzi (§26) |
| pytanie o dobór części | skrzynka, zakładka Dobór | — |
| pytanie o dostawę i termin | skrzynka; od 0.502.0 „zamówione u dostawcy” w paśmie i w faktach szkicu | — |
| prośba o fakturę albo korektę | skrzynka, ręcznie | drogi do Subiekta bez przepisywania |
| paczka nieodebrana | zwroty, `zrodlo` osobne (0.172.0) | — |
| zwrot ustawowy w 14 dni | zwroty, kubełki bramek | — |
| zwrot częściowy | zwroty, zaznaczenie pozycji | — |
| towar uszkodzony w transporcie | reklamacje albo dyskusja | wskazania przewoźnika jako winnego |
| reklamacja z rękojmi i gwarancji | reklamacje, `prawo` | — |
| dyskusja przed reklamacją | dyskusje (0.245.0), wiązanie od 0.386.0 | zegara |
| prośba o rabat zamiast zwrotu | rabat transakcyjny (0.164.0) | — |
| pytanie reklamacyjne bez sprawy w Allegro | skrzynka, znacznik „reklamacyjna" (0.390.0) | zegara — rozmowa nie ma terminu (§26) |
| wymiana na inny towar | zwrot przez Allegro, dosyłka poza aplikacją | kroku „dosłać" w sprawie klienta (S6) |
| brak towaru na stanie | rozmowa plus zadanie terenowe | — |
| brak towaru do sprzedanego zamówienia | Sellasist: magazynier zgłasza brak przy zbieraniu | drogi braku z Sellasist do sprawy klienta |
| klient wraca po miesiącu | rozmowa plus pełna historia (0.386.0) | — |
| klient pisze z drugiego konta | dwie historie, bez wiązania | świadomej odpowiedzi „nie wiążemy" |
| klient milczy po naszym pytaniu | kubełek BEZ RUCHU w reklamacjach | tego samego w skrzynce i zwrotach |
| doradca Allegro w rozmowie | rola autora inna niż `SELLER` | — |
| spam i zaczepka | status `spam`, ręcznie | — |
| sprawa poza Allegro: telefon, e-mail | NIGDZIE | decyzji o drugim kanale |
| sprawa trafia do sądu albo do UOKiK | NIGDZIE | eksportu całej historii sprawy |

Znacznik „reklamacyjna" (0.390.0) jest NASZ i zostaje przy rozmowie. Sprawy
w Allegro sprzedawca nie założy — `/sale/issues` ma wyłącznie GET.

**Największe dziury to wymiana i brak towaru.** Obie są codzienne w handlu
częściami i obie żyją dziś poza aplikacją. Wymiana dostaje miejsce w sprawie
klienta (S6). Brak towaru czeka na drogę z Sellasist.

**Drugi kanał przestał być pilny.** Wywiad z 26 września 2026 dał dwa
fakty. Z Allegro jest 99% zamówień, a pytania klientów przychodzą przez
Allegro z odnośnikiem do zamówienia. Gmail niesie głównie powiadomienia
Allegro i służy biuru za listę zadań. Tę rolę ma przejąć sprawa klienta.

## Otwarte decyzje właściciela

Czy wchodzi drugi kanał poza Allegro. Czy rozmowa dostaje termin odpowiedzi.
Czy dwa konta jednego człowieka wiążemy ręką. Kiedy sprawa klienta jest
zamknięta i czy wymiana dostaje własny byt — rozstrzygnięte w S6.

## Blizny, których to spoiwo nie ma kupić drugi raz

Blizny 0.130.0 i 0.140.0 stoją w punkcie 5 dekalogu i tu ich nie powtarzamy.

| blizna | czego pilnować przy łączeniu kolejek |
|---|---|
| 0.56.6 | `client:<liczba>` to login kupującego bez konta, nie maska (sprawdzone 24 września 2026); login porównuje się bez wielkości liter |
| 0.121.0 | dyskusja nie jest reklamacją; zegar jednej nie nazywa się zegarem drugiej |
| 0.152.0 | powód odmowy zapisuje się słowem, nie samym kodem odpowiedzi |
| 0.157.0 | ta sama rzecz zbudowana dwa razy w dwóch gałęziach; sprawdź, co już stoi |
| 0.224.1 | pole nieopisane w typie ciała znika po cichu na trasie |
