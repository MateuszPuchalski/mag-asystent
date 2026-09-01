import type { StatusRozmowy } from "../api/typy";

/* Nazwy statusów PO POLSKU w jednym miejscu. Lista jest zamknięta i pochodzi
   z §7 — `Record<StatusRozmowy, string>` sprawia, że dołożenie statusu
   w typach nie skompiluje się, dopóki nie dostanie nazwy dla człowieka.
   Angielskie klucze zostają w bazie i w API; na ekran idzie polszczyzna. */
export const NAZWA: Record<StatusRozmowy, string> = {
  new: "Nowa",
  open: "Otwarta",
  waiting_for_customer: "Czeka na klienta",
  waiting_for_internal: "Czeka na nas",
  snoozed: "Odłożona",
  resolved: "Rozwiązana",
  closed: "Zamknięta",
  spam: "Spam",
};

/* Statusy, które agent ustawia RĘCZNIE. `new` jest poza listą, bo znaczy
   „nikt tego nie tknął" — cofnięcie rozmowy do tego stanu byłoby kłamstwem.
   Reszty ekran nie ukrywa: zamknięcie i spam to jawne werdykty człowieka. */
export const DO_WYBORU: StatusRozmowy[] = [
  "open", "waiting_for_customer", "waiting_for_internal", "snoozed",
  "resolved", "closed", "spam",
];
