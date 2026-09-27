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

Drugim mostkiem jest login kupującego. Chodzą po nim zakładka KLIENT (S2),
kandydaci zamówień rozmowy bez numeru (S1) i od 0.535.0 sprawa klienta
(S6). Właściciel potwierdził go na żywym koncie 24 września 2026 — rozdział
„Sprzeczność: login kupującego" niżej. Nowe wiązania po loginie są więc dozwolone, bez wielkości liter.

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
zdejmuje od 0.535.0 sprawa klienta z S6. Jej kluczem jest login, nie
zamówienie, więc obie rozmowy budzą tę samą sprawę.

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
nie zapisują. Sprawę klienta pilnuje test „odczyty niczego nie zapisują”
w `prowadzenie-klienta.test.ts`: sprawa, jej odcisk i „Moje” liczą się
przy odczycie, bez zapisu.

## Spoiwo — sześć kroków, szósty w pierwszym przyroście

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

**Notatka była jedynym zapisem do 0.535.0.** Jedna na login, bez statusu
i bez kolejki, więc nie jest piątą tabelą nad kolejkami. Trzyma poprzednią
treść, bo agent nadpisuje cudzą notatkę jednym kliknięciem. Dziennik zdarzeń
dostaje długość, nie treść: notatka o kliencie to dane osobowe, a dziennik
czyta analiza.

**Drugim zapisem jest sprawa klienta (S6).** Notatka mówi, KIM jest klient,
i nie ma terminu. Sprawa mówi, co z nim robimy i do kiedy. Wpisana w notatkę
nie wróciłaby na „Moje” ani w dniu kroku, ani po wiadomości klienta. Stąd
osobna tabela, a nie pole w notatce.

**Zabrania.** Adresu, danych z `buyer` i kwot z anulowanych zamówień.
Pilnują tego `profil-klienta.test.ts` i test ekranu (zero zapisu przy
otwarciu).

### S3. Przeskok jako ODCZYT

`drogaZakupu` wylicza drogę z momentów otwarcia, które i tak leżą w bazie.
Zdarzenie dopisywane przy synchronizacji byłoby drugą prawdą o tym samym
fakcie. Dwie prawdy rozjeżdżają się przy pierwszej poprawce jednej z nich.

### S4. Jedno „Moje" dla trzech kolejek i spraw klienta

Ekran `/obsluga/moje` składa rozmowy, reklamacje i dyskusje. Zwrotu tam NIE MA:
w 0.370.0 właściciel zdjął ze zwrotu prowadzącego. Kolumny `prowadzi_*`
w `zwrot_klienta` zostały, ale nikt ich nie pisze.

**Od 0.535.0 „Moje" niesie też sprawy klienta tej osoby (S6).** Scala je
`mojaLista` w `services/prowadzenie-klienta.ts`, bo `droga-klienta.ts` nie
może znać serwisu sprawy. Pętla importów dała już raz pusty zbiór
(`statusy-spraw.ts`). Wiersz sprawy prowadzi do źródła najnowszego zdarzenia
albo na profil klienta i nie ma przycisku.

Kolejność ma cztery piętra:

1. sprawy klienta z nowym zdarzeniem, najdłużej czekające pierwsze;
2. terminy: kolejki z terminem i kroki na dziś albo po terminie, wedle daty;
3. reszta kolejek, wedle ostatniego ruchu;
4. kroki na przyszłość, z dopiskiem „czeka do”.

Przy równym terminie wygrywa kolejka. Jej termin stawia Allegro albo ustawa,
a krok sprawy stawiamy sobie sami. Pilnuje tego test kolejności „Moje”
w `prowadzenie-klienta.test.ts`. Tożsamość idzie z sesji, więc cudzej sprawy
klienta tu nie widać — test „sprawa klienta na „Moje”…” w `skrzynka.test.ts`.

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

### S6. Sprawa klienta i jej zakończenie (decyzja z 26 września 2026)

