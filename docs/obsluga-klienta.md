# Obsługa klienta — decyzje i dowody

Ten plik jest rejestrem decyzji o obsłudze klienta, dowodów za nimi i polityki
danych. Docelowy panel opisuje `docs/panel-obslugi-klienta.md`, a reguły
obowiązujące MIĘDZY kolejkami — `docs/obsluga-klienta-calosc.md`.

Obsługa klienta powstała od zera, po skasowaniu poprzedniej: rozmów, nakładki
spraw, rejestru zwrotów i reklamacji. Właściciel zdecydował ciąć przed
zebraniem dowodów, żeby nie budować nowego na starym. Dowody rozstrzygają, co
powstaje, a nie czy ciąć.

## Dlaczego od zera

Pytanie klienta o rozrusznik przyjechało **bez numeru oferty**, choć mail
z Allegro go nazywał. Dopasowanie zgadywało więc z treści: dobór fraz brał
słowa po DŁUGOŚCI i wybrał „Pozdrawiam" zamiast „szarpaku". Powód głębszy:
**model danych stał na kształcie JSON-a wymyślonym w testach adaptera**,
nigdy nie sprawdzonym na żywym koncie, a każda warstwa dziedziczyła tę
niepewność.

## Metoda: najpierw dowody, potem zasady

Nowe zasady wyprowadza się z trzech źródeł, nie ze starych zasad.

1. **Co przyjeżdża z Allegro** — `npm run sonda`
   ([`server/src/sonda-run.ts`](../server/src/sonda-run.ts)). Wyłącznie GET,
   siedem rodzin końcówek, raport o KSZTAŁCIE: nazwy pól, typy, obecność
   i niepustość. Treści, loginów i numerów nie wypisuje — pilnują tego reguły
   w [`services/ksztalt.ts`](../server/src/services/ksztalt.ts). Wynik to
   OBSERWACJA z datą (`allegro-sonda.md`). KONTRAKT mapowania, pisany ze
   specyfikacji, to `allegro-ksztalt.md`; raport sondy go nie nadpisuje.
2. **Jaka praca przychodzi** — `npm run inwentarz`
   ([`server/src/inwentarz-run.ts`](../server/src/inwentarz-run.ts)). Odczyt
   z naszej bazy: wpływ po miesiącach, udział pytań z numerem oferty, trafienia
   w kartotekę, szkice bez edycji, czasy odpowiedzi, decyzje przy zwrotach,
   wyniki reklamacji i drogi napełniania koszy. Wynik trafia do
   `obsluga-stan-zastany.md`.
3. **Czego nie wolno zgubić** — lista blizn niżej.

## Osiem pytań

Każda odpowiedź wskazuje dowód albo mówi wprost, że jest decyzją właściciela
bez dowodu.

### 1. Jaka jest jednostka pracy?

Jednostki domenowe są trzy: rozmowa, dobór i zadanie. Osobnej „sprawy"
sklejającej rozmowy NIE MA. Istniała z decyzji podjętej PRZED liczbami,
których żądało to pytanie, a te liczby nie padły nigdy. Pytanie „co jeszcze
dotyczy tego klienta" rozstrzyga **droga zakupu**: wiąże po numerze
zamówienia, przez cztery kolejki, bez kliknięcia. Drugi pasek o tym samym
byłby podwojeniem, którego zabrania punkt 2 dekalogu
(`docs/obsluga-klienta-calosc.md`). **Cena:** dwóch rozmów o jednym problemie
BEZ wspólnego zakupu droga nie sklei.

### 2. Co wjeżdża i skąd?

Kształty bierzemy z **oficjalnej dokumentacji Allegro**, nie z sondy —
decyzja właściciela. Potwierdzone pola zapisuje `docs/allegro-ksztalt.md`
i to on jest kontraktem dla kodu. Pole, którego nie da się odczytać
z dokumentacji wprost, dostaje `[WERYFIKUJ]` i wchodzi do licznika
w preambule `docs/subiekt-gt-struktura.md`.

Zakaz: żadnego mapowania z pamięci, z wymyślonego JSON-a, z usuniętej
implementacji ani z treści e-maila powiadamiającego. Przykład kosztu:
`external.id` czytany z wiadomości zamiast z oferty dawał `NaN`.

### 3. Co trzymamy u siebie?

Treści wiadomości, w dwóch warstwach — surowej i modelu obsługi. Bez nich
wiedza o tym, o co klient pytał, ginęła po zamknięciu ekranu. Zakres i cena
stoją w rozdziale „Polityka danych skrzynki".

### 4. Kto ma następny ruch i skąd to wiemy?

