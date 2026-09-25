import { useEffect, useState } from "react";

/* ── PODPOWIEDŹ KLAWISZA TYLKO WTEDY, GDY KLAWISZ DZIAŁA (0.500.0) ─────────
   Jednoliterowe skróty skrzynki (E, R, Z) milczą w polu tekstowym — tam
   człowiek pisze, nie steruje. Znaczek „E" przy przycisku świecił jednak dalej,
   więc agent w trakcie pisania widział obietnicę, której klawisz nie spełniał.
   Interfejs, który kłamie o swoim stanie, uczy nie wierzyć podpowiedziom
   w ogóle (Norman: widoczność stanu; Nielsen, heurystyka 1). Znaczek znika
   więc dokładnie wtedy, kiedy klawisz przestaje działać. */

/** Czy element jest polem, w którym klawisz pisze, a nie steruje. */
export const polePisania = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"
    || el.isContentEditable));
};

/** `true`, gdy jednoliterowe skróty działają — fokus nie stoi w polu pisania. */
export function useSkrotyDzialaja(): boolean {
  const [dzialaja, setDzialaja] = useState(() =>
    typeof document === "undefined" || !polePisania(document.activeElement));
  useEffect(() => {
    const wejscie = (e: FocusEvent) => setDzialaja(!polePisania(e.target));
    /* Przy wyjściu liczy się cel, DO którego fokus idzie (`relatedTarget`),
       nie ten, który opuszcza — inaczej przejście z pola do pola mrugałoby
       znaczkami na jedną klatkę. Brak celu to fokus na tle strony. */
    const wyjscie = (e: FocusEvent) => setDzialaja(!polePisania(e.relatedTarget));
    document.addEventListener("focusin", wejscie);
    document.addEventListener("focusout", wyjscie);
    return () => {
      document.removeEventListener("focusin", wejscie);
      document.removeEventListener("focusout", wyjscie);
    };
  }, []);
  return dzialaja;
}