Pytanie stało tu otwarte: kiedy sprawa klienta jest skończona, skoro składa
się z bytów o czterech właścicielach danych? Rozstrzygnął je wywiad
z właścicielem z 26 września 2026. Pierwszy przyrost stoi w kodzie od
0.535.0, a drugi, dosyłka ze śledzeniem, od 0.536.0.

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
- zakończenie, które stawia człowiek;
- ponowne otwarcie przy każdym nowym zdarzeniu dowolnego źródła.

**Czego sprawa nie trzyma.** Stanu kolejek, bo ten liczy się przy odczycie,
jak droga zakupu (S3). Historii, bo wisi przy źródle (punkt 5). Ręcznego
scalania, bo login jest kluczem naturalnym i nie ma czego sklejać.

**Co stoi w kodzie.** Tabela `klient_prowadzenie` ma jeden wiersz na login,
a regułę niesie `services/prowadzenie-klienta.ts`. Nazwa nie brzmi
`sprawa_klienta`, bo `migrate()` kasuje tamtą tabelę przy każdym starcie
(0.388.0). Sprawa ma dwa stany: „w toku” z krokiem i terminem albo
„zakończona”. Karta „Sprawa klienta” stoi na profilu klienta, pod sygnałami.
W drugą stronę niosą ją „Moje” prowadzącego i historia klienta przy rozmowie,
zwrocie, reklamacji i dyskusji.

**Krok jest jedyną drogą założenia i wznowienia.** Sprawa bez następnego
kroku nie istnieje: kto nie ma kroku, kończy sprawę. Termin leży najdalej
sześćdziesiąt dni naprzód, bo na dostawcę czeka się tygodniami. Pomyłkę przy
„Zakończ sprawę” cofa przez osiem sekund pasek „Cofnij”. Prowadzącym zostaje
autor pierwszego ruchu, jak przy odpowiedzi w skrzynce od 0.159.0.
„Przejmij” widać tylko przy cudzej sprawie w toku.

Od 0.536.0 krok stawia też odmowa wypłaty z kodem dosyłki na ekranie
zwrotu. Idzie tą samą drogą w kodzie co „Ustaw krok” (`zapiszKrokSprawy`),
więc zdanie wyżej zostaje prawdą.

**Zapis sprawdza świeżość.** Każdy zapis niesie numer wersji, więc cudzy ruch
po otwarciu ekranu daje 409 ze świeżą sprawą. Każdy zapis poza pierwszym
krokiem niesie też odcisk faktów, które ekran narysował (punkt 4). Dotyczy to
także „Przejmij” i „Cofnij”, bo wiadomość klienta nie podbija wersji. Agent
nie potwierdzi więc wiadomości, która przyszła po otwarciu profilu. Brak
klucza w ciele żądania to 400 bez zapisu (blizna 0.224.1).

Od 0.536.0 jest jeden wyjątek: odmowa wypłaty z kodem dosyłki i „Śledź
dosyłkę” przy zwrocie. Stawiają krok bez wersji i odcisku ekranu, bo agent
działa na ZWROCIE, a sprawy nie widzi. Obie podnoszą wersję, więc profil
otwarty w tej chwili dostaje przy zapisie 409. Gdy odcisk różni się tylko
licznikami dosyłki, 409 mówi o dosyłce, a nie o kliencie.

**Co budzi sprawę.** Wyłącznie zdarzenie po stronie klienta albo Allegro, bo
tylko o nim prowadzący może nie wiedzieć. Budzi wiadomość klienta w dowolnej
jego rozmowie, nowy zwrot, nadanie zwrotu i jego doręczenie do nas. Budzi
nowa reklamacja, nowa dyskusja i wiadomość klienta albo doradcy Allegro
w jednej z nich. Zakończona sprawa z takim zdarzeniem wraca na „Moje”
prowadzącego, a sprawa w toku staje tam na górze. Powód stoi słowami panelu,
na przykład „Klient napisał 26.09 14:10”, i prowadzi do źródła.

**Doręczenie dosyłki i kłopot z nią też budzą (0.536.0).** To poszerzenie
decyzji z 26 września, więc stoi tu jawnie, do oceny właściciela. Dosyłkę
zakłada biuro, ale doręczenie i kłopot zgłasza przewoźnik przez Allegro.
Prowadzący o nich nie wie, a krok „dosłać” właśnie na nie czeka. Powód stoi
słowami panelu: „Dosyłka doręczona 30.09” albo „Dosyłka wraca do nadawcy”.
Zakończonej sprawy ticker nie śledzi, więc to obudzenie nie dokłada szumu.

