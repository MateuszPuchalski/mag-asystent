# Kształt Centrum wiadomości Allegro

Kontrakt mapowania skrzynki. **Pochodzi ze specyfikacji OpenAPI Allegro**
(`developer.allegro.pl/swagger.yaml`, odczyt 1 września 2026), nie z żywego
konta — `npm run sonda` na koncie firmy jeszcze nie biegła.

Do 0.151.0 ten plik przedstawiał się jako „raport zanonimizowanej odpowiedzi
produkcyjnej". Nie był nim: powstał w tym samym commicie co synchronizacja
i fixture'y (`2e9984a`), a opisane w nim pola nie istnieją w Allegro. Skutek —
skrzynka nie zapisała ani jednego wątku przez dwa wydania, bo każdy z nich
wywracał wstawkę na niezwiązanym parametrze.

To ta sama blizna trzeci raz. `adapters/allegro.http.ts` nosi o niej akapit:
kształt wymyślony w testach i nigdy niesprawdzony na żywym koncie. Za drugim
razem założenie nosiło znacznik do sprawdzenia i było uczciwe. Za trzecim nosiło
etykietę „raport z produkcji" — i dlatego nikt go nie sprawdził.

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
