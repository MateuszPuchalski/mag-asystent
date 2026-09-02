import { useEffect, useRef } from "react";

/* ── Czytnik kodów jako klawiatura (0.163.0) ─────────────────────────────────
   Czytnik USB wpisuje znaki jak klawiatura i kończy Enterem. Panel musi
   odróżnić taką serię od człowieka stukającego w skróty — a na ekranie zwrotów
   cyfry 1–6 przełączają kubełki i litery `j`/`k` chodzą po kolejce.

   To nie jest ryzyko teoretyczne: przykładowa etykieta InPostu ma numer
   `600000367616070023174201`, więc bez zabezpieczenia jeden skan przerzuciłby
   kubełek sześć razy, zanim doleciałby Enter.

   Wzorzec jest przeniesiony z kolektora (`android/.../scan/WedgeKeySource.kt`),
   razem z jego uzasadnieniami: przerwa resetuje bufor, Enter kończy serię,
   krótka seria nie jest skanem, a gdy kursor stoi w polu tekstowym — hook
   milczy, bo pole obsługuje Enter samo.                                     */

/** Dłuższa przerwa niż ta znaczy, że to człowiek, a nie czytnik. */
export const PRZERWA_MS = 300;
/** Krótsza seria to nie kod — żaden numer listu ani zwrotu nie jest tak krótki. */
export const MIN_DLUGOSC = 6;
/**
 * Ile czeka PIERWSZY znak serii, zanim trafi do skrótów klawiszowych.
 *
 * Bez tego opóźnienia pierwsza cyfra kodu i tak przełączyłaby kubełek: w chwili
 * jej naciśnięcia nikt jeszcze nie wie, czy to skan, czy skrót. Człowiek nie
 * wciska dwóch klawiszy w czterdzieści milisekund, a czytnik wysyła znak co
 * kilka — więc drugi znak w tym oknie rozstrzyga sprawę na korzyść skanu.
 */
export const ZWLOKA_MS = 40;

/**
 * Nasłuch czytnika. `onSkan` dostaje gotowy kod, `onZnak` — pojedynczy klawisz,
 * który okazał się NIE być częścią serii (czyli zwykły skrót).
 *
 * Ekran oddaje obsługę skrótów temu hookowi zamiast trzymać własny `keydown`:
 * dwa niezależne nasłuchy nie umiałyby się dogadać, który klawisz jest czyj.
 */
export function useSkaner(
  onSkan: (kod: string) => void,
  onZnak?: (e: KeyboardEvent) => void,
) {
  const naSkan = useRef(onSkan);
  const naZnak = useRef(onZnak);
  naSkan.current = onSkan;
  naZnak.current = onZnak;

  useEffect(() => {
    let bufor = "";
    let ostatni = 0;
    let odlozony: { e: KeyboardEvent; zegar: ReturnType<typeof setTimeout> } | null = null;

    const wypusc = () => {
      if (!odlozony) return;
      clearTimeout(odlozony.zegar);
      const e = odlozony.e;
      odlozony = null;
      naZnak.current?.(e);
    };

    const naKlawisz = (e: KeyboardEvent) => {
      /* Pole tekstowe obsługuje wpisywanie samo — tak samo jak licznik fokusów
         w kolektorze. Bez tego skan wpisywany ręcznie do pola leciałby dwiema
         drogami naraz. */
      const cel = e.target as HTMLElement | null;
      if (cel && (/^(INPUT|TEXTAREA|SELECT)$/.test(cel.tagName) || cel.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const teraz = Date.now();
      const seria = teraz - ostatni <= PRZERWA_MS;
      if (!seria) bufor = "";
      ostatni = teraz;

      if (e.key === "Enter" || e.key === "Tab") {
        const kod = bufor;
        bufor = "";
        if (kod.length >= MIN_DLUGOSC) {
          /* Odłożony pierwszy znak NIE leci do skrótów: należał do kodu. */
          if (odlozony) { clearTimeout(odlozony.zegar); odlozony = null; }
          e.preventDefault();
          naSkan.current(kod);
          return;
        }
        wypusc();
        naZnak.current?.(e);
        return;
      }

      if (e.key.length !== 1) { wypusc(); naZnak.current?.(e); return; }

      bufor += e.key;
      if (bufor.length === 1) {
        /* Pierwszy znak czeka: dopiero drugi w oknie mówi, że to czytnik. */
        odlozony = { e, zegar: setTimeout(() => { odlozony = null; naZnak.current?.(e); }, ZWLOKA_MS) };
        return;
      }
      /* Druga litera w serii przesądza — pierwszy znak zostaje przy kodzie. */
      if (odlozony) { clearTimeout(odlozony.zegar); odlozony = null; }
    };

    window.addEventListener("keydown", naKlawisz);
    return () => {
      if (odlozony) clearTimeout(odlozony.zegar);
      window.removeEventListener("keydown", naKlawisz);
    };
  }, []);
}
