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

/** Los próby zdaniem, nie kodem. `send_uncertain` mówi wprost, czego NIE robić. */
export const NAZWA_STANU_WERDYKTU: Record<StatusWerdyktu, string> = {
  sending: "W drodze do Allegro…",
  sent: "Wysłany — Allegro jeszcze nie potwierdziło",
  send_uncertain: "Niepewny — sprawdź w Centrum Sprzedaży, nie wysyłaj drugi raz",
  send_failed: "Nieudany",
};
