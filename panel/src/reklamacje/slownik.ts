import type { Reklamacja, Werdykt } from "../api/typy";
import { zlote } from "../api/zwroty";

/* ── Słowa reklamacji w jednym miejscu ───────────────────────────────────────
   Kody Allegro (powód, oczekiwanie klienta, werdykt) po polsku. Każdy
   komponent brał je dotąd z własnej mapy, a pięć map tych samych kodów
   rozjeżdża się przy pierwszej poprawce słowa.

   KOD SPOZA SŁOWNIKA ZOSTAJE KODEM. Zgadnięte słowo byłoby nieprawdą, więc
   każdy odczyt robi `?? kod`, a nie domyślne słowo. */

/** Powody z `PostPurchaseIssueReason.type`. */
export const POWODY: Record<string, string> = {
  DEFECT_FOUND_DURING_USE: "usterka przy używaniu",
  NOT_AS_DESCRIBED: "niezgodny z opisem",
  MISSING_PRODUCT_ELEMENT: "brakuje elementu",
  PRODUCT_DAMAGED_PARCEL_INTACT: "uszkodzony, paczka cała",
  PRODUCT_AND_PARCEL_DAMAGED_IN_TRANSIT: "uszkodzony w transporcie",
  NO_PRODUCT_RECEIVED: "towar nie dotarł",
  NO_PRODUCT_IN_PARCEL: "brak towaru w paczce",
  NO_PROOF_OF_PURCHASE_MANUAL_OR_WARRANTY: "brak dowodu zakupu",
  ITEM_IS_DAMAGED: "towar uszkodzony",
  RECEIVED_INCOMPLETE_ORDER: "niekompletne zamówienie",
  RECEIVED_ITEMS_NOT_MATCHING_DESCRIPTION: "towar niezgodny z opisem",
  OTHER: "inny powód",
};

/** Czego klient chce — `PostPurchaseIssueExpectation.name`, w mianowniku. */
export const OCZEKIWANIA: Record<string, string> = {
  REPAIR: "naprawa",
  EXCHANGE: "wymiana",
  REFUND: "zwrot pieniędzy",
  PARTIAL_REFUND: "częściowy zwrot",
};

/** Uznanie startuje na życzeniu klienta, bo tak brzmi każde uznanie bez sporu o sposób. */
export const UZNANIE_ZYCZENIA: Record<string, Werdykt> = {
  REPAIR: "ACCEPTED_REPAIR",
  EXCHANGE: "ACCEPTED_EXCHANGE",
  REFUND: "ACCEPTED_REFUND",
  PARTIAL_REFUND: "ACCEPTED_PARTIAL_REFUND",
};

/**
 * Czym kończy się uznanie — słowo kroku „Rozliczenie”.
 *
 * Liczy się z oczekiwania, które werdykt uznał, więc mapa nie powtarza słów.
 */
export function rozliczenieWerdyktu(kod: string | null): string | null {
  const zyczenie = Object.entries(UZNANIE_ZYCZENIA).find(([, w]) => w === kod)?.[0];
  return zyczenie ? OCZEKIWANIA[zyczenie] : null;
}

/* Oczekiwanie w dopełniaczu, bo w linii zgłoszenia stoi po „chce”. */
const CHCE: Record<string, string> = {
  REPAIR: "naprawy",
  EXCHANGE: "wymiany",
  REFUND: "zwrotu pieniędzy",
  PARTIAL_REFUND: "częściowego zwrotu",
};

/** Tytuł prawny słowem — rękojmia i gwarancja to dwie różne rozmowy z klientem. */
export const PRAWO: Record<string, string> = {
  COMPLAINT: "rękojmia", WARRANTY: "gwarancja",
};

/**
 * Linia nad zdaniem klienta w dymku zgłoszenia: „Powód: … · chce … · rękojmia”.
 *
 * TO JEDYNY DOM tych faktów na ekranie sprawy. Stoją przy słowach klienta,
 * bo bez nich zdanie bywa niejasne, a karta Produkt mówi o towarze.
 * Kwota idzie za oczekiwaniem, bo „chce zwrotu 40 zł” to jedno żądanie.
 * Brak wszystkiego daje `null`, a dymek stoi wtedy bez tej linii.
 */
export function liniaPowodu(r: Pick<Reklamacja, "powodTyp" | "oczekiwanie" | "oczekiwanaKwotaGrosze"
  | "waluta" | "prawo">): string | null {
  const czesci: string[] = [];
  if (r.powodTyp) czesci.push(`Powód: ${POWODY[r.powodTyp] ?? r.powodTyp}`);
  if (r.oczekiwanie) {
    const kwota = r.oczekiwanaKwotaGrosze !== null ? ` ${zlote(r.oczekiwanaKwotaGrosze, r.waluta)}` : "";
    const chce = `${CHCE[r.oczekiwanie] ?? r.oczekiwanie}${kwota}`;
    czesci.push(czesci.length ? `chce ${chce}` : `Chce ${chce}`);
  }
  if (r.prawo) czesci.push(PRAWO[r.prawo] ?? r.prawo);
  return czesci.length ? czesci.join(" · ") : null;
}
