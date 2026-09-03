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

`attachments[]` niesie `fileName`, `mimeType`, `url` i `status`; obok stoi
`hasAdditionalAttachments`. Załączników ani nie pobieramy, ani nie wysyłamy,
więc kolumn na nie nie ma. `type` (`MESSAGE_CENTER`) rozróżnia kanały, których
mamy jeden. `additionalInformation` niesie dane właściwe branży (w przykładzie
`vin`) i nie ma u nas ekranu.

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
`parcels[].waybill` bywa `null` na liście (88 z 94), a w szczególe było
niepuste w dziesięciu na dziesięć. Numeru listu i tak nie zapisujemy, więc
różnica nie zmienia dziś niczego; gdyby kiedyś zaczęła, to jest miejsce,
w którym szczegół daje więcej.

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

**Poprzednia wersja tego akapitu odczytała sondę ODWROTNIE.** Twierdziła, że
`waybill` „jest pusty w 88 z 94 rekordów" — a kolumna nosi nagłówek `niepuste`.
Numer jest więc WYPEŁNIONY w 88 przypadkach na 94, czyli prawie zawsze, gdy
zwrot ma w ogóle paczkę. Ta pomyłka kazałaby uznać całą drogę za bezużyteczną.

**`status` NIE odpowiada na pytanie o doręczenie**, choć ma wartość `DELIVERED`
na liście. Sonda pokazuje, czym to pole naprawdę bywa: `COMMISSION_REFUNDED`
×95, `COMMISSION_REFUND_CLAIMED` ×3, `DELIVERED` ×2. Stan prowizji nadpisuje
stan przesyłki, więc po tym polu nie da się poznać, czy karton u nas jest.
Z tego samego powodu kolejka bramek nie routuje po nim od 0.164.0.

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
`rejection` z polem `code` i opcjonalnym `reason`. Dozwolone kody:
`REFUND_REJECTED` (wymaga `reason`), `NEW_ITEM_SENT`, `ITEM_FIXED`
i `MISSING_PART_SENT`. Nazwa końcówki mówi o odmowie ZWROTU PIENIĘDZY,
a nie o odrzuceniu samego zwrotu — panel ma to nazywać tak samo.

`[WERYFIKUJ]` `POST /payments/refunds` przyjmuje `payment.id`, `reason`
oraz opcjonalne `lineItems`, `delivery`, `overpaid`, `surcharges`,
`additionalServices` i `sellerComment`. Pozycja `lineItems[]` ma `id`, `type`
(`QUANTITY` albo `AMOUNT`), `quantity` i `value`. Wartości `reason` z kopii:
`REFUND`, `COMPLAINT`, `PRODUCT_NOT_AVAILABLE`, `PAID_VALUE_TOO_LOW`.

`[WERYFIKUJ]` Pola `commandId` i `order.id` w tym samym żądaniu. Ogłoszenie
Allegro mówi, że od 15 grudnia 2025 są WYMAGANE, a kopia specyfikacji ich nie
ma. `commandId` to identyfikator UUID zapewniający idempotencję — czyli
gotowe miejsce na klucz z kolejki `outbox`. Do sprawdzenia przed pierwszym
zwrotem pieniędzy.

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

Zdjęcia z `primaryImage` NIE POBIERAMY. To ta sama decyzja, co przy awatarze
rozmówcy: obrazek z serwera Allegro znaczyłby wyjście przeglądarki biura poza
własną sieć przy każdym otwarciu skrzynki.

## Odnośniki do panelu sprzedawcy

Adres oferty przy pozycji zwrotu (`CustomerReturnItem.url`, przykład
`https://allegro.pl/oferta/item-name-7678887152`) jest udokumentowany i idzie
na ekran wprost.

Adresy PANELU SPRZEDAWCY to strony UI, więc nie opisuje ich ani ta
specyfikacja, ani żadna inna.

`[WERYFIKUJ]` Zwrot otwiera się pod
`https://allegro.pl/moje-allegro/sprzedaz/zwroty/{id}`, a zamówienie pod
`https://allegro.pl/moje-allegro/sprzedaz/zamowienia/{id}`. Oferta z rozmowy
prowadzi pod `https://allegro.pl/oferta/{id}`, czyli na stronę PUBLICZNĄ:
agent chce zobaczyć to, co widzi klient, a nie formularz edycji. Wszystkie trzy
wzorce stoją w konfiguracji (`ALLEGRO_PANEL_ZWROT`, `ALLEGRO_PANEL_ZAMOWIENIE`,
`ALLEGRO_PANEL_OFERTA`), bo link trafiający w 404 kosztuje kliknięcie
i zaufanie do ekranu — a poprawka ma być wpisem w `wertis.env`, nie nowym
wydaniem. Udokumentowany przykład `CustomerReturnItem.url` niesie w adresie
także slug tytułu; czy sam numer wystarczy, sprawdza się kliknięciem.
