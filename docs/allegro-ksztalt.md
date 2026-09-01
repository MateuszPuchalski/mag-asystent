# Kształt Centrum wiadomości Allegro

Raport zanonimizowanej odpowiedzi produkcyjnej. Jest jedynym kontraktem
mapowania inboxu; nie należy uzupełniać pól na podstawie kodu sprzed 0.140.0.

## `GET /messaging/threads`

Obiekt ma tablicę `threads` i liczbę `totalCount`. Wątek ma pola `id`, `read`,
`lastMessageDate` oraz `interlocutor.login`. Lista jest od najnowszej zmiany.
Endpoint przyjmuje `limit` (maks. 20) i `offset`.

## `GET /messaging/threads/{id}/messages`

Obiekt ma tablicę `messages`. Wiadomość ma `id`, `author.login`, `author.role`,
`text`, `relatedObject` (obiekt `{ type, id }` albo `null`), `attachments`
(tablica) i `read`. Zaobserwowane role to `BUYER` i `SELLER`, a typ powiązania
to `OFFER`. Nieobserwowanych pól synchronizator nie mapuje.

## Wysyłka — kształt NIEPOTWIERDZONY

Ta sekcja **nie jest raportem z produkcji**. Powstała z pamięci, bo
`developer.allegro.pl` jest niedostępny ze środowiska, w którym pisano kod,
a właściciel polecił mimo to zbudować wysyłkę. Reszta dokumentu opisuje
kształty zaobserwowane; ta sekcja opisuje założenia.

Nie należy jej cytować jako kontraktu, dopóki znaczniki nie znikną.

### `POST /messaging/threads/{id}/messages`

Adres jest ten sam co przy odczycie i pochodzi z działającego kodu
(`urlWiadomosci` w `server/src/adapters/allegro.http.ts`). Nagłówki, negocjacja
wersji zasobu po 406 oraz obsługa 401, 403, 404 i 429 też są sprawdzone —
robi to `zapytajAllegro`, ta sama funkcja co przy pobieraniu.

`[WERYFIKUJ]` Ciało żądania zakładamy jako `{ "text": string }`. To założenie
nie jest nowe: `payloadAllegroWiadomosci` zwraca dokładnie taki obiekt od
0.144.0. Załączników nie wysyłamy, więc pola na nie nie zakładamy wcale.

`[WERYFIKUJ]` Odpowiedź zakładamy jako obiekt wiadomości z polem `id`. Tego
jesteśmy mniej pewni niż ciała. Brak `id` nie jest traktowany jak błąd
wysyłki: kolejka zapisuje wtedy stan `send_uncertain`, a rozstrzyga dopiero
synchronizacja wątku.

### Co się stanie, jeśli kształt jest inny

Allegro odpowie 400 albo 422. Kolejka `outbox` zapisze to jako `send_failed`
razem z treścią odpowiedzi serwera, a wiersz `message` nie powstanie. Pierwszy
prawdziwy strzał sam poda więc właściwy kształt, a do klienta nic nie wyjdzie
po cichu.

Poprawka obejmuje trzy miejsca: `server/src/services/allegro-wysylka.ts`,
test tego serwisu i tę sekcję.

## Zwroty klienckie — kształt z dokumentacji, nie z produkcji

Ta sekcja różni się od dwóch pierwszych POCHODZENIEM. Tamte są raportem
sondy z żywego konta. Ta powstała z oficjalnej specyfikacji OpenAPI Allegro
(`developer.allegro.pl/swagger.yaml`), odczytanej z publicznej kopii
wygenerowanego klienta z 26 lutego 2024 — sam portal jest niedostępny
z sieci, w której pisano ten kod.

To spełnia regułę §8.2 projektu panelu: mapowanie wynika z dokumentacji
Allegro. Nie zastępuje jednak sondy. Kopia ma dwa lata, a Allegro w tym
czasie dokładało pola — dlatego rzeczy młodsze od niej noszą znacznik.

`npm run sonda` zdejmuje dziś także zwroty i ich szczegół. Po pierwszym
przebiegu na żywym koncie znaczniki z tej sekcji schodzą, a liczba
w preambule `docs/subiekt-gt-struktura.md` maleje.

### `GET /order/customer-returns`

