/* ── Słownik decyzji klasyfikatora (specyfikacja z 20 września 2026) ────────

   Jedno źródło dla kategorii, następnych kroków i kodów polityki. Czyta go
   serwis, adapter dostawcy i test; panel trzyma LUSTRO w `api/typy.ts`, a
   `Record<Kategoria, string>` z nazwami po polsku nie skompiluje się bez
   kompletu (ta sama zasada co przy ośmiu kategoriach 0.191.0).

   WARTOŚCI SĄ PO ANGIELSKU I TO JEST WYJĄTEK OD JĘZYKA REPO. Specyfikacja
   nazywa je kontraktem niezależnym od dostawcy: te same wartości ma oddać
   Claude dziś i Jev jutro, a raport porównawczy zestawi je znak w znak.
   Polska nazwa dla człowieka mieszka na ekranie, nie w danych.

   Priorytetu 1–5 ze specyfikacji NIE MA — decyzja właściciela z 22 września
   2026. Kolejność kolejki stoi na faktach (flaga „pilne", czas czekania,
   terminy), a przypuszczenie maszyny jej nie przestawia (§14.5).            */

/**
 * Wersja słownika. Zapisuje się przy KAŻDEJ decyzji, bo pomiar trafności
 * porównuje wyłącznie decyzje jednego słownika — etykieta „dobor" z ośmiu
 * kategorii nie jest ani trafieniem, ani pudłem wobec piętnastu.
 */
export const TAKSONOMIA_WERSJA = "v2";

/** Wersja reguł z `klasyfikacja-polityka.ts`. Zmiana reguły podnosi numer. */
export const POLITYKA_WERSJA = "p1";

/**
 * Piętnaście kategorii ze specyfikacji. Granice między nimi stoją w
 * instrukcji dla modelu (`adapters/copilot.anthropic.ts`); tu jest tylko lista.
 *
 * Granica najważniejsza dla tej firmy: część dostarczona zgodnie z zamówieniem,
 * która nie pasuje do maszyny, to `PRODUCT_COMPATIBILITY`, a nie
 * `WRONG_PRODUCT`. Pierwsze jest pytaniem o dobór, drugie — o naszą pomyłkę.
 */
export const KATEGORIE = [
  "ORDER_STATUS", "DELIVERY_DELAY", "DELIVERY_LOST", "DELIVERY_DAMAGED",
  "PRODUCT_COMPATIBILITY", "PRODUCT_QUESTION", "PRODUCT_AVAILABILITY",
  "WRONG_PRODUCT", "MISSING_PRODUCT", "DAMAGED_PRODUCT",
  "RETURN", "COMPLAINT", "CANCEL_ORDER", "INVOICE", "OTHER",
] as const;
export type Kategoria = (typeof KATEGORIE)[number];

/**
 * Następny użyteczny krok. NIE jest pozwoleniem na wykonanie — specyfikacja
 * mówi to wprost, a panel żadnej z tych akcji sam nie uruchamia.
 */
export const AKCJE = [
  "GET_ORDER", "GET_SHIPMENT", "GET_PRODUCT", "CHECK_COMPATIBILITY", "CHECK_STOCK",
  "START_RETURN", "START_COMPLAINT", "ASK_FOR_MACHINE_MODEL", "ASK_FOR_PART_NUMBER",
  "ASK_FOR_PHOTO", "HUMAN_REVIEW", "NO_ACTION",
] as const;
export type Akcja = (typeof AKCJE)[number];

/**
 * Pewność zgłoszona przez model. Trzy słowa, nie procent — i ekran nie udaje,
 * że to prawdopodobieństwo trafienia. Specyfikacja zastrzega to samo o
 * „confidence" Jeva: miarą trafności jest dopiero porównanie z człowiekiem.
 */
export const PEWNOSCI = ["wysoka", "srednia", "niska"] as const;
export type Pewnosc = (typeof PEWNOSCI)[number];

/**
 * Powód kategorii `OTHER`, podawany przez model. Dwa różne kosze z 0.191.0
 * przeżywają tu jako kod: „słownik za krótki" i „za mało treści" wołają
 * o dwie różne naprawy, a zlane w jedno `OTHER` zabrałyby pomiarowi połowę.
 */
export const POWODY_INNE = ["poza_slownikiem", "za_malo_tresci"] as const;
export type PowodInne = (typeof POWODY_INNE)[number];

export const ZRODLA = ["ALLEGRO_MAPPING", "MODEL", "FALLBACK"] as const;
export type Zrodlo = (typeof ZRODLA)[number];

export const STATUSY = ["SUCCESS", "FAILED", "NEEDS_REVIEW"] as const;
export type StatusDecyzji = (typeof STATUSY)[number];

/**
 * Kody reguł, które coś zmieniły w decyzji. Każdy mówi, DLACZEGO rozmowa
 * dostała „wymaga człowieka" albo inną akcję niż podał model — bez kodu
 * nadpisanie byłoby nie do odróżnienia od zdania modelu.
 */
export const KODY = {
  prosbaOCzlowieka: "PROSBA_O_CZLOWIEKA",
  modelZadaCzlowieka: "MODEL_ZADA_CZLOWIEKA",
  niskaPewnosc: "NISKA_PEWNOSC",
  kategoriaInne: "KATEGORIA_OTHER",
  tylkoZalacznik: "TYLKO_ZALACZNIK",
  niespojna: "NIESPOJNA_ODPOWIEDZ",
  akcjaReczna: "AKCJA_RECZNA",
  bladModelu: "BLAD_MODELU",
  bladMaskowania: "BLAD_MASKOWANIA",
  niepoprawna: "NIEPOPRAWNA_ODPOWIEDZ",
  sporZAllegro: "SPOR_Z_ALLEGRO",
  podtypNieznany: "PODTYP_NIEZNANY",
  typNieznany: "TYP_NIEZNANY",
} as const;

/** Tryb wysyłki. Dziś jedyny: każda odpowiedź przechodzi przez człowieka (§27, punkt 2). */
export const TRYB = "HUMAN_APPROVED";

export const czyKategoria = (v: unknown): v is Kategoria =>
  typeof v === "string" && (KATEGORIE as readonly string[]).includes(v);
export const czyAkcja = (v: unknown): v is Akcja =>
  typeof v === "string" && (AKCJE as readonly string[]).includes(v);
