import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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

/* ── OKNA DIALOGOWE: FOKUS WCHODZI, ZOSTAJE I WRACA (0.546.0) ──────────────
   Pomiar przed zmianą: z sześciu okien panelu fokus wchodził tylko do
   szukania, a nie wracał z żadnego. Tabulator szedł za nakładkę, w ekran,
   którego nie widać. Najdroższy skutek był gdzie indziej. Skróty strony
   słuchają na `window` i pytały tylko o pole pisania, więc pod otwartym
   oknem działały dalej. W zwrotach `Z` pod historią klienta oddawało
   pieniądze za zwrot, którego agent w tej chwili nie widział
   (`ekrany/Zwroty.test.tsx`).

   Stąd rejestr otwartych okien. Okno modalne wycisza skróty strony
   (`klawiszZajety`), trzyma tabulator u siebie i oddaje fokus temu, kto
   je otworzył (WAI-ARIA APG, wzorzec „Dialog (Modal)"). Okno niemodalne,
   jak szuflada towaru obok pracy, tylko przyjmuje i oddaje fokus.

   Skan czytnika NIE jest skrótem i przechodzi dalej (`skaner.ts`). Właściciel
   chce, żeby zwroty słuchały etykiety cały czas (0.468.0). */

interface Okno { el: HTMLElement; modalne: boolean }
const okna: Okno[] = [];
const sluchacze = new Set<() => void>();
const zmiana = () => { for (const f of sluchacze) f(); };

/** Czy nad stroną stoi okno modalne. Wtedy skróty strony milczą. */
export const oknoModalne = (): boolean => okna.some((o) => o.modalne);

/**
 * Czy klawisz należy do czegoś innego niż skróty strony: do pola pisania
 * albo do okna modalnego. Nasłuch skrótów pyta TU, nie o samo pole.
 */
export const klawiszZajety = (t: EventTarget | null): boolean => polePisania(t) || oknoModalne();

const CELE = "a[href], button:not([disabled]), input:not([disabled]):not([type=\"hidden\"]), "
  + "select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";

/* `checkVisibility`, bo przycisk ukryty klasą `hidden` nie przyjmie fokusu,
   a pułapka, która na niego celuje, wypuściłaby tabulator za okno. jsdom tej
   metody nie zna i wtedy liczy się każdy element. */
const cele = (el: HTMLElement): HTMLElement[] =>
  [...el.querySelectorAll<HTMLElement>(CELE)].filter((c) =>
    typeof c.checkVisibility !== "function" || c.checkVisibility());

/**
 * Fokus i klawisze okna dialogowego. Zwraca właściwości do rozłożenia na
 * elemencie z `role="dialog"`.
 *
 * Fokus startowy: element z `data-fokus-startowy`, a bez niego samo okno.
 * Okno, a nie pierwszy przycisk, bo pierwszy bywa „Zamknij". Enter wciśnięty
 * z rozpędu zamykałby wtedy okno, które agent dopiero otworzył.
 * `onZamknij` wiąże Escape. Zamyka tylko górne okno, jedno na jedno wciśnięcie.
 */