Status rozmowy wynika wyłącznie z FAKTÓW, które i tak zapisujemy: przyszła
wiadomość, ktoś przejął rozmowę, odpowiedź poszła, zlecono pomiar, wrócił
wynik z hali. Zapisuje go ta sama transakcja co fakt, więc typowa rozmowa nie
wymaga ANI JEDNEGO kliknięcia w status. Statusy wymienia
`panel-obslugi-klienta.md` §7. **Ręcznych stanów nie ma**, decyzją
właściciela; cena jest świadoma: spamu nie da się uciszyć.

**Podziękowanie nie czeka na nas**, gdy klasyfikator zwrócił `OTHER`
z `NO_ACTION` z wysoką pewnością, a my już odpowiedzieliśmy. To fakt
z przypuszczenia maszyny, dlatego każdy warunek jest wąski.

### 5. Czym jest odpowiedź i gdzie stoi granica automatu?

Właściciel usunął zasadę „człowiek wysyła każdą odpowiedź" (§27 projektu
panelu, punkt 2), ale kodu wysyłki bez człowieka nie ma. Kod działa według
granicy **automat proponuje, do klienta mówi człowiek** (§14.2 projektu
panelu). Według §14.3 każde twierdzenie techniczne w szkicu wskazuje źródło.

**Wiedzę zatwierdza każdy z biura, także autor propozycji**, bo w biurze bywa
jedna osoba. Autor i zatwierdzający są zapisani osobno, a automat tylko
proponuje — pilnuje tego serwis. Baza startuje bez importu CUDZEJ bazy
pasowań. Tokeny silników (§12 panelu) zatwierdza człowiek jedną transakcją.

### 6. Czym jest zwrot?

**Dwoma bytami o jednym numerze** — i panel pokazuje to wprost. Sprawa
klienta żyje w Allegro: identyfikator zwrotu, zegar ustawowy, pieniądze.
Proces magazynowy żyje w Subiekcie: paczka wraca, korekta, MM na bufor.
WERTIS trzyma jeden wiersz spinający oba i jest **kolejką decyzji**.
Trzeciego obiegu magazynowego nie ma: odłożenie zostaje w koszach z MM ZWROTY
(`DEPLOY.md` §6a), a ocena towaru idzie przez `zadanie_terenowe` z rodzajem
`weryfikacja`.

**Kształt ekranu wynika z kryterium minimum klikań.** Kubełki DO DECYZJI,
DO OCENY, DO ZWROTU i DO KOREKTY zadają po jednym pytaniu: przyjąć, co
z towarem, ile oddać, czy zlecić korektę. Wiersz przyjeżdża z policzoną
propozycją, więc typowy zwrot to jeden klawisz. Kolejność bierze się
z zegara ustawowego. Sygnały są trzy, bo kolor zapalany zawsze uczy go
ignorować: termin blisko, towar nie wrócił, sprawa rozstrzygnięta w Allegro.
Potwierdzenie dostają dwie rzeczy nieodwracalne: oddanie pieniędzy i odmowa.
Pełny projekt: `docs/panel-obslugi-klienta.md`, rozdział „Zwroty klienckie".

### 7. Jak wygląda ekran?

**Jeden front.** Całe biuro mieszka w `panel/` pod `/obsluga`, w React z Vite
i Tailwindem. `/` i `/biuro` przekierowują (302) do `/obsluga/`. Decyzja
właściciela po audycie: dawna `biuro.html` była konsolą pracy z dwudziestoma
dwoma zapisami, a ci sami ludzie logowali się do dwóch frontów.

**Cel biura, od którego liczy się każdy ekran:** biuro rozstrzyga to, czego
hala nie rozstrzygnie sama — w drodze towaru przez magazyn. Reszta jest
nadzorem albo ustawieniem. **Test dla każdej funkcji:** czy kończy się
decyzją biura, której hala nie podejmie? Tak znaczy pracę na górnym rzędzie.
Coś, co trzeba sprawdzać, to wgląd na dolnym rzędzie. Rzadka zmiana idzie za
zębatkę. Reszta wypada.

**Nagłówek ma jeden rząd.** Podział „praca na górnym rzędzie, wgląd na
dolnym" obowiązuje jako podział treści. Praca to zakładki, a wgląd,
ustawienia i wyjście stoją w menu „Więcej", bo drugi rząd kosztował ~50 px na
każdym ekranie pracy. Dostawy są ósmą zakładką, za kreską, bo to praca
dzienna. Pomiar przy 1180 px: 65 px zamiast 117 px; `flex-wrap` zostaje, bo
menu niesie wylogowanie.

