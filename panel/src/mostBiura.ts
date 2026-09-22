import { token } from "./api/klient";

/* ── MOST DO STAREGO BIURA (0.431.0, znika w F6) ────────────────────────────
   Widok, który jeszcze nie przeszedł do panelu, otwiera się w `/biuro`. Oba
   fronty stoją na jednym originie i na jednych sesjach serwera, więc panel
   zostawia biuru swój token i nazwę zakładki w kluczach, które `biuro.html`
   czyta przy starcie (`wertis.token`, `wertis.kto`, `wertis.widok`). Bez tego
   człowiek logowałby się drugi raz przy każdym przejściu.

   Osobny plik, bo `main.tsx` montuje aplikację przy imporcie — test nie
   mógłby go wczytać bez uruchomienia całego panelu. */

/** Zakładki `biuro.html`, do których panel umie jeszcze prowadzić. Każde wydanie
    przeprowadzki skreśla tu swój widok — DOSTAWY odeszły w 0.435.0. */
export const WIDOKI_BIURA = ["magazyn", "nadzor", "dziennik", "analiza"] as const;
export type WidokBiura = (typeof WIDOKI_BIURA)[number];

/** Przejście do widoku, który jeszcze mieszka w `biuro.html`. */
export function doBiura(widok: WidokBiura, kto: string): void {
  localStorage.setItem("wertis.token", token());
  localStorage.setItem("wertis.kto", kto);
  localStorage.setItem("wertis.widok", widok);
}
