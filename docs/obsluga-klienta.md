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
Wynik zapisujemy obok tego pliku jako `allegro-ksztalt.md`.

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

> **Odpowiedź:** Z **jawnego stanu stawianego ręką człowieka** — trzecia
> z trzech możliwości, o które pyta ten rozdział. Statusy rozmowy wymienia
> `panel-obslugi-klienta.md` §7: `waiting_for_customer` znaczy „piłka po
> stronie klienta", `waiting_for_internal` — po stronie pracownika lub hali.
>
> Odpada liczenie piłki z metadanych, które wymagało osobnej tabeli
> `watek_meta` i dociągania rozmów przy każdej synchronizacji.

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

> **Odpowiedź:** _(do wypełnienia)_

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
| 0.59.0 | bufor zwrotów cofał się bez porządku | guard „adres przed sprzedawalnością" przy zadaniach MM (dotyczy koszy, które zostają) |

## Polityka danych skrzynki (0.143.0)

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

**Kształt żądania jest niepotwierdzony.** Mapowanie POST powstało z pamięci,
wbrew regule §8.2 projektu panelu, na polecenie właściciela. Stoi w jednej
funkcji, nosi znacznik `[WERYFIKUJ]` i ma osobną sekcję
w `docs/allegro-ksztalt.md`. Do czasu potwierdzenia pierwsza wysyłka na
produkcji jest testem kontraktu, nie rutyną.

## Co się nie zmienia

Trzy rzeczy nie są przedmiotem tej przebudowy, bo nie mają z nią nic wspólnego:
kosze i przyjęcia z dokumentu MM, kolektor (dotyka wyłącznie `/api/kosze`,
`/api/kartony`, `/api/przyjecia`) oraz dostawy, kartoteka i strefa złota.