**Co to kosztuje.** Wdrożenie wymaga `npm run build`, który buduje panel,
zanim serwer skopiuje go do `dist/web/obsluga`. Dochodzi drzewo zależności
npm: React, Vite, Tailwind oraz, według `panel-obslugi-klienta.md` §10, React
Router, TanStack Query, shadcn, React Hook Form i Zod. Testy frontu idą
w Vitest, Testing Library i Playwright. Decyzja właściciela, świadoma.

**Co to kupuje.** Adresowalne ekrany zamiast jednego przełącznika. Wspólny
cache zapytań zamiast ręcznego odświeżania co dwadzieścia sekund. Walidację
formularzy w jednym miejscu i testy frontu. Jeden zestaw nawyków, jedno
logowanie, jeden nagłówek i jedną listę spraw do rozstrzygnięcia.

**Przeprowadzka szła widok po widoku**, z makietami
w `docs/projekt-widokow-jeden-front/`. F0 to decyzja, F1 fundament, F2 DO
DECYZJI i dostawy, F3 kosze, F4 stan systemu, dziennik i analiza, F5
ustawienia, F6 skasowanie `biuro.html`. Trasy API biura zostały te same.
Odstępstwa od makiet:

- DO DECYZJI to ekran startowy, liczony w locie, bez tabeli i statusu.
- Kosze mieszkają w zakładce Zwroty (przełącznik Zwroty · Kosze), bo kosz
  jest dalszym ciągiem zwrotu; wiązanie działa w obie strony.
- Metryki etykiet i kodów oraz pomiary obsługi stoją w analizie. Stan
  integracji stoi w stanie systemu. Arkusz lokalizacji widzi tylko admin.
- Dane firmy do druków leżą na serwerze, z zapasem w przeglądarce. To dane
  SPRZEDAWCY, więc reguła prywatności adresu ich nie dotyczy.

### 8. Kiedy nowa obsługa jest gotowa?

Siedemnaście zdań sprawdzalnych okiem stoi w `panel-obslugi-klienta.md` §25.
Najkrótsze niesie sens całości: agent obsłuży typowe pytanie bez otwierania
panelu Allegro. **Dopuszczalnej długości przerwy** w pracy biura nie nazwał
ani ten plik, ani projekt docelowy.

## Lista blizn

Usterki już zapłacone wydaniem. Nowy kod ma prawo wyglądać zupełnie inaczej,
ale nie ma prawa kupić ich drugi raz. Kolumna „wydanie" jest kluczem, po
którym cytują je komentarze w kodzie.

| wydanie | blizna | czego nie wolno zgubić |
|---|---|---|
| 0.18.0 | zapis przy samym patrzeniu na ekran | otwarcie ekranu niczego nie mutuje; liczniki zapisów w teście panelu są umową |
| 0.56.6 | „brak korespondencji" przy istniejącym wątku rozmówcy `client:44300444` | to login kupującego bez konta, nie maska; rozbieżność dawała wielkość liter, więc login porównuje się bez niej (`allegro-ksztalt.md`) |
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
| 0.224.1 | flaga jawnej zgody ginęła na trasie, choć serwis ją obsługiwał i panel ją wysyłał | pole nieopisane w typie `Body` znika po cichu; flagi ciała testuje się na TRASIE, nie tylko w serwisie |
| 0.250.0 | encje HTML TRZECI RAZ — czeskie, słowackie i węgierskie litery wracały dosłownie, a sprawy posprzedażowe omijały dekoder | tablicę encji GENERUJE się parserem przeglądarki, nie pisze z pamięci pod jeden alfabet; nowy synchronizator dostaje dekoder razem z mapowaniem |
| 0.253.0 | zakaz wiedzy własnej dawał szkic suchy, a opis oferty z wymiarami i listą zgodności leżał nietknięty | swobodę modelu kupuje się JAWNOŚCIĄ: źródło przy każdym twierdzeniu, pewność przyznaje serwer wg źródła, a agent widzi rachunek przed wysłaniem |
| 0.253.1 | nowe pole w wyjściu modelu przy starym suficie `max_tokens` ucinało JSON, a błąd odczytu SDK spadał do gałęzi „coś u nas" | rosnąc o pole w wyjściu, rośnij o sufit; `APIError` dziedziczy po `AnthropicError`, więc kolejność `instanceof` jest logiką |
| 0.254.0 | szkic mówił klientowi, że zapisujemy jego model, czego nam brak w kartotece i ile sztuk leży na półce | odpowiedź jest o MASZYNIE KLIENTA, nie o naszej pracy; stan wiedzy i magazynu idą do agenta, nie do klienta |
| 0.59.0 | bufor zwrotów cofał się bez porządku | guard „adres przed sprzedawalnością" przy zadaniach MM (dotyczy koszy) |

## Polityka danych skrzynki

