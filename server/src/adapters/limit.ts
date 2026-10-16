/* ── Limit zapytań cudzego API — wspólny mianownik ───────────────────────────
   Takt tickerów (`services/takt.ts`) ma rozpoznać prośbę o przerwę od KAŻDEGO
   dostawcy, z którym rozmawia serwer: Allegro i Sellasist. Gdyby takt znał
   tylko klasę Allegro, 429 z Sellasist wyglądałby jak zwykła awaria i następny
   przebieg uderzyłby po samym interwale, nie po `Retry-After`. */

/** Dostawca prosi o przerwę (HTTP 429). Ponowień nie ma — wydłuża się odstęp. */
export class BladLimitu extends Error {
  constructor(
    komunikat: string,
    /** Ile poczekać wg nagłówka `Retry-After`; null = dostawca nie podał. */
    public readonly poIluMs: number | null
  ) {
    super(komunikat);
  }
}