Powrót NASZEJ dosyłki do nadawcy budzi, choć paczka nieodebrana nie budzi.
Paczkę nieodebraną zakłada biuro samo, więc o niej wie. Powrót dosyłki
zgłasza przewoźnik, biuro o nim nie wie, a krok „dosłać” czeka właśnie
na tę paczkę.

**Czego nie budzi (decyzja właściciela z 27 września 2026).** Decyzja
z 26 września mówiła o ponownym otwarciu przy każdym zdarzeniu. Właściciel
zatwierdził węższy odczyt, w tym to, że zakup sprawy nie budzi. Pełna lista
i powody:

- zakupu, bo stały klient budziłby sprawę co tydzień, a obudzenie bez pracy
  uczy je ignorować;
- naszego ruchu — odpowiedzi, werdyktu, pieniędzy — bo prowadzący o nim wie;
- paczki nieodebranej, bo zakłada ją biuro, nie klient;
- podziękowania, bo to rozstrzygnięcie, nie powrót klienta (S5a);
- rozmowy dowiązanej wstecz ręcznym wskazaniem zamówienia, bo jej wiadomość
  znaliśmy przed ruchem agenta.

**Otwarte: obudzona zakończona sprawa zostaje zakończona.** Pierwszy
przyrost stawia ją na „Moje” prowadzącego z powodem, zamiast otwierać na
nowo. Właściciel 27 września tego nie rozstrzygnął. Samo otwarcie wymagałoby
kroku z terminem, więc automat musiałby go zmyślić albo pokazać stary, po
terminie. Rozstrzygnie miara z punktu 10 niżej. Gdy obudzona sprawa zwykle
dostaje nowy krok, samo otwarcie oszczędzi kliknięcie; gdy zwykle kończy się
ją znów, obecny kształt wystarcza.

**Obudzenie liczy się przy odczycie, bez tickera.** W wierszu leży odcisk
faktów z chwili ostatniego ruchu człowieka. „Nowe” to różnica między nim
a odciskiem teraz. Ticker, który raz nie wstanie, zostawiłby sprawę
zakończoną na zawsze. Każdy zapis przy sprawie potwierdza to, co widać,
i gasi obudzenie.

**„Cofnij” przywraca, nie potwierdza.** Zakończenie odkłada odcisk sprzed
siebie, a „Cofnij” go oddaje. Pomyłkowe zakończenie i jego cofnięcie nie
mogą załatwić wiadomości, na którą nikt nie odpisał. Obudzoną zakończoną
sprawę kończy się znów jednym kliknięciem „Zakończ sprawę”. Takie zakończenie
nie ma paska „Cofnij”, bo cofnięcie otworzyłoby sprawę z krokiem po terminie.

**Okno obudzenia: trzydzieści dni od zakończenia (decyzja właściciela
z 27 września 2026).** Zaproponowała je sesja, która zbudowała ten przyrost,
bo decyzja z 26 września nie znała granicy. Właściciel okno zatwierdził.
„Moje” liczy odcisk prowadzonych spraw przy każdym odświeżeniu, co 30 sekund,
synchronicznie na serwerze. Bez granicy ten koszt rósłby z każdą sprawą
zakończoną kiedykolwiek.

Miesiąc mieści ustawowe 14 dni na odstąpienie i drogę paczki z powrotem.
Później nowa wiadomość to nowa sprawa: pokazuje ją skrzynka, a agent zaczyna
sprawę krokiem.

Poza oknem zakończona sprawa nie ma „nowego” nigdzie: na profilu, przy
źródle ani na „Moje”. Wewnątrz okna „Moje” liczy odcisk tylko sprawie, przy
której klient się ruszył od ostatniego ruchu człowieka. Sito przepuszcza
więcej, niż budzi, a rozstrzyga pełny odcisk.

