import type {
  Kategoria, Pewnosc, PowodNegatywny, RodzajDowodu, RodzajIdentyfikatora, StatusDoboru,
  StatusRozmowy, ZrodloPropozycji, RolaPasowania } from "../api/typy";

/* Nazwy statusów PO POLSKU w jednym miejscu. Lista jest zamknięta i pochodzi
   z §7 — `Record<StatusRozmowy, string>` sprawia, że dołożenie statusu
   w typach nie skompiluje się, dopóki nie dostanie nazwy dla człowieka.
   Angielskie klucze zostają w bazie i w API; na ekran idzie polszczyzna. */
export const NAZWA: Record<StatusRozmowy, string> = {
  new: "Nowa",
  open: "Otwarta",
  waiting_for_customer: "Czeka na klienta",
  waiting_for_us: "Czeka na nas",
  /* „Czeka na halę", nie „Czeka na nas" (0.225.0). Ta etykieta kłamała: stan
     stawia ZLECENIE POMIARU, a zdejmuje wynik z magazynu — to czekanie na
     halę, nie na odpowiedź biura. Pod starą nazwą stał obok „Otwartej"
     w rozwijanym menu i wyglądał jak coś, co agent ma wybrać ręką. */
  waiting_for_internal: "Czeka na halę",
  snoozed: "Odłożona",
  resolved: "Rozwiązana",
  closed: "Zamknięta",
  spam: "Spam",
};

/* Stany, które WYNIKAJĄ z rozmowy — ekran ich nie daje do wyboru (0.225.0).
   Właściciel: „otwarta, czeka na klienta, czeka na nas powinno być odczytywane
   z wiadomości". Kto ma następny ruch, widać po ostatniej wiadomości; klikanie
   tego z ręki było przepisywaniem faktu, który już stoi w wątku. */
export const WYLICZANE: StatusRozmowy[] = [
  "new", "open", "waiting_for_customer", "waiting_for_us",
];

/* Statusy, które agent ustawia RĘCZNIE — cztery werdykty. `open` dochodzi jako
   DROGA POWROTNA („wróć do stanu z rozmowy"), bo bez niej werdykt „Rozwiązana"
   trzymałby rozmowę, dopóki klient sam nie napisze, a pomyłki nie dałoby się
   cofnąć. `waiting_for_internal` też zniknął z listy: stawia go zlecenie
   pomiaru, a zdejmuje wynik z hali — człowiek nie ma tu nic do klikania. */
export const DO_WYBORU: StatusRozmowy[] = ["snoozed", "resolved", "closed", "spam"];

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

/* KATEGORIE Copilota (§14, etap F). Ta sama zasada, co przy `NAZWA_DOBORU`:
   `Record<Kategoria, string>` NIE SKOMPILUJE SIĘ, gdy dojdzie siódma kategoria
   bez nazwy dla człowieka. To jest test sam w sobie i dlatego kategoria nie
   dostała `CHECK`-a w bazie — słownik ma rosnąć tanio, ale nie po cichu.

   Dwa kosze mają RÓŻNE nazwy, bo mówią o różnych naprawach: „Inne" znaczy
   „słownik jest za krótki", „Nie wiadomo" — „przeczytaj sam". */
export const NAZWA_KATEGORII: Record<Kategoria, string> = {
  dobor: "Dobór",
  dostepnosc: "Dostępność",
  wysylka: "Wysyłka",
  zwrot: "Zwrot",
  reklamacja: "Reklamacja",
  dokumenty: "Dokumenty",
  inne: "Inne",
  nie_wiadomo: "Nie wiadomo",
};

/* Pewność NIE jest procentem i ekran nie ma prawa udawać, że jest. Model
   podaje własne oszacowanie, a jedyna liczba, której tu ufamy, to trafność
   z pomiaru — ta stoi za zębatką, nie na wierszu kolejki. */
export const NAZWA_PEWNOSCI: Record<Pewnosc, string> = {
  wysoka: "pewne",
  srednia: "prawdopodobne",
  niska: "zgadywane",
};

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

/* Rola części w pasowaniu (§11.2). To własność CZĘŚCI zapisana w relacji,
   bo nazwa kartoteki to wolny tekst; lista zamknięta jak `RodzajDowodu`. */
export const ROLE_PASOWANIA: RolaPasowania[] = [
  "uszczelka", "membrana", "zestaw_naprawczy", "lacznik", "element_zestawu", "inne",
];
export const NAZWA_ROLI: Record<RolaPasowania, string> = {
  uszczelka: "uszczelka", membrana: "membrany", zestaw_naprawczy: "zestaw naprawczy",
  lacznik: "łącznik kolektora", element_zestawu: "element zestawu", inne: "inne",
};

export const NAZWA_RODZAJU_IDENTYFIKATORA: Record<RodzajIdentyfikatora, string> = {
  oem: "OEM",
  nr_oryg: "nr oryginału",
  katalog_obcy: "katalog obcy",
  stare_sku: "stare SKU",
};
export const RODZAJE_IDENTYFIKATORA: RodzajIdentyfikatora[] = ["oem", "nr_oryg", "katalog_obcy", "stare_sku"];
