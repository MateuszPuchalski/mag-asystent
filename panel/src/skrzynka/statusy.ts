import type {
  Akcja, GrupaKandydata, Kategoria, Pewnosc, PodstawaWyboru, PowodNegatywny, RodzajDowodu, RodzajIdentyfikatora,
  StanDoboru, StatusRozmowy, ZrodloPropozycji, RolaPasowania, ZrodloZakonczenia } from "../api/typy";

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
  /* JEDEN WERDYKT (23 września 2026, decyzja właściciela). „Rozwiązana"
     i „Zamknięta" różniły się tylko tym, komu wraca obudzona rozmowa —
     dziś wraca do prowadzącego w obu przypadkach, więc nazwa jest jedna. */
  resolved: "Zakończona",
  closed: "Zakończona",
  spam: "Spam",
};

/* Skąd zakończenie — słowo na plakietkę i dymek. Zakończenie bez źródła
   byłoby werdyktem nie do sprawdzenia, więc źródło stoi zawsze. */
export const ZRODLO_ZAKONCZENIA: Record<ZrodloZakonczenia, string> = {
  agent: "zakończona ręcznie",
  podziekowanie: "klient podziękował",
  cisza: "2 dni bez odpowiedzi klienta",
  allegro: "wątek zamknięty w Allegro",
};

/* Stany DOBORU (`docs/dobor-od-zera.md` §4.2). `Record` nie skompiluje się
   bez nazwy dla nowego stanu. Nazwa mówi ODPOWIEDŹ dla klienta, bo po nią
   agent otwiera dobór, a nie etap roboty. */
export const NAZWA_STANU_DOBORU: Record<StanDoboru, string> = {
  pusty: "Nie zaczęty",
  otwarty: "Otwarty",
  czesc: "Wybrano część",
  brak: "Nie mamy",
  dopytac: "Dopytać klienta",
  nie_dotyczy: "Nie dotyczy",
};

/* Barwa znaku doboru w kolejce. Zieleń to gotowa odpowiedź, czerwień czeka
   na klienta, bursztyn jest robotą w toku, szarość mówi „nie mamy".
   `null` = stan bez znaku, bo nie ma w nim nic do zrobienia. */
export const BARWA_STANU_DOBORU: Record<StanDoboru, string | null> = {
  pusty: null,
  otwarty: "text-amber-700",
  czesc: "text-emerald-700",
  brak: "text-slate-600",
  dopytac: "text-ranga-zle",
  nie_dotyczy: null,
};

/* Grupy kandydatów (§4.3) — trzy pytania, nie jedenaście dróg: co klient
   wskazał, co wiedza potwierdza, co jest podobne. Te same nazwy czyta raport
   miar, bo podstawa wyboru to grupa, z której przyszła część. */
export const NAZWA_GRUPY: Record<GrupaKandydata, string> = {
  numer: "Wskazane przez klienta",
  wiedza: "Z bazy wiedzy",
  podobne: "Podobne po nazwie",
};

export const NAZWA_PODSTAWY: Record<PodstawaWyboru, string> = {
  ...NAZWA_GRUPY,
  reczny: "Wskazane z wyszukiwarki",
};

/* KATEGORIE klasyfikatora (specyfikacja z 20 września 2026). Ta sama zasada,
   co przy `NAZWA_STANU_DOBORU`: `Record<Kategoria, string>` NIE SKOMPILUJE SIĘ, gdy
   dojdzie szesnasta kategoria bez nazwy dla człowieka. Nazwy są krótkie, bo
   stoją na plakietce wiersza kolejki, a wiersz ma pokazywać pytanie klienta.

   „Dobór" zostaje nazwą `PRODUCT_COMPATIBILITY`, bo tak tę sprawę nazywa
   całe biuro — i zakładka obok. */