**Odcisk liczy sztuki, nie daty Allegro.** Część dat podstawia nasze
mapowanie, a każda synchronizacja je nadpisuje, więc budziłyby sprawę przy
każdym przebiegu. Wiadomość idzie po NASZYM czasie wstawienia. Import
z opóźnieniem budzi, bo tej wiadomości agent nie widział. Znacznik bez strefy
czyta się jako UTC, tak jak SQLite, żeby próg i zapytanie mówiły o tej samej
chwili.

**Odcisk dostał w 0.536.0 dwa klucze: `k` i `q`.** Od @wydanie liczą PRZEJŚCIA dosyłek
w doręczenie i w kłopot u przewoźnika. Liczniki stoją w wierszu dosyłki
i nigdy nie maleją. Kłopot, potem „w drodze” i znów kłopot budzi więc dwa
razy. Zastąpiona dosyłka nie odejmuje niczego i nie udaje obudzenia.

Napis odcisku każdej sprawy zmienił się w 0.536.0. Ekran profilu otwarty
w chwili tamtej aktualizacji dostał więc raz 409 ze świeżą sprawą. Zapamiętany
odcisk bez nowych kluczy nie budzi. Migracja w @wydanie przycina zapisane
`k` i `q` do nowych sum, żeby następny kłopot obudził sprawę. Odmowa z dosyłką dopisuje brakujące
klucze bez potwierdzania reszty.

**Zakończenie zależy od tego, co klient dostał:**

| rozwiązanie | sprawa kończy się, gdy | skąd to wiemy |
|---|---|---|
| sam zwrot | pieniądze wróciły do klienta | oś zwrotu, `zwrot-pieniedzy.ts` |
| wymiana | poprawny towar doszedł na ten sam adres | od 0.536.0 z trackingu dosyłki, `dosylka.ts` |
| odpowiedź | klient dostał odpowiedź i nie dopisał | skrzynka, S5a |

Wymiana to zwrot przez Allegro i dosyłka poprawnego towaru. Nie dostaje
osobnej kolejki, tylko staje jako następny krok sprawy. Od 0.536.0 krok
„dosłać” ma numer przesyłki i jej stan z Allegro. Kończy zawsze człowiek.

**Podpowiedź zakończenia stoi na profilu.** Pyta „Zakończ sprawę?”, gdy
sprawa jest w toku, w kolejkach nic nie czeka, a dzień kroku nadszedł.
Wcześniej pchałaby do zakończenia sprawy, której krok jeszcze się nie
spełnił. „Dziś” i „po terminie” liczą się na dobie lokalnej magazynu. Na
czerwono stoi tylko „po terminie”.

Od 0.536.0 pyta też wtedy, gdy doszła dosyłka: „Dosyłka doręczona 30.09.
Zakończ sprawę?”. Doszła każda śledzona dosyłka, a ostatnia po ostatnim
ruchu człowieka. Nowy krok po doręczeniu znaczy, że agent je widział
i sprawa ma jeszcze coś do zrobienia. Otwarty zwrot TEGO zamówienia
podpowiedzi nie gasi, bo zwrot wymiany stoi otwarty na zawsze. Powód niesie
pole `podpowiedzPowod`.

**Pilnują:**

- `prowadzenie-klienta.test.ts`: obudzenia i ich brak, świeżość na czterech
  zapisach, prowadzący, „Cofnij” z zapasem, okno obudzenia i doba lokalna;
- ten sam plik: piętra „Moje”, sito bez odcisku dla cichych spraw, UTC
  znaczników bez strefy i zero zapisu przy odczycie;
- `spoiwo.test.ts` i `skrzynka.test.ts`: wymagane klucze ciała, 409 ze
  sprawą, tożsamość z sesji, audyt bez loginu i sprawa przy rozmowie bez
  rozmówcy;
- w panelu `ProfilKlienta.test.tsx`, `Moje.test.tsx` i `Klient.test.tsx`:
  same GET-y przy otwarciu profilu, wiersz „Moje” bez przycisku i linijka
  sprawy przy źródle;
- od @wydanie `dosylka.test.ts`: odmowa stawia krok tą samą drogą, przejęcie
  i zastąpienie dosyłki, epizody, wykrycie numeru i obudzenie z `k` oraz `q`;
