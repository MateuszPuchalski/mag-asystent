import type {
  Akcja, Kategoria, Pewnosc, Rozmowa, StatusRozmowy, ZrodloZakonczenia } from "../api/typy";

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

/* ── POWODY PROBLEMU Z ZAKUPEM ──────────────────────────────────────────────
   `subType` wątku `POST_PURCHASE_ISSUE` z Centrum Wiadomości: dziesięć
   wartości ze schematu `beta.v1` w `docs/allegro/swagger.yaml`. Klucze
   zostają angielskie w API, na ekran idzie polszczyzna — jak przy `NAZWA`.

   Słownik jest OTWARTY, jak `NAZWA_KODU`, bo Allegro dokłada wartości bez
   zapowiedzi. Nieznanej nie tłumaczymy. Zgadnięty powód kierowałby pierwszym
   ruchem agenta, a surowy klucz w dymku da się sprawdzić w specyfikacji. */
export const POWOD_PROBLEMU_ZAKUPU: Record<string, string> = {
  PRODUCT_INCONSISTENT_WITH_THE_OFFER: "towar niezgodny z ofertą",
  PRODUCT_ARRIVED_DAMAGED: "towar dotarł uszkodzony",
  DEFECT_DETECTED_DURING_USE: "wada wykryta w użyciu",
  NO_PRODUCT_IN_THE_SHIPMENT: "brak towaru w przesyłce",
  MISSING_PRODUCT_ELEMENTS: "brak elementów towaru",
  OTHER: "inny problem",
  NO_REFUND: "brak zwrotu pieniędzy",
  SELLER_DOES_NOT_WANT_TO_ACCEPT_RETURN: "sprzedawca nie przyjmuje zwrotu",
  PROBLEM_WITH_SENDING_PRODUCT_BACK: "problem z odesłaniem towaru",
  NO_DOCUMENTATIONS: "brak dokumentów",
};

/* Dymek mówi, CZYJA to sprawa. Bez niego znacznik czytałby się jak nasza
   flaga, którą da się zdjąć — a sprawę zakłada kupujący, nie biuro. */
const DYMEK_PROBLEMU =
  "Sprawa założona przez kupującego w Centrum Wiadomości Allegro. Allegro może do niej dołączyć.";

/** Zdanie do dymku przy wątku zamkniętym. Wspólne dla kolejki i nagłówka rozmowy. */
export const DYMEK_ZAMKNIETEGO_PROBLEMU = "Allegro zamknęło ten wątek i nie przyjmie w nim nowej wiadomości.";

/**
 * Problem z zakupem słowami: powód po polsku (`null`, gdy brak albo spoza
 * słownika) i treść dymku. Jedna funkcja dla kolejki i nagłówka, żeby oba
 * miejsca nazywały ten sam wątek tymi samymi słowami.
 */
export function opisProblemuZakupu(p: NonNullable<Rozmowa["problemZakupu"]>): {
  powod: string | null; dymek: string;
} {
  if (p.powod === null) return { powod: null, dymek: DYMEK_PROBLEMU };
  /* `hasOwnProperty`, nie samo `[klucz]`: klucz przychodzi z zewnątrz,
     a `constructor` czy `toString` znalazłyby coś w prototypie. */
  if (Object.prototype.hasOwnProperty.call(POWOD_PROBLEMU_ZAKUPU, p.powod)) {
    return { powod: POWOD_PROBLEMU_ZAKUPU[p.powod], dymek: DYMEK_PROBLEMU };
  }
  return { powod: null, dymek: `${DYMEK_PROBLEMU} Powód od Allegro spoza słownika: ${p.powod}.` };
}

/* KATEGORIE klasyfikatora (specyfikacja z 20 września 2026). Ta sama zasada,
   co przy `NAZWA`: `Record<Kategoria, string>` NIE SKOMPILUJE SIĘ, gdy
   dojdzie szesnasta kategoria bez nazwy dla człowieka. Nazwy są krótkie, bo
   stoją na plakietce wiersza kolejki, a wiersz ma pokazywać pytanie klienta.

   „Dobór" zostaje nazwą `PRODUCT_COMPATIBILITY`, bo tak tę sprawę nazywa
   całe biuro. */
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

/* Kody przewoźnika słowem, z perspektywy KLIENTA, bo paczka jedzie do niego.
   Słownik zwrotów mówi „w drodze do nas" i tu dałby zdanie odwrotne. Jeden
   słownik dla streszczenia wiersza „Zamówienie", soczewki i bloku paczki:
   trzy kopie rozjechałyby się przy pierwszym nowym kodzie. Nieznany kod
   stoi surowy, jak u przewoźnika. */
export const STATUS_PACZKI: Record<string, string> = {
  PENDING: "czeka na nadanie",
  IN_TRANSIT: "w drodze do klienta",
  RELEASED_FOR_DELIVERY: "wydana do doręczenia",
  AVAILABLE_FOR_PICKUP: "czeka w punkcie odbioru",
  NOTICE_LEFT: "awizo — nieudana próba doręczenia",
  ISSUE: "problem z przesyłką",
  RETURNED: "wraca do nadawcy",
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
