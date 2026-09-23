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
    przeprowadzki skreśla tu swój widok — DOSTAWY odeszły w 0.435.0, MAGAZYN
    ZWROTÓW (kosze) w 0.438.0, DZIENNIK i ANALIZA w 0.440.0.

    `dostawcy` to USTAWIENIA za zębatką biura (nazwa widoku została po
    dawnej zakładce, żeby nie migrować `localStorage`). Doszły tu w 0.440.0,
    bo strefa złota w analizie panelu prowadzi do swoich reguł, które
    przeprowadzą się dopiero z ustawieniami (F5). */
export const WIDOKI_BIURA = ["nadzor", "dostawcy"] as const;
export type WidokBiura = (typeof WIDOKI_BIURA)[number];

/** Przejście do widoku, który jeszcze mieszka w `biuro.html`. */
export function doBiura(widok: WidokBiura, kto: string): void {
  localStorage.setItem("wertis.token", token());
  localStorage.setItem("wertis.kto", kto);
  localStorage.setItem("wertis.widok", widok);
}