- ten sam plik: ticker ze strażą sprawy, ponowienie partii numer po numerze
  i zamrożony stan w nakładce zamówienia;
- `dosylka-opis.test.ts`: zdania dosyłki słowo w słowo i dni robocze na
  dobie magazynu;
- `zwroty.test.ts`: porażka zapisu dosyłki nie zamienia odmowy w błąd,
  a ponowienie niczego nie dopisuje ani nie oddaje 500;
- `zwrot-pieniedzy.test.ts`: odmowa z panelu Allegro zamyka drugą odmowę.

**Miara (punkt 10 dekalogu z `docs/ergonomia-magazynu.md`).** Dwie liczby
mówią, czy sprawa pomaga, czy dokłada pracy. Pierwsza to udział obudzeń
zakończonej sprawy, po których prowadzący kończy ją znów w ciągu dziesięciu
minut, czyli `klient_sprawa_zakonczona` z `ponownie: true` w dzienniku.
Wysoki udział znaczy, że budzi szum, a nie klient. Druga to liczba kroków po
terminie na tydzień: rośnie, gdy terminy są na wyrost albo spraw jest za
dużo. Obie liczy się bez osi osobowej, a dziś nie liczy ich nic.

**Miara dosyłki (0.536.0).** Trzecia liczba to udział numerów wpisanych
ręką: `klient_dosylka_numer` wobec `klient_dosylka_wykryta` z tickera. Sprawdza
na żywo fakt właściciela, że numer dosyłki stoi przy tym samym zamówieniu.
Czwarta to czas od odmowy do numeru, od `klient_dosylka_zalozona` do
pierwszego numeru tej samej sprawy. Sprawdza też założenia o terminach:
etykietę w dniu odmowy i numer w Allegro w ciągu doby.

Krok z terminem postawionym przez odmowę niesie `domyslny: true`
w `klient_sprawa_krok`. Ponowne wpisanie tego samego numeru nie zostawia
wpisu, więc nie zawyża trzeciej liczby. Te miary też liczy się bez osi
osobowej i dziś nie liczy ich nic.

**Zabrania.** Statusu przepisanego ze źródeł, kończenia przez automat
i otwarcia ekranu, które cokolwiek zapisuje. Zabrania też listy, liczby
i raportu spraw albo kroków po terminie w podziale na osoby. Jedynym
wyjątkiem jest własne „Moje” oglądającego, z tożsamością z sesji. Zestawienie
per osoba to monitoring pracowniczy z art. 22² Kodeksu pracy
(`docs/architektura.md` §9). Do dziennika idzie numer sprawy, nigdy login,
treść kroku ani numer przesyłki — polityka stoi w `docs/obsluga-klienta.md`.

**Drugi przyrost: dosyłka ze śledzeniem (0.536.0).** Przy złym towarze
biuro odmawia wypłaty za zwrot kodem `NEW_ITEM_SENT`, czyli „Wysłaliśmy nowy
towar”. Tak podał właściciel 27 września. Kod `MISSING_PART_SENT` doszedł
w tym wydaniu, bo brakująca część jedzie tak samo, drugą paczką. To do
oceny właściciela.

Ta sama odmowa, w tym samym ruchu, stawia w sprawie krok „dosłać” i zakłada
śledzenie dosyłki. Krok dostaje termin trzech dni roboczych, na 8:00
w magazynie. Trzy dni to założenie: dzień na etykietę i do dwóch dni kuriera.
Sprawie w toku odmowa zastępuje krok, bo „czekamy na zwrot” właśnie się
spełniło.

Gdzie biuro odmawia, na ekranie zwrotu WERTIS czy w panelu Allegro, tego nie
wiemy. Obie drogi są obsłużone. Kod odmowy z panelu Allegro przychodzi
synchronizacją i daje przy zwrocie „Śledź dosyłkę” oraz propozycję na
profilu.

**Odmowa nie potwierdza „nowego”.** Agent odmawia na ekranie zwrotu i profilu
nie widział. Porażka zapisu dosyłki nie zamienia odmowy w błąd, bo odmowa
w Allegro już poszła. Ekran zwrotu mówi wtedy, czemu śledzenia nie założono,
i proponuje „Śledź dosyłkę”.

