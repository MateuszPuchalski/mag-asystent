import type { StatusWerdyktu, Werdykt } from "../api/typy";

/* Nazwy werdyktów PO POLSKU — wzór `skrzynka/statusy.ts`: `Record<Werdykt, string>`
   sprawia, że nowa wartość w typie nie skompiluje się bez etykiety. Serwer ma
   swoją kopię tych zdań (`werdyktNazwa` na wierszu) — ta służy WYŁĄCZNIE liście
   wyboru, zanim werdykt istnieje. Kolejność w listach jest kolejnością ze
   schematu Allegro, nie częstością użycia: agent uczy się jednego porządku. */
export const NAZWA_WERDYKTU: Record<Werdykt, string> = {
  ACCEPTED_REPAIR: "Uznana — naprawa",
  ACCEPTED_REFUND: "Uznana — zwrot pieniędzy",
  ACCEPTED_EXCHANGE: "Uznana — wymiana",
  ACCEPTED_PARTIAL_REFUND: "Uznana — częściowy zwrot pieniędzy",
  REJECTED_ADDITIONAL_REQUIREMENTS_NOT_COMPLETED: "Odrzucona — kupujący nie spełnił dodatkowych wymagań",
  REJECTED_PRODUCT_NOT_RETURNED: "Odrzucona — towar nie wrócił",
  REJECTED_PRODUCT_DAMAGED_BY_USER: "Odrzucona — uszkodzenie z winy użytkownika",
  REJECTED_PRODUCT_CONFORMS_TO_CONTRACT: "Odrzucona — towar zgodny z umową",
  REJECTED_MINOR_DEFECT: "Odrzucona — wada nieistotna",
  REJECTED_OTHER: "Odrzucona — inny powód",
  REJECTED_CLAIM_WITHDRAWN_BY_BUYER: "Odrzucona — kupujący wycofał reklamację",
};

/* Dwie gałęzie po dwóch przyciskach (prawo Hicka): najpierw „UZNAJĘ" albo
   „ODRZUCAM", dopiero potem lista czterech albo siedmiu. Jedenaście pozycji
   w jednym `select` to jedenaście decyzji naraz. */
export const UZNANIA: Werdykt[] = [
  "ACCEPTED_REPAIR", "ACCEPTED_REFUND", "ACCEPTED_EXCHANGE", "ACCEPTED_PARTIAL_REFUND",
];
export const ODMOWY: Werdykt[] = [
  "REJECTED_ADDITIONAL_REQUIREMENTS_NOT_COMPLETED", "REJECTED_PRODUCT_NOT_RETURNED",
  "REJECTED_PRODUCT_DAMAGED_BY_USER", "REJECTED_PRODUCT_CONFORMS_TO_CONTRACT",
  "REJECTED_MINOR_DEFECT", "REJECTED_OTHER", "REJECTED_CLAIM_WITHDRAWN_BY_BUYER",
];

/* ── SŁOWA ZDANIA „CO SIĘ DZIEJE” ────────────────────────────────────────────
   Głowica mówi etap sprawy zdaniem, a nie kodem (`etap.ts`). Słowa stoją
   w mapach `Record`, więc nowy stan werdyktu albo nowy status Allegro
   dopisany do typu nie skompiluje się bez swojego zdania. Łańcuch `?:`
   przy renderze podpisałby nowość ostatnią gałęzią, czyli skłamałby. */

/** Los próby werdyktu zdaniem. `send_uncertain` mówi wprost, czego NIE robić. */
export const ZDANIE_STANU_WERDYKTU: Record<StatusWerdyktu, (nazwa: string, kwota: string | null) => string> = {
  sending: (nazwa) => `Werdykt „${nazwa}” jest w drodze do Allegro.`,
  sent: (nazwa, kwota) => `Werdykt „${nazwa}”${kwota ? ` ${kwota}` : ""} wysłany — czekamy, aż Allegro potwierdzi.`,
  send_uncertain: (nazwa) =>
    `Nie wiemy, czy werdykt „${nazwa}” doszedł — sprawdź w Centrum Sprzedaży i nie wysyłaj go drugi raz.`,
  /* Bez kropki, bo za tym zdaniem idzie termin: werdyktu nie ma, więc zegar
     dalej biegnie. Treść błędu stoi w bloku werdyktu, przy ponowieniu. */
  send_failed: () => "Werdykt nie przeszedł — popraw go w bloku Werdykt i wyślij jeszcze raz",
};

/** Statusy reklamacji ze specyfikacji Allegro (`PostPurchaseIssueStatus`). */
export type StatusAllegro =
  | "CLAIM_SUBMITTED" | "CLAIM_ACCEPTED" | "CLAIM_REJECTED"
  | "DISPUTE_ONGOING" | "DISPUTE_CLOSED" | "DISPUTE_UNRESOLVED";

/**
 * Gdzie stoi sprawa według Allegro — słowem, bez kropki na końcu.
 *
 * `rodzaj` wybiera gałąź zdania: przed decyzją idzie za nim termin,
 * po rozstrzygnięciu dalszy krok, przy sporze termin tylko w kubełku
 * decyzji. Surowy kod zostaje w podpowiedzi zdania, dla dokładnej wartości.
 */
export const STATUS_ALLEGRO: Record<StatusAllegro, {
  rodzaj: "decyzja" | "rozstrzygnieta" | "spor"; slowo: string;
}> = {
  CLAIM_SUBMITTED: { rodzaj: "decyzja", slowo: "Czeka na naszą decyzję" },
  CLAIM_ACCEPTED: { rodzaj: "rozstrzygnieta", slowo: "Uznana w Centrum Sprzedaży, poza panelem" },
  CLAIM_REJECTED: { rodzaj: "rozstrzygnieta", slowo: "Odrzucona w Centrum Sprzedaży, poza panelem" },
  DISPUTE_ONGOING: { rodzaj: "spor", slowo: "Allegro prowadzi spór z kupującym w tej sprawie" },
  DISPUTE_CLOSED: { rodzaj: "spor", slowo: "Allegro zamknęło spór w tej sprawie" },
  DISPUTE_UNRESOLVED: { rodzaj: "spor", slowo: "Allegro uznało spór za nierozstrzygnięty" },
};

/** Czy kod Allegro jest w słowniku — tylko wtedy wolno go czytać z mapy. */
export function znanyStatus(kod: string | null): kod is StatusAllegro {
  return kod !== null && Object.prototype.hasOwnProperty.call(STATUS_ALLEGRO, kod);
}

/**
 * Rozstrzygnięcie Allegro: „uznana", „odrzucona" albo `null`, gdy go nie ma.
 *
 * Głowica i blok werdyktu pytają tej jednej funkcji. Dwie kopie mapy
 * rozjechałyby się przy pierwszym nowym statusie końcowym.
 */
export function rozstrzygniecie(kod: string | null): "uznana" | "odrzucona" | null {
  return kod === "CLAIM_ACCEPTED" ? "uznana" : kod === "CLAIM_REJECTED" ? "odrzucona" : null;
}

/** Tytuł prawny słowem — rękojmia i gwarancja to dwie różne rozmowy z klientem. */
export const PRAWO: Record<string, string> = {
  COMPLAINT: "rękojmia", WARRANTY: "gwarancja",
};
