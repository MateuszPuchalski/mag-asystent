/* ── Statusy końcowe sprawy posprzedażowej — JEDNA lista dla całego repo ─────
   Stała mieszkała w `reklamacje.ts` i komentarz przy niej mówił wprost, czego
   się boi: „dwie listy końcowe przepisane ręcznie w dwóch plikach to jedna
   lista za dużo — przy następnej zmianie rozjadą się w ciszy". Spoiwo kolejek
   (`droga-klienta.ts`) potrzebuje dokładnie tej samej odpowiedzi na pytanie
   „czy ta sprawa jeszcze czeka na ruch", więc lista schodzi tutaj, zamiast
   urosnąć o trzecią kopię.

   OSOBNY PLIK, a nie import z `reklamacje.ts`, bo tamten importuje spoiwo —
   pętla importów przy stałej liczonej w chwili ładowania modułu bywa pustym
   zbiorem, a objawem jest sprawa zamknięta, która nie schodzi z listy. */

/**
 * Statusy, po których biuro nie ma już przy sprawie decyzji do podjęcia.
 *
 * `DISPUTE_CLOSED` jest tu, bo enum `PostPurchaseIssueStatus` jest JEDEN dla
 * dyskusji i reklamacji. To lista o CZEKANIU NA RUCH, nie o werdykcie —
 * potwierdzenie naszego werdyktu ma w `reklamacje.ts` własną, węższą listę
 * i te dwie rzeczy nie mają prawa się zlać.
 */
export const STATUSY_KONCOWE = [
  "CLAIM_ACCEPTED", "CLAIM_REJECTED", "DISPUTE_CLOSED",
] as const;

const KONCOWE = new Set<string>(STATUSY_KONCOWE);

/**
 * Czy sprawa jeszcze czeka na ruch biura.
 *
 * Status NIEZNANY liczy się jako otwarty i to jest świadome: wartość spoza
 * naszej listy znaczy nowy schemat Allegro, a nie koniec sprawy. Zgadnięcie
 * „skoro nie znam, to zamknięte" zdjęłoby z pracy sprawę z biegnącym zegarem.
 */
export const sprawaOtwarta = (status: string | null): boolean =>
  status == null || !KONCOWE.has(status.toUpperCase());