- **Treści wiadomości SĄ przechowywane lokalnie, w dwóch warstwach.**
  Synchronizator zapisuje surową odpowiedź do `allegro_inbox_thread`
  i `allegro_inbox_message`, a z niej składa model obsługi: `channel_account`,
  `conversation` i `message`. Ekran czyta wyłącznie ten drugi. Kopia lokalna
  jest ceną za ekran, który otwiera się przy niedostępnym Allegro. Lądowisko
  trzyma w `surowe_json` także adresy załączników i `additionalInformation`.
- **Załączniki: nazwa, typ i stan, bez pliku.** Nazwa bywa daną osobową
  (`faktura_Kowalski.pdf`); przy treści rozmowy w bazie nie zmienia to skali
  ryzyka. Pobranie idzie przez nasz serwer, bo token konta firmy nie opuszcza
  maszyny. Pliku `UNSAFE` nie da się pobrać.
- **Szkic i komentarze zostają u nas.** Szkic wychodzi WYŁĄCZNIE przez wysyłkę,
  na jawne kliknięcie agenta. Komentarz wewnętrzny ma osobną tabelę, a adapter
  Allegro czyta wyłącznie `message`.
- **Zadanie dla hali niesie kopię pytania**: treść, numer oferty
  i identyfikatory rozmowy i wiadomości trafiają do `zadanie_terenowe`, bo
  streszczenie gubi to, co w pomiarze rozstrzyga.
- **Hala nie widzi rozmowy.** Kolektor czyta wyłącznie zadanie, a trasy
  skrzynki mają bramkę roli także na odczycie.
- **Wynik nie staje się odpowiedzią sam.** Wraca na oś rozmowy jako osobny
  wpis i do szkicu trafia na jawne kliknięcie agenta.

### Copilot: co wychodzi do dostawcy modelu

Copilot jest wyłączony domyślnie. Bez `COPILOT_MODE=anthropic` i bez klucza
z firmy nie wychodzi ani jeden znak. Klasyfikacja nie pisze do klienta.

- **Maskowanie stoi przed każdą drogą.** Znikają e-mail, telefon, kod pocztowy
  z miastem, wiersz z markerem adresu, ciąg szesnastu cyfr i login kupującego;
  zostaje znacznik. Stopka firmowa jest wycięta. Nadawca przyjmuje typ
  `TrescBezpieczna`, nie tekst.
- **Granica maskowania.** Adres bez markera i bez kodu pocztowego przejdzie —
  wyrażenia regularne tego nie rozstrzygają. Dziewięć cyfr tuż po słowie OEM,
  nr, numer, symbol albo kod NIE jest maskowane jako telefon, żeby numer OEM
  dało się rozpoznać. Cena: „nr 601…" bez słowa „tel" wyjdzie do dostawcy.
