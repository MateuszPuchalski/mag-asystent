/* ── Identyfikator zamówienia Allegro w polu uwag dokumentu (0.175.0) ────────
   Zrzut z Subiekta firmy pokazał, gdzie integracja NAPRAWDĘ wpisuje numer
   zamówienia: nie w `dok_NrPelnyOryg`, tylko w `dok_Uwagi`, w postaci
   `b9732a20-a621-11f1-8e66-3787b0f6d855 ; Client:143874145`. Read-model
   z 0.174.0 czytał wyłącznie kolumnę numeru obcego, więc mocny sygnał — jedyny,
   który wiąże dokument automatycznie — nie miał prawa zadziałać ani razu.

   `dok_Uwagi` to varchar(500) wolnego tekstu i 0.174.0 celowo go nie kopiowało:
   kiedyś ktoś wpisze tam adres albo telefon, a read-model idzie do kopii
   zapasowych. Ta decyzja STOI. Nie kopiujemy kolumny — WYCINAMY z niej w SQL,
   po stronie serwera firmy, wyłącznie ciąg o kształcie UUID-a: 36 znaków
   szesnastkowych z myślnikami w ustalonych miejscach. Nic innego przez tę
   funkcję nie przejdzie, bo wzorzec nie ma jak dopasować niczego innego.
   Wolny tekst nie opuszcza bazy Subiekta.

   Druga zapora stoi po naszej stronie: `uuidZTekstu` sprawdza wynik jeszcze raz
   w JS, zanim trafi do bazy. Gdyby układ znaków (collation) po stronie SQL
   dopasował coś dziwnego, tutaj to odpada.                                   */

const HEX_TSQL = "[0-9a-fA-F]";

/**
 * Wzorzec `PATINDEX` na UUID. T-SQL nie zna powtórzeń w wyrażeniu, więc każda
 * pozycja stoi osobno — 32 klasy znaków i 4 myślniki, 36 znaków.
 */
export const WZORZEC_UUID_TSQL =
  "%" + [8, 4, 4, 4, 12].map((n) => HEX_TSQL.repeat(n)).join("-") + "%";

/**
 * Wyrażenie T-SQL wycinające pierwszy UUID z kolumny albo NULL.
 * `@uuid` to parametr zapytania z `WZORZEC_UUID_TSQL`.
 */
export function wyrazenieUuid(kolumna: string): string {
  return (
    `CASE WHEN PATINDEX(@uuid, ${kolumna}) > 0 ` +
    `THEN SUBSTRING(${kolumna}, PATINDEX(@uuid, ${kolumna}), 36) END`
  );
}

const UUID_JS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Pierwszy UUID z tekstu, małymi literami — albo `null`. */
export function uuidZTekstu(tekst: string | null | undefined): string | null {
  const m = UUID_JS.exec(tekst ?? "");
  return m ? m[0].toLowerCase() : null;
}
