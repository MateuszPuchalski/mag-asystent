/* ── Głos Allegro w rozmowie ─────────────────────────────────────────────────
   W Problemie z zakupem (`POST_PURCHASE_ISSUE` z `beta.v1`) piszą trzy
   strony: kupujący, my i Allegro. Doradca ma rolę `CONSULTANT`, a wiadomość
   systemowa — `ALLEGRO`. Synchronizacja zapisuje je jako PRZYCHODZĄCE, bo
   nie są nasze, a rolę trzyma w `message.autor_rola`.

   Dwie reguły stoją tu raz, bo czyta je kilka plików naraz:

   1. Głos Allegro NIE JEST głosem klienta. Copilot rozpoznaje i szkicuje
      odpowiedź na słowa kupującego, a słowa doradcy widzi podpisane „ALLEGRO”.
   2. Głos Allegro w wątku, który Allegro ZAMKNĘŁO, nie jest ruchem
      w rozmowie. Inaczej zamykające zdanie doradcy stawiałoby rozmowę
      w „Czeka na nas”, choć odpowiedzi Allegro już nie przyjmie (422).
      Reguła właściciela z `wyliczStatus` zostaje: pytanie KLIENTA bez
      odpowiedzi dalej czeka, także w zamkniętym wątku.

   W otwartym wątku głos Allegro liczy się jak przychodzący: doradca pyta
   sprzedawcę o stanowisko i to na nas czeka odpowiedź.

   Moduł jest liściem bez importów, bo czytają go `conversations.ts`
   i `copilot-klasyfikacja.ts`, które importują siebie nawzajem. */

/** Role `author.role` z `beta.v1`, które nie są ani klientem, ani nami. */
export const ROLE_ALLEGRO: ReadonlySet<string> = new Set(["CONSULTANT", "ALLEGRO"]);

/** SQL: wiadomość napisana przez Allegro. `m` to alias tabeli `message`. */
export const glosAllegro = (m: string): string =>
  `COALESCE(${m}.autor_rola,'') IN ('CONSULTANT','ALLEGRO')`;

/**
 * SQL: głos Allegro w wątku, który Allegro zamknęło. Taka wiadomość nie jest
 * ruchem w rozmowie (reguła 2 wyżej). `m` to alias tabeli `message`.
 *
 * Zwykła wiadomość ma `autor_rola` NULL, więc pierwszy warunek odpada od razu
 * i złączenie z wątkiem nie liczy się wcale.
 */
export const glosAllegroPoZamknieciu = (m: string): string =>
  `(${glosAllegro(m)} AND EXISTS (SELECT 1 FROM conversation cz
      JOIN allegro_inbox_thread tz ON tz.id = cz.external_conversation_id
     WHERE cz.id = ${m}.conversation_id AND tz.watek_status = 'CLOSED'))`;

/**
 * SQL: rozmowa jest zamkniętym Problemem z zakupem. `c` to alias tabeli
 * `conversation`. Automat nie układa tu szkicu: Allegro odrzuci odpowiedź
 * (422 `THREAD_CLOSED`), panel szkicu nie pokaże, a wywołanie modelu kosztuje.
 */
export const zamknietyProblem = (c: string): string =>
  `EXISTS (SELECT 1 FROM allegro_inbox_thread tp WHERE tp.id = ${c}.external_conversation_id
      AND tp.watek_typ = 'POST_PURCHASE_ISSUE' AND tp.watek_status = 'CLOSED')`;