**Odmowa przejmuje dosyłkę, która należy do zwrotu.** Należy do niego numer
wpisany ręką w bieżącym epizodzie i dosyłka założona po zgłoszeniu zwrotu.
Od @wydanie należy też dosyłka, której numer wpisano po zgłoszeniu. Przejęcie
zostawia numer, stan i doręczenie. Starszą odmowa zastępuje, bo klient odesłał
i ją. Tę samą regułę czytają
ekran zwrotu, „Śledź dosyłkę” i propozycja na profilu.

**Wznowienie zakończonej sprawy zaczyna nowy epizod.** Krok, który ją
wznawia, odkłada do historii jej skończone dosyłki, każdą drogą. Skończona
to doręczona, zawrócona albo spoza trzydziestu dni okna. Karta sprawy,
„Moje”, podpowiedź i ticker widzą tylko dosyłki bieżącego epizodu. Dosyłka
sprzed miesięcy nie woła więc w nowej sprawie o numer, którego nikt nie wpisze.

Dosyłka w drodze zostaje żywa (@wydanie). Agent kończy sprawę po nadaniu
etykiety, a wznawia, gdy klient pyta „gdzie paczka?”. Odłożona przestałaby
być śledzona, a panel nie ma jak jej wskrzesić.

**„Po ruchu człowieka” liczy chwila zapisu doręczenia na serwerze** (@wydanie).
Data kuriera bywa wcześniejsza od numeru wpisanego ręką. Wtedy podpowiedź
„Zakończ sprawę?” i zdanie w „Moje” gasły mimo świeżego doręczenia.

**Tabela `klient_dosylka` trzyma numer i wynik śledzenia, nie historię.**
Jeden wiersz przypada na sprawę i zamówienie. Numer wykrywa ticker `dosylki`
w `main()`, co siedemnaście minut (`ALLEGRO_DOSYLKI_SYNC_MS`). O jedną
dosyłkę bez numeru pyta najwyżej co pół godziny. Pyta
`GET /order/checkout-forms/{id}/shipments` i odrzuca numery paczek zwrotu,
wcześniejszych dosyłek i pierwszej paczki.

Pierwszą paczkę poznaje po rejestracji albo doręczeniu przed zgłoszeniem
zwrotu. Numer bez daty rejestracji bierze tylko wtedy, gdy przewoźnik
zgłosił ruch po zgłoszeniu zwrotu. Kilku kandydatów bez daty nie rozstrzyga.
Dwa dni robocze bez numeru to założenie o Sellasist i Allegro, po którym
ekran prosi o numer.

**Śledzenie idzie tą samą drogą co zwroty.** `odpytajTracking`
w `services/allegro-tracking.ts` pyta partiami po przewoźniku. Śledzi
wyłącznie sprawy w toku i bieżący epizod. Okno ma trzydzieści dni od
założenia albo od numeru wpisanego po czasie. Przewoźnika `OTHER` Allegro
nie śledzi, więc nie pytamy o niego wcale.

Limit 429 idzie do `uruchomTakt`. Inny błąd zabiera tylko dosyłkę, o którą
pytanie padło: partię, która padła, ticker pyta jeszcze raz numer po
numerze. Ticker nie podnosi wersji sprawy. Pisze warunkowo, po numerze,
i tylko wtedy, gdy sprawa dalej jest w toku w tym samym epizodzie.

**Dosyłki, której już nie śledzimy, nie opisujemy stanem.** Chodzi
o zakończoną sprawę, poprzedni epizod albo koniec okna. Ekran zwrotu mówi
wtedy „Dosyłka doręczona 30.09” albo „Dosyłki już nie śledzimy.”.
Nakładka zamówienia i szkic Copilota mówią tylko o doręczeniu.

**Wpisany numer jest drogą zapasową.** Profil ma przy dosyłce „wpisz numer”
z listą przewoźników znanych z bazy. Ten sam numer wpisany drugi raz niczego
nie zapisuje. Propozycja „Śledzić dosyłkę?” na profilu zostaje wyłącznie dla
ponowienia i kodów odmowy z panelu Allegro.

