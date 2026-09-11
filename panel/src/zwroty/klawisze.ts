import { useEffect, type MutableRefObject } from "react";

/* ── Klawisze kubełka sięgają do stanu, który mieszka niżej ──────────────────
   Nasłuch klawiatury stoi na EKRANIE (`ekrany/Zwroty.tsx`) i tak ma zostać:
   czytnik kodów wpisuje znaki jak klawiatura, więc dwa niezależne nasłuchy nie
   umiałyby się dogadać, który klawisz jest czyj (`skaner.ts`, 0.163.0).

   Dwie decyzje z tabeli §25a.2 potrzebują jednak stanu, którego ekran nie ma
   i mieć nie powinien:

   • ODMOWA otwiera pole powodu — `Decyzje.tsx` trzyma to w `useState`;
   • KWOTA powstaje z ZAZNACZENIA pozycji, a ono mieszka w `Pozycje.tsx`
     i ma tam zostać. Wyprowadzenie zaznaczenia z `zwrot.pozycje` naprawiło
     w 0.216.0 dwie osobne drogi do złej kwoty; podniesienie go na ekran
     odtworzyłoby dokładnie tamten błąd.

   Stąd REJESTR: komponent zostawia w nim funkcję, a nasłuch ją woła. To nie
   jest kanał zdarzeń w drugą stronę — ekran nadal decyduje, KIEDY wolno
   wywołać akcję, i nadal jest jedynym miejscem, które zna klawisze.          */

export interface AkcjeKlawiszy {
  /**
   * DO DECYZJI, klawisz `O`.
   *
   * Otwiera pole powodu, a NIE zapisuje odmowy. Odmowa jest nieodwracalna,
   * a §25a.5 daje potwierdzenie dokładnie takim rzeczom.
   */
  odmow?: () => void;
  /** DO ZWROTU, klawisz `Enter`: zapisuje kwotę z bieżącego zaznaczenia. */
  zapiszKwote?: () => void;
}

/**
 * Zgłoszenie akcji do rejestru ekranu.
 *
 * BEZ TABLICY ZALEŻNOŚCI, i to jest tu sedno: funkcja domyka się nad stanem,
 * który zmienia się przy każdym kliknięciu (zaznaczone pozycje, haczyk przy
 * dostawie). Zarejestrowana raz zapisywałaby kwotę sprzed zaznaczenia — czyli
 * cichą pomyłkę o pieniądzach, najgorszy rodzaj błędu na tym ekranie.
 */
export function useAkcjaKlawisza(
  rejestr: MutableRefObject<AkcjeKlawiszy> | undefined,
  nazwa: keyof AkcjeKlawiszy,
  fn: () => void,
): void {
  useEffect(() => {
    if (!rejestr) return;
    rejestr.current[nazwa] = fn;
    /* Sprzątanie jest obowiązkowe: komponent znika razem z kubełkiem, a akcja
       po nim zostawiona działałaby na zwrocie, którego nie ma na ekranie. */
    return () => { delete rejestr.current[nazwa]; };
  });
}