export function useOkno<T extends HTMLElement>(
  { modalne = true, onZamknij }: { modalne?: boolean; onZamknij?: () => void } = {},
) {
  const ref = useRef<T>(null);
  /* Wyzwalacz czytany PRZY RYSOWANIU, nie w efekcie. Pole z `autoFocus`
     w oknie (szukanie) bierze fokus przy zatwierdzeniu drzewa, czyli przed
     każdym efektem. Efekt zapamiętałby więc pole zamiast przycisku. */
  const [wyzwalacz] = useState(() =>
    typeof document === "undefined" ? null : document.activeElement);
  const zamknij = useRef(onZamknij);
  zamknij.current = onZamknij;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wpis: Okno = { el, modalne };
    okna.push(wpis);
    zmiana();
    const gorne = () => okna[okna.length - 1] === wpis;
    if (!el.contains(document.activeElement)) {
      (el.querySelector<HTMLElement>("[data-fokus-startowy]") ?? el).focus();
    }

    const klawisz = (e: KeyboardEvent) => {
      if (!gorne() || e.defaultPrevented) return;
      if (e.key === "Escape" && zamknij.current) {
        e.preventDefault();
        zamknij.current();
        return;
      }
      if (e.key !== "Tab" || !modalne) return;
      const lista = cele(el);
      if (lista.length === 0) { e.preventDefault(); el.focus(); return; }
      /* Fokus, który jakoś wyszedł za okno (kod strony, klik w tło), wraca
         na początek okna, zamiast iść dalej po niewidocznej stronie. */
      if (!el.contains(document.activeElement)) { e.preventDefault(); lista[0].focus(); return; }
      const i = lista.indexOf(document.activeElement as HTMLElement);
      const pierwszy = lista[0];
      const ostatni = lista[lista.length - 1];
      if (e.shiftKey && i <= 0) { e.preventDefault(); ostatni.focus(); }
      else if (!e.shiftKey && i === lista.length - 1) { e.preventDefault(); pierwszy.focus(); }
    };
    window.addEventListener("keydown", klawisz);

    return () => {
      window.removeEventListener("keydown", klawisz);
      const i = okna.indexOf(wpis);
      if (i >= 0) okna.splice(i, 1);
      zmiana();
      /* Fokus wraca, gdy zginął razem z oknem (tło strony) albo nadal w nim
         stoi. Agent, który przy otwartej szufladzie kliknął już w stronę,
         wybrał inne miejsce i tego wyboru nie odbieramy.

         PO MIKROZADANIU i tylko wtedy, gdy okna już nie ma w dokumencie.
         `StrictMode` odmontowuje efekt na próbę, a okno zostaje na ekranie.
         Oddanie fokusu od razu odbierało go polu z `autoFocus` w szukaniu —
         zmierzone w Chromium na serwerze deweloperskim. */
      queueMicrotask(() => {
        if (el.isConnected) return;
        const teraz = document.activeElement;
        const zgubiony = !teraz || teraz === document.body || el.contains(teraz);
        if (zgubiony && wyzwalacz instanceof HTMLElement && wyzwalacz !== document.body
          && wyzwalacz.isConnected) wyzwalacz.focus();
      });
    };
    /* Rodzaj okna nie zmienia się w trakcie jego życia; efekt biegnie raz. */
  }, []);

  return { ref, tabIndex: -1, "aria-modal": modalne ? true : undefined } as const;
}

const subskrybuj = (f: () => void) => { sluchacze.add(f); return () => { sluchacze.delete(f); }; };

/** `true`, gdy jednoliterowe skróty działają: fokus poza polem pisania i żadne okno modalne nad stroną. */
export function useSkrotyDzialaja(): boolean {
  const [wPolu, setWPolu] = useState(() =>
    typeof document !== "undefined" && polePisania(document.activeElement));
  /* Znaczek pod otwartym oknem kłamałby tak samo jak w polu. Klawisz wtedy
     milczy (`klawiszZajety`), więc znaczek też znika. */
  const modalne = useSyncExternalStore(subskrybuj, oknoModalne, () => false);
  useEffect(() => {
    const wejscie = (e: FocusEvent) => setWPolu(polePisania(e.target));
    /* Przy wyjściu liczy się cel, DO którego fokus idzie (`relatedTarget`),
       nie ten, który opuszcza — inaczej przejście z pola do pola mrugałoby
       znaczkami na jedną klatkę. Brak celu to fokus na tle strony. */
    const wyjscie = (e: FocusEvent) => setWPolu(polePisania(e.relatedTarget));
    document.addEventListener("focusin", wejscie);
    document.addEventListener("focusout", wyjscie);
    return () => {
      document.removeEventListener("focusin", wejscie);
      document.removeEventListener("focusout", wyjscie);
    };
  }, []);
  return !wPolu && !modalne;
}
