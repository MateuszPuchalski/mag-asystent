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

/**
 * Dostawca chwilowo nie wyrabia (529 `overloaded_error`, szerzej: 5xx).
 *
 * WŁASNA KLASA, bo woła o inną reakcję niż zwykła odmowa, a przede wszystkim
 * niesie stan DOSTAWCY, nie tej jednej rozmowy. Przy odmowie naprawia się
 * żądanie, przy przeciążeniu czeka się i klika ponownie — i dlatego ta klasa
 * zatrzymuje CAŁĄ partię. Bez niej dwadzieścia rozmów szłoby po kolei w ten
 * sam mur: sześćdziesiąt prób (SDK ponawia dwa razy), dwadzieścia wierszy
 * w księdze i zero informacji ponad tę z pierwszej próby. Ten sam argument,
 * który zatrzymuje partię przy złym kluczu.
 *
 * Ponowień SAMI NIE DOKŁADAMY. `@anthropic-ai/sdk` ponawia 5xx dwa razy
 * z odczekaniem, więc 529, który do nas dotarł, przeżył już trzy podejścia.
 * Czwarte w naszej pętli byłoby drugą prawdą o tym, ile razy się próbuje.
 */
export class BladPrzeciazeniaCopilota extends Error {
  constructor(komunikat: string, readonly status: number, readonly slad: string) {
    super(komunikat);
  }
}

/**
 * Nie udało się nawiązać połączenia — DNS, zapora, zerwany kabel, przekroczony
 * czas oczekiwania. Partia staje z tego samego powodu, co przy przeciążeniu:
 * następna rozmowa nie pojedzie po kablu, którego nie ma.
 *
 * Osobna klasa, bo REAKCJA jest inna niż przy przeciążeniu. Tam się czeka
 * i klika ponownie, tu ktoś idzie sprawdzić serwer — a zdanie „chwilowo
 * przeciążone" wysłałoby go czekać na coś, co samo nie minie.
 */
export class BladLacznosciCopilota extends Error {
  constructor(komunikat: string, readonly slad: string) {
    super(komunikat);
  }
}

/**
 * Wszystko inne, ze statusem HTTP dla diagnostyki.
 *
 * `slad` jest OSOBNY od `komunikat` i to jest decyzja: na ekran idzie zdanie
 * mówiące, co zrobić, a do księgi identyfikator żądania i typ błędu, po
 * których dostawca umie odszukać sprawę. Wrzucenie surowej odpowiedzi JSON na
 * ekran uczy agenta, że nic tam dla niego nie ma — a wtedy przestaje czytać
 * także te komunikaty, które coś mówią.
 */
export class BladOdpowiedziCopilota extends Error {
  constructor(komunikat: string, readonly status: number, readonly slad: string = "") {
    super(komunikat);
  }
}
