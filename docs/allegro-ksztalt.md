# Kształt Centrum wiadomości Allegro

Kontrakt mapowania skrzynki. **Pochodzi ze specyfikacji OpenAPI Allegro**,
a od 0.164.0 stoi obok niego obserwacja z żywego konta:
[`allegro-sonda.md`](allegro-sonda.md), zdjęta 2 września 2026. Ten plik mówi,
co WOLNO czytać kodowi; tamten mówi, co konto firmy naprawdę oddało danego dnia.
Przy rozjeździe wygrywa obserwacja, a kontrakt się poprawia — i tak powstały
poprawki opisane niżej.

Specyfikacja leży w repo: `docs/allegro/swagger.yaml`, razem z notatką
o pochodzeniu i sposobie odświeżania w `docs/allegro/README.md`. Nie trzeba
już wychodzić do sieci, żeby sprawdzić kształt pola — i to jest jedyna zmiana,
która naprawia przyczynę opisaną niżej, a nie kolejny jej skutek.

Do 0.151.0 ten plik przedstawiał się jako „raport zanonimizowanej odpowiedzi
produkcyjnej". Nie był nim: powstał w tym samym commicie co synchronizacja
i fixture'y (`2e9984a`), a opisane w nim pola nie istnieją w Allegro. Skutek —
skrzynka nie zapisała ani jednego wątku przez dwa wydania, bo każdy z nich
wywracał wstawkę na niezwiązanym parametrze.

To ta sama blizna trzeci raz. `adapters/allegro.http.ts` nosi o niej akapit:
kształt wymyślony w testach i nigdy niesprawdzony na żywym koncie. Za drugim
razem założenie nosiło znacznik do sprawdzenia i było uczciwe. Za trzecim nosiło
etykietę „raport z produkcji" — i dlatego nikt go nie sprawdził.

## Co potwierdziła sonda (1 września 2026)

Pierwszy przebieg `npm run sonda` na koncie firmy potwierdził **całe mapowanie
odczytu** pole po polu. Trzy liczby z niego zmieniają jednak decyzje, więc
stoją tutaj, a nie tylko w raporcie:

- `relatesTo.offer` jest niepuste w **5 z 39** wiadomości. Ekran zbudowany na
  numerze oferty byłby pusty przy większości rozmów.
- `subject` jest niepuste w **5 z 39**, a `type` to `MESSAGE_CENTER` ×25,
  `ASK_QUESTION` ×9 i `MAIL` ×5. Temat mają praktycznie tylko maile.
- `attachments` jest niepuste w **7 z 39**. Załączniki są realne i od 0.155.0
  wchodzą do modelu pracy.

Pełny raport wchodzi obok tego dokumentu po najbliższym przebiegu sondy — ten
z 1 września wyniósł numery listów przewozowych i nie może trafić do repo
(poprawka w `server/src/services/ksztalt.ts` weszła w 0.155.0). Ten dokument
jest KONTRAKTEM, czyli mówi, co wolno czytać kodowi; raport będzie OBSERWACJĄ
z datą. Przy rozjeździe wygrywa obserwacja, a kontrakt się poprawia.

Znaczniki weryfikacji niżej dotyczą **w większości** końcówek ZAPISU i tych
sonda nie tknie, bo jest z założenia GET-em. Do 0.164.0 stało tu twardsze
zdanie — „wyłącznie zapisu, licznik nie zejdzie ani o jeden" — i było
nieprawdziwe: trzy z siedmiu znaczników w tym pliku mówiły o czym innym,
a jeden z nich (`status` zwrotu) dało się zdjąć samą lekturą `swagger.yaml`
leżącego w tym repo. Zdanie przeczyło zresztą innemu, kilkadziesiąt linii
niżej, w sekcji o zwrotach.

### `commission.amount` jest LICZBĄ

W `/order/refund-claims` kwota przyjeżdża jako liczba, gdy wszędzie indziej
Allegro oddaje ją tekstem. Nikt tego pola dziś nie mapuje; `naGrosze()`
przyjmuje tekst i na liczbie się wywróci.

## `GET /messaging/threads`

Obiekt ma tablicę `threads` oraz `offset` i `limit`. Pola `totalCount`
w odpowiedzi NIE MA, choć poprzednia wersja tego pliku je opisywała.

Wątek ma `id`, `read`, **`lastMessageDateTime`** oraz `interlocutor` z polami
`login` i `avatarUrl`. Lista jest od najnowszej zmiany. Endpoint przyjmuje
`limit` (maks. 20) i `offset`.

**Wymagane są WYŁĄCZNIE `id` i `read`.** `lastMessageDateTime` i `interlocutor`
są opcjonalne i jawnie `nullable` — wątek świeżo założony nie ma jak mieć
ostatniej wiadomości. Kolumny `last_message_at` i `interlocutor_login`
dopuszczają więc NULL; do 0.151.0 stało na nich `NOT NULL`, co zamieniało
poprawną odpowiedź Allegro w błąd zapisu.

Kursor synchronizacji porównuje się PARĄ (data, id), więc wątek bez daty nie ma
jak w tej parze stanąć i kursora nie przesuwa. Bierze go najnowszy wątek,
który datę ma.

Awatara nie mapujemy: panel pokazuje login, a obrazek z serwera Allegro
znaczyłby wyjście przeglądarki biura poza własną sieć przy każdym otwarciu
skrzynki.

Schemat mówi o `read` `type: boolean`, ale opublikowany PRZYKŁAD renderuje je
jako tekst (`"false"`). Czytamy więc obie postaci. Wszystko inne jest błędem
wątku: wątek zostaje pominięty i policzony w `error_thread_count`, zamiast
dostać zgadnięte zero.

### Dwie wersje zasobu mają RÓŻNE kształty

`application/vnd.allegro.public.v1+json` i `application/vnd.allegro.beta.v1+json`
to nie są warianty tej samej odpowiedzi. Wersja beta ma `participants` zamiast
`interlocutor`, `status`, `type`, stronicowanie kursorem `nextPage` zamiast
`offset`, a autora wiadomości opisuje polem `role` (`BUYER`, `SELLER`, `USER`,
`CONSULTANT`, `ALLEGRO`) zamiast `isInterlocutor`.

Mapowanie stoi na wersji STABILNEJ i to nie jest obojętne. `zapytajAllegro`
próbuje nagłówków po kolei i zapamiętuje działający — `public.v1` jest pierwszy,
więc dostajemy jego kształt. Gdyby Allegro kiedyś odpowiedziało na niego 406,
klient zszedłby na betę i dostał odpowiedź, której to mapowanie nie rozumie.
Wtedy wątki zaczną wpadać do `error_thread_count`, a nie zapisywać się po cichu
w złym kształcie.

Warto odnotować, że wymyślone `author.role` z `BUYER`/`SELLER` przypominało
akurat wersję beta. Zgadywanie trafiło w kształt, który istnieje — tylko nie
w ten, którym chodzimy.

## `GET /messaging/threads/{id}/messages`

Obiekt ma tablicę `messages` oraz `offset` i `limit`. Wiadomość ma `id`,
`status`, `type`, **`createdAt`**, `thread.id`, `author` z polami `login`
i **`isInterlocutor`**, `text`, `subject`, **`relatesTo`** (gałęzie `offer.id`
i `order.id`), `hasAdditionalAttachments`, `attachments` oraz
`additionalInformation`.

Trzy pola z tej listy zmieniają działanie synchronizatora:

- **`author.isInterlocutor`** daje KIERUNEK. Rozmówca to ten, który nie jest
  nami, więc `true` znaczy wiadomość przychodzącą. Pola `author.role`
  z wartościami `BUYER` i `SELLER` — opisanego tu do 0.151.0 — Allegro nie
  przysyła w tej wersji zasobu wcale.
- **`createdAt`** daje datę POJEDYNCZEJ wiadomości. Poprzednia wersja tego
  pliku twierdziła, że Allegro takiej daty nie podaje, więc wszystkie
  wiadomości wątku dostawały jedną godzinę i oś czasu rozmowy była zmyślona.
- **`relatesTo.offer.id`** daje ofertę. Nie ma pola `relatedObject`
  ani `type` — `OFFER` w kolumnie `related_object_type` to NASZE słowo,
  nazwane tak w modelu kanonicznym, a nie cytat z Allegro.
- **`relatesTo.order.id`** daje zamówienie i idzie do OSOBNEJ kolumny
  `message.related_order_id` (0.166.0). Obie gałęzie są od siebie niezależne:
  wiadomość niesie jedną, obie albo żadną. Raport z 2 września liczy
  `order` w 7 z 33 wiadomości, `offer` w 5 z 33 — zamówienie jest częstszym
  powiązaniem, a do 0.165.0 było wyrzucane przy mapowaniu.

### Czego nie mapujemy i dlaczego

