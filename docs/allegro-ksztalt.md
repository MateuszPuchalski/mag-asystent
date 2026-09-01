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
