/* Słowniki stanu reklamacji wspólne dla głowicy, drogi i karty decyzji.
   Stoją w mapach `Record`, więc nowy kod dopisany do typu nie skompiluje
   się bez swojego słowa. */

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