Zasób jest w becie, więc chodzi nagłówkiem `application/vnd.allegro.beta.v1+json`.
Negocjuje to `zapytajAllegro` i zapamiętuje wynik osobno dla tej rodziny.

Obiekt ma liczbę `count` i tablicę `customerReturns`. Zwrot ma pola `id`,
`createdAt`, `referenceNumber`, `orderId`, `items`, `refund`, `parcels`,
`rejection` oraz `marketplaceId`.

Pozycja (`items[]`) ma `offerId`, `quantity`, `name`, `price`, `url` oraz
`reason` z polami `type` i `userComment`. Zaobserwowane wartości `reason.type`:
`NONE`, `MISTAKE`, `TRANSPORT`, `DAMAGED`, `NOT_AS_DESCRIBED`, `DONT_LIKE_IT`,
`OVERDUE_DELIVERY`, `INCOMPLETE`, `HIDDEN_FLAW`, `OTHER_FLAW`, `DIFFERENT`.

Kwota (`price`) ma `amount` i `currency`. Specyfikacja mówi wprost, że
`amount` jest STRINGIEM, żeby uniknąć błędów zaokrąglenia. Dlatego
`naGrosze` liczy na tekście, a nie przez liczbę zmiennoprzecinkową.

Paczka (`parcels[]`) ma `createdAt`, `waybill`, `carrierId` oraz `sender`.
Odrzucenie (`rejection`) ma `code`, `reason` i `createdAt`.

Filtry listy: `customerReturnId`, `orderId`, `items.offerId`, `items.name`,
`parcels.waybill`, `parcels.carrierId`, `parcels.senderPhoneNumber`,
`referenceNumber`, `from`, `createdAt.gte`, `createdAt.lte`, `marketplaceId`,
`limit` (domyślnie 100) i `offset`.

Parametr `from` jest KURSOREM: dokumentacja opisuje go jako identyfikator
ostatnio widzianego zwrotu, a odpowiedź niesie zwroty utworzone po nim.
Synchronizator idzie kursorem, bo offset gubi rekord przy wstawce w środku
strony — i to jest blizna 0.127.0 zdjęta u źródła.

### Czego NIE mapujemy i dlaczego

Trzy rzeczy z tej odpowiedzi nie mają u nas kolumny.

`refund.bankAccount` niesie `owner`, `accountNumber`, `iban`, `swift`
i `address`. `parcels[].sender.phoneNumber` niesie telefon nadawcy.

Zwrot da się rozstrzygnąć bez nich, a raz pobrane dane osobowe zostają
w kopii zapasowej na lata. Kolumn na nie po prostu nie ma, więc nieuważne
mapowanie wywali się na SQL-u, zamiast wyciec po cichu. Pilnuje tego
`server/src/db/migracja-zwrotow.test.ts`.

Zostaje sam FAKT powrotu paczki — `paczka_at` z najwcześniejszego
`parcels[].createdAt`. To wystarcza, żeby powiedzieć „towar wrócił".

### Pola młodsze od kopii specyfikacji

`[WERYFIKUJ]` Pole `status` na zwrocie. Ogłoszenie Allegro „Zwroty klienckie
— dodaliśmy informacje o statusie zwrotu" opisuje wartości `COMMISSION_REFUNDED`
i `WAREHOUSE_DELIVERED`, ale kopia specyfikacji z 2024 roku go nie zawiera.
Synchronizator go nie czyta, a kubełek liczy z naszych własnych faktów, więc
brak tego pola niczego dziś nie psuje.

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

`[WERYFIKUJ]` `POST /order/refund-claims` tworzy roszczenie o zwrot prowizji.
Odczyt (`GET`) oddaje `id`, `status`, `quantity`, `commission`, `buyer`,
`createdAt`, `lineItem` i `type`. Kształt ŻĄDANIA jest tu najsłabiej
udokumentowany z całej trójki.

### Co się stanie, jeśli kształt jest inny

Przy odczycie: `tablica()` rzuca zdaniem wskazującym ten plik, a przebieg
kończy się porażką z kodem HTTP w `allegro_zwroty_sync_state`. Panel pokazuje
wtedy status z §21, a nie pustą kolejkę udającą brak zwrotów.

Przy zapisie (0.151.0): Allegro odpowie 400 albo 422, kolejka zapisze to jako
porażkę razem z treścią odpowiedzi, a do klienta nic nie wyjdzie po cichu.
