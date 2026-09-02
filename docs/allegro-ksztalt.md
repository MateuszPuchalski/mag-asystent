# Kształt Centrum wiadomości Allegro

Kontrakt mapowania skrzynki. **Pochodzi ze specyfikacji OpenAPI Allegro**,
a od 0.163.0 stoi obok niego obserwacja z żywego konta:
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
sonda nie tknie, bo jest z założenia GET-em. Do 0.163.0 stało tu twardsze
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

### Czego nie mapujemy i dlaczego

`attachments[]` niesie `fileName`, `mimeType`, `url` i `status`; obok stoi
`hasAdditionalAttachments`. Załączników ani nie pobieramy, ani nie wysyłamy,
więc kolumn na nie nie ma. `type` (`MESSAGE_CENTER`) rozróżnia kanały, których
mamy jeden. `additionalInformation` niesie dane właściwe branży (w przykładzie
`vin`) i nie ma u nas ekranu.

`relatesTo.order.id` czeka na ekran zamówienia. Numer oferty wystarcza, żeby
powiedzieć, o jaki towar pyta klient, a to jest pytanie, na które skrzynka ma
odpowiadać dziś.

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
`rejection`, `marketplaceId` oraz — dopisane w 0.163.0 — `status`, `buyer`
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

`buyer` niesie `login` ORAZ `email` — patrz „Czego NIE mapujemy".
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
Do 0.163.0 stała tu lista czterech, przepisana z ogłoszenia zamiast ze
schematu.

Filtry listy: `customerReturnId`, `orderId`, `items.offerId`, `items.name`,
`parcels.waybill`, `parcels.carrierId`, `parcels.senderPhoneNumber`,
`referenceNumber`, `from`, `createdAt.gte`, `createdAt.lte`, `marketplaceId`,
`limit` (domyślnie 100) i `offset`.

Parametr `from` jest KURSOREM: dokumentacja opisuje go jako identyfikator
ostatnio widzianego zwrotu, a odpowiedź niesie zwroty utworzone po nim.
Synchronizator idzie kursorem, bo offset gubi rekord przy wstawce w środku
strony — i to jest blizna 0.127.0 zdjęta u źródła.

### `GET /order/customer-returns/{id}`

Szczegół zwrotu ma TEN SAM kształt co element listy — obie ścieżki oddają
`CustomerReturn`. Sekcji tu nie było do 0.163.0, choć sonda mierzy szczegół od
0.154.0; obserwacja z 2 września potwierdza zgodność pole po polu na dziesięciu
zwrotach.

Synchronizator dlatego czyta LISTĘ i po szczegół nie sięga: dokłada jedno
wywołanie na zwrot, a nie dokłada ani jednego pola. Wyjątek jest jeden —
`parcels[].waybill` bywa `null` na liście (88 z 94), a w szczególe było
niepuste w dziesięciu na dziesięć. Numeru listu i tak nie zapisujemy, więc
różnica nie zmienia dziś niczego; gdyby kiedyś zaczęła, to jest miejsce,
w którym szczegół daje więcej.

### Czego NIE mapujemy i dlaczego

Trzy rzeczy z tej odpowiedzi nie mają u nas kolumny.

`refund.bankAccount` niesie `owner`, `accountNumber`, `iban`, `swift`
i `address`. `parcels[].sender.phoneNumber` niesie telefon nadawcy.
`buyer.email` niesie adres e-mail kupującego — dopisany do tej listy
w 0.163.0, bo `buyer` wszedł wtedy do kontraktu i bez tego zdania wyglądałby
na pole do wzięcia w całości. W obserwacji z 2 września `buyer.email` było
puste w stu rekordach na sto, ale schemat je przewiduje i to schemat
rozstrzyga, czego nie wolno zapisać.

Zwrot da się rozstrzygnąć bez nich, a raz pobrane dane osobowe zostają
w kopii zapasowej na lata. Kolumn na nie po prostu nie ma, więc nieuważne
mapowanie wywali się na SQL-u, zamiast wyciec po cichu. Pilnuje tego
`server/src/db/migracja-zwrotow.test.ts`.

Zostaje sam FAKT powrotu paczki — `paczka_at` z najwcześniejszego
`parcels[].createdAt`. To wystarcza, żeby powiedzieć „towar wrócił".

### Pola młodsze od kopii specyfikacji

Znacznik przy `status` zwrotu ZDJĘTY w 0.163.0. Twierdził, że „kopia
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
złożonym z panelu, nie wcześniej. Do 0.163.0 stało tu, że kształt jest
„najsłabiej udokumentowany z całej trójki" — nieprawda, bo schemat leży
w repo; nieznana jest wyłącznie odpowiedź konta.

### Rabat transakcyjny — `/order/refund-claims`

Zwrot prowizji od sprzedaży, po polsku „rabat transakcyjny". Do 0.163.0 firma
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
i `name` — więc do 0.163.0 cały mostek do kartoteki stał na nieznanym
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

## Odnośniki do panelu sprzedawcy

Adres oferty przy pozycji zwrotu (`CustomerReturnItem.url`, przykład
`https://allegro.pl/oferta/item-name-7678887152`) jest udokumentowany i idzie
na ekran wprost.

Adresy PANELU SPRZEDAWCY to strony UI, więc nie opisuje ich ani ta
specyfikacja, ani żadna inna.

`[WERYFIKUJ]` Zwrot otwiera się pod
`https://allegro.pl/moje-allegro/sprzedaz/zwroty/{id}`, a zamówienie pod
`https://allegro.pl/moje-allegro/sprzedaz/zamowienia/{id}`. Oba wzorce stoją
w konfiguracji (`ALLEGRO_PANEL_ZWROT`, `ALLEGRO_PANEL_ZAMOWIENIE`), bo link
trafiający w 404 kosztuje kliknięcie i zaufanie do ekranu — a poprawka ma być
wpisem w `wertis.env`, nie nowym wydaniem.
