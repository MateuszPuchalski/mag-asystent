# Obsługa klienta od zera — zasady

Dotychczasowa obsługa klienta — rozmowy, nakładka spraw, rejestr zwrotów
i reklamacje — została skasowana w 0.140.0. Ten dokument opisuje, co ma
stanąć na jej miejscu. Poprzednik, `architektura-spraw.md`, opisywał kod
i odszedł razem z nim.

Projekt docelowy panelu opisuje `docs/panel-obslugi-klienta.md`. Ten plik
zostaje rejestrem decyzji i dowodów; tamten mówi, dokąd idziemy.

**Stan: BUDOWA.** Wydanie 0.141.0 dostarcza pierwszy pionowy kawałek:
panel React/Tailwind → zadanie terenowe → kolektor → wynik w panelu.
Osiem pytań niżej nadal prowadzi projekt pełnej skrzynki Allegro. Wypełnia się je
dowodami z dwóch narzędzi, nie z pamięci — o tym mówi następny rozdział.
Właściciel zdecydował ciąć przed zebraniem dowodów, żeby nie budować nowego
na starym; dowody rozstrzygają, co powstanie, a nie czy ciąć.

## Dlaczego od zera

Bezpośredni powód jest jednostkowy. Pytanie klienta o rozrusznik przyjechało
do panelu **bez numeru oferty**, choć mail z Allegro tę ofertę nazywa po
tytule i numerze. Bez oferty dopasowanie towaru zeszło do zgadywania z treści
i pokazało klin drwalski: dobór fraz bierze słowa po DŁUGOŚCI, więc wygrały
„zdemontowanym", „oferowanym" i „Pozdrawiam", a jedyne słowo nazywające
produkt („szarpaku") wypadło przez limit trzech fraz.

Powód głębszy jest inny. **Model danych stał na kształcie JSON-a, który sami
wymyśliliśmy w testach adaptera.** Nikt nigdy nie sprawdził go na żywym
koncie. Inwentarz mówił to wprost o statusach dyskusji („niezweryfikowana
lista"); okazuje się, że dotyczy też wątków wiadomości. Przy takim fundamencie
każda kolejna warstwa — sprawa, piłka, oś czasu, tagi — dziedziczy niepewność
po tej pierwszej i nie da się jej z zewnątrz zobaczyć.

## Metoda: najpierw dowody, potem zasady

Skoro wszystko jest do rewizji, nowych zasad nie wolno wyprowadzić ze starych.
Wyprowadzamy je z trzech rzeczy.

**1. Co naprawdę przyjeżdża z Allegro** — `npm run sonda`
([`server/src/sonda-run.ts`](../server/src/sonda-run.ts)). Wyłącznie GET,
siedem rodzin końcówek, raport o KSZTAŁCIE: nazwy pól, typy, w ilu rekordach
pole było obecne i w ilu niepuste. Treści, loginów, nazwisk i numerów nie
wypisuje — pilnują tego reguły w
[`services/ksztalt.ts`](../server/src/services/ksztalt.ts) i testy obok.
Wynik zapisujemy obok tego pliku jako `allegro-sonda.md` — z datą, bo to
OBSERWACJA. `allegro-ksztalt.md` to co innego: KONTRAKT mapowania, pisany ze
specyfikacji. Do 0.163.0 stało tu, że raport zapisujemy właśnie jako
`allegro-ksztalt.md`, czyli zdanie kazało nadpisać kontrakt raportem — tak
powstała blizna 0.151.0, gdy plik wymyślony razem z kodem nosił etykietę
„raport z produkcji".

Pierwsze pytanie do sondy: **gdzie siedzi numer oferty i czy siedzi tam
zawsze.** Kolumna „niepuste" odpowie też na pytanie ogólniejsze — które pola
tylko wyglądają na pewne.

**2. Jaka praca naprawdę przychodzi** — `npm run inwentarz`
([`server/src/inwentarz-run.ts`](../server/src/inwentarz-run.ts)). Odczyt
z naszej bazy, uruchamiany **przed** cięciem, bo po `DROP TABLE` tych liczb
nikt nie odtworzy: wpływ miesiąc po miesiącu, udział pytań z numerem oferty
i bez, trafienia w kartotekę, szkice puszczone bez edycji, czasy odpowiedzi,
decyzje na pozycjach zwrotu, wyniki reklamacji oraz to, którędy napełniały się
kosze. Wynik zapisujemy obok tego pliku jako `obsluga-stan-zastany.md`.

**3. Czego nie wolno zgubić** — lista blizn na końcu tego dokumentu.

## Osiem pytań

Każda odpowiedź ma wskazywać dowód z punktu 1 albo 2. Odpowiedź bez dowodu
jest kolejnym domysłem — a od domysłów właśnie odchodzimy.

### 1. Jaka jest jednostka pracy?

Wątek, problem klienta, zamówienie? Poprzednia odpowiedź brzmiała „sprawa
skleja obiekty Allegro w jeden problem" i kosztowała cztery tabele nakładki
plus ręczne SCAL i ROZKLEJ. Inwentarz powie, ile spraw naprawdę miało więcej
niż jedno źródło — czyli czy było co sklejać.

> **Odpowiedź:** Rozmowa, sprawa, dobór i zadanie to CZTERY osobne byty —
> `panel-obslugi-klienta.md` §6.1. Sprawa stoi ponad rozmowami i skleja te,
> które dotyczą jednego problemu klienta.
>
> **To decyzja właściciela podjęta przed liczbami, których to pytanie żądało.**
> Inwentarz miał powiedzieć, ile spraw naprawdę miało więcej niż jedno źródło,
> czyli czy było co sklejać. Poprzednia odpowiedź o tym samym kształcie
> kosztowała cztery tabele nakładki oraz ręczne SCAL i ROZKLEJ. Zapisujemy to
> jawnie, żeby nikt nie wziął tej odpowiedzi za wniosek z dowodów.

### 2. Co wjeżdża i skąd?

Lista końcówek z `allegro-ksztalt.md`, z jawnym podziałem na pola pewne
i takie, które bywają puste. Każde pole, na którym stanie logika, ma tu mieć
liczbę „niepuste" przy sobie.

> **Odpowiedź:** Kształty bierzemy z **oficjalnej dokumentacji Allegro**, nie
> z sondy — decyzja właściciela. Potwierdzone pola zapisuje
> `docs/allegro-ksztalt.md` i to on jest kontraktem dla kodu. Pole, którego nie
> da się odczytać z dokumentacji wprost, dostaje `[WERYFIKUJ]` i wchodzi do
> licznika w preambule `docs/subiekt-gt-struktura.md`.
>
> Zakaz zostaje bez zmian: żadnego mapowania z pamięci, z wymyślonego JSON-a,
> z usuniętej implementacji ani z treści e-maila powiadamiającego. Ta lista
> kosztowała już jedno wydanie — `external.id` czytany z wiadomości zamiast
> z oferty dawał `NaN`.

### 3. Co trzymamy u siebie?

Do 0.142.1 treści rozmów nie zapisywaliśmy wcale — i to był jeden z powodów,
dla których szukanie po sprawach i dopasowania towarów były słabe: wiedza
o tym, o co klient pytał, ginęła po zamknięciu ekranu. Od 0.142.1 zapisujemy je
lokalnie; czym za to płacimy, mówi rozdział „Polityka danych skrzynki" niżej.

> **Odpowiedź:** Trzymamy u siebie treści wiadomości, w dwóch warstwach —
> surowej i modelu obsługi. Pełny zapis stoi w rozdziale „Polityka danych
> skrzynki" na końcu tego pliku i on jest odpowiedzią na to pytanie.

### 4. Kto ma następny ruch i skąd to wiemy?

Z metadanych, z treści, czy z jawnego stanu stawianego ręką człowieka?
Poprzednia odpowiedź (piłka liczona z metadanych) działała, ale wymagała
osobnej tabeli `watek_meta` i dociągania rozmów przy każdej synchronizacji.

> **Odpowiedź:** Z **jawnego stanu**, ale stawianego RĘKĄ TYLKO TAM, GDZIE
> automat nie ma go z czego policzyć. Statusy rozmowy wymienia
> `panel-obslugi-klienta.md` §7: `waiting_for_customer` znaczy „piłka po
> stronie klienta", `waiting_for_internal` — po stronie pracownika lub hali.
>
> Odpada liczenie piłki z metadanych, które wymagało osobnej tabeli
> `watek_meta` i dociągania rozmów przy każdej synchronizacji.
>
> **Poprawka z 0.157.0 — druga połowa tej odpowiedzi.** Do tego wydania
> rozdział mówił „stawianego ręką człowieka" i tak też miał powstać ekran.
> Właściciel rozstrzygnął inaczej, tym samym kryterium co przy zwrotach:
> minimum klikań. Status wynika więc z FAKTÓW, które i tak zapisujemy —
> przyszła wiadomość, ktoś przejął rozmowę, odpowiedź poszła do klienta,
> zlecono pomiar, wrócił wynik z hali.
>
> Ręką zostają cztery stany, których automat nie ma jak zgadnąć: odłożenie
> (z terminem), załatwione, zamknięte i spam. To nie jest liczenie piłki
> z metadanych — status zapisuje ta sama transakcja co fakt, z którego
> wynika, i nikt go potem nie odgaduje przy odczycie.
>
> Różnica jest mierzalna: typowa rozmowa nie wymaga ANI JEDNEGO kliknięcia
> w status. Wersja ręczna kłamałaby przy pierwszej rozmowie, w której agent
> się spieszył — a status, który kłamie, jest gorszy od jego braku.

### 5. Czym jest odpowiedź i gdzie stoi granica automatu?

Dotychczasowa granica: automat proponuje, do klienta mówi wyłącznie człowiek.
Ta zasada nie jest podważana przez żaden znany nam fakt — ale ma tu zostać
zapisana świadomie, a nie odziedziczona.

> **Odpowiedź:** Granica zostaje tam, gdzie była, i zostaje zapisana
> świadomie: **automat proponuje, do klienta mówi wyłącznie człowiek.**
> Rozwinięcie w `panel-obslugi-klienta.md` §14.2 — automat nie wysyła
> odpowiedzi, nie potwierdza niepewnego dopasowania, nie obiecuje dostępności
> ani terminu i nie usuwa negatywnego dopasowania.
>
> Do tego §14.3: każde twierdzenie techniczne w szkicu wskazuje źródło, a treść
> bez źródła jest oznaczona jako przypuszczenie.

### 6. Czym jest zwrot?

Sprawą klienta, procesem magazynowym, czy dwoma bytami o jednym numerze?
Decyzja właściciela: rejestr zwrotu znika, kosz napełnia się wyłącznie
dokumentem MM ZWROTY z Subiekta, a zwroty wracają później **zaprojektowane od
nowa**. Ten rozdział jest miejscem na ten projekt — po liczbach z inwentarza,
zwłaszcza po tabelce „którędy napełniane były kosze".

> **Odpowiedź:** **Dwoma bytami o jednym numerze** — i panel ma to pokazywać
> wprost. Sprawa klienta żyje w Allegro: identyfikator zwrotu, zegar ustawowy,
> pieniądze. Proces magazynowy żyje w Subiekcie: paczka wraca, korekta, MM na
> bufor. WERTIS trzyma jeden wiersz spinający oba.
>
> **Czego ten projekt NIE robi.** Nie buduje trzeciego obiegu magazynowego.
> Fizyczne odłożenie zostaje w koszach z dokumentu MM ZWROTY (`DEPLOY.md` §6a),
> a ocena towaru idzie istniejącym `zadanie_terenowe` — rodzaj `weryfikacja`
> już jest w ograniczeniu tabeli, więc kolektor nie dostaje nowego ekranu.
>
> Tu leży różnica wobec rejestru skasowanego w 0.140.0. Tamten próbował być
> naraz kartą zwrotu, dokumentem magazynowym i kolejką korekt. Ten jest
> **kolejką decyzji** nad danymi, których właścicielami są Allegro i Subiekt.
>
> **Kształt ekranu wynika z jednego kryterium: minimum klikań.** Rejestr każe
> najpierw znaleźć zwrot, potem wybrać akcję z menu — dwa kliknięcia przed
> jakąkolwiek decyzją. Panel dzieli pracę na kubełki, a w każdym stoi
> dokładnie jedno pytanie:
>
> | kubełek | pytanie |
> |---|---|
> | DO DECYZJI | przyjąć czy odrzucić? |
> | DO OCENY | co z towarem? |
> | DO ZWROTU | ile oddać? |
> | DO KOREKTY | zlecić korektę? |
>
> Operator nie wybiera, co zrobić — kubełek już to powiedział. Odpowiada
> tylko „tak", „nie" albo „ile". Wiersz przyjeżdża z policzoną propozycją,
> więc typowy zwrot to jeden klawisz.
>
> **Kolejność bierze się z zegara ustawowego**, nie z daty wpływu. To blizna
> 0.121.0 zastosowana do zwrotów: termin jest osobnym bytem i steruje
> kolejnością pracy. Zwrot z dwoma dniami zapasu stoi nad wczorajszym.
>
> **Sygnały są trzy**, bo kolor zapalany zawsze uczy go ignorować: termin
> blisko, towar jeszcze nie wrócił, sprawa rozstrzygnięta już w panelu
> Allegro. Wszystko inne wiersz mówi bez czytania.
>
> **Potwierdzenie dostają dwie rzeczy nieodwracalne** — oddanie pieniędzy
> i odmowa zwrotu. Reszta ma cofnięcie, jak trzy cofnięcia koszy z 0.79.0:
> dopóki zapis czeka w kolejce, aplikacja go anuluje.
>
> Pełny projekt ekranu stoi w `docs/panel-obslugi-klienta.md`, rozdział
> „Zwroty klienckie".

### 7. Jak wygląda ekran?

Czy zostaje jeden panel bez bundlera (`biuro.html`), czy obsługa klienta
dostaje własne miejsce. Reguła „jeden front" z `CLAUDE.md` obowiązuje, dopóki
ten rozdział jej nie zmieni — a zmiana wymaga zdania o koszcie, nie o modzie.

> **Odpowiedź:** Obsługa klienta dostaje własne miejsce — `panel/` pod
> `/obsluga`, React z Vite i Tailwindem. Decyzja właściciela z 0.141.0.
>
> **Co to kosztuje.** Wdrożenie przestaje być kopiowaniem pliku: `npm run
> build` musi zbudować panel, zanim serwer skopiuje go do `dist/web/obsluga`.
> Dochodzi drzewo zależności npm, którego `biuro.html` nie miał wcale.
> Rośnie też koszt czytania: dwa fronty to dwa zestawy nawyków, a odruch
> „szukaj w `biuro.html`" przestaje wystarczać.
>
> **Koszt urósł w 0.145.0 z trzech bibliotek do ośmiu.** Pierwotna wycena
> obejmowała React, Vite i Tailwind. `panel-obslugi-klienta.md` §10 dokłada
> React Router, TanStack Query, shadcn, React Hook Form, Zod oraz testy
> w Vitest, Testing Library i Playwright. Decyzja właściciela, świadoma.
>
> Kupujemy za to rzeczy, których panel dziś nie ma: adresowalne ekrany zamiast
> jednego przełącznika, wspólny cache zapytań zamiast ręcznego odświeżania co
> dwadzieścia sekund, walidację formularzy w jednym miejscu i testy frontu,
> których nie ma wcale. Płacimy ośmioma zależnościami i dłuższym buildem.
>
> **To odwraca decyzję z 0.143.0**, gdzie TanStack Query odrzuciłem jako
> przedwczesny przy pierwszym, czytającym wydaniu skrzynki. Przedwczesny
> przestaje być, gdy ekranów jest kilka i mają wspólny stan.
>
> **Co to kupuje.** Ekrany obsługi są stanowe — lista zadań, formularz wyniku,
> odświeżanie w tle. `biuro.html` robi to ręcznie na `innerHTML`, a testy-
> strażnicy dubli i delegacji istnieją właśnie dlatego, że ten sposób się tam
> już raz wymknął. Nowa obsługa startuje od zera i nie musi tego dziedziczyć.
>
> **Gdzie stoi granica.** Magazyn zostaje w `biuro.html`; przepisywanie go nie
> jest częścią tej decyzji. Trzeciego frontu nie ma.

### 8. Kiedy nowa obsługa jest gotowa?

Lista zdań sprawdzalnych okiem na produkcji („agent odpowiada na pytanie
o dobór części bez otwierania Allegro"), nie lista funkcji. Ma też nazwać
**dopuszczalną długość przerwy** w pracy biura między cięciem a pierwszym
użytecznym kawałkiem — bo przez ten czas biuro pracuje w panelu Allegro
i w Subiekcie.

> **Odpowiedź:** Siedemnaście zdań sprawdzalnych okiem stoi
> w `panel-obslugi-klienta.md` §25. Najkrótsze z nich niesie sens całości:
> agent obsłuży typowe pytanie bez otwierania panelu Allegro.
>
> **Druga połowa pytania zostaje bez odpowiedzi.** Dopuszczalnej długości
> przerwy w pracy biura nie nazwał ani ten rozdział, ani projekt docelowy.
> Przez ten czas biuro pracuje w panelu Allegro i w Subiekcie.

## Lista blizn

Usterki już zapłacone wydaniem. Nowy kod ma prawo wyglądać zupełnie inaczej,
ale nie ma prawa kupić ich drugi raz.

| wydanie | blizna | czego nie wolno zgubić |
|---|---|---|
| 0.18.0 | zapis przy samym patrzeniu na ekran | otwarcie ekranu niczego nie mutuje; liczniki zapisów w teście panelu są umową |
| 0.56.6 | „brak korespondencji" przy istniejącym wątku — Allegro MASKUJE rozmówcę jako `client:44300444` | rozmowy szuka się po identyfikatorze kupującego, nigdy po loginie |
| 0.102.1 | pobranie przerabiało 60 rozmów i zakładało zero pytań | kto pisał, ustala się po roli autora (`BUYER`/`SELLER`), a login rozmówcy jest dopiero zapasem |
| 0.105.0 | szkic dostawał szum, a Allegro zbędne strzały | kontekst dociąga się pod PYTANIE, nie do każdej sprawy |
| 0.110.0 | dopisek klienta zakładał drugą sprawę, a odpowiedź szła na starą wersję pytania | kontrola świeżości przy wysyłce: 409 i jawne „wyślij mimo to", nigdy ciche nadpisanie |
| 0.121.0 | CLAIM miał tę samą plakietkę co zwykła dyskusja | ustawowy zegar 14 dni jest osobnym bytem i steruje kolejnością pracy |
| 0.127.0 | rejestr widział pierwszą setkę dyskusji i gubił resztę po cichu | listy stronicuje się do bezpiecznika, a nie czyta pierwszej strony |
| 0.127.0 | polskie znaki przyjeżdżały jako encje HTML | dekodowanie w adapterze, przy wejściu, a nie przy wyświetlaniu |
| 0.128.0 | ticker widział te same wątki co pięć minut | idempotencja po identyfikatorze wiadomości; drugi przebieg nie robi duplikatów |
| 0.130.0 | historia sprawy ginęła przy scalaniu | zdarzenia wiszą przy ŹRÓDLE, nie przy sprawie |
| 0.135.0 | rozszerzenie ograniczenia `CHECK` w SQLite wymaga przebudowy tabeli | migracja przenosi dane i indeksy, a test stawia bazę sprzed migracji |
| 0.137.1 | trzy przejęcia sprawy zapisywały się bez śladu w dzienniku | każda mutacja zostawia zdarzenie audytu; jedna kolumna ma jedną drogę zapisu |
| 0.151.0 | kształt odczytu Allegro wymyślony razem z kodem, pod etykietą „raport z produkcji" | kształt czyta się ze `swagger.yaml` w repo; znacznik mierzy to, komu się przyznano, a nie to, co sprawdzone |
| 0.152.0 | encje HTML DRUGI RAZ — `odkodujEncje` czekała gotowa z testami, a mapowanie jej nie wołało | odtrutka bez wołającego to odtrutka nieużyta; przepisując funkcję od nowa, sprawdź, co po starej zostało |
| 0.152.0 | 62 przebiegi pod słowem `failed`, gdy serwer znał zdanie „konto niepołączone" | powód zapisuje się SŁOWEM, nie tylko kodem HTTP; wiersz nazwany „połączenie" pokazuje połączenie |
| 0.59.0 | bufor zwrotów cofał się bez porządku | guard „adres przed sprzedawalnością" przy zadaniach MM (dotyczy koszy, które zostają) |

## Polityka danych skrzynki (0.143.0)

**Załączniki (0.155.0).** Trzymamy nazwę pliku, typ i stan — nie trzymamy
samego pliku. Nazwa bywa daną osobową (`faktura_Kowalski.pdf`) i przyjmujemy
to świadomie: skoro w bazie leży treść rozmowy, nazwa załącznika niczego nie
zmienia w skali ryzyka, a bez niej agent nie wie, co dostał.

Pobranie idzie przez nasz serwer, nie z przeglądarki do Allegro — token konta
firmy nie ma prawa opuścić maszyny. Plik o stanie `UNSAFE` nie jest do
pobrania wcale.

`CLAUDE.md` żąda, żeby nowa obsługa zapisała swoją politykę danych, zanim
dotknie pierwszej rozmowy. To jest ten zapis, w stanie na 0.143.0.

**Treści wiadomości SĄ przechowywane lokalnie, w dwóch warstwach.**
Synchronizator zapisuje surową odpowiedź Allegro do `allegro_inbox_thread`
i `allegro_inbox_message`, a z niej składa model obsługi: `channel_account`,
`conversation` i `message`. Ekran skrzynki czyta wyłącznie ten drugi.
Wcześniejszy szkic tego rozdziału mówił, że treści nie trafiają do bazy, i był
nieprawdziwy — kopia lokalna jest ceną za ekran, który otwiera się przy
niedostępnym Allegro.

**Szkic odpowiedzi i komentarze zostają u nas.** Szkic jest współdzielony
w zespole i wychodzi na zewnątrz WYŁĄCZNIE przez wysyłkę, na jawne kliknięcie
agenta. Komentarz
wewnętrzny ma osobną tabelę, żeby nie dało się go pomylić z wiadomością
kanału — adapter Allegro czyta wyłącznie `message`.

**Zadanie dla hali niesie kopię pytania.** Treść wiadomości źródłowej, numer
oferty oraz identyfikatory rozmowy i wiadomości trafiają do `zadanie_terenowe`.
Magazynier ma zobaczyć pytanie w oryginale, bo streszczenie gubi to, co
w pomiarze rozstrzyga.

**Hala nie widzi rozmowy.** Kolektor czyta wyłącznie zadanie. Trasy skrzynki
mają bramkę roli także na odczycie — rozmowy z klientami to dane biura.

**Wynik nie staje się odpowiedzią sam.** Wraca na oś rozmowy jako osobny wpis
i do szkicu trafia wyłącznie na jawne kliknięcie agenta.

**Czego jeszcze nie ma.** Adresy dostawy, załączniki i dane osobowe poza
loginem rozmówcy nie są pobierane.

## Polityka danych zwrotów (0.150.0)

Zwroty pobierają WIĘCEJ niż skrzynka, więc dostają własny zapis. Ten rozdział
powstał, zanim powstała pierwsza tabela.

**Trzymamy to, co rozstrzyga zwrot.** Identyfikator i numer zwrotu, numer
zamówienia, datę zgłoszenia, pozycje z nazwą, ilością, ceną i powodem oraz
sam FAKT powrotu paczki. Surową odpowiedź Allegro trzyma osobne lądowisko
`allegro_zwrot`, jak przy skrzynce — jest dowodem źródłowym przy sporze
o kształt.

**Konta bankowego i telefonu nadawcy NIE ZAPISUJEMY.** Odpowiedź Allegro
niesie `refund.bankAccount` z właścicielem, numerem konta, IBAN-em, SWIFT-em
i adresem, a przy paczce `sender.phoneNumber`. Zwrot da się rozstrzygnąć bez
nich. Kolumn na te pola nie ma wcale, więc nieuważne mapowanie wywali się na
zapytaniu, zamiast wyciec po cichu.

**To zdanie było do 0.151.0 nieprawdziwe i tu jest poprawka.** Mówiło „nie
pobieramy", a lądowisko `allegro_zwrot` zapisywało odpowiedź DOSŁOWNIE —
razem z IBAN-em i telefonem. Model pracy był czysty, kopia zapasowa nie.

Od 0.152.0 obie odpowiedzi przechodzą przez `services/allegro-oczyszczanie.ts`
ZANIM trafią do bazy: wartość znika, klucz zostaje. Lądowisko dalej niesie
kształt, po który istnieje, ale nie niesie już treści, której nie wolno nam
trzymać. Kosztuje to część dowodu przy sporze o kształt — i dlatego pełny
kontrakt czyta się dziś ze specyfikacji w repo, nie z kopii cudzych danych.

To ten sam gatunek poprawki co w 0.143.0, gdzie szkic tej polityki twierdził,
że treści rozmów nie trafiają do bazy. Wtedy poprawiliśmy ZDANIE, bo kopia
treści była ceną za działający ekran. Tu poprawiliśmy KOD, bo konto bankowe
nie kupuje nam niczego.

**Zasada adresów zostaje nietknięta.** Adresy dostawy nie przechodzą przez
mapowanie ani tu, ani w skrzynce.

**Hala nie widzi zwrotu.** Trasy mają bramkę roli także na odczycie. Do
magazyniera idzie wyłącznie zadanie oceny towaru, tak jak przy pytaniach
idzie samo zadanie pomiaru.

**Zamówienie pobieramy w całości, bez danych kupującego.** Od 0.152.0 zwrot
dociąga swoje zamówienie: pozycje, koszt dostawy i SKU sprzedawcy
(`offer.external.id`). Adres dostawy, e-mail, telefon i PESEL kupującego nie
przechodzą przez mapowanie ani przez lądowisko. Zostaje login — jedyna dana
osobowa, którą ta polityka dopuszcza wprost.

**Kartotekę wskazuje człowiek, a automat tylko proponuje.** Dopasowanie po
SKU liczy się przy ODCZYCIE i niczego nie zapisuje; do bazy trafia dopiero
potwierdzenie agenta, razem ze źródłem (`sku` albo `reczne`). Projekt panelu
§4.3 nie pozwala, żeby wybór człowieka udawał fakt z Allegro — wybór automatu
tym bardziej.

**Pamięć wskazań trzyma identyfikatory, nie ludzi.** Od 0.154.0 potwierdzenie
zapisuje w `oferta_kartoteka` parę oferta–kartoteka razem z symbolem, datą
i IMIENIEM AGENTA. To ostatnie jest daną pracownika, nie klienta, i stoi tam
z tego samego powodu co przy każdej innej mutacji: zapis bez autora nie da się
później rozliczyć. Zdjęcie powiązania kasuje wpis.

**Do Allegro nadal nie wychodzi z tego ekranu nic.** Zapisy zwrotów są dwa:
potwierdzenie kartoteki i ręczne dociągnięcie zamówień. Drugi WYCHODZI do
Allegro, ale wyłącznie po odczyt — pobiera to samo co ticker i tak samo
przerywa na 429. Werdykt, kwota, ocena hali i korekta wciąż czekają. Pilnuje
tego licznik tras zapisu w teście.

## Wysyłka odpowiedzi (0.148.0)

Ten rozdział unieważnia zdanie, które stało tu do 0.147.0: „wysyłka jest
wyłączona, więc żadna treść nie wychodzi z WERTIS na zewnątrz". Od 0.148.0
wychodzi — i dlatego dostaje własny zapis.

**Wychodzi wyłącznie to, co człowiek wysłał.** Automat nie wysyła niczego;
regułę tę projekt panelu wymienia jako drugą zasadę nadrzędną. Wysyła agent,
który prowadzi rozmowę, jednym kliknięciem, po zatwierdzeniu treści.

**Nie wychodzi nic poza treścią odpowiedzi.** Do Allegro idzie sam tekst.
Komentarze wewnętrzne mają osobną tabelę i adapter ich nie widzi. Załączników
nie wysyłamy wcale.

**Każda próba zostawia wiersz w kolejce.** Tabela `outbox` trzyma treść, klucz
idempotencji, wersję rozmowy i stan próby. Podwójne kliknięcie nie tworzy
drugiej odpowiedzi, bo klucz wylicza serwer z rozmowy, pytania i treści.

**Dopisek klienta zatrzymuje wysyłkę.** Serwer zwraca 409, szkic zostaje
nietknięty, a agent decyduje: poprawić odpowiedź albo wysłać mimo to. Zgoda
jest jawna — to blizna 0.110.0 i nie wolno jej kupić drugi raz.

**Po niejednoznacznym timeoucie nic nie idzie ponownie.** Stan `send_uncertain`
blokuje kolejną próbę, dopóki synchronizacja nie sprawdzi, czy odpowiedź już
jest w wątku.

**Kształt żądania jest potwierdzony specyfikacją** (0.151.0). Mapowanie POST
powstało z pamięci, wbrew regule §8.2, na polecenie właściciela — i okazało się
trafione co do znaku. Ciało to `{ text }`, a limit `text` wynosi 2000 znaków
i jest sprawdzany przed wysłaniem, nie po odmowie Allegro.

Ta sama specyfikacja pokazała, że mapowanie ODCZYTU skrzynki, które żadnego
znacznika nie nosiło, było błędne w każdym polu i przez dwa wydania nie
zapisało ani jednego wątku. Zakaz z §8.2 zostaje w mocy tym mocniej: nie
chroni przed zgadywaniem oznaczonym, tylko przed nieoznaczonym.

**Dane, które zostają w bazie.** Lądowisko (`allegro_inbox_*`) trzyma całą
odpowiedź Allegro w `surowe_json`, więc adresy załączników
i `additionalInformation` zostają, choć nie mają własnych kolumn ani ekranu.
Model kanoniczny bierze z wiadomości wyłącznie treść, autora, datę, temat
i numer oferty.

## Co się nie zmienia

Trzy rzeczy nie są przedmiotem tej przebudowy, bo nie mają z nią nic wspólnego:
kosze i przyjęcia z dokumentu MM, kolektor (dotyka wyłącznie `/api/kosze`,
`/api/kartony`, `/api/przyjecia`) oraz dostawy, kartoteka i strefa złota.