`attachments[]` niesie `fileName`, `mimeType`, `url` i `status` — od 0.155.0
mapujemy je do `message_attachment`, od 0.195.0 wysyłamy, a od 0.244.0
upsertujemy przy każdym przebiegu (patrz „Pobranie załącznika Centrum
Wiadomości" niżej). `hasAdditionalAttachments` zostaje w `surowe_json`:
sonda widziała `false` w 33 na 33 wiadomościach, a specyfikacja nie mówi, co
znaczy `true`. `type` (`MESSAGE_CENTER`) rozróżnia kanały, których mamy jeden.
`additionalInformation` niesie dane właściwe branży (w przykładzie `vin`)
i nie ma u nas ekranu.

Do 0.165.0 stało tu zdanie, że `relatesTo.order.id` „czeka na ekran
zamówienia". Ekran jest od 0.166.0: numer trafia do modelu, ticker
`uzupelnijZamowienia` dociąga treść tą samą drogą co przy zwrotach, a stare
wiadomości dostają numer dosypką z `surowe_json` lądowiska.

**Uwaga o danych:** `surowe_json` w lądowisku trzyma CAŁĄ odpowiedź, więc
adresy załączników i `additionalInformation` zostają w bazie mimo braku kolumn.
Lądowisko jest z założenia surowe — polityka danych z `docs/obsluga-klienta.md`
mówi, co z tego wychodzi dalej.

## Wysyłka

`POST /messaging/threads/{id}/messages` przyjmuje `{ text, attachments? }`
i oddaje obiekt wiadomości w kształcie opisanym wyżej — czyli z polem `id`.
Wymagane jest samo `text`, a jego **`maxLength` to 2000 znaków**.

Ten limit sprawdzamy PRZED wysłaniem (`services/wysylka.ts`). Po wysłaniu
jedyną informacją zwrotną byłoby 400 od Allegro i `send_failed` w kolejce —
agent traciłby wtedy napisany tekst i nie wiedziałby dlaczego.

Adres jest ten sam co przy odczycie (`urlWiadomosci`). Nagłówki, negocjacja
wersji zasobu po 406 oraz obsługa 401, 403, 404 i 429 robi `zapytajAllegro`,
ta sama funkcja co przy pobieraniu.

**Ciało deklaruje WERSJĘ ZASOBU, nie `application/json`** (od 0.173.0).
Specyfikacja wymienia przy tym zapisie dwa typy treści:
`application/vnd.allegro.public.v1+json` i `…beta.v1+json`. Gołego
`application/json` nie wymienia ani tutaj, ani przy wniosku o rabat —
odpowiedzią na niezadeklarowany typ bywa 415. Klient wysyła teraz w
`content-type` tę samą wersję, którą negocjuje w `accept`, a 415 traktuje jak
406: próbuje następnej.

**Uprawnienie jest to samo co przy odczycie** — `allegro:api:messaging`.
Konto, które czyta wiadomości, ma czym odpisywać; ponowne parowanie nie jest
do tego potrzebne.

**Ta końcówka ma limit jednego żądania na sekundę dla użytkownika** i mówi to
wprost jej opis w specyfikacji. Odpowiedzi pisze człowiek, więc limit nie
dotyka pracy biura — ale przy każdym pomyśle na wysyłkę masową to jest
pierwsza liczba do sprawdzenia.

Do 0.151.0 ta sekcja nosiła nagłówek „kształt NIEPOTWIERDZONY" i dwa znaczniki:
ciało powstało z pamięci, wbrew §8.2 projektu panelu, na polecenie właściciela.
**Specyfikacja potwierdziła je co do znaku.** Warto to zapisać obok zdania
wyżej: w tym samym wydaniu okazało się, że mapowanie ODCZYTU, które żadnego
znacznika nie nosiło i przedstawiało się jako raport z produkcji, było błędne
w każdym polu. Znacznik nie mierzy ryzyka; mierzy to, komu się przyznano.

Załączników nie wysyłamy, więc opcjonalnego pola nie budujemy. Specyfikacja zna
też `POST /messaging/messages` z `recipient.login` i `order.id` — to końcówka
do ZAKŁADANIA wątku, a my odpisujemy w istniejącym.

### Co się stanie, jeśli kształt jest inny

Przy odczycie: wątek łamiący schemat jest pomijany, liczy się
w `error_thread_count`, a panel
pokazuje wiersz „Wątki z błędem". Przebieg leci dalej i kursor nie staje na
pominiętym wątku — to jest zabezpieczenie z 0.149.2 i ono zostaje.

Przy wysyłce: Allegro odpowie 400 albo 422, kolejka `outbox` zapisze to jako
`send_failed` razem z treścią odpowiedzi, a wiersz `message` nie powstanie.
Do klienta nic nie wyjdzie po cichu.

## Zwroty klienckie — kształt z dokumentacji, nie z produkcji

Ta sekcja różni się od dwóch pierwszych POCHODZENIEM. Tamte są raportem
sondy z żywego konta. Ta powstała z oficjalnej specyfikacji OpenAPI Allegro
(`developer.allegro.pl/swagger.yaml`), odczytanej z publicznej kopii
wygenerowanego klienta z 26 lutego 2024 — sam portal jest niedostępny
z sieci, w której pisano ten kod.

To spełnia regułę §8.2 projektu panelu: mapowanie wynika z dokumentacji
Allegro. Nie zastępuje jednak sondy. Kopia ma dwa lata, a Allegro w tym
czasie dokładało pola — dlatego rzeczy młodsze od niej noszą znacznik.

`npm run sonda` zdejmuje dziś także zwroty i ich szczegół — przebieg
z 2 września potwierdził tę sekcję pole po polu i zdjął z niej jeden znacznik
(`status`). Reszta znaczników dotyczy ZAPISÓW, których GET nie dosięgnie.

### `GET /order/customer-returns`

Zasób jest w becie, więc chodzi nagłówkiem `application/vnd.allegro.beta.v1+json`.
Negocjuje to `zapytajAllegro` i zapamiętuje wynik osobno dla tej rodziny.

Obiekt ma liczbę `count` i tablicę `customerReturns`. Zwrot ma pola `id`,
`createdAt`, `referenceNumber`, `orderId`, `items`, `refund`, `parcels`,
`rejection`, `marketplaceId` oraz — dopisane w 0.164.0 — `status`, `buyer`
i `isFulfillment`.

`status` to OŚ CZASU ZWROTU po stronie Allegro, nie nasza decyzja. Jedenaście
wartości ze schematu: `CREATED`, `DISPATCHED`, `IN_TRANSIT`, `DELIVERED`,
`FINISHED`, `FINISHED_APT`, `REJECTED`, `COMMISSION_REFUND_CLAIMED`,
`COMMISSION_REFUNDED`, `WAREHOUSE_DELIVERED`, `WAREHOUSE_VERIFICATION`. Pole
jest zwykłym `string` z opisem, **bez `enum`** — zbiór nie jest zamknięty, więc
kod nie może na nim stawiać `CHECK` ani wyczerpującego `switch`.

Dwie z tych wartości mówią o PROWIZJI dla sprzedawcy, nie o pieniądzach
oddanych klientowi: `COMMISSION_REFUND_CLAIMED` znaczy „wniosek o rabat
transakcyjny złożony", a `COMMISSION_REFUNDED` — „prowizja zwrócona".
Pieniądze klienta opisuje dopiero `FINISHED`. Obserwacja z 2 września ma
`COMMISSION_REFUNDED` ×95, więc mylne odczytanie tego pola zamknęłoby prawie
całą kolejkę.

`buyer` niesie `login` ORAZ `email` — patrz „Czego NIE mapujemy". Login stoi
TAKŻE przy zamówieniu (`checkout-forms.buyer.login`), więc od 0.177.0 ekran
zwrotu bierze go z zamówienia, gdy sam zwrot go nie niesie. To ten sam
człowiek, a dwa źródła jednego pola nie są tu nadmiarem: `buyer` wszedł do
mapowania zwrotów dopiero w 0.164.0.
`isFulfillment` mówi, że zwrotem zajmuje się One Fulfillment; u tej firmy
było `false` w stu rekordach na sto.

Pozycja (`items[]`) ma `offerId`, `quantity`, `name`, `price`, `url` oraz
`reason` z polami `type` i `userComment`. Zaobserwowane wartości `reason.type`:
`NONE`, `MISTAKE`, `TRANSPORT`, `DAMAGED`, `NOT_AS_DESCRIBED`, `DONT_LIKE_IT`,
`OVERDUE_DELIVERY`, `INCOMPLETE`, `HIDDEN_FLAW`, `OTHER_FLAW`, `DIFFERENT`.

Kwota (`price`) ma `amount` i `currency`. Specyfikacja mówi wprost, że
`amount` jest STRINGIEM, żeby uniknąć błędów zaokrąglenia. Dlatego
`naGrosze` liczy na tekście, a nie przez liczbę zmiennoprzecinkową.

Paczka (`parcels[]`) ma `createdAt`, `waybill`, `carrierId` oraz `sender`.
Odrzucenie (`rejection`) ma `code`, `reason` i `createdAt`. Kodów jest
SIEDEM, nie cztery: `REFUND_REJECTED`, `NEW_ITEM_SENT`, `ITEM_FIXED`,
`MISSING_PART_SENT`, `ITEM_MISMATCH`, `BUSINESS_PURCHASE` i `NO_RETURN_RIGHT`.
Do 0.164.0 stała tu lista czterech, przepisana z ogłoszenia zamiast ze
schematu.

Filtry listy: `customerReturnId`, `orderId`, `items.offerId`, `items.name`,
`parcels.waybill`, `parcels.carrierId`, `parcels.senderPhoneNumber`,
`referenceNumber`, `from`, `createdAt.gte`, `createdAt.lte`, `marketplaceId`,
`limit` (domyślnie 100) i `offset`.

Od 0.163.0 używamy jednego z tych filtrów: `parcels.waybill` przy skanie
etykiety zwrotnej. Pytamy o JEDEN numer listu, poza rytmem synchronizacji,
i nie ruszamy przy tym kursora — inaczej ręczne pytanie przestawiłoby
ticker i zgubiło zwroty pomiędzy.

Parametr `from` jest KURSOREM: dokumentacja opisuje go jako identyfikator
ostatnio widzianego zwrotu, a odpowiedź niesie zwroty utworzone po nim.
Synchronizator idzie kursorem, bo offset gubi rekord przy wstawce w środku
strony — i to jest blizna 0.127.0 zdjęta u źródła.

### `GET /order/customer-returns/{id}`

Szczegół zwrotu ma TEN SAM kształt co element listy — obie ścieżki oddają
`CustomerReturn`. Sekcji tu nie było do 0.164.0, choć sonda mierzy szczegół od
0.154.0; obserwacja z 2 września potwierdza zgodność pole po polu na dziesięciu
zwrotach.

Synchronizator dlatego czyta LISTĘ i po szczegół nie sięga: dokłada jedno
wywołanie na zwrot, a nie dokłada ani jednego pola. Wyjątek jest jeden —
`parcels[].waybill` bywa na liście pusty, w 6 rekordach z 94, a w szczególe był
niepusty w dziesięciu na dziesięć. Do 0.187.0 stało tu, że pusty jest w 88
z 94 — czyli odwrotnie, niż mówi sonda. Poprawka 0.187.0 zdjęła tę samą
pomyłkę o dwie sekcje niżej i TEGO zdania nie ruszyła.

Różnica dotyczy dziś sześciu paczek: bez numeru listu nie ma o co zapytać
przewoźnika, więc te zwroty zostają bez daty doręczenia. To jest miejsce,
w którym szczegół dałby więcej.

### Co zaczęliśmy mapować w 0.169.0

`buyer.login` przy ZWROCIE (sonda: 100 na 100 niepustych), `parcels[].carrierId`
z tej samej paczki, co data, oraz przy zamówieniu `payment.type`,
`payment.finishedAt` i `invoice.required`.

`carrierId` nie ma w schemacie ani enuma, ani listy — Allegro oddaje słownik
osobno, pod `GET /order/carriers`. Sonda złapała `INPOST`, `ALLEGRO`, `DPD`
i `UNKNOWN`, przy czym ostatniej wartości nie ma w żadnej specyfikacji. Dlatego
kolumna jest bez `CHECK`, a panel buduje filtr z tego, co przyjechało.

`items[].reason.type` też nie ma enuma: schemat wymienia SIEDEMNAŚCIE wartości
słownie, a sonda zaobserwowała jedenaście. Panel tłumaczy dziś wszystkie
siedemnaście, a kod spoza listy pokazuje surowy.

**Obiekt zwrotu nie niesie daty doręczenia — ale API ją podaje.** `parcels[]`
ma wyłącznie `createdAt`, czyli moment utworzenia paczki przez klienta, i tak
się to nazywa na ekranie od 0.169.0. Czasu doręczenia szuka się gdzie indziej:

    GET /order/carriers/{carrierId}/tracking?waybill=…

Każdy wpis historii niesie `occurredAt` („actual shipment status change time"),
a wśród ośmiu kodów jest `DELIVERED`. Jedno wywołanie bierze do dwudziestu
numerów. Od 0.187.0 pyta o to synchronizacja zwrotów.

**Numer do zapytania bierze się z LĄDOWISKA, nie ze świeżo pobranej strony.**
To wynika wprost z kursora opisanego wyżej: `from` oddaje zwroty utworzone PO
podanym, więc raz zobaczony zwrot na listę nie wraca. Pytanie o tracking
wyłącznie tego, co właśnie przyszło, dotyczyłoby więc zawsze zwrotów sprzed
chwili — a te nie są doręczone. Pierwsza wersja poprawki tak właśnie działała
i nie zapisała ani jednej daty.

**Poprzednia wersja tego akapitu odczytała sondę ODWROTNIE.** Twierdziła, że
`waybill` „jest pusty w 88 z 94 rekordów" — a kolumna nosi nagłówek `niepuste`.
Numer jest więc WYPEŁNIONY w 88 przypadkach na 94, czyli prawie zawsze, gdy
zwrot ma w ogóle paczkę. Ta pomyłka kazałaby uznać całą drogę za bezużyteczną.

**`status` NIE odpowiada na pytanie o doręczenie**, choć ma wartość `DELIVERED`
na liście. Sonda pokazuje, czym to pole naprawdę bywa: `COMMISSION_REFUNDED`
×95, `COMMISSION_REFUND_CLAIMED` ×3, `DELIVERED` ×2. Stan prowizji nadpisuje
stan przesyłki, więc po tym polu nie da się poznać, czy karton u nas jest.
Z tego samego powodu kolejka bramek nie routuje po nim od 0.164.0.

`[WERYFIKUJ]` **`checkoutForm.createdAt` przy sprawie posprzedażowej.**
Schemat `PostPurchaseIssueCheckoutForm` ma dokładnie dwa pola: `id`
i `createdAt` (`date-time`). Do 0.282.0 czytaliśmy pierwsze, a drugie ginęło
na etapie typu — i właśnie o tę datę Copilot prosił agenta w liście braków.
Czym dokładnie jest ten moment, nie jest potwierdzone na żywym koncie:
schemat nie mówi, czy to złożenie koszyka, czy jego opłacenie, a `boughtAt`
przy pozycji zamówienia bywa późniejszy. Dlatego ekran nazywa tę datę
„zamówienie złożone", a nie „kupiono", i ustępuje dacie z zamówienia, gdy ją
mamy.

`[WERYFIKUJ]` zostaje przy jednym: końcówka trackingu jest w dokumentacji
opisana przy przesyłkach ZAMÓWIENIA, a my pytamy o przesyłkę ZWROTNĄ. Odmowa
albo pusta historia degraduje — data dojdzie przy następnym takcie.

### Czego NIE mapujemy i dlaczego

Trzy rzeczy z tej odpowiedzi nie mają u nas kolumny.

`refund.bankAccount` niesie `owner`, `accountNumber`, `iban`, `swift`
i `address`. `parcels[].sender.phoneNumber` niesie telefon nadawcy.
`buyer.email` niesie adres e-mail kupującego — dopisany do tej listy
w 0.164.0, bo `buyer` wszedł wtedy do kontraktu i bez tego zdania wyglądałby
na pole do wzięcia w całości. W obserwacji z 2 września `buyer.email` było
puste w stu rekordach na sto, ale schemat je przewiduje i to schemat
rozstrzyga, czego nie wolno zapisać.

Zwrot da się rozstrzygnąć bez nich, a raz pobrane dane osobowe zostają
w kopii zapasowej na lata. Kolumn na nie po prostu nie ma, więc nieuważne
mapowanie wywali się na SQL-u, zamiast wyciec po cichu. Pilnuje tego
`server/src/db/migracja-zwrotow.test.ts`.

Zostaje sam FAKT powrotu paczki — `paczka_at` z najwcześniejszego
`parcels[].createdAt`. To wystarcza, żeby powiedzieć „towar wrócił".

Numeru listu (`parcels[].waybill`) NIE BIERZEMY z tej odpowiedzi, mimo że skan
etykiety go szuka. Szukamy po kopii odpowiedzi w lądowisku, więc numer żyje
przez jedno żądanie zamiast zostać u nas na lata. Politykę opisuje
`docs/obsluga-klienta.md`, rozdział o danych zwrotów.

Kolumna `zwrot_klienta.waybill` powstała w 0.172.0 i tego zdania nie łamie.
Wypełnia się wyłącznie dla wierszy `zrodlo='nieodebrana'`, a te nie pochodzą
z Allegro wcale — wpisuje je operator ze skanu. Z mapowania odpowiedzi Allegro
nadal nie trafia tam ani jeden numer.

### Paczki nieodebranej Allegro nie zna

`CustomerReturn` powstaje ze ZGŁOSZENIA klienta. Przesyłka, której klient nie
odebrał, wraca sama i żadnego zwrotu po tamtej stronie nie tworzy. W schemacie
nie ma na to ani zasobu, ani statusu, ani wartości `reason.type`.

Dlatego takie wiersze zakłada u nas człowiek, a kolumna `zrodlo` mówi wprost,
skąd wiersz pochodzi. Odnośnika do panelu sprzedawcy taki zwrot nie dostaje:
prowadziłby na stronę, której tam nie ma. Synchronizacja ich nie dotyka, bo
dopasowuje po `external_id` z Allegro, a lokalny nosi własny przedrostek.

### Pola młodsze od kopii specyfikacji

Znacznik przy `status` zwrotu ZDJĘTY w 0.164.0. Twierdził, że „kopia
specyfikacji z 2024 roku go nie zawiera" — a `docs/allegro/swagger.yaml`
opisuje to pole razem z jedenastoma wartościami. Znacznik przeżył wymianę
źródła z 0.151.0: sekcja o zwrotach dalej była pisana z dwuletniej kopii, choć
schemat leżał już w repo. Kształt czyta się z pliku, nie z pamięci o pliku.

### Zapisy — kształt NIEPOTWIERDZONY

Trzy końcówki zapisu wchodzą dopiero w 0.151.0. Ich kształt notujemy tutaj
z tej samej kopii specyfikacji, żeby nie odtwarzać go z pamięci później.

`[WERYFIKUJ]` `POST /order/customer-returns/{id}/rejection` przyjmuje obiekt
`rejection` z polem `code` i opcjonalnym `reason`. Nazwa końcówki mówi
o odmowie ZWROTU PIENIĘDZY, a nie o odrzuceniu samego zwrotu — panel nazywa to
tak samo (przycisk ODMÓW WYPŁATY).

**Kodów jest SIEDEM, nie cztery.** Do 0.190.0 stały tu tylko `REFUND_REJECTED`,
`NEW_ITEM_SENT`, `ITEM_FIXED` i `MISSING_PART_SENT`; schemat
`CustomerReturnRefundRejectionRequest` wymienia jeszcze `ITEM_MISMATCH`,
`BUSINESS_PURCHASE` i `NO_RETURN_RIGHT`. Wymagany jest sam `code`; `reason`
staje się obowiązkowy przy `REFUND_REJECTED` i ma `maxLength: 250`.

Końcówka deklaruje WYŁĄCZNIE `application/vnd.allegro.beta.v1+json` i jest
oznaczona `[BETA]` — inaczej niż zwrot pieniędzy, który bierze `public.v1`.
Uprawnienie: `allegro:api:orders:write`.

`[WERYFIKUJ]` `POST /payments/refunds` (schemat `InitializeRefund`) ma CZTERY
pola wymagane: `payment`, `order`, `commandId` i `reason`. Opcjonalne są
`lineItems`, `deposits`, `delivery`, `overpaid`, `surcharges`,
`additionalServices` i `sellerComment`. Pozycja `lineItems[]` ma `id`, `type`
(`QUANTITY` albo `AMOUNT`), `quantity` i `value`.

Wartości `reason` jest SIEDEM: `REFUND`, `COMPLAINT`, `PRODUCT_NOT_AVAILABLE`,
`PAID_VALUE_TOO_LOW`, `OVERPAID`, `CANCELLED_BY_BUYER` i `NOT_COLLECTED`.
Panel wysyła stale `REFUND` — pozostałe opisują sytuacje, których ekran zwrotu
nie obsługuje, a menu z siedmioma powodami kazałoby wybierać przy każdym
zwrocie coś, co ma zawsze tę samą odpowiedź.

Uprawnienie to `allegro:api:payments:write` i jest INNE niż przy rabacie.
Wersja zasobu: `public.v1`. Odpowiedź (`RefundDetails`) niesie `id`, `payment`,
`reason`, `status`, `createdAt` i `totalValue`.

`[WERYFIKUJ]` Zachowanie idempotencji `commandId` na żywym koncie. Do 0.190.0
stało tu, że kopia specyfikacji nie ma `commandId` ani `order` — NIEPRAWDA:
oba stoją w `required` schematu `InitializeRefund`, zgodnie z ogłoszeniem
Allegro o zmianie z 15 grudnia 2025. Zdanie zestarzało się przy odświeżeniu
kopii i nikt go nie przeczytał ponownie.

Otwarte zostaje to, czego z pliku wyczytać się nie da: czy powtórzone żądanie
z tym samym `commandId` naprawdę NIE oddaje pieniędzy drugi raz. Od 0.190.0
identyfikator powstaje raz na zwrot i wraca ten sam przy ponowieniu
(`zwrot_klienta.zwrot_pieniedzy_command_id`), więc pierwszy ponowiony zwrot
odpowie na to pytanie. Do tego czasu obowiązuje ostrożność: nasz własny
strażnik nie wypuszcza drugiego żądania po udanym pierwszym.

`[WERYFIKUJ]` `POST /order/refund-claims` — kształt ŻĄDANIA jest znany
ze schematu (`RefundClaimRequest`, patrz sekcja niżej), ale nie przeszedł
jeszcze przez żywe konto. Znacznik schodzi po PIERWSZYM udanym wniosku
złożonym z panelu, nie wcześniej. Do 0.164.0 stało tu, że kształt jest
„najsłabiej udokumentowany z całej trójki" — nieprawda, bo schemat leży
w repo; nieznana jest wyłącznie odpowiedź konta.

### Rabat transakcyjny — `/order/refund-claims`

Zwrot prowizji od sprzedaży, po polsku „rabat transakcyjny". Do 0.164.0 firma
klikała po niego ręcznie przy każdym zwrocie w panelu Allegro; obserwacja
z 2 września pokazuje, dlaczego to była praca: `type` to `MANUAL` ×60
i `AUTOMATIC` ×40, czyli Allegro część wniosków zakłada samo, a resztę trzeba
złożyć.

**Odczyt** — `GET /order/refund-claims`, nagłówek
`application/vnd.allegro.public.v1+json`, uprawnienie `allegro:api:orders:read`.
Odpowiedź ma `count` i `refundClaims[]`, a wniosek: `id`, `status`, `quantity`,
`commission`, `buyer`, `createdAt`, `lineItem` i `type`. Statusy z filtra:
`IN_PROGRESS`, `WAITING_FOR_PAYMENT_REFUND`, `GRANTED`, `REJECTED`,
`REJECTED_AFTER_APPEAL`, `CANCELLED`, `APPEALED`. Domyślny `limit` to 25,
maksymalny 100.

**Zapis** — `POST /order/refund-claims`, uprawnienie
**`allegro:api:orders:write`**. Ciało (`RefundClaimRequest`) to dosłownie dwie
rzeczy: `{ "lineItem": { "id": … }, "quantity": … }`, gdzie `quantity` musi być
większe od zera. Odpowiedź 201 niesie samo `{ id }` utworzonego wniosku.

`lineItem.id` to identyfikator POZYCJI ZAMÓWIENIA (`lineItems[].id`
z `/order/checkout-forms`), nie oferty i nie pozycji zwrotu. Trzymamy go
w `zamowienie_klienta_pozycja.external_id`.

**LISTA WNIOSKÓW TO NIE JEDYNE ŹRÓDŁO.** Wniosek złożony w panelu Allegro
trafia do niej dopiero z opóźnieniem, a my czytamy ją taktem co kwadrans.
Drugim źródłem jest sam zwrot: `COMMISSION_REFUND_CLAIMED` i
`COMMISSION_REFUNDED` mówią, że prowizja jest już objęta wnioskiem — bez jego
numeru i bez kwoty. Od 0.176.0 `stanRabatu` czyta OBA i mówi, z którego wie,
bo do 0.175.0 ekran pisał przy takim zwrocie „brak wniosku" i podstawiał
przycisk, który zawsze kończył się konfliktem.

### Wątek przeczytany i załączniki wiadomości (0.195.0)

`PUT /messaging/threads/{threadId}/read`, uprawnienie `allegro:api:messaging`.
Ciało to `{ "read": true }` ze schematu `ThreadReadFlag` — pole jest `required`,
a specyfikacja wprost wymienia 422 „missing flag in the request body". Nowego
scope'u parowanie nie potrzebuje: to ten sam, którym czytamy i wysyłamy.

Załącznik wgrywa się DWOMA żądaniami i skrócić się tego nie da.
`POST /messaging/message-attachments` z `{ filename, size }` oddaje `{ id }`,
gdzie `size` ma `maximum: 5242880`. Dopiero `PUT /messaging/message-attachments/{id}`
niesie bajty, a jego `content-type` to TYP PLIKU, nie wersja zasobu —
specyfikacja wymienia `image/png`, `image/gif`, `image/bmp`, `image/tiff`,
`image/jpeg` i `application/pdf`. To jedyny nasz zapis, przy którym 415 znaczy
„zły plik", a nie „zła wersja zasobu".

### Pobranie załącznika Centrum Wiadomości — `GET` bez `Accept` (0.244.0, poprawione w 0.248.0)

Do ODCZYTU specyfikacja daje dwie rzeczy: pole `url` w `MessageAttachmentInfo`
(w przykładzie `https://upload.allegro.pl/message-center/message-attachments/{uuid}`)
oraz operację `downloadAttachmentGET` na `/messaging/message-attachments/{attachmentId}`
(scope `allegro:api:messaging`). Ta druga deklaruje odpowiedź 200 jako `*/*`
z nagłówkami `Content-Type` i `Content-Disposition` — plik binarny, bez wersji
zasobu, dokładnie jak `GET /sale/issues/attachments/{attachmentId}`, z którego
reklamacje czytają zdjęcia bez `Accept` od 0.223.0.

0.244.0 przeczytało plik źle: zapisało, że „operacji w swaggerze nie ma", i dało
drodze API nagłówek `Accept` z JSON-em z pamięci. Sonda właściciela (10 września
2026, `npm run sonda:zalacznik`) pokazała skutek: API z `public.v1` i `beta.v1`
odpowiada **406**, API bez `Accept` **200 `image/jpeg`**, a zapisany adres na
`upload.allegro.pl` **403** na brzegu (portal deweloperski: `EDGE_CLIENT_ERROR`,
którego specyfikacja nie zna). Odmawiał nasz nagłówek, nie Allegro.

Od 0.248.0 adapter idzie KANDYDATAMI (`kandydaciPobrania`): `GET {api}/messaging/message-attachments/{uuid}`
bez `Accept`, a gdy odmówi — zapisany `url` bez `Accept` jako zapas. UUID
bierzemy z OGONA `url`; `MessageAttachmentInfoVBeta1` ma go w `id`, a oba
przykłady w swaggerze niosą ten sam ciąg. 401 kończy próby od razu, bo token
jest jeden. Odmowa każdej drogi wraca jednym zdaniem z kodem każdej próby, bez
adresów i bez identyfikatora. Sonda zostaje jako potwierdzenie na żywo po
aktualizacji: dwie próby kontrolne Z nagłówkiem mają pokazać 406.

Gotowe identyfikatory idą w `NewMessageInThread.attachments` jako lista
`{ id }`. Deklaracji nie da się cofnąć — nie ma takiej końcówki — więc plik
dodany i nigdy niewysłany zostaje po ich stronie i wygasa sam.

**TA KOŃCÓWKA NIE MA IDEMPOTENCJI.** Pole `commandId` jest przy zwrocie
pieniędzy, nie tutaj — więc powtórzone żądanie zakłada DRUGI wniosek, a nie
ten sam. Strażnik przed dubletem musi stać po naszej stronie i dlatego stoi
potrójny (`services/rabaty.ts`).

**Anulowanie** — `DELETE /order/refund-claims/{claimId}`, odpowiedź 204, to samo
uprawnienie do zapisu. Specyfikacja pisze przy nim „this cannot be undone":
anulowania nie da się cofnąć, ale sam wniosek anulować można. Dlatego złożenie
wniosku dostaje w panelu COFNIĘCIE, a nie potwierdzenie — §25a.5 rezerwuje
potwierdzenie dla rzeczy nieodwracalnych.

### Co się stanie, jeśli kształt jest inny

Przy odczycie: `tablica()` rzuca zdaniem wskazującym ten plik, a przebieg
kończy się porażką z kodem HTTP w `allegro_zwroty_sync_state`. Panel pokazuje
wtedy status z §21, a nie pustą kolejkę udającą brak zwrotów.

Przy zapisie (0.151.0): Allegro odpowie 400 albo 422, kolejka zapisze to jako
porażkę razem z treścią odpowiedzi, a do klienta nic nie wyjdzie po cichu.

## Sprawy posprzedażowe — kształt ze specyfikacji i z sondy

Rodzina `/sale/issues` („Post Purchase Issues") niesie DWA byty pod jednym
zasobem: dyskusje (`type: "DISPUTE"`) i reklamacje (`type: "CLAIM"`). Do
0.244.0 panel prowadził wyłącznie reklamacje, a dyskusje odsiewał filtr
w mapowaniu synchronizatora — decyzja właściciela z 6 września 2026.

**Właściciel odwrócił ją 9 września 2026.** Od 0.245.0 obie gałęzie lądują
w bazie, a rozróżnia je kolumna `typ`; dyskusje mają własny ekran (§25c
projektu panelu). Licznik odsianych ZOSTAŁ i zmienił znaczenie na „ile dyskusji
przyjechało" — jest teraz kontrolą krzyżową dla licznika kolejki.

Identyfikatory obu bytów żyją w JEDNEJ przestrzeni: specyfikacja opisuje
`{issueId}` jako `Dispute or claim identifier` przy każdej końcówce rodziny.
Dlatego trzyma je jedna tabela — dwie czyniłyby z „jedna sprawa = jeden wiersz"
umowę, której baza nie pilnuje.

Cała rodzina chodzi po `application/vnd.allegro.beta.v1+json` i po uprawnieniu
`allegro:api:disputes` — specyfikacja podaje je przy wszystkich trzech zapisach
tak samo, jak przy odczytach. Wysyłka odpowiedzi (0.224.0) nie prosi więc
o nowe uprawnienie i werdykt też nie będzie prosił; parowania konta żaden
z tych przyrostów nie powtarza.

### Ile tego jest

Sonda z żywego konta (2 września 2026, próbka stu spraw): **65 CLAIM i 35
DISPUTE**, `right: COMPLAINT` przy wszystkich sześćdziesięciu pięciu. Statusy:
`CLAIM_ACCEPTED` 33, `DISPUTE_ONGOING` 25, `CLAIM_SUBMITTED` 20,
`CLAIM_REJECTED` 12, `DISPUTE_CLOSED` 10. Powody: `DEFECT_FOUND_DURING_USE` 34,
`NOT_AS_DESCRIBED` 17, `OTHER` 6, `MISSING_PRODUCT_ELEMENT` 5,
`PRODUCT_DAMAGED_PARCEL_INTACT` 3.

Dwadzieścia spraw czekało na decyzję sprzedawcy i żadna z nich nie miała
u nas kolejki ani zegara.

### `GET /sale/issues`

Parametry: `checkoutForm.id`, `limit` (1–100, domyślnie 10), `offset`, `status`
(tablica) oraz `Accept-Language`. **Kursora ani granicy dat NIE MA** i to jest
różnica wobec zwrotów: `getCustomerReturns` przyjmuje `from`, ten zasób nie.
Każdy przebieg czyta listę od początku, posortowaną malejąco po dacie otwarcia.

Odpowiedź `PostPurchaseIssueListResponse` ma w schemacie WYŁĄCZNIE pole
`issues`. Licznika `count` tam nie ma, więc czytamy go miękko: gdy przyjdzie,
ogon przebiegu będzie policzony; gdy nie, zostaje „nie wiem".

**ŻADEN ze schematów `PostPurchaseIssue*` nie ma listy `required`.** Wymagalność
pola mówi wyłącznie ta lista, więc kod traktuje każde pole jako opcjonalne —
poza `id`, bez którego nie ma czego zapisać. Tak samo potraktowaliśmy
`OfferListingDto` w 0.214.0 i to nie była wtedy usterka Allegro.

### Filtr statusów: przebieg bierze NAJPIERW sprawy otwarte (0.273.0)

`getListOfIssuesUsingGET` przyjmuje `status` — tablicę `PostPurchaseIssueStatus`
(`CLAIM_SUBMITTED`, `CLAIM_ACCEPTED`, `CLAIM_REJECTED`, `DISPUTE_ONGOING`,
`DISPUTE_CLOSED`, `DISPUTE_UNRESOLVED`). Do 0.272.0 nie używaliśmy go wcale.

Lista jedzie MALEJĄCO PO DACIE OTWARCIA, a bezpiecznik stron ucina jej ogon —
czyli sprawy najstarsze, czyli najbardziej spóźnione, czyli dokładnie te, dla
których panel reklamacji powstał. Przebieg pyta więc najpierw o trzy statusy
spraw żywych, a dopiero potem o całą listę. Spraw otwartych jest garść, więc
mieszczą się przed bezpiecznikiem niezależnie od tego, jak długie jest archiwum.

Przelot pełny ZOSTAJE nietknięty: to on zamyka sprawy rozstrzygnięte poza
panelem i z niego liczy się ogon (`pozostalo`). Sprawa widziana w obu przelotach
zapisuje się raz — przebieg trzyma je w mapie po identyfikatorze.

### Język: `Accept-Language` przy każdym żądaniu (0.273.0)

Specyfikacja wymienia ten nagłówek przy `GET /sale/issues` („Expected language
of subject field") i przy `GET …/chat` („Expected language of messages",
z przykładem `en-US`). Do 0.272.0 nie było go w serwerze NIGDZIE, więc pola
zależne od języka przychodziły w domyślnym Allegro.

Wysyłamy `pl-PL` z jednego miejsca — bloku nagłówków `zapytajAllegro` — dla
całej rodziny końcówek. Rozjazd języka między listą a rozmową tej samej sprawy
byłby gorszy niż konsekwentna angielszczyzna.

### Co mapujemy

| pole Allegro | kolumna | po co |
|---|---|---|
| `id` | `external_id` | klucz naturalny w parze z kontem |
| `type` | `typ` | zostaje, żeby dało się sprawdzić, co odsialiśmy |
| `referenceNumber` | `reference_number` | numer, który widzi też kupujący |
| `decisionDueDate` | `decyzja_do` | termin decyzji — **czytany, nie liczony** |
| `currentState.statusDueDate` | `status_do` | drugi zegar Allegro |
| `currentState.status` | `status_allegro` | z niego wynika kubełek |
| `currentState.returnRequired` | `zwrot_wymagany` | trzy stany, więc kolumna, nie flaga |
| `currentState.chatActive` | `czat_aktywny` | czy Allegro przyjmie odpowiedź |
| `openedDate` | `otwarto_at` | moment otwarcia albo ponownego otwarcia |
| `buyer.login` | `kupujacy_login` | jedyna dana osobowa, jak przy zwrocie |
| `checkoutForm.id` | `order_id` | mostek do zamówienia, zwrotów i rozmów |
| `offer.id` | `offer_id` | mostek do kartoteki przez `offer_snapshot` |
| `reason.type`, `reason.description` | `powod_typ`, `powod_opis` | powód i słowa klienta |
| `right` | `prawo` | rękojmia albo gwarancja — dwa tytuły prawne |
| `expectations[0].name` i `.refund` | `oczekiwanie`, `oczekiwana_kwota_grosze` | czego klient chce |
| `chat.messagesCount` | `wiadomosci_ile` | mówi, czy rozmowa jest kompletna |
| `chat.lastMessage.status` | `ostatnia_wiadomosc_status` | czyj jest ruch |
| `chat.initialMessage` | wiersz w `reklamacja_wiadomosc` | treść zgłoszenia bez dodatkowego żądania |
| `attachments[]` | `reklamacja_zalacznik` | nazwa i adres, **nigdy plik** |

`decisionDueDate` jest tu najważniejszy. Implementacja skasowana w 0.140.0
liczyła ustawowe czternaście dni SAMA, bo komentarz obok twierdził, że ten
zasób żadnego zegara nie oddaje. Twierdzenie było nieprawdziwe już wtedy,
a liczba wzięta z naszego kodu rozjeżdżałaby się z tą, którą widzi kupujący.

Kwotę z `expectations[].refund.amount` liczymy na TEKŚCIE, tą samą funkcją co
przy zwrotach (`naGrosze`). Allegro oddaje ją stringiem i mówi wprost dlaczego:
„to avoid rounding errors".

### Czego NIE mapujemy i dlaczego

`product.id` — identyfikator katalogu Allegro, a my wiążemy przez ofertę
i sygnaturę. `offer.quantity` — liczba sztuk objętych sprawą; przyda się
dopiero przy częściowym zwrocie pieniędzy, czyli w przyroście trzecim.
Danych adresowych i kontaktowych schemat `PostPurchaseIssue` nie niesie
w ogóle, więc kolumn na nie po prostu nie ma.

### `GET /sale/issues/{issueId}/chat`

Zwraca obiekt z tablicą `chat`, a nie `messages` — do 0.164.0 sonda pytała
o zły klucz i dlatego jej sekcja rozmowy była pusta przy stu sprawach
z niezerowym `chat.messagesCount`. Domyślny `limit` przy tej jednej końcówce
to **10**, nie 100 jak przy listach obok, więc podajemy go jawnie.

`PostPurchaseIssueMessageAuthor.login` bywa PUSTY i schemat mówi wprost, kiedy:
„not present if role is ADMIN, SYSTEM or FULFILLMENT". Doradca Allegro
(`ADMIN`) odpisał w 61 sprawach na 100, więc to jest przypadek typowy.

**Rozmowa STRONICUJE SIĘ od 0.273.0.** Do 0.272.0 to żądanie szło raz, bez
`offset`, choć adres umiał go od początku — więc rozmowa dłuższa niż sto
wiadomości była przycięta na zawsze, a ekran obiecywał przy niej resztę, która
nie miała skąd przyjść. Bezpiecznik stoi na pięciu stronach; rozmowa dłuższa
dostaje znak `czat_urwany` i wtedy ekran mówi co innego, zamiast obiecywać.

Bezpiecznik był potrzebny z osobnego powodu niż przy liście: budżet rozmów na
przebieg liczy SPRAWY, nie żądania, więc bez granicy jedna rozmowa o tysiącu
wiadomości zjadłaby cały takt sama.

`[WERYFIKUJ]` Kształt rozmowy na ŻYWYM koncie. `docs/allegro-sonda.md` ma tę
sekcję pustą, bo próbkę zdjęto przed poprawką klucza. Kolumna „niepuste" dla
`chat[].text`, `chat[].author.login` i `chat[].attachments` jest więc nieznana.
Sprawdza się to jednym `npm run sonda`.

`[WERYFIKUJ]` KOLEJNOŚĆ wiadomości w rozmowie. Przy liście spraw specyfikacja
mówi wprost „ordered by descending opened date"; przy `/chat` nie mówi nic.
Dopóki tego nie wiemy, nie wiadomo, czy pierwsza strona to najstarsze sto
wiadomości, czy najnowsze — a to rozstrzyga, co widzi agent przy rozmowie
uciętej bezpiecznikiem. Stronicowanie czyni pytanie bezprzedmiotowym dla
kompletu danych, ale nie dla tego jednego przypadku.

`[WERYFIKUJ]` Do której przestrzeni należy `PostPurchaseIssue.offer.id`. Przykład
w specyfikacji pokazuje UUID (`54b50cb5-2dd3-4ce0-9c41-57ac5981d2ab`), a sonda
z żywego konta zapisała zwykły tekst przy sześćdziesięciu pięciu sprawach.
Typem jest `string`, więc rozstrzyga to dopiero pierwsze trafienie w
`offer_snapshot` — to jest ta sama otwarta sprawa dwóch przestrzeni
identyfikatora oferty, co przy pozycji zwrotu.

### `GET /sale/issues/{issueId}` — odświeżenie jednej sprawy (0.273.0)

Czwarta końcówka rodziny i do 0.272.0 jedyna nieużywana wcale. Oddaje ten sam
kształt `PostPurchaseIssue`, co wiersz listy, więc zapisuje ją ta sama funkcja —
jedna droga zapisu, nie dwie.

Powód istnienia jest po stronie człowieka, nie danych: bez niej świeży stan
sprawy dawał wyłącznie PEŁNY przebieg listy, czyli takt trzech minut. Agent,
który właśnie wysłał odpowiedź albo werdykt, patrzy na ekran teraz — i najbardziej
wtedy, gdy wysyłka skończyła się niejednoznacznie, bo pasek odsyłał go wtedy do
Centrum Sprzedaży po coś, co jedno żądanie rozstrzyga.

Rozmowa dociąga się przy okazji i tylko wtedy, gdy licznik Allegro rozjechał się
z naszym — odświeżenie ma kosztować jedno żądanie, gdy nic nowego nie przyszło.

### Załączniki WYCHODZĄCE: `POST /sale/issues/attachments` + `PUT` (0.274.0)

Decyzja właściciela z 7 września brzmiała „sam tekst" i trzymała się cztery dni;
11 września ją odwrócił. Droga jest dwukrokowa jak w Centrum Wiadomości:
deklaracja oddaje numer, `PUT` niesie bajty, a `MessageRequest.attachments`
wymienia numery przy wiadomości (`PostPurchaseIssueAttachmentId`, czyli `{ id }`).

**TO INNY KSZTAŁT NIŻ PRZY CENTRUM WIADOMOŚCI, choć robi to samo.** Deklaracja
sprawy używa schematu `AttachmentDeclaration` z polem **`fileName`**, a
`/messaging/message-attachments` — schematu `NewAttachmentDeclaration` z polem
**`filename`**. Różnica jednej litery przy polu obowiązkowym w obu.

To jest dokładnie ta pułapka, przed którą ostrzega `CLAUDE.md`: `public.v1`
i `beta.v1` bywają RÓŻNYMI kształtami, nie wariantami jednego. Kształt czyta się
z pliku, nie z pamięci o sąsiedniej końcówce — a sąsiednia końcówka stała
gotowa i kusiła.

Druga różnica: schemat spraw **nie podaje maksymalnego rozmiaru** (messaging
podaje 5 MiB), więc granicą jest wyłącznie nasza — cztery megabajty, bo plik
jedzie do nas base64 w JSON i rośnie o jedną trzecią.

**Adres wgrania bierze się z nagłówka `Location`.** Specyfikacja mówi to wprost:
„The URL is unique and one-time. As its format may change in time, you should
always use the address from the header. Do not compose the address on your own".
Adres składany z identyfikatora zostaje jako droga awaryjna i zostawia ślad
w dzienniku — bez niej brak jednej linijki w odpowiedzi zabijałby całą funkcję,
a z nią wiadomo, że Allegro przestało nagłówek przysyłać.

Typy plików są te same, co przy Centrum Wiadomości: PNG, GIF, BMP, TIFF, JPEG
i PDF. Innych `requestBody` wgrania NIE wymienia.

### Załącznik: typ rozstrzygają BAJTY

`PostPurchaseIssueAttachment` ma DWA pola: `fileName` i `url`. Nie ma ani typu
MIME, ani stanu `SAFE`/`UNSAFE`, na którym stoi podgląd zdjęć w skrzynce
(0.218.0). Do 0.222.0 wyciągaliśmy z tego wniosek, że zdjęcia nie da się
pokazać na osi — i ten wniosek był zbyt szeroki.

Bramka ze skrzynki pilnowała JEDNEJ rzeczy: żeby na osi rysowały się wyłącznie
typy, które przeglądarka narysuje, i nic innego. Tego da się dopilnować bez
pola, po SYGNATURZE pliku — bajty i tak przechodzą przez nasz serwer. Od
0.223.0 robi to `rozpoznajMime` (ta sama funkcja, co przy zdjęciach z Subiekta)
przecięte z `TYPY_PODGLADU`.

Przechodzą TRZY typy, i to jest przecięcie dwóch list. Allegro przyjmuje przy
tym zasobie `image/png`, `image/gif`, `image/bmp`, `image/tiff`, `image/jpeg`
i `application/pdf` (`PUT /sale/issues/attachments/{attachmentId}`); skrzynka
rysuje cztery typy rastrowe. Wspólne są JPEG, PNG i GIF — `webp` po stronie
Allegro nie istnieje, a `bmp` i `tiff` przeglądarki rysują nierówno albo wcale.
Reszta zostaje przy pobieraniu i to jest odpowiedź, nie awaria.

Nazwa pliku niczego nie rozstrzyga: decyduje o UKŁADZIE po stronie panelu
(pole `podglad`), a plik nazwany `usterka.jpg`, który sygnatury obrazu nie ma,
dostaje 415 i spada z powrotem na przycisk pobrania.

Pobranie ma tu za to WŁASNĄ końcówkę w specyfikacji
(`GET /sale/issues/attachments/{attachmentId}`), czego brakuje przy
załącznikach Centrum Wiadomości — tamte dostały w 0.244.0 kandydatów
i znacznik (sekcja „Pobranie załącznika Centrum Wiadomości"). Adres i tak
czytamy z bazy, a host sprawdza `pobierzZalacznik` — dwie niezależne zapory,
bo obie kosztują jedną linijkę.

### `POST /sale/issues/{issueId}/message` — odpowiedź w sprawie (0.224.0)

Pierwszy zapis tego modułu. Ciało to `MessageRequest`: `text` (**maxLength
20 000** — dziesięć razy więcej niż 2000 w Centrum Wiadomości), `attachments`
i `type`. Wysyłamy `{ text, type: "REGULAR" }` i nic więcej.

Lista `required: [text, attachment, type]` w tym schemacie jest FIKCJĄ:
właściwości `attachment` w nim nie ma, a lista przeczy własnemu opisowi obok.
Wiążący jest opis końcówki — „At least one of fields: 'text', 'attachment'".
To trzeci raz, gdy przykład albo lista `required` u Allegro kłóci się z resztą
schematu, i trzeci raz wygrywa schemat czytany w całości.

`[WERYFIKUJ]` `END_REQUEST` jest ŻĄDANIEM, nie zakończeniem. Panel wysyła tę
wartość od 0.245.0 jako „poproś o zakończenie dyskusji". Nazwa mówi `request`,
a specyfikacja nie łączy jej ani jednym zdaniem ze statusem `DISPUTE_CLOSED`;
że dyskusja od niej się zamyka, byłoby wnioskiem z nazwy, nie z kontraktu.
Sonda tej operacji nigdy nie wykonała — znacznik schodzi po pierwszym udanym
zakończeniu na żywym koncie. Do tego czasu panel mówi „poproszono", a stan
sprawy czyta wyłącznie z `currentState.status` po synchronizacji.

Enum `type` niesie też `END_REQUEST` (wyłącznie dyskusje) i trzy `RETURN_*`
(wyłącznie reklamacje). Te trzy są JEDYNĄ drogą do `currentState.returnRequired`
— osiem trafień w całej specyfikacji i ani jednej innej końcówki. Ale
specyfikacja nie łączy tych miejsc ani jednym zdaniem: to wniosek z nazw,
a wysłanie takiego typu jest formalnym stanowiskiem sprzedawcy. Od przyrostu
trzeciego panel wysyła dwa z nich po uznaniu (`RETURN_REQUIRED_CUSTOM`,
`RETURN_NOT_REQUIRED`) jako krok „towar do odesłania?" — tą samą końcówką,
z `typ` zapisanym na próbie w `reklamacja_outbox`. `RETURN_REQUIRED_SELLER_LABEL`
(etykieta od sprzedawcy) zostaje poza panelem.

`[WERYFIKUJ]` czy `RETURN_REQUIRED_CUSTOM` / `RETURN_NOT_REQUIRED` naprawdę
przestawiają `currentState.returnRequired`. Panel zapisuje decyzję lokalnie
(`zwrot_towaru`) i traktuje `returnRequired` po synchronizacji jako
POTWIERDZENIE, nie założenie; sygnał „towar?" gaśnie po naszej decyzji, a nie
po wartości z Allegro. Pierwsze uznanie na żywej sprawie rozstrzyga.

**`409` przy tej końcówce NIE jest konfliktem wersji.** Opis brzmi `Dispute is
in a state that forbids adding new messages` — to odpowiednik
`currentState.chatActive: false`. Panel sprawdza tę flagę PRZED strzałem, żeby
agent zobaczył zdanie zamiast surowego kodu.

`[WERYFIKUJ]` czy `409` z tej końcówki naprawdę odpowiada `chatActive: false`.
Powiązanie jest wnioskiem z opisu, nie zdaniem specyfikacji. Gdyby kod niósł
też coś innego, bramka sprawdzana przed strzałem byłaby za wąska, a agent
dostałby zdanie o zamkniętej rozmowie przy sprawie, która wcale zamknięta
nie jest.

`[WERYFIKUJ]` czy odpowiedź `201` ZAWSZE niesie `id` wiadomości. Schemat
`Message` nie ma listy `required`, więc formalnie każde pole jest opcjonalne.
Sukces bez `id` traktujemy dziś jak wynik niejednoznaczny i nie dopisujemy
wiersza na osi rozmowy — `reklamacja_wiadomosc` ma
`UNIQUE(reklamacja_id, external_id)`, więc wiersz bez identyfikatora nie miałby
jak być idempotentny.

### Werdykt: `POST /sale/issues/{issueId}/status` (przyrost trzeci, 0.242.0)

`changeStatusOfIssueUsingPOST`, wyłącznie `application/vnd.allegro.beta.v1+json`,
uprawnienie `allegro:api:disputes` — to samo, co odczyt spraw, więc nowego
parowania nie ma. Ciało `ClaimStatusChangeRequest`: `required: [status, message]`;
`status` z enumu jedenastu wartości (cztery `ACCEPTED_*`, siedem `REJECTED_*`),
`partialRefund` to `Price` (`amount` jako TEKST „40.00", `currency`) i jedzie
wyłącznie przy `ACCEPTED_PARTIAL_REFUND` — ciało układa `cialoWerdyktu()`
w adapterze, a test sprawdza je bez sieci. Odpowiedzi: `200` „Status changed
correctly" BEZ ciała, `400`, `401`, `403`, `404`. Sukcesem jest brak wyjątku,
nie kształt odpowiedzi; `404` jest przy tym zapisie błędem (`blad404`), bo
pusta `200` też oddaje `null` i bez tej opcji „sprawa nie istnieje" wyglądałoby
jak „werdykt przyjęty". Kolumna `werdykt` ma `CHECK` z pełnym enumem od razu.

`[WERYFIKUJ]` `message` nie ma w schemacie `maxLength` — inaczej niż
`MessageRequest.text` (20 000). Panel przyjmuje limit czatu jako własny, żeby
agent nie uczył się dwóch liczb; gdyby Allegro cięło krócej, odmowa wróci
jako `400` i `werdykt_status='send_failed'` ze zdaniem, a nie jako cisza.

### Co się stanie, jeśli kształt jest inny

`tablica()` rzuca zdaniem wskazującym ten plik, a przebieg kończy się porażką
z kodem HTTP w `allegro_reklamacje_sync_state`. Panel pokazuje wtedy status
z §21, a nie pustą kolejkę udającą brak reklamacji. Status Allegro spoza
`PostPurchaseIssueStatus` NIE jest błędem: sprawa wchodzi do kolejki
z sygnałem „status?", żeby właściciel potwierdził wartość na żywym koncie.

## Zamówienie klienta — kształt ze specyfikacji w repo

Ta sekcja różni się od poprzednich pochodzeniem po raz drugi, tym razem na
lepsze. Od 0.151.0 cała specyfikacja Allegro leży w repo
(`docs/allegro/swagger.yaml`), więc pola niżej odczytano ze SCHEMATU, nie
z pamięci ani z kopii sprzed dwóch lat. Znaczników tu nie ma.

### `GET /order/checkout-forms/{id}`

Schemat `CheckoutForm`. Bierzemy `id`, `status`, `updatedAt`,
`summary.totalToPay`, `delivery.cost`, `delivery.method.name` oraz
`lineItems[]`.

Pozycja (`CheckoutFormLineItem`) ma `id`, `offer`, `quantity`, `price`
i `boughtAt`. Data zakupu stoi przy POZYCJI, nie przy zamówieniu — bierzemy
najwcześniejszą, bo zamówienie scalone z kilku zakupów miałoby inaczej datę
przypadkową.

Oferta (`OfferReference`) ma `id`, `name` i **`external`**. To ostatnie pole
jest powodem, dla którego w ogóle pobieramy zamówienia.

### `external.id` — mostek do kartoteki

Schemat `ExternalId` opisuje je jako „The ID of the offer in the external
system": identyfikator, który sprzedawca sam wpisał przy ofercie. U tej firmy
to symbol z Subiekta.

**Pole jest OPCJONALNE w schemacie** — `OfferReference` wymaga tylko `id`
i `name` — więc do 0.164.0 cały mostek do kartoteki stał na nieznanym
pokryciu. Obserwacja z 2 września odpowiada: `lineItems[].offer.external.id`
było niepuste w **165 na 165** pozycji. Grunt jest pewny, ale nie z definicji:
to liczba z jednego dnia i jednego konta, a kod ma dalej znosić brak SKU
(„oferta bez SKU" jest jednym z sześciu powodów w łańcuchu kartotek).

Bez tego mostka pozycja zwrotu nie ma zdjęcia, bo `zdjecie_cache`
i `zdjecie_wlasne` są kluczowane po `tw_id`. Projekt panelu §28 nazywał to
„czeka na dostęp do dokumentacji Allegro" — dokumentacja przyszła.

Dopasowanie jest PROPOZYCJĄ, nie faktem: `services/dopasowanie-sku.ts`
porównuje SKU z `sgt_towar.symbol`, a zapisuje dopiero potwierdzenie
człowieka. Zero i wiele trafień daje brak, nigdy zgadywanie.

### Dwie przestrzenie identyfikatorów oferty — pytanie otwarte

`CustomerReturnItem.offerId` i `OfferReference.id` to być może NIE to samo.
Przykład pierwszego jest UUID-em (`3e895572-…`), a drugiego — numerem
(`3213213`). W tym samym schemacie `url` kończy się numerem oferty; gdyby
`offerId` nim był, przykład adresu kończyłby się na tej samej wartości.
UUID-owy kształt pokrywa się za to z `CheckoutFormLineItem.id`, czyli
z przestrzenią POZYCJI zamówienia.

To są jednak PRZYKŁADY, a `docs/allegro/README.md` ostrzega, że bywają
niezgodne ze schematem. Oba pola mają `type: string` bez `format`, więc plik
tego nie rozstrzyga. Sonda też nie: `services/ksztalt.ts` pokazuje wartości
wyłącznie dla pól słownikowych, a identyfikator oferty nim nie jest.

`[WERYFIKUJ]` Do której przestrzeni należy `CustomerReturnItem.offerId`.
Zamiast zgadywać, `dopasowanie-sku.ts` łączy pozycję zwrotu z pozycją
zamówienia po `offer_id` **albo** po `external_id` i zapisuje w polu
`poKolumnie`, która z nich trafiła. Odpowiedź przyjedzie z produkcji.
Wcześniejsze złączenie po samym `offer_id` nie trafiało nigdy — cicho
i w stu procentach — jeśli rozjazd jest faktem.

### Pamięć wskazań — `oferta_kartoteka`

Potwierdzenie kartoteki zapisuje parę `offer_id → tw_id` w tabeli
`oferta_kartoteka`. Następny zwrot tej samej oferty dostaje propozycję
z tej pamięci, z pominięciem całego łańcucha wyżej.

Tabela stoi na wzorcu `ean_alias`: `tw_id` jest zwykłym `INTEGER`, **bez**
klucza obcego do `sgt_towar`. Import z Subiekta kasuje cały read-model
i wstawia go od nowa; klucz obcy zerowałby przy tym pracę człowieka co minutę.
Zdjęcie powiązania kasuje też wpis z pamięci — inaczej następny odczyt
zaproponowałby je z powrotem.

### Jedno wywołanie na zamówienie, nie na ofertę

`GET /sale/product-offers/{offerId}` dałoby ten sam SKU po jednym strzale na
pozycję i nie dałby ani kosztu dostawy, ani pozycji, których klient nie
zwraca. `/sale/product-offers/{offerId}/parts` NIE jest tańszym zamiennikiem:
schemat dopuszcza w `include` wyłącznie `stock` i `price`.

### Numer, którego Allegro nie zna

404 na `GET /order/checkout-forms/{id}` jest ODPOWIEDZIĄ, a nie awarią.
Numer prowadzi tu ze zwrotu albo z wiadomości i bywa numerem zamówienia
sprzed lat, skasowanego albo z innego środowiska.

Do 0.249.0 nie było tego gdzie zapisać. Adapter oddawał przy 404 `null`,
`zamowienie_klienta` nie dostawało wiersza, a warunek „nie mamy tego
zamówienia" był prawdą na zawsze — ten sam zbiór najwyżej dwudziestu numerów
wracał w każdym przebiegu tickera. Portal deweloperski pokazał 432 takie
wywołania w krótkim czasie.

Od 0.249.1 `server/src/services/allegro-zamowienia-sync.ts` woła tę końcówkę
z `blad404`, a odmowę zapisuje w `zamowienie_klienta_brak`. Numer wraca do
kolejki po tygodniu, na jedną próbę; każda kolejna odmowa wydłuża odstęp do
czternastu, dwudziestu jeden i dwudziestu ośmiu dni.

Timeout i 5xx nie tworzą takiego wpisu i to jest różnica, o którą tu chodzi.
Allegro mówi wtedy „nie wiadomo", a nie „nie ma", a zapamiętany brak
zabrałby zamówienie na tydzień z powodu jednej minuty bez internetu.
Ręczne „dociągnij zamówienia" w panelu pyta o wszystko, także o zapamiętane
braki — inaczej przycisk do diagnozy przez tydzień milczałby.

### Czego z zamówienia NIE bierzemy

`CheckoutForm.buyer` niesie `email`, `firstName`, `lastName`, `companyName`,
`personalIdentity`, `phoneNumber` i `address`, a `CheckoutFormDeliveryReference`
— adres dostawy z imieniem i nazwiskiem. `CLAUDE.md` mówi twardo: adresy
dostawy nie przechodzą przez mapowanie.

Zostaje `buyer.login` i `buyer.id` — polityka danych skrzynki dopuszcza login
rozmówcy wprost, a bez niego nie da się powiązać zamówienia z rozmową.

### Lądowiska są OKROJONE — i to jest zmiana z 0.152.0

Do 0.151.0 `allegro_zwrot.surowe_json` trzymało odpowiedź dosłownie, razem
z numerem konta bankowego kupującego i telefonem nadawcy paczki. Polityka
danych mówiła tymczasem „nie pobieramy" i to zdanie było nieprawdziwe.

Od 0.152.0 oba lądowiska przechodzą przez `services/allegro-oczyszczanie.ts`:
**wartość znika, klucz zostaje**. Kształt nadal da się obejrzeć, a pełny
kontrakt czyta się ze specyfikacji w repo, nie z kopii cudzych danych.

Lista pól idzie po NAZWIE, nie po ścieżce — tak, żeby pole, które Allegro
doda w przyszłości pod tą samą nazwą, odpadło samo.

## `GET /sale/product-offers/{offerId}` — jedna oferta z całą treścią

Jedyna końcówka, która oddaje OPIS oferty. Schemat
`SaleProductOfferResponseV1` niesie trzy rzeczy, po które tu chodzimy.

`description.sections[].items[]` to opis pokrojony na kawałki. Pozycja ma
`type`: `TEXT` niesie `content` z HTML-em, `IMAGE` niesie `url`. Sekcja ma
sufit 40 000 bajtów, a sekcji bywa kilka.

`parameters[].{name, values}` to parametry techniczne wprost z formularza
sprzedawcy — wymiar stojący tu jest wart więcej niż ten sam wymiar wypatrzony
w prozie opisu.

`compatibilityList.items[].text` to lista „pasuje do" w formie pozycji, nie
zdania, na przykład `CITROËN C6 (TD_) 2005/09-2011/12 2.7 HDi 204KM/150kW`.
Lista ma dwie odmiany, `MANUAL` i `PRODUCT_BASED`, i OBIE oddają `text`.
Pozycja typu `ID` niesie sam identyfikator, więc dla człowieka nie znaczy nic.

**Ta końcówka kosztuje jedno żądanie NA OFERTĘ.** `GET /sale/offers` obok
przyjmuje dwadzieścia numerów naraz, ale opisu nie oddaje.
`/sale/product-offers/{offerId}/parts` nie jest tańszym zamiennikiem: schemat
dopuszcza w `include` wyłącznie `stock` i `price`. Dlatego po treść chodzimy
leniwie i tylko dla oferty, o którą pyta klient w otwartej rozmowie.

Uprawnienie: `allegro:api:sale:offers:read`, to samo co przy liście ofert.

## `GET /sale/offers` — oferty sprzedawcy po numerach

Końcówka oddaje `offers`, `count` i `totalCount` (schemat
`OffersSearchResultDto`). Oferta ma `id`, `name`, `sellingMode.price`
z `amount` i `currency`, `external.id` oraz `publication.status`
(schemat `OfferListingDto`).

Parametr **`offer.id` jest TABLICĄ**, więc dwadzieścia numerów kosztuje jedno
żądanie. `limit` ma domyślną wartość 20 i maksimum 1000; ustawiamy go na
długość partii, bo cicha domyślna dwudziestka obcięłaby większą partię
w połowie.

`external.id` to SKU sprzedawcy — u tej firmy symbol z Subiekta. To ten sam
identyfikator, co `lineItems[].offer.external.id` w zamówieniu, i tak samo jest
mostkiem do kartoteki. Różnica jest w momencie: zamówienie mamy po zakupie,
a ofertę już przy pytaniu.

Uprawnienie to `allegro:api:sale:offers:read`, inne niż przy skrzynce.
Konto bez niego dostanie 403, a odmowa nazwie brakujący scope po imieniu —
`scopeDlaUrl` w `adapters/allegro.http.ts` ma dla tego adresu własną gałąź.

**Zdjęcie z `primaryImage` bierzemy od 0.213.0.** Schemat `OfferListingDtoImage`
opisuje je wprost: „The image used as a thumbnail on the listings", czyli to,
co kupujący widzi na liście ofert. Pole jedzie w TEJ SAMEJ odpowiedzi, więc nie
kosztuje żądania, uprawnienia ani limitu; do 0.210.0 po prostu wypadało przy
mapowaniu.

Decyzja z 0.178.0 brzmiała „nie pobieramy, bo obrazek z serwera Allegro to
wyjście przeglądarki biura poza własną sieć". To jest zakaz HOTLINKA i on
obowiązuje dalej — panel nie dostaje adresu w `allegroimg.com` i nie ma go po
co dostawać. Po plik idzie SERWER, który i tak rozmawia z Allegro, i podaje go
z własnej trasy `/api/obsluga/oferta/:externalId/zdjecie`. Ta sama droga, którą
od 0.30.0 idą zdjęcia kartotek.

Kopia ma trzy uzasadnienia poza prywatnością: zachowuje obraz, który klient
NAPRAWDĘ widział (sprzedawca podmienia zdjęcie, a rozmowa sprzed tygodnia ma
zostać czytelna — §15.2), pozwala pracować na stanowisku bez wyjścia na świat
i daje jedno pobranie na ofertę dla wszystkich agentów.

`OfferListingDto` nie ma bloku `required`, więc `primaryImage` bywa puste —
`NULL` w kolumnie znaczy „Allegro nie podało adresu", nie „oferta nie ma
zdjęcia".

**Wariant rozmiarowy adresu jest konwencją, nie specyfikacją.** Schemat
dokumentuje wyłącznie adres w rozmiarze ORYGINALNYM. Podmiana segmentu
(`/original/` → `/s320/`) daje miniaturę i tak robią to strony Allegro, ale
w `swagger.yaml` tego nie ma. Serwer traktuje ją więc jako PRÓBĘ i w tym samym
przebiegu wraca do oryginału, gdy CDN nie odda obrazu. Tym różni się to od
mapowania z pamięci: tam pomyłka jest cicha, tu ma jawną drogę wyjścia.

## Odnośniki do panelu sprzedawcy

Adres oferty przy pozycji zwrotu (`CustomerReturnItem.url`, przykład
`https://allegro.pl/oferta/item-name-7678887152`) jest udokumentowany i idzie
na ekran wprost.

Adresy PANELU SPRZEDAWCY to strony UI, więc nie opisuje ich ani ta
specyfikacja, ani żadna inna.

**Zwrot — adres ZWERYFIKOWANY (0.207.0).** Właściciel podał działający:
lista zwrotów Centrum Sprzedaży z numerem w wyszukiwaniu,
`https://salescenter.allegro.com/returns?page=1&limit=25&from={od}&search={id}`.
Dawny `moje-allegro/sprzedaz/zwroty/{id}` był zgadnięty i zwrot nie ma pod nim
własnej strony.

`{od}` to dolna granica zakresu dat listy i bierze się z DNIA ZGŁOSZENIA tego
zwrotu. Stała granica — na przykład sprzed trzech miesięcy — wycięłaby starszy
zwrot i wyszukanie po poprawnym numerze oddałoby pustą listę.

`[WERYFIKUJ]` Zamówienie otwiera się pod
`https://allegro.pl/moje-allegro/sprzedaz/zamowienia/{id}`, a oferta z rozmowy
pod `https://allegro.pl/oferta/{id}`, czyli na stronie PUBLICZNEJ: agent chce
zobaczyć to, co widzi klient, a nie formularz edycji. Oba wzorce stoją
w konfiguracji (`ALLEGRO_PANEL_ZAMOWIENIE`, `ALLEGRO_PANEL_OFERTA`), bo link
trafiający w 404 kosztuje kliknięcie i zaufanie do ekranu — a poprawka ma być
wpisem w `wertis.env`, nie nowym wydaniem. Udokumentowany przykład
`CustomerReturnItem.url` niesie w adresie także slug tytułu; czy sam numer
wystarczy, sprawdza się kliknięciem.

**Reklamacja — adres ZWERYFIKOWANY (0.226.1).** Wzorzec z 0.222.0 zbudowano
z ANALOGII do zwrotu: lista Centrum Sprzedaży z numerem sprawy w wyszukiwaniu.
Właściciel kliknął i dostał „Ups, nic tu nie ma". Domysł mylił się w OBU
członach naraz — sprawa ma WŁASNĄ stronę, a adresuje się identyfikatorem
zasobu, nie numerem czytelnym:

`https://salescenter.allegro.com/claims/{id}?sellerId={sprzedawca}`

`{id}` to `PostPurchaseIssue.id`, czyli UUID. Numer `2585498/2026` widzi
kupujący i widzi go agent, ale w adresie jest bezużyteczny.

`{sprzedawca}` to identyfikator konta sprzedawcy i nie mamy go skąd wziąć
sami: `channel_account.external_account_id` trzyma clientId OAuth, a `GET /me`
wymaga uprawnienia `allegro:api:profile:read`, którego konto nie ma. Stoi więc
w `ALLEGRO_SELLER_ID` z domyślną wartością WERTIS — decyzja właściciela, żeby
odnośnik działał bez wpisu przy wdrożeniu. Doklejany jest w kodzie, a nie we
wzorcu: przy pustej wartości w adresie zawisłby goły `?sellerId=`, o którym nic
nie wiemy.

Lekcja jest ta sama, co przy zwrocie w 0.207.0 i kosztowała drugi raz tyle
samo: adres panelu zgadnięty z analogii do innego adresu panelu trafia w 404,
a znacznik przy nim wisi dopóty, dopóki ktoś go nie kliknie.

Hosta Centrum Sprzedaży dla SANDBOKSU nie znamy, więc `ALLEGRO_SANDBOX=1`
zostaje przy dawnym wzorcu. Zgadywanie go drugi raz kosztowałoby to samo, co
pierwszy.
