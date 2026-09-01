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