export const NAZWA_KATEGORII: Record<Kategoria, string> = {
  ORDER_STATUS: "Status zamówienia",
  DELIVERY_DELAY: "Opóźniona dostawa",
  DELIVERY_LOST: "Zaginiona paczka",
  DELIVERY_DAMAGED: "Uszkodzona w transporcie",
  PRODUCT_COMPATIBILITY: "Dobór",
  PRODUCT_QUESTION: "Pytanie o towar",
  PRODUCT_AVAILABILITY: "Dostępność",
  WRONG_PRODUCT: "Inny towar",
  MISSING_PRODUCT: "Brak w paczce",
  DAMAGED_PRODUCT: "Wada towaru",
  RETURN: "Zwrot",
  COMPLAINT: "Reklamacja",
  CANCEL_ORDER: "Anulowanie",
  INVOICE: "Faktura",
  OTHER: "Inne",
};

/* Następny krok jako polecenie dla człowieka. To PODPOWIEDŹ — panel żadnej
   z tych czynności nie wykonuje sam i nazwa nie może tego sugerować. */
export const NAZWA_AKCJI: Record<Akcja, string> = {
  GET_ORDER: "sprawdź zamówienie",
  GET_SHIPMENT: "sprawdź przesyłkę",
  GET_PRODUCT: "sprawdź ofertę",
  CHECK_COMPATIBILITY: "sprawdź pasowanie",
  CHECK_STOCK: "sprawdź stan",
  START_RETURN: "przygotuj zwrot",
  START_COMPLAINT: "przygotuj reklamację",
  ASK_FOR_MACHINE_MODEL: "zapytaj o model maszyny",
  ASK_FOR_PART_NUMBER: "zapytaj o numer części",
  ASK_FOR_PHOTO: "poproś o zdjęcie",
  HUMAN_REVIEW: "do decyzji człowieka",
  NO_ACTION: "nic do zrobienia",
};

/* Kody reguł polityki jako zdania. Zbiór jest OTWARTY (kod przychodzi z serwera
   jako tekst), więc to nie `Record<Kod, …>`: nieznany kod ekran pokazuje
   wprost, zamiast go przemilczeć. */
export const NAZWA_KODU: Record<string, string> = {
  PROSBA_O_CZLOWIEKA: "klient prosi o człowieka",
  MODEL_ZADA_CZLOWIEKA: "sprawa wymaga decyzji",
  NISKA_PEWNOSC: "niska pewność",
  KATEGORIA_OTHER: "poza słownikiem",
  TYLKO_ZALACZNIK: "sam załącznik — Copilot go nie czyta",
  NIESPOJNA_ODPOWIEDZ: "sprzeczna odpowiedź modelu",
  AKCJA_RECZNA: "zwrot i reklamację zakłada człowiek",
  BLAD_MODELU: "Copilot nie odpowiedział",
  BLAD_MASKOWANIA: "maskowanie nie przeszło — nic nie wysłano",
  NIEPOPRAWNA_ODPOWIEDZ: "odpowiedź spoza słownika",
  SPOR_Z_ALLEGRO: "Allegro wskazuje co innego",
  PODTYP_NIEZNANY: "nieznany podtyp wątku Allegro",
  TYP_NIEZNANY: "nieznany typ wątku Allegro",
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
  dobor: "z doboru w rozmowie",
  pomiar: "z pomiaru hali",
  reczne: "wpis ręczny",
  opis: "z opisu kartoteki",
  copilot: "propozycja Copilota",
  /* Nie „z oferty" samo w sobie: chodzi o NASZĄ ofertę Allegro, a nie
     o ofertę dostawcy — na ekranie Wiedzy jedno i drugie brzmi tak samo. */
  oferta: "z naszej oferty Allegro",
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
  /* 0.234.0 — numer wyczytany z sekcji „Zamiennik:". Podpis mówi SKĄD, bo ta
     sekcja jest słabszym świadectwem niż numer producenta (§11.3). */
  zamiennik: "z zamienników",
};
/* Lista do WYBORU przy wpisie ręcznym, nie do wyświetlania. `zamiennik` jej
   nie ma i to jest decyzja: ten rodzaj znaczy „parser wyczytał z sekcji
   zamienników". Wpisany ręką kłamałby o swoim pochodzeniu, a biuro ma do tego
   `katalog_obcy`. */
export const RODZAJE_IDENTYFIKATORA: RodzajIdentyfikatora[] = ["oem", "nr_oryg", "katalog_obcy", "stare_sku"];