- **Wychodzi CAŁY WĄTEK tej jednej rozmowy**, przy szkicu i przy klasyfikacji,
  razem z naszymi wiadomościami. Krótka odpowiedź („tak, GX160") bez naszego
  pytania nie mówi modelowi nic. Sufit: dwanaście wiadomości albo sześć
  tysięcy znaków od najnowszej; starsze zastępuje znacznik
  `[wcześniejsze wiadomości pominięte]`.
- **Login do maskowania bierze się z wątku Allegro**, nie z tematu, który
  bywa tytułem oferty. **Nagłówek klasyfikacji piszemy my**: czy jest
  zamówienie, oferta i ile załączników, bez numerów. Typ i podtyp wątku idą
  jako enumy Allegro. Loginów uczestników z `beta.v1` nie zapisujemy.
- **Klasyfikację, szkice, dopytanie i reklamacje robi Claude**, z tym samym
  maskowanym wejściem. Treść wątku wychodzi do jednego podmiotu.
- **Takt.** `COPILOT_AUTO_KLASYFIKACJA=1` rozpoznaje każdą nową wiadomość
  klienta, z sufitem na godzinę z księgi i oknem siedmiu dni. Bez flagi partię
  uruchamia agent, a potwierdzenie mówi, że to kosztuje. Wiadomość z samym
  załącznikiem nie wychodzi: decyzja mówi „sam załącznik" i woła człowieka.
- **Przy decyzji zapisujemy, NA CZYM ją liczono**: identyfikatory
  wiadomości, SHA-256 wejścia i to, czy sufit coś uciął. Treści nie kopiujemy.
- **Szkic z taktu** (`COPILOT_AUTO_SZKIC=1`) powstaje pod ofertą i dla
  wiadomości, która każe coś zrobić: pytania o paczkę, fakturę albo zwrot.
  Fakty szkicu niosą rozpoznanie klasyfikatora — nasze dane, bez treści.
- **Obok rozmowy idą FAKTY serwera.** Kartoteka oferty (symbol, nazwa, EAN,
  numery, dostępność dziś), treść oferty, dane doboru, kandydaci i negatywy
  ze zdaniami źródła oraz wiedza o zastosowaniach, silnikach, pasowaniach
  i pomiarach z rozmowy. Podpisy dowodów jadą BEZ nazwiska pracownika. Nie
  idą: półka, rezerwacje, rozbicie na magazyny, pełny opis kartoteki, historia
  zakupów klienta ani jego adres.
- **Szkic nie staje się odpowiedzią sam.** Stoi w pustym polu jako tekst do
  poprawiania, nie zapisany; do klienta idzie po „Wyślij". Dane doboru
  z rozmowy serwer sprawdza przeciw wątkowi i wyrzuca te, których tam nie ma.
  Wchodzą na kliknięcie agenta, wyłącznie w puste pola.

**Zdjęcia w rozmowie wychodzą do dostawcy, także bez kliknięcia.** Pikseli
zamaskować się nie da: zdjęcie bywa paragonem, etykietą albo ekranem telefonu
i wychodzi w całości. Przy szkicu z taktu nikt tego nie klika; właściciel,
pytany wprost, wybrał obie ścieżki. Kod wymusza trzy zawężenia: tylko `SAFE`,
tylko przychodzące i sufit sztuk (`SUFIT_SZTUK_ROZMOWY`, dziś cztery, idą
najnowsze). Sufit jest, bo tę ścieżkę uruchamia takt, nie człowiek.

Wraca `szkic_copilota.odczyt_zdjec`, bez którego odsiew numerów odrzucałby
każdy numer odczytany ze zdjęcia. Twierdzenia ze zdjęcia mają źródło
`zdjecie` z sufitem „prawdopodobne".

### Treść oferty i wiedza własna modelu

Treść oferty dociągamy z `GET /sale/product-offers/{offerId}` leniwie: jedno
żądanie na ofertę tej rozmowy, przy „Ułóż odpowiedź", trzymane tydzień. Opis
to tekst opublikowany przez sprzedawcę, więc może jechać do dostawcy.

Wiedza własna modelu jest dozwolona pod warunkiem: źródło przy każdym
twierdzeniu i sztywna ocena pewności. Każde twierdzenie techniczne stoi na
liście `twierdzenia` ze źródłem: baza, opis oferty albo wiedza modelu. Numer
bez pokrycia w twierdzeniach odrzuca szkic, bo agent nie ma jak go sprawdzić.
Pewność przyznaje SERWER wg źródła: baza może być „pewna", opis oferty
najwyżej „prawdopodobny", wiedza modelu zawsze „niepewna". Agent czyta
rachunek w oknie „Skąd to wiem", otwartym, gdy pada zdanie spoza bazy.

## Polityka danych zwrotów

- **Trzymamy to, co rozstrzyga zwrot**: identyfikator i numer zwrotu, numer
  zamówienia, datę zgłoszenia, pozycje z nazwą, ilością, ceną i powodem oraz
  FAKT powrotu paczki. Surowa odpowiedź leży w lądowisku `allegro_zwrot`.
- **Konta bankowego i telefonu nadawcy NIE ZAPISUJEMY.** `refund.bankAccount`
  i `sender.phoneNumber` nie mają kolumn, więc nieuważne mapowanie wywali się
  na zapytaniu. Lądowiska przechodzą przez `services/allegro-oczyszczanie.ts`
  ZANIM trafią do bazy: wartość znika, klucz zostaje. Dlatego kontrakt czyta
  się ze specyfikacji w repo, nie z kopii cudzych danych.
- **Zamówienie pobieramy bez danych kupującego**: pozycje, koszt dostawy i SKU
  sprzedawcy (`offer.external.id`). Z `buyer` przechodzi wyłącznie login.
  Login stoi też przy zwrocie, bo Allegro przysyła go z każdym zwrotem.
- **Forma płatności i ŻĄDANIE faktury, bez danych firmy.** Bierzemy
  `payment.type` i flagę `invoice.required`; `invoice.address` nie przechodzi.

### Nazwa odbiorcy z naklejki

Paczka, której klient nie odebrał, wraca z naklejką, której numeru w Allegro
NIE MA, więc pierwszy skan chybia z definicji. Zostaje to, co widać: nazwa
odbiorcy i przewoźnik. Bierzemy `firstName` i `lastName` z `delivery.address`,
a gdy jest `companyName` — jego, bo paczka firmowa nosi nazwę firmy. Wszystko
idzie do JEDNEJ kolumny `odbiorca_nazwa`, przy zamówieniu i przy zwrocie.

### Reszta adresu dostawy

Decyzja właściciela, podjęta po przedstawieniu zakresu i skutków. Klient pisze
„gdzie moja paczka" i podaje SAM NUMER TELEFONU — uchwyt, którego panel nie
znał. Szukanie po nazwisku pokazuje cudze zakupy przy zbieżności nazwisk,
a ulica rozstrzyga to w jednym spojrzeniu.

- **Zakres**: `street`, `city`, `zipCode` i `phoneNumber` z
  `delivery.address`. Pięć kolumn przy `zamowienie_klienta`, bo telefon ma
  drugą, z samymi cyframi: Allegro zapisuje numer tak, jak go wpisano.
- **Szukanie po telefonie idzie po KOŃCÓWCE, od dziewięciu cyfr** — tyle ma
  polski numer bez prefiksu. Krótszy ciąg to losowanie. Końcówka, bo prefiks
  bywa tylko po jednej stronie.
- **Przy zwrocie kolumn adresu NIE MA.** Zwrot bierze adres z zamówienia;
  druga kopia rozjechałaby się przy zmianie adresu u Allegro.
- **Nie przechodzą**: `invoice.address` (innej decyzji nie było), reszta
  `buyer` (e-mail, telefon, własny adres kupującego), PESEL i konto bankowe.
  Raport sondy (`ksztalt.ts`) nie pokazuje pól adresu, bo wchodzi do REPO.
- **Lądowisko nie dostaje nic z adresu.** `allegro-oczyszczanie.ts` wycina
  cały `address`, także nazwę odbiorcy. Mapowanie czyta żywą odpowiedź.
- **Do CSV nazwa nie wychodzi**, bo plik na dysku jest trwalszy niż baza.
- **Odczyt zostawia ślad.** Szukanie paczek po nazwisku dopisuje zdarzenie
  z LICZBĄ trafień i długością uchwytu, nigdy z uchwytem. Uchwyt jedzie
  w ciele żądania, bo adres ląduje w logu żądań serwera.

### Pozostałe zasady zwrotów

- **Hala nie widzi zwrotu.** Bramka roli także na odczycie; magazynier dostaje
  wyłącznie zadanie oceny towaru.
- **Kartotekę wskazuje człowiek.** Dopasowanie po SKU liczy się przy ODCZYCIE.
  Potwierdzenie agenta trafia do `oferta_kartoteka` ze źródłem (`sku` albo
  `reczne`), symbolem, datą i IMIENIEM AGENTA, bo zapisu bez autora nie da się
  rozliczyć (projekt panelu §4.3).
- **Numer listu przewozowego STOI w modelu pracy.** Synchronizacja zapisuje
  w `zwrot_klienta.waybill` numer PIERWSZEJ paczki, tej samej co data nadania
  i przewoźnik. Odświeżenie bez tablicy `parcels` numeru nie kasuje. Przy
  paczce nieodebranej kolumnę wypełnia człowiek ze skanu. CSV numeru nie
  niesie, skan idzie POST-em, a dziennik numeru nie zapisuje.
- **Raport sondy nazywa numer listu daną osobową** (`services/ksztalt.ts`),
  a czyszczenie lądowisk go przepuszcza (`allegro-oczyszczanie.test.ts`).
  Raport WCHODZI DO REPO, a lądowisko jest prywatną kopią w bazie biura.
- **Potrącenie za utratę wartości** zapisuje kwotę, obowiązkowy powód i autora.
  Powód zobaczy klient pytający, czemu dostał mniej. Kwota mieści się
  w widełkach `0…wartość pozycji`.
- **Read-model `sgt_faktura`** niesie identyfikator, typ, numer pełny, numer
  obcy i datę. Nie ma `kh_Symbol` (bywa w nim imię i nazwisko) ani
  `dok_Uwagi` (wolny tekst na adres albo telefon).
- **Produkt dopisany do zwrotu** przepisuje się z zamówienia, bez pola
  tekstowego. **Eksport CSV kolejki** wynosi loginy, więc dopisuje zdarzenie
  `zwroty_eksport`.
- **Z ekranu zwrotów do Allegro wychodzi wyłącznie odczyt**, przerywany na
  429 jak ticker. Pilnuje tego licznik tras zapisu w teście.

## Wysyłka odpowiedzi

- **Wychodzi wyłącznie to, co człowiek wysłał**, jednym kliknięciem, po
  zatwierdzeniu treści. To opis kodu, nie zakaz — patrz pytanie 5.
- **Do Allegro idzie sam tekst.** Komentarze wewnętrzne mają osobną tabelę.
  Załączników ze skrzynki nie wysyłamy.
- **Każda próba zostawia wiersz w `outbox`**: treść, klucz idempotencji,
  wersję rozmowy i stan. Klucz wylicza serwer z rozmowy, pytania i treści,
  więc podwójne kliknięcie nie tworzy drugiej odpowiedzi.
- **Dopisek klienta zatrzymuje wysyłkę**: 409, szkic nietknięty, agent
  poprawia albo wysyła mimo to, jawnie (blizna 0.110.0).
- **Po niejednoznacznym timeoucie nic nie idzie ponownie.** `send_uncertain`
  blokuje próbę, dopóki synchronizacja nie sprawdzi wątku.
- **Kształt żądania potwierdza specyfikacja**: ciało `{ text }`, limit 2000
  znaków sprawdzany przed wysłaniem.

## Polityka danych reklamacji

- **Zapisujemy** treść zgłoszenia i całą rozmowę, login kupującego, powód,
  oczekiwanie i kwotę klienta, terminy, statusy, nasze notatki i „kto
  prowadzi". Rozmowa jest dowodem w sporze, a kopia — ceną za ekran.
- **Prowadzący** ma numer konta z `app_user` i imię. To dana o NAS: „Moje"
  liczy się w przeglądarce, a do Allegro nie idzie. Imię zostaje, żeby czip
  był czytelny po skasowaniu konta.
- **Tagi spraw** są słowem BIURA i nie idą do Allegro. **Poprzednia treść
  notatki** to jeden szczebel w wierszu sprawy, dla cofnięcia. Dziennik
  dostaje długość notatki i nazwę tagu, a `events` nie ma retencji.
- **`PostPurchaseIssue` nie niesie** adresu, telefonu ani konta, więc kolumn
  na nie nie ma. Plików załączników nie trzymamy; pobranie idzie przez nasz
  serwer. Na oś idą wyłącznie JPEG, PNG i GIF, rozpoznane po sygnaturze,
  z `nosniff`, bo załącznik nie ma pola `SAFE`. Hala reklamacji nie widzi.
- **Do dostawcy modelu idzie ZAMASKOWANA rozmowa** (§14.4 projektu panelu),
  z tym samym sufitem co w skrzynce. Login podmienia się po ZNANEJ wartości.
- **Wychodzą FAKTY ZE SPRAWY**: temat, opis zgłoszenia (przycięty), powód,
  podstawa prawna, oczekiwanie z kwotą, ilość, nazwa towaru, numery oferty
  i zamówienia, data zakupu, otwarcia i termin decyzji, zamaskowane. Nie
  wychodzą fakty o NAS: notatka, „kto prowadzi", tagi, kartoteka ani kwoty.
- **Wychodzą ZDJĘCIA klienta, a pikseli zamaskować się nie da.** Typ nazywa
  się `ZdjecieZBramki`, nie „bezpieczne". Obiecuje trzy rzeczy: bajty z TEJ
  sprawy, obraz rozpoznany po SYGNATURZE i mieszczący się w suficie. Bajtów
  nie trzymamy, a dziennik dostaje liczby, nie nazwy plików.
- **Sufitu sztuk nie ma**, decyzją właściciela, ze znajomością kosztu. Zostaje
  sufit bajtów i zdanie, ile pominięto. Budżetu kwotowego **nie ma**.
- **Pytanie agenta przy dopytaniu idzie bez maskowania**, bo pisze je
  pracownik o towarze, a numer części jest jego sensem. **W pytaniu do
  Copilota nie pisze się o kliencie.** Dziennik zapisuje wyłącznie długość.
- **Wraca karta faktów i RADA** z uzasadnieniem, pewnością i niewiadomymi.
  Bramka pilnuje, żeby opinia nie trafiła do pól o słowach klienta. Rada nie
  wychodzi do kupującego i nie dotyka werdyktu. Rachunek trafia do księgi
  Copilota także przy błędzie, bo nieudana próba też bywa płatna.
- **Odpowiedź wysyła tekst agenta i identyfikator sprawy.** Ciało ma dwa pola,
  `text` i `type: "REGULAR"`, i składa je adapter. Dziennik dostaje długość.
- **Załączniki wychodzące** idą do Allegro W CHWILI DODANIA, więc odmowa pada,
  gdy da się wybrać inny plik. Zostaje numer z Allegro, nazwa, typ i rozmiar,
  bez bajtów. Plik niewysłany zostaje u Allegro bez sposobu na sprzątnięcie,
  więc ekran nie obiecuje usunięcia go z Allegro.
- **Kopia wysłanego tekstu zostaje dwa razy**: w `reklamacja_outbox` jako ślad
  PRÓBY i na osi po potwierdzeniu. Bez kopii próby timeout znaczyłby ciszę.
- **Werdykt wychodzi jednym strzałem człowieka**: status z listy jedenastu
  wartości, wiadomość agenta i — przy częściowym zwrocie — kwota. U nas zostaje
  kopia wiadomości na `reklamacja_klienta`, kwota, kto i kiedy oraz los próby
  (`werdykt_status`), także niepewny. Dziennik dostaje długości, kody HTTP
  i nazwę operacji uprzywilejowanej.

## Polityka danych dyskusji

Dyskusja leży w tej samej tabeli co reklamacja i obowiązuje ją ta sama
polityka. Różnice:

- **Zapisujemy mniej, bo Allegro daje mniej.** Przy `type: "DISPUTE"` schemat
  nie niesie numeru sprawy, terminu, tytułu prawnego, powodu, oczekiwania ani
  kwoty. Prośba o zakończenie wysyła tekst agenta z inną wartością `type`.
- **Załączników wychodzących nie ma.** Zdarzenia `dyskusja_odpowiedz`
  i `dyskusja_zakonczenie` niosą długość, los próby i kody.
- **Hala nie widzi dyskusji. Do dostawcy modelu nie idzie stąd nic.**

## Polityka danych sprawy klienta

Sprawa klienta (`docs/obsluga-klienta-calosc.md`, S6) ma klucz w loginie
kupującego, jak `klient_notatka`, i trzyma dane także o nas.

- **Zapisujemy** login jako klucz, następny krok (najwyżej 200 znaków) z
  terminem i odcisk faktów klienta: liczby zwrotów, spraw i wiadomości oraz
  czas najnowszej wiadomości, bez treści. Krok i odcisk sprzed zakończenia
  zostają dla „Cofnij".
- **Prowadzący i kończący to dane o NAS**: imię i konto z `app_user`. Sprawy
  per osoba pokazuje wyłącznie własne „Moje". Zestawienia dla kogoś innego nie
  ma, bo byłoby monitoringiem pracowniczym (art. 22² Kodeksu pracy).
- **Dziennik nie dostaje loginu ani treści kroku.** Zdarzenia
  `klient_sprawa_*` niosą numer sprawy, długość kroku i termin.
- **Audyt odrzuceń pisze wzorzec trasy**, np.
  `/api/obsluga/klient/:login/sprawa/krok`, bo adres niesie login. Starsze
  wpisy `http_rejected` zostają z loginem; ich czyszczenie to decyzja
  właściciela, bo §9 architektury zabrania nadpisywania historii.
- **Sprawa nie wychodzi dalej**: Copilot, CSV, migawka doby i raport tygodnia
  jej nie mają, a hala jej nie widzi. Krok nie niesie adresu ani telefonu —
  to reguła dla człowieka, bo pole jest wolnym tekstem.
- **Retencji nie ma.** Zakończona sprawa budzi się przez trzydzieści dni (S6),
  a profil dalej pokazuje ostatni krok. O archiwizacji decyduje właściciel.

## Polityka danych dosyłki

Drugi przyrost S6 dokłada tabelę `klient_dosylka` z numerem przesyłki.

- **Zapisujemy** numer zamówienia z kontem kanału, numer przesyłki
  i przewoźnika, ostatni kod statusu, pierwsze doręczenie, chwilę ostatniego
  pytania, liczniki przejść i znacznik poprzedniego epizodu. Historii statusów
  nie ma. Autor stoi w dzienniku, bo klucz do `app_user` blokowałby kasowanie
  kont.
- **Numer leży tak jak numer pierwszej paczki**
  (`zamowienie_klienta.przesylka_waybill`, `zwrot_klienta.waybill`). Prowadzi
  do adresu odbiorcy, więc wychodzi tylko do profilu
  (`GET /api/obsluga/klient/:login`) i do odpowiedzi zapisów pod
  `/api/obsluga/klient/:login/sprawa/`, także 409. Reszta ekranów dostaje
  zdanie o dosyłce, bez numeru.
- **Nie ma** adresu, telefonu ani nazwy odbiorcy dosyłki. Zdarzenia
  `klient_dosylka_*` niosą numer sprawy, źródło i kod statusu, bez numeru
  przesyłki. Copilot zna tylko stan paczki (`zdaniePrzesylki`), a CSV,
  migawka i raport wybierają tabele z nazwy.
- **Retencja idzie za sprawą** (kaskada). Ticker przestaje pytać po
  trzydziestu dniach, ale numeru nie kasuje, bo reklamacja dosyłki go wymaga.

## Co się nie zmienia

Poza tą przebudową stoją: kosze i przyjęcia z dokumentu MM, kolektor (dotyka
wyłącznie `/api/kosze`, `/api/kartony`, `/api/przyjecia`) oraz dostawy,
kartoteka i strefa złota.