`services/przesylka-zamowienia.ts` pokazuje dosyłkę obok pierwszej paczki,
bez numeru. Reguła „doręczona przebija” zostaje, bo przy reklamacji pytanie
brzmi „czy on to w ogóle dostał”.

Właściciel podał 27 września jeszcze dwa fakty, niesprawdzone na żywym
koncie. O numerze przy tym samym zamówieniu powiedział: „Wydaje mi się że
tak”. O przewoźniku dosyłki: „Prawie zawsze tym samym co wcześniej”. Na
pierwszym stoi wykrycie numeru, więc w `docs/allegro-ksztalt.md` ma znacznik
weryfikacji. Na drugim stoi tylko domyślny przewoźnik w formularzu numeru.

**Odcięte z tego przyrostu.** Krok ze zwrotu z powodem `DIFFERENT` odpadł:
powód zwrotu bez kodu odmowy nie znaczy dosyłki. Plakietka
`LicznikDoZrobienia` odpadła, bo „Moje” celowo nie ma licznika. Zdecyduje
o niej miara, nie przyrost. Przycisk „Sprawdź teraz” odpadł, bo ticker
i wpisany numer wystarczają.

Odpadł też ekran do wpisania numeru przy zamówieniu bez dosyłki. Trasa
`POST …/sprawa/dosylka/numer` taki wiersz zakłada, ale panel pokazuje
„wpisz numer” tylko przy dosyłce na karcie sprawy.

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
| wymiana na inny towar | zwrot przez Allegro; od 0.535.0 krok „dosłać" w sprawie klienta, od 0.536.0 numer i śledzenie dosyłki (S6) | potwierdzenia na żywym koncie, że numer dosyłki stoi przy zamówieniu |
| brak towaru na stanie | rozmowa plus zadanie terenowe | — |
| brak towaru do sprzedanego zamówienia | Sellasist: magazynier zgłasza brak przy zbieraniu; od 0.535.0 Ctrl+K po numerze zamówienia daje kupującego | drogi braku z Sellasist do sprawy klienta bez przepisywania numeru |
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
częściami i obie żyły poza aplikacją. Wymiana ma od 0.535.0 krok „dosłać"
w sprawie klienta (S6), a od 0.536.0 numer i śledzenie dosyłki. Brak towaru
czeka na drogę z Sellasist. Do tego czasu numer zamówienia w Ctrl+K daje
kupującego, a z nim profil i sprawę.

**Drugi kanał przestał być pilny.** Wywiad z 26 września 2026 dał dwa
fakty. Z Allegro jest 99% zamówień, a pytania klientów przychodzą przez
Allegro z odnośnikiem do zamówienia. Gmail niesie głównie powiadomienia
Allegro i służy biuru za listę zadań. Tę rolę ma przejąć sprawa klienta.

## Otwarte decyzje właściciela

Czy wchodzi drugi kanał poza Allegro. Czy rozmowa dostaje termin odpowiedzi.
Czy dwa konta jednego człowieka wiążemy ręką. Kiedy sprawa klienta jest
zakończona i czy wymiana dostaje własny byt — rozstrzygnięte w S6.

## Blizny, których to spoiwo nie ma kupić drugi raz

Blizny 0.130.0 i 0.140.0 stoją w punkcie 5 dekalogu i tu ich nie powtarzamy.

| blizna | czego pilnować przy łączeniu kolejek |
|---|---|
| 0.56.6 | `client:<liczba>` to login kupującego bez konta, nie maska (sprawdzone 24 września 2026); login porównuje się bez wielkości liter |
| 0.121.0 | dyskusja nie jest reklamacją; zegar jednej nie nazywa się zegarem drugiej |
| 0.152.0 | powód odmowy zapisuje się słowem, nie samym kodem odpowiedzi |
| 0.157.0 | ta sama rzecz zbudowana dwa razy w dwóch gałęziach; sprawdź, co już stoi |
| 0.224.1 | pole nieopisane w typie ciała znika po cichu na trasie |
