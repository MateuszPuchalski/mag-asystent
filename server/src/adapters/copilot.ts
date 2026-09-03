/* ── Błędy Copilota (etap F) ─────────────────────────────────────────────────
   Ten sam podział, co przy Allegro (`adapters/allegro.ts`): limit ma WŁASNĄ
   klasę, bo woła o inną reakcję niż zwykła odmowa — przy limicie się czeka,
   przy odmowie się naprawia konfigurację.

   Plik jest osobny od `copilot.anthropic.ts`, żeby serwis i testy mogły
   rozpoznawać te klasy bez wciągania SDK dostawcy.                          */

/** Dostawca poprosił o przerwę (429). `poIluMs` z nagłówka, `null` gdy go nie ma. */
export class BladLimituCopilota extends Error {
  constructor(komunikat: string, readonly poIluMs: number | null) {
    super(komunikat);
  }
}

/** Klucz odrzucony albo nieobecny — partia nie ma po co lecieć dalej. */
export class BladKluczaCopilota extends Error {}

/** Wszystko inne, ze statusem HTTP dla diagnostyki. */
export class BladOdpowiedziCopilota extends Error {
  constructor(komunikat: string, readonly status: number) {
    super(komunikat);
  }
}
