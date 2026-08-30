# Obsługa klienta od zera — zasady

Dokument powstaje przed skasowaniem dotychczasowej obsługi klienta: rozmów,
nakładki spraw, rejestru zwrotów i reklamacji. Nie jest wersją
[`architektura-spraw.md`](architektura-spraw.md) — tamten opisuje kod, który
odchodzi, i odejdzie razem z nim. Ten opisuje, co ma stanąć na jego miejscu.

**Stan: SZKIELET.** Osiem pytań niżej ma odpowiedzi puste. Wypełnia się je
dowodami z dwóch narzędzi, nie z pamięci — o tym mówi następny rozdział.
Dopóki odpowiedzi nie ma, nie kasujemy ani jednej linii kodu.

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

> **Odpowiedź:** _(do wypełnienia po sondzie i inwentarzu)_

### 2. Co wjeżdża i skąd?

Lista końcówek z `allegro-ksztalt.md`, z jawnym podziałem na pola pewne
i takie, które bywają puste. Każde pole, na którym stanie logika, ma tu mieć
liczbę „niepuste" przy sobie.

> **Odpowiedź:** _(do wypełnienia)_

### 3. Co trzymamy u siebie?

Dziś treści rozmów nie zapisujemy wcale — i to jest jeden z powodów, dla
których szukanie po sprawach i dopasowania towarów są słabe: cała wiedza
o tym, o co klient pytał, ginie po zamknięciu ekranu. Jeśli zasada ma zostać,
tutaj musi stać, czym za nią płacimy i co ją zastępuje.

> **Odpowiedź:** _(do wypełnienia)_

### 4. Kto ma następny ruch i skąd to wiemy?

Z metadanych, z treści, czy z jawnego stanu stawianego ręką człowieka?
Poprzednia odpowiedź (piłka liczona z metadanych) działała, ale wymagała
osobnej tabeli `watek_meta` i dociągania rozmów przy każdej synchronizacji.

> **Odpowiedź:** _(do wypełnienia)_

### 5. Czym jest odpowiedź i gdzie stoi granica automatu?

Dotychczasowa granica: automat proponuje, do klienta mówi wyłącznie człowiek.
Ta zasada nie jest podważana przez żaden znany nam fakt — ale ma tu zostać
zapisana świadomie, a nie odziedziczona.

> **Odpowiedź:** _(do wypełnienia)_

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

> **Odpowiedź:** _(do wypełnienia)_

### 8. Kiedy nowa obsługa jest gotowa?

Lista zdań sprawdzalnych okiem na produkcji („agent odpowiada na pytanie
o dobór części bez otwierania Allegro"), nie lista funkcji. Ma też nazwać
**dopuszczalną długość przerwy** w pracy biura między cięciem a pierwszym
użytecznym kawałkiem — bo przez ten czas biuro pracuje w panelu Allegro
i w Subiekcie.

> **Odpowiedź:** _(do wypełnienia)_

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

## Co się nie zmienia

Trzy rzeczy nie są przedmiotem tej przebudowy, bo nie mają z nią nic wspólnego:
kosze i przyjęcia z dokumentu MM, kolektor (dotyka wyłącznie `/api/kosze`,
`/api/kartony`, `/api/przyjecia`) oraz dostawy, kartoteka i strefa złota.
