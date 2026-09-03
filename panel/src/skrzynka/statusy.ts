import type {
  PowodNegatywny, RodzajDowodu, RodzajIdentyfikatora, StatusDoboru, StatusRozmowy, ZrodloPropozycji,
} from "../api/typy";

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

/* Statusy DOBORU (§7, etap E1) — ta sama zasada: polszczyzna na ekran, klucze
   w bazie i w API. `Record` nie skompiluje się bez nazwy dla nowego statusu. */
export const NAZWA_DOBORU: Record<StatusDoboru, string> = {
  not_started: "Nierozpoczęty",
  extracting_data: "Copilot czyta dane",
  missing_information: "Brakuje danych",
  searching: "Szukamy",
  candidates_found: "Są kandydaci",
  requires_expert: "Do sprawdzenia",
  confirmed: "Dobór zatwierdzony",
  rejected: "Odrzucony",
  not_applicable: "Nie dotyczy",
};

/* Do wyboru RĘCZNIE: bez `extracting_data`, bo tego stanu człowiek nie nadaje
   uczciwie — on dane wpisuje, nie wyciąga; nada go Copilot (etap F). */
export const DO_WYBORU_DOBORU: StatusDoboru[] = [
  "not_started", "missing_information", "searching", "candidates_found",
  "requires_expert", "confirmed", "rejected", "not_applicable",
];

/* Baza wiedzy (E2): powody negatywne §11.4 i rodzaje dowodów §11.3 — nazwy
   do FORMULARZY. Zdania przy gotowych wpisach pisze serwer, panel ich nie
   składa drugi raz. `decyzja_biura` stoi tam, gdzie projekt pisał „ekspert". */
export const NAZWA_POWODU: Record<PowodNegatywny, string> = {
  nie_pasuje: "nie pasuje",
  tylko_inny_wariant: "pasuje tylko do innego wariantu",
  niewlasciwy_rozstaw: "niewłaściwy rozstaw",
  srednica_ok_inne_mocowanie: "właściwa średnica, inny sposób mocowania",
  mylace_oznaczenie: "mylące oznaczenie",
  wymaga_pomiaru: "wymaga dodatkowego pomiaru",
};

export const NAZWA_DOWODU: Record<RodzajDowodu, string> = {
  producent: "producent",
  katalog_dostawcy: "katalog dostawcy",
  pomiar_wlasny: "pomiar własny",
  sprzedaz_weryfikacja: "sprzedaż i weryfikacja",
  decyzja_biura: "decyzja biura",
  rozmowa: "rozmowa",
};

/* Do wyboru w formularzu ręcznym: `rozmowa` jest śladem, który zapisuje sam
   dobór; człowiek wpisuje dowody TECHNICZNE. */
export const DOWODY_DO_WYBORU: RodzajDowodu[] = [
  "producent", "katalog_dostawcy", "pomiar_wlasny", "sprzedaz_weryfikacja", "decyzja_biura",
];

/* Skąd propozycja (E2/E3). Surowy klucz `opis` na ekranie mówił tyle, co nic. */
export const NAZWA_ZRODLA: Record<ZrodloPropozycji, string> = {
  dobor: "z zatwierdzonego doboru",
  pomiar: "z pomiaru hali",
  reczne: "wpis ręczny",
  opis: "z opisu kartoteki",
  copilot: "propozycja Copilota",
};

export const NAZWA_RODZAJU_IDENTYFIKATORA: Record<RodzajIdentyfikatora, string> = {
  oem: "OEM",
  nr_oryg: "nr oryginału",
  katalog_obcy: "katalog obcy",
  stare_sku: "stare SKU",
};
export const RODZAJE_IDENTYFIKATORA: RodzajIdentyfikatora[] = ["oem", "nr_oryg", "katalog_obcy", "stare_sku"];
