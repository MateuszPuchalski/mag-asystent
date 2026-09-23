import type { Firma } from "./szablony";

/* ── Dane firmy do druków dostawców (0.435.0) ──────────────────────────────
   Druki GEKO i PARTNER pytają o dane ZGŁASZAJĄCEGO — nazwę, NIP, adres,
   osobę kontaktową. Od lat mieszkają w `localStorage` przeglądarki biura pod
   kluczem `wertis.firma`, a wpisuje je formularz za zębatką w `biuro.html`.

   PANEL CZYTA TEN SAM KLUCZ, a nie nowe miejsce, bo stoi na tym samym
   originie co biuro. Dzięki temu przeprowadzka druku nie każe nikomu
   wpisywać danych drugi raz — ani nie zostawia dwóch kopii, które by się
   rozjechały przy pierwszej zmianie numeru telefonu.

   Przeniesienie danych firmy NA SERWER czeka na wydanie z ustawieniami
   (F5 w `docs/obsluga-klienta.md` §7): wtedy znika formularz w biurze
   i jest jedno miejsce, do którego można je przenieść. Zrobione teraz
   wymagałoby zmiany zapisu w `biuro.html`, któremu nic nowego nie wolno. */

const KLUCZ = "wertis.firma";

export function firma(): Firma {
  try {
    const f = JSON.parse(localStorage.getItem(KLUCZ) ?? "null") as unknown;
    return f && typeof f === "object" ? (f as Firma) : {};
  } catch { return {}; }
}
