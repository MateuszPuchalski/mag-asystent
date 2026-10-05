import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { BladOdpowiedziCopilota } from "../adapters/copilot.js";
import { logEvent } from "./events.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import {
  zamaskujWatek, zostalyDaneOsobowe, type TrescBezpieczna, type WiadomoscWatku,
} from "./copilot-maskowanie.js";
import type { Tokeny } from "./copilot-koszt.js";
import { kartotekaOferty } from "./dopasowanie-sku.js";
import { dociagnijTresc } from "./allegro-oferta-tresc.js";
import { buildProductCard } from "./stock.js";
import { podzielStopke } from "./stopka.js";
import { LIMIT_ZNAKOW } from "./wysylka.js";
import { bezPodpisu, zwin } from "../tekst.js";
import { TAKSONOMIA_WERSJA } from "./klasyfikacja-slownik.js";
import { wzorzecOdpowiedzi } from "./wzorce-odpowiedzi.js";
import { numerZamowieniaRozmowy } from "./zamowienia-kandydaci.js";
import {
  idZamowienia, przesylkaDoOdswiezenia, przesylkaZamowienia, sprawdzPrzesylke, zdaniePrzesylki,
  type PrzesylkaDeps,
} from "./przesylka-zamowienia.js";
import { config } from "../config.js";
import { ofertyPoSygnaturze, type LinkDoOferty } from "./allegro-oferty-po-sygnaturze.js";
import {
  przygotujZdjeciaRozmowy, spisZdjec, type Pobieracz, type WynikZdjec, type ZdjecieZBramki,
} from "./copilot-zdjecia.js";
import { faktZwrotu, zdarzeniaZwrotowRozmowy } from "./zwrot-na-osi.js";
import { ocenRealizacji, stanRealizacji } from "./realizacja-zamowienia.js";
import { odswiezZamowienie } from "./allegro-zamowienia-sync.js";

/* ── Copilot: szkic odpowiedzi z faktów (§14.6, etap F, przyrost drugi) ──────

   Decyzja właściciela z 7 września 2026: „w oknie odpowiedzi powinien być
   guzik, który konstruuje odpowiedź z pomocą AI, kartotek etc." Każde
   twierdzenie ma podpisane źródło, brak trafienia to puste pole, a nie
   zgadywanie.

   Stąd podział ról, który jest całą treścią tego pliku:
   - SERWER układa FAKTY (F1, F2, …) z kartoteki, oferty, rozpoznania,
     przesyłki i zwrotu, czyli z danych, które już ma.
   - MODEL pisze prozę z faktów i cytuje ich identyfikatory.
   - SERWER SPRAWDZA wynik deterministycznie: każdy numer w szkicu musi stać
     w faktach albo w rozmowie, inaczej szkic jest odrzucony. Zła proza kosztuje
     „brzmi nieładnie"; wymyślony numer kosztowałby zwrot — i tego drugiego
     kod nie przepuszcza niezależnie od tego, jak dobry jest prompt.

   Propozycja NIE trafia do `conversation_draft`: tam mieszka szkic agenta
   pilnowany przez `conversation.version` (blizna 409 w trakcie pisania). Wraca
   jako osobny wiersz i do szkicu wchodzi na jawne kliknięcie — polityka
   danych skrzynki: „wynik nie staje się odpowiedzią sam".                    */

export type RodzajFaktu =
  | "oferta" | "kartoteka" | "intake"
  /* Treść oferty (0.253.0). TRZY rodzaje, nie jeden, bo mają różną wagę:
     parametr stoi w polu formularza, zgodność na liście Allegro, a opis to
     proza sprzedawcy, w której wymiar bywa sprzed dwóch wersji towaru. */
  | "oferta_opis" | "oferta_parametry" | "oferta_zgodnosc"
  /* Adres NASZEJ aktywnej aukcji na daną kartotekę (0.270.0). Osobny rodzaj,
     bo to jedyny fakt, który model ma prawo przepisać klientowi DOSŁOWNIE —
     reszta jest materiałem na zdanie, a link jest linkiem albo niczym. */
  | "oferta_link"
  /* Rozpoznanie klasyfikatora (22 września 2026): o co klient prosi i jaki
     jest następny krok. Osobny rodzaj, bo to jedyny fakt, który jest
     PRZYPUSZCZENIEM automatu, a nie danymi firmy — model ma go użyć do
     wyboru tematu odpowiedzi, nie cytować jako prawdy. */
  | "rozpoznanie"
  /* Stan paczki zamówienia rozmowy (23 września 2026). Osobny rodzaj, bo
     niesie datę sprawdzenia: to stan z chwili pytania Allegro, nie z chwili
     czytania szkicu, i model ma go podać jako taki. */
  | "przesylka"
  /* Kamienie milowe zwrotu tego zamówienia (0.502.0) — `zwrot-na-osi.ts`.
     Osobny rodzaj z tego samego powodu co przesyłka: to stan z naszego
     systemu z datą, a nie obietnica, i model ma go podać jako taki. */
  | "zwrot"
  /* Realizacja zamówienia przed nadaniem (`realizacja-zamowienia.ts`):
     płatność, termin nadania, dokument z Subiekta i werdykt „wyślemy dziś".
     Osobny rodzaj, bo jako jedyny niesie gotowe zdanie dla klienta o terminie. */
  | "realizacja";

export interface Fakt { id: string; rodzaj: RodzajFaktu; zdanie: string }

/**
 * Kategorie, przy których szkic pyta o dane maszyny i części (intake).
 * `WRONG_PRODUCT` jest na liście, bo „przyszło co innego" rozstrzyga się
 * porównaniem numerów i danych z tabliczki.
 */
const KATEGORIE_Z_INTAKE = new Set<string>([
  "PRODUCT_COMPATIBILITY", "PRODUCT_QUESTION", "PRODUCT_AVAILABILITY", "WRONG_PRODUCT",
]);

/**
 * Fakty w kształcie do wysyłki. Typ OZDOBIONY jak `TrescBezpieczna`, ale
 * z INNEGO powodu: fakty nie przechodzą przez `zamaskuj()`, bo reguła „dziewięć
 * cyfr to telefon" zjadłaby numery OEM — dokładnie te dane, które szkic ma
 * cytować. Bezpieczeństwo bierze się z KONSTRUKCJI: fakty składa TEN PLIK z własnych
 * danych firmy, bez tekstu klienta, bez półki, bez nazwiska pracownika.
 * Składają je dwa miejsca i oba są tutaj: `kontekstSzkicu()` (czysty odczyt)
 * oraz `dopiszLinkiOfert()` (0.270.0), które dokłada adresy naszych aktywnych
 * aukcji — jedyny fakt wymagający sieci, więc jedyny, którego czysty odczyt
 * nie mógł zebrać. Producentem tego typu jest ten jeden plik.
 */
export type FaktyBezpieczne = string & { readonly __fakty: unique symbol };

export interface KontekstSzkicu {
  fakty: Fakt[];
  tekstFaktow: FaktyBezpieczne;
  watek: TrescBezpieczna;
  /** Ostatnia wiadomość KLIENTA — na niej liczymy świeżość propozycji. */
  ostatniaWiadomoscId: number | null;
  /** Aktywna decyzja klasyfikatora, której fakt wszedł do szkicu; `null` — bez rozpoznania. */
  decyzjaId: number | null;
  /**
   * Kartoteki, które serwer sam położył w faktach; dziś to kartoteka oferty.
   * Klucz to `zwin(symbol)`. Po linki do naszych aukcji pytamy wyłącznie
   * o nie, nigdy o symbol z treści wiadomości: klient nie wybiera, o co
   * pytamy Allegro.
   */
  kartoteki: Map<string, Kartoteka>;
}

/** Kartoteka w faktach: tyle, ile trzeba, żeby ją nazwać i znaleźć jej aukcję. */
export interface Kartoteka { twId: number; symbol: string; nazwa: string }

/* ── SKĄD MODEL TO WIE (0.253.0) ─────────────────────────────────────────────
   Do 0.252.0 reguła brzmiała „nie znasz dopasowań z pamięci", a `numery
   SpozaFaktow` odrzucał CAŁY szkic za jeden numer spoza faktów. Właściciel
   zdjął ten zakaz i postawił w jego miejsce warunek: „pełna swoboda, ale niech
   przy tym załącza źródła, sztywno oceniany poziom pewności".

   Zamiana zakazu na RACHUNEK. Model wolno korzysta z własnej wiedzy, ale
   każde twierdzenie techniczne musi stanąć na liście z podpisem, skąd je ma.
   Zdanie bez wpisu dalej wywraca szkic — bo szkic, którego nie da się
   sprawdzić, kosztuje dokładnie tyle, co szkic zmyślony.                    */

/** Skąd wzięło się twierdzenie. Kolejność ma znaczenie: od najmocniejszego. */
export const ZRODLA_TWIERDZENIA = ["fakty", "oferta", "zdjecie", "model"] as const;
export type ZrodloTwierdzenia = (typeof ZRODLA_TWIERDZENIA)[number];

/** Ile temu twierdzeniu wolno ufać. Też od najmocniejszej. */
export const POZIOMY_PEWNOSCI = ["pewne", "prawdopodobne", "niepewne"] as const;
export type PoziomPewnosci = (typeof POZIOMY_PEWNOSCI)[number];

/**
 * SUFIT PEWNOŚCI NA ŹRÓDŁO — i to jest cała „sztywność" oceny.
 *
 * Model deklaruje pewność sam, ale nie może się nią wywyższyć ponad źródło,
 * z którego czerpie. Bez sufitu ocena byłaby jego zdaniem o sobie samym:
 * „pewne", bo brzmi pewnie. Z sufitem jest funkcją tego, na czym stoi.
 *
 * `fakty` — nasza baza: kartoteka, stan, zamówienia, przesyłka. Wolno „pewne".
 * `oferta` — słowa sprzedawcy sprzed lat; najwyżej „prawdopodobne", bo towar
 *   u dostawcy zmienia się bez zmiany opisu.
 * `zdjecie` — odczytane z fotografii przysłanej przez klienta; najwyżej
 *   „prawdopodobne", i to z DWÓCH niezależnych powodów. Pierwszy jest banalny:
 *   litery na tabliczce mylą się z cyframi, a zdjęcie bywa nieostre. Drugi
 *   jest poważniejszy i nie znika przy idealnej ostrości — z tego, że na
 *   zdjęciu widać tabliczkę, NIE wynika, że to tabliczka maszyny, o którą
 *   klient pyta. Zdjęcie bywa z internetu, z maszyny sąsiada albo z drugiej
 *   kosiarki w garażu. „Pewne" zostaje dla naszej bazy.
 * `model` — wiedza własna modelu, bez pokrycia w naszych danych; „niepewne"
 *   i ani stopnia wyżej. To nie jest opinia o modelu, tylko o tym, że nikt
 *   tego u nas nie sprawdził.
 *
 * W dół model może zawsze — kto sam mówi „nie jestem pewien", ten mówi prawdę,
 * której nie mamy powodu poprawiać.
 */
const SUFIT_PEWNOSCI: Record<ZrodloTwierdzenia, PoziomPewnosci> = {
  fakty: "pewne", oferta: "prawdopodobne", zdjecie: "prawdopodobne", model: "niepewne",
};

/** Twierdzenie tak, jak oddał je model — przed obcięciem pewności do sufitu. */
export interface TwierdzenieSurowe {
  teza: string;
  zrodlo: ZrodloTwierdzenia;
  /** `F3`, nazwa parametru z oferty albo `null`, gdy model mówi z siebie. */
  odwolanie: string | null;
  pewnosc: PoziomPewnosci;
}

/** Twierdzenie po ocenie serwera. `obnizona` = model chciał wyżej, niż wolno. */
export interface Twierdzenie extends TwierdzenieSurowe { obnizona: boolean }

/**
 * Sztywna ocena pewności: bierze niższą z dwóch — deklarowanej i sufitu źródła.
 * Zwraca też, czy trzeba było obniżyć, bo to jest miara warta dziennika:
 * model, który regularnie zawyża, mówi coś o sobie.
 */
export function ustalPewnosc(t: TwierdzenieSurowe): Twierdzenie {
  const sufit = SUFIT_PEWNOSCI[t.zrodlo];
  const wyzej = POZIOMY_PEWNOSCI.indexOf(t.pewnosc) < POZIOMY_PEWNOSCI.indexOf(sufit);
  return { ...t, pewnosc: wyzej ? sufit : t.pewnosc, obnizona: wyzej };
}

/**
 * Twierdzenie oparte na fakcie „rozpoznanie" schodzi do „niepewne" ze
 * źródłem `model` (22 września 2026). Rozpoznanie jest przypuszczeniem
 * klasyfikatora — model, który powoła się na nie jak na bazę sklepu,
 * dostałby sufit „pewne" za zgadywanie automatu. Instrukcja zabrania takiego
 * powołania, ale sufit pewności stoi w kodzie, nie w dyscyplinie modelu.
 */
export function zRozpoznaniaNiepewne(tw: Twierdzenie[], fakty: Fakt[]): Twierdzenie[] {
  const zRozpoznania = new Set(fakty.filter((f) => f.rodzaj === "rozpoznanie").map((f) => f.id));
  return tw.map((t) => t.odwolanie && zRozpoznania.has(t.odwolanie)
    ? { ...t, zrodlo: "model" as const, pewnosc: "niepewne" as const, obnizona: t.pewnosc !== "niepewne" }
    : t);
}

/**
 * Twierdzenia po ocenie. Wpis bez tezy wypada — pusty wiersz w oknie „skąd to
 * wiem" byłby gorszy niż jego brak, bo wygląda na urwaną informację.
 */
export function ocenTwierdzenia(surowe: TwierdzenieSurowe[]): Twierdzenie[] {
  return surowe.filter((t) => t.teza.trim()).map(ustalPewnosc);
}

/* ── ODCZYT ZE ZDJĘCIA: PO CO OSOBNE POLE ───────────────────────────────────
   Bez niego zdjęcia do szkicu WŁOŻYĆ SIĘ NIE DA, i nie jest to kwestia formy.
   `numerySpozaFaktow` odrzuca szkic, w którym stoi numer nieobecny w faktach
   ani w wątku. Tabliczka znamionowa to sama numeracja: „PBRM 39 E4", „131",
   numer seryjny. Model, który ją poprawnie odczyta i użyje, wywróciłby własny
   szkic — każde UDANE odczytanie kasowałoby swój wynik.

   Pole jest więc DEKLARACJĄ: model przepisuje, co widzi, przy numerze zdjęcia,
   a serwer dopiero potem uznaje ten tekst za materiał, z którego wolno cytować.
   Kolejność ma znaczenie — najpierw sprawdzamy, czy `Zn` jest zdjęciem, które
   NAPRAWDĘ wysłaliśmy. Inaczej pole byłoby furtką: dopisz zmyślony odczyt
   i przemyć nim dowolny numer obok kontroli.

   Agent widzi odczyt obok miniatury i rozstrzyga jednym spojrzeniem, czy model
   przeczytał tabliczkę, czy ją sobie wyobraził.                              */

/** Co model odczytał z jednego zdjęcia. `zdjecie` to `Z1`, `Z2` — sprawdzane. */
export interface OdczytZdjecia {
  zdjecie: string;
  tekst: string;
}

/** Surowa odpowiedź modelu. Walidacja jest niżej, w `ulozSzkic`. */
export interface OdpowiedzSzkicu {
  tresc: string;
  uzyteFakty: string[];
  zastrzezenia: string[];
  /**
   * Skąd model wie to, co napisał (0.253.0). Surowe — pewność obcina do sufitu
   * źródła `ocenTwierdzenia`, nie adapter. Pusta lista przy nadawcy-atrapie.
   */
  twierdzenia: TwierdzenieSurowe[];
  /**
   * Co model odczytał ze zdjęć rozmowy. Pusta lista przy nadawcy-atrapie
   * i wtedy, gdy zdjęć nie było — obie sytuacje wyglądają tu tak samo,
   * bo dla walidacji znaczą to samo: nie ma się na co powołać.
   */
  odczytZeZdjec: OdczytZdjecia[];
  model: string;
  zuzycie: Tokeny;
  ms: number;
}

/**
 * Wysyłka do dostawcy — wstrzykiwana, jak `NadawcaKlasyfikacji`. Dwa argumenty,
 * dwa zamki: wątek musi być `TrescBezpieczna` (tylko `zamaskuj*`), fakty muszą
 * być `FaktyBezpieczne` (tylko ten plik). Goły `string` nie wejdzie żadną
 * z tych dróg nawet przez pomyłkę.
 */
export type NadawcaSzkicu = (
  watek: TrescBezpieczna, fakty: FaktyBezpieczne, zdjecia?: ZdjecieZBramki[],
) => Promise<OdpowiedzSzkicu>;

export const OCENY_SZKICU = ["wstawiony", "zastapiony", "odrzucony"] as const;
export type OcenaSzkicu = (typeof OCENY_SZKICU)[number];

export interface SzkicCopilota {
  tresc: string;
  zastrzezenia: string[];
  uzyteFakty: string[];
  messageId: number | null;
  model: string;
  at: string;
  przez: string;
  ocena: OcenaSzkicu | null;
  /**
   * SKĄD MODEL TO WIE (0.253.0) — po ocenie serwera, czyli z pewnością już
   * obciętą do sufitu źródła. Panel pokazuje tę listę agentowi OBOK szkicu:
   * tekst dla klienta ma być gładki, a rachunek za niego stoi osobno.
   * Pusta lista przy szkicach sprzed tego wydania — i to o nich prawda.
   */
  twierdzenia: Twierdzenie[];
  /**
   * CO MODEL ODCZYTAŁ ZE ZDJĘĆ — dla agenta, obok miniatur.
   *
   * Pusta lista znaczy jedno z trojga i ekran nie ma jak ich rozróżnić, bo
   * i nie musi: rozmowa nie miała zdjęć, zdjęcia nie przeszły bramki albo
   * model niczego na nich nie odczytał. We wszystkich trzech przypadkach nie
   * ma się na co powołać, a to jest jedyne, co z tego pola wynika.
   */
  odczytZeZdjec: OdczytZdjecia[];
}

/* ── Pytania z intake per typ części (krytyka właściciela, punkt 4) ──────────
   Kupujący nie pisze „OEM 17211-ZL8-023". Pisze „mam kosiarkę z Castoramy,
   jaki filtr". Gdy fakty nie dają odpowiedzi, szkic ma zadać DOKŁADNIE te
   pytania, a nie ogólne „proszę o więcej danych". Słownik jest KODEM, nie
   promptem: biuro dopisze typ części bez dotykania instrukcji modelu.      */
const INTAKE: Array<{ typ: string; slowa: RegExp; pytania: string[] }> = [
  { typ: "nóż", slowa: /\bn[oó]ż|no[zż]e|ostrz/i, pytania: [
    "długość całkowita noża", "średnica otworu centralnego",
    "liczba i rozstaw otworów dodatkowych", "kształt: prosty, mulczujący czy z podniesionymi skrzydłami",
    "grubość", "zdjęcie starego noża na tle linijki" ] },
  { typ: "pasek", slowa: /\bpas(ek|ka|ki|kiem)\b/i, pytania: [
    "profil paska (Z/A/B, 3L/4L/5L, SPZ)", "długość zewnętrzna La albo wewnętrzna Li",
    "zwykły klinowy czy aramidowy (kevlar)", "ile pasków w komplecie" ] },
  { typ: "filtr", slowa: /\bfiltr/i, pytania: [
    "wymiary długość × szerokość × wysokość", "kształt: płaski, okrągły czy owalny",
    "papierowy czy piankowy", "z filtrem wstępnym czy bez", "zdjęcie tabliczki znamionowej silnika" ] },
  { typ: "linka", slowa: /\blink[aiąę]\b|cięgn/i, pytania: [
    "długość pancerza", "długość rdzenia", "rodzaj końcówek",
    "zdjęcie starej linki na tle linijki z widocznymi końcówkami" ] },
  { typ: "rozrusznik", slowa: /rozruszn|spręż/i, pytania: [
    "średnica bębna", "kierunek nawinięcia", "zdjęcie tabliczki znamionowej silnika" ] },
  { typ: "gaźnik lub uszczelka", slowa: /ga[zź]nik|uszczelk|membran/i, pytania: [
    "symbol gaźnika z jego korpusu albo tabliczki silnika",
    "pozycja uszczelki: od strony filtra, od strony kolektora czy między dystansem",
    "zdjęcie starej części" ] },
];

const PYTANIA_OGOLNE = [
  "marka i model maszyny z tabliczki znamionowej", "model silnika, jeśli maszyna go ma osobno",
  "zdjęcie starej części na tle linijki",
];

export function pytaniaIntake(nazwaCzesci: string | null): { typ: string; pytania: string[] } {
  const n = (nazwaCzesci ?? "").trim();
  const w = n ? INTAKE.find((i) => i.slowa.test(n)) : undefined;
  return w ? { typ: w.typ, pytania: w.pytania } : { typ: "część", pytania: PYTANIA_OGOLNE };
}

/**
 * Odwołania do faktów „(F3)", „(F1, F2)" znikają z treści PO sprawdzeniu.
 * Model ma je pisać — to na nich stoi kontrola pokrycia — ale klient nie ma
 * ich czytać. Na zrzucie właściciela (8.09.2026) stały w szkicu gotowym do
 * wstawienia. `uzyteFakty` zostaje w wierszu jako ślad dla pomiaru.
 */
export function bezZnacznikow(tresc: string): string {
  return tresc
    .replace(/\s*\(\s*F\d+(?:\s*,\s*F\d+)*\s*\)/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1");
}

/* Kształt numeru części: litery i cyfry z myślnikiem albo ukośnikiem, co
   najmniej cztery znaki, co najmniej jedna cyfra. Łapie `W09-0211`, `GX160`,
   `17211-ZL8-023`, `5901234567890`; nie łapie „148 mm" ani słów bez cyfr. */
const NUMER = /\b[A-Z0-9][A-Z0-9\-\/]{3,}\b/gi;

/** Numery ze szkicu, których NIE MA ani w faktach, ani w rozmowie. */
export function numerySpozaFaktow(tresc: string, dozwolone: string): string[] {
  const korpus = dozwolone.toUpperCase();
  const obce = new Set<string>();
  for (const m of tresc.match(NUMER) ?? []) {
    if (!/\d/.test(m)) continue;
    if (!korpus.includes(m.toUpperCase())) obce.add(m);
  }
  return [...obce];
}

/**
 * Numery, których model użył NIE DEKLARUJĄC, skąd je ma (0.253.0).
 *
 * Następca zakazu z 0.252.0. Tamten odrzucał szkic za każdy numer spoza
 * faktów; ten odrzuca za numer, którego nie pokrywa żadne twierdzenie ze
 * źródłem `model`. Różnica jest cała: model wolno powiedzieć „to zwykle
 * ma numer 503 28 32-08", ale musi się pod tym podpisać, a agent musi to
 * zobaczyć w oknie „skąd to wiem", zanim wyśle.
 *
 * Porównanie po `zwin`: „503 28 32-08" w szkicu i „503283208" w tezie to
 * ten sam numer, a różnica w spacjach nie jest powodem do odrzucenia
 * dobrego szkicu.
 */
export function numeryNiezadeklarowane(
  tresc: string, dozwolone: string, twierdzenia: TwierdzenieSurowe[],
): string[] {
  /* `zdjecie` obok `model`: jedno i drugie znaczy „wiem to spoza naszej bazy,
     i mówię skąd". Różnią się sufitem pewności, nie prawem do numeru. */
  const zWiedzy = twierdzenia
    .filter((t) => t.zrodlo === "model" || t.zrodlo === "zdjecie")
    .map((t) => zwin(t.teza).toUpperCase())
    .join(" ");
  return numerySpozaFaktow(tresc, dozwolone)
    .filter((n) => !zWiedzy.includes(zwin(n).toUpperCase()));
}

/** Oferta, o którą chodzi: ręczne wskazanie bije numer z wiadomości. */
function ofertaRozmowy(database: DatabaseSync, conversationId: number): { konto: number; ofertaId: string } | null {
  const konto = database.prepare("SELECT channel_account_id AS konto FROM conversation WHERE id=?")
    .get(conversationId) as { konto: number } | undefined;
  if (!konto) throw new Error("Nie znaleziono rozmowy");
  const reczna = database.prepare(`SELECT payload FROM conversation_event
    WHERE conversation_id=? AND event_type='offer_linked_manually' ORDER BY id DESC LIMIT 1`)
    .get(conversationId) as { payload: string | null } | undefined;
  if (reczna?.payload) {
    const p = JSON.parse(reczna.payload) as { ofertaId?: string };
    if (p.ofertaId) return { konto: Number(konto.konto), ofertaId: p.ofertaId };
  }
  /* Ta sama reguła co w `osRozmowy`: numer z najnowszej wiadomości KLIENTA,
     a gdy klient go nie podał — z najnowszej naszej. Najnowszej PO CZASIE:
     `id` starych wierszy nie rośnie z czasem. */
  const m = database.prepare(`SELECT related_object_id AS oferta FROM message
    WHERE conversation_id=? AND related_object_type='OFFER' AND related_object_id IS NOT NULL
    ORDER BY (direction='incoming') DESC, sent_at DESC, id DESC LIMIT 1`)
    .get(conversationId) as { oferta: string } | undefined;
  return m ? { konto: Number(konto.konto), ofertaId: String(m.oferta) } : null;
}

/** Login rozmówcy z WĄTKU Allegro — nie z tematu, bo temat bywa tytułem oferty. */
function loginRozmowcy(conversationId: number): string | null {
  const w = db().prepare(`SELECT t.interlocutor_login AS login
      FROM conversation c JOIN allegro_inbox_thread t ON t.id = c.external_conversation_id
     WHERE c.id=?`).get(conversationId) as { login: string | null } | undefined;
  const l = String(w?.login ?? "").trim();
  return l || null;
}

/**
 * Ile znaków opisu oferty wchodzi do faktów.
 *
 * W bazie opis bywa na osiem tysięcy znaków (patrz `allegro-oferta-tresc.ts`),
 * a to jest tekst SPRZEDAŻOWY: gwarancja, wysyłka, „zapraszamy do zakupów".
 * Dane techniczne stoją zwykle na początku, więc bierzemy początek i mówimy
 * wprost, że reszta została ucięta — model, który nie wie o przycięciu,
 * odpowiada „w opisie nie ma", zamiast poprosić agenta o zajrzenie.
 */
const LIMIT_OPISU_W_FAKTACH = 1200;

/**
 * Ile pozycji listy zgodności wchodzi do faktów.
 *
 * Lista „pasuje do" bywa na setki wierszy (jeden na wersję silnika). Model
 * dostaje jej POCZĄTEK i informację o długości: „pasuje do 214 pozycji, oto
 * pierwsze 30" mówi mu prawdę, a wysłanie wszystkich 214 zjadłoby prompt
 * i utopiło w nim resztę faktów.
 */
const LIMIT_ZGODNOSCI = 30;

/**
 * Fakty z TREŚCI oferty (0.253.0): opis, parametry, lista zgodności.
 *
 * Właściciel: „często oferta ma w sobie opis, do jakich wersji pasuje, wymiary
 * z oferty, dane techniczne". To jest wiedza, którą sprzedawca już zapisał,
 * a Copilot do 0.252.0 odpowiadał bez niej.
 *
 * KAŻDY z tych faktów mówi o sobie, że pochodzi z OFERTY, a nie z kartoteki
 * — i to nie jest ozdoba zdania. Kartoteka Subiekta jest stanem magazynu
 * z dzisiaj; opis oferty bywa sprzed trzech lat i opisuje towar, który
 * dostawca w międzyczasie zmienił. Gdy się rozjeżdżają, rację ma kartoteka,
 * a model musi mieć z czego to poznać.
 *
 * Czysty ODCZYT ze snapshotu. Do sieci po treść idzie `ulozSzkic`, PRZED
 * złożeniem kontekstu — tu nie ma prawa być ani jednego żądania.
 */
function faktyZTresciOferty(
  database: DatabaseSync, konto: number, ofertaId: string,
  dodaj: (rodzaj: RodzajFaktu, zdanie: string) => void,
): void {
  const w = database.prepare(`SELECT opis, parametry_json, pasuje_do_json FROM offer_snapshot
      WHERE channel_account_id=? AND external_id=?`).get(konto, ofertaId) as
    { opis: string | null; parametry_json: string | null; pasuje_do_json: string | null } | undefined;
  if (!w) return;

  const parametry = czytajListe<{ nazwa: string; wartosci: string[] }>(w.parametry_json);
  if (parametry.length) {
    dodaj("oferta_parametry", "Parametry Z OFERTY (pola wypełnione przez sprzedawcę): "
      + parametry.map((p) => `${p.nazwa}: ${p.wartosci.join(", ")}`).join("; "));
  }

  const zgodnosc = czytajListe<string>(w.pasuje_do_json);
  if (zgodnosc.length) {
    const ile = zgodnosc.length;
    const pokazane = zgodnosc.slice(0, LIMIT_ZGODNOSCI);
    const ogon = ile > pokazane.length ? ` (lista ma ${ile} pozycji, to są pierwsze ${pokazane.length})` : "";
    dodaj("oferta_zgodnosc", `Lista zgodności Z OFERTY${ogon}: ${pokazane.join(" | ")}`);
  }

  const opis = (w.opis ?? "").trim();
  if (opis) {
    const przyciety = opis.slice(0, LIMIT_OPISU_W_FAKTACH);
    const ogon = przyciety.length < opis.length ? " […opis ucięty, dalszy ciąg w ofercie]" : "";
    dodaj("oferta_opis", `Opis oferty — SŁOWA SPRZEDAWCY, nie kartoteka; gdy przeczy `
      + `kartotece, rację ma kartoteka: ${przyciety}${ogon}`);
  }
}

/** Lista z kolumny JSON. Uszkodzony wpis to pusta lista, nie wywrócony szkic. */
function czytajListe<T>(json: string | null): T[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

const dostepnosc = (ile: number | null, jednostka: string | null) =>
  ile != null && ile > 0 ? `dostępne dziś: ${ile} ${jednostka ?? "szt."}` : "dziś brak na stanie";

/**
 * „Kiedy będzie" przy braku na stanie (0.502.0) — z zamówień u dostawcy.
 *
 * Serwer liczył to od dawna (`zamowioneUDostawcy`), ale widział to tylko
 * kolektor. Szkic przy braku towaru nie miał więc czego powiedzieć poza
 * „brak", a agent szedł po termin do Subiekta. Fakt stoi WYŁĄCZNIE przy braku:
 * przy towarze na półce pytanie o termin nie pada.
 *
 * Nazwy dostawcy i numeru dokumentu NIE ma — to nasza kuchnia, nie odpowiedź
 * dla klienta (ta sama zasada co półka w §10.4). Termin jest terminem
 * DOSTAWCY i fakt mówi to wprost, żeby szkic nie zamienił go w obietnicę.
 */
export function kiedyBedzie(
  karta: { mag: { avail: number }; unit: string | null; zamowione?: Array<{ termin: string | null; ilosc: number; szacunek: boolean }> },
): string | null {
  if (karta.mag.avail > 0) return null;
  const z = karta.zamowione ?? [];
  if (!z.length) return "brak otwartych zamówień u dostawcy — terminu nie znamy";
  const jedn = karta.unit ?? "szt.";
  /* Lista przychodzi posortowana po terminie, bez terminu na końcu. */
  const najblizsze = z[0];
  const ile = z.reduce((a, b) => a + b.ilosc, 0);
  const szac = z.some((w) => w.szacunek) ? "do " : "";
  return `zamówione u dostawcy: ${szac}${ile} ${jedn}`
    + (najblizsze.termin ? `, najbliższy termin dostawcy ${najblizsze.termin.slice(0, 10)}`
      : ", dostawca nie podał terminu")
    + " (termin dostawcy, nie obietnica dla klienta)";
}

/**
 * Fakty dla modelu — czysty ODCZYT, niczego nie zapisuje.
 *
 * Co świadomie NIE wchodzi: półka, rezerwacje, rozbicie na magazyny (§10.4 —
 * adres regału mówi obcemu, jak zbudowany jest magazyn), opis kartoteki
 * w całości (bywa notatką magazynu), historia zakupów klienta (§14.4).
 */
export function kontekstSzkicu(
  conversationId: number, subiekt: SubiektAdapter, teraz = new Date(),
): KontekstSzkicu {
  const wiadomosci = db().prepare(`SELECT id, direction, body FROM message
      WHERE conversation_id=? ORDER BY sent_at, id`).all(conversationId) as
    Array<{ id: number; direction: string; body: string | null }>;
  if (wiadomosci.length === 0) {
    throw new Error("Rozmowa nie ma żadnej wiadomości — nie ma na co odpowiadać");
  }
  const login = loginRozmowcy(conversationId);
  const watek: WiadomoscWatku[] = wiadomosci.map((m) => ({
    odKlienta: m.direction === "incoming",
    /* Stopka firmowa wycięta tą samą funkcją, którą czyta ją oś rozmowy —
       model nie ma się uczyć naszego podpisu, a znaki kosztują. */
    tresc: m.direction === "outgoing" ? podzielStopke(String(m.body ?? "")).tresc : String(m.body ?? ""),
  }));
  const ostatniaKlienta = [...wiadomosci].reverse().find((m) => m.direction === "incoming");

  const fakty: Fakt[] = [];
  const dodaj = (rodzaj: RodzajFaktu, zdanie: string) =>
    fakty.push({ id: `F${fakty.length + 1}`, rodzaj, zdanie: bezPodpisu(zdanie.replace(/\s+/g, " ").trim()) });
  /* Kartoteki z faktów zbiera ten sam przebieg, który układa fakty, bo drugi
     przebieg po to samo rozjechałby się z pierwszym. */
  const kartoteki = new Map<string, Kartoteka>();

  const oferta = ofertaRozmowy(db(), conversationId);
  let nazwaOferty: string | null = null;
  if (oferta) {
    const snap = db().prepare(`SELECT nazwa, sku FROM offer_snapshot
        WHERE channel_account_id=? AND external_id=?`).get(oferta.konto, oferta.ofertaId) as
      { nazwa: string; sku: string | null } | undefined;
    if (snap) {
      nazwaOferty = snap.nazwa;
      dodaj("oferta", `Oferta, o którą pyta klient: „${snap.nazwa}"`);
    }
    faktyZTresciOferty(db(), oferta.konto, oferta.ofertaId, dodaj);
    const k = kartotekaOferty(db(), oferta.konto, oferta.ofertaId, snap?.sku ?? undefined);
    if (k.twId !== null) {
      const karta = buildProductCard(subiekt, k.twId);
      if (karta) {
        kartoteki.set(zwin(karta.sym), { twId: k.twId, symbol: karta.sym, nazwa: karta.name });
        const numery = karta.identyfikatory.map((i) => i.wartosc).join(", ");
        dodaj("kartoteka", `Kartoteka oferty: ${karta.sym} — ${karta.name}; EAN ${karta.ean || "brak"};`
          + ` numery: ${numery || "brak"}; ${dostepnosc(karta.mag.avail, karta.unit)}`
          + `${kiedyBedzie(karta) ? `; ${kiedyBedzie(karta)}` : ""} (${k.zrodlo})`);
      }
    } else {
      dodaj("oferta", `Oferta bez kartoteki w Subiekcie: ${k.zrodlo}`);
    }
  }

  /* ROZPOZNANIE BIEŻĄCEJ PROŚBY (22 września 2026). Specyfikacja: szkic
     dostaje znormalizowaną decyzję klasyfikatora. Do tej wersji szkic był
     szyty pod dobór części i prosił o tabliczkę znamionową także klienta,
     który pytał, gdzie jest paczka. Decyzja NIEAKTUALNA (klient dopisał po
     rozpoznaniu) nie wchodzi — opisywałaby pytanie, którego już nie zadaje. */
  const rozpoznanie = ostatniaKlienta ? db().prepare(`SELECT id, kategoria, akcja, wymaga_czlowieka,
      brak_danych_zamowienia, brak_danych_produktu FROM decyzja_klasyfikacji
      WHERE message_id=? AND aktywna=1 AND taksonomia_wersja=?`)
    .get(ostatniaKlienta.id, TAKSONOMIA_WERSJA) as {
      id: number; kategoria: string; akcja: string; wymaga_czlowieka: number;
      brak_danych_zamowienia: number; brak_danych_produktu: number } | undefined : undefined;
  if (rozpoznanie) {
    dodaj("rozpoznanie", `Rozpoznanie bieżącej prośby klienta (automat, może się mylić): `
      + `${rozpoznanie.kategoria}; następny krok: ${rozpoznanie.akcja}`
      + (Number(rozpoznanie.brak_danych_zamowienia) ? "; w rozmowie brakuje danych zamówienia" : "")
      + (Number(rozpoznanie.brak_danych_produktu) ? "; w rozmowie brakuje danych towaru lub maszyny" : "")
      + (Number(rozpoznanie.wymaga_czlowieka)
        ? "; sprawa wymaga decyzji człowieka — nie obiecuj rozstrzygnięcia" : "")
      /* Wzorzec odpowiedzi dla TEJ kategorii (23 września 2026) — powód
         i treść w `wzorce-odpowiedzi.ts`. Stoi w tym samym fakcie, bo jest
         tak samo przypuszczeniem jak kategoria, z której wynika. */
      + (wzorzecOdpowiedzi(rozpoznanie.kategoria)
        ? `; jak odpowiedzieć: ${wzorzecOdpowiedzi(rozpoznanie.kategoria)}` : ""));
  }

  /* PRZESYŁKA, GDY KLIENT PISZE POD ZAMÓWIENIEM (23 września 2026). Fakt
     stoi przy każdej rozmowie z zamówieniem, nie tylko przy rozpoznaniu
     „gdzie paczka": pytanie o fakturę czy zwrot też bywa odpowiadane
     zdaniem „paczka jest jeszcze w drodze". Czytamy ZAPISANY stan — świeży
     dociąga `ulozSzkic`, bo ta funkcja zostaje czystym odczytem. */
  const numerZam = numerZamowieniaRozmowy(conversationId);
  const idZam = numerZam ? idZamowienia(db(), numerZam.konto, numerZam.externalId) : null;
  const paczka = idZam === null ? null : przesylkaZamowienia(db(), idZam);
  const zdanieP = paczka ? zdaniePrzesylki(paczka) : null;
  if (zdanieP) dodaj("przesylka", zdanieP);
  /* REALIZACJA PRZED NADANIEM. Stoi przy każdej rozmowie z zamówieniem, jak
     przesyłka: „czy wyjdzie dziś" pada też w wątku o fakturze. Po nadaniu
     milczy, bo wtedy odpowiada fakt o przesyłce. */
  const realizacja = idZam === null || !paczka ? null : stanRealizacji(
    idZam, paczka.waybill !== null || paczka.dostarczonoAt !== null, subiekt, db());
  const ocena = realizacja ? ocenRealizacji(realizacja, teraz) : null;
  if (ocena) dodaj("realizacja", ocena.zdanie);
  const zdanieZ = faktZwrotu(zdarzeniaZwrotowRozmowy(db(), conversationId));
  if (zdanieZ) dodaj("zwrot", zdanieZ);

  /* Intake tylko przy prośbie o TOWAR (22 września 2026): pytania o maszynę
     przy „gdzie paczka" odpowiadają na pytanie, którego klient nie zadał.
     Bez rozpoznania intake zostaje, bo szkic pod ofertą to najczęściej
     pytanie o część. Typ części czytamy z tytułu oferty: to jedyna nazwa
     części, którą serwer zna, a nie wymyśla. */
  const oTowar = !rozpoznanie || KATEGORIE_Z_INTAKE.has(rozpoznanie.kategoria);
  if (oTowar) {
    const i = pytaniaIntake(nazwaOferty);
    /* „TYLKO o to, czego jeszcze nie podał" stoi w FAKCIE, nie tylko w
       instrukcji (0.232.2): klientka podała komplet danych z tabliczki,
       a szkic poprosił o tabliczkę raz jeszcze, bo fakt brzmiał „zapytaj o…". */
    dodaj("intake", `Gdy fakty nie rozstrzygają, zapytaj klienta TYLKO o to, czego w rozmowie jeszcze nie podał`
      + ` (${i.typ}): ${i.pytania.join("; ")}; to, co już podał, potwierdź jednym zdaniem`);
  }

  const tekstFaktow = fakty.map((f) => `${f.id}: ${f.zdanie}`).join("\n") as FaktyBezpieczne;
  return {
    fakty, tekstFaktow,
    watek: zamaskujWatek(watek, login),
    ostatniaWiadomoscId: ostatniaKlienta ? Number(ostatniaKlienta.id) : null,
    decyzjaId: rozpoznanie ? Number(rozpoznanie.id) : null,
    kartoteki,
  };
}

/**
 * Dokłada do faktów adresy NASZYCH aktywnych aukcji (0.270.0).
 *
 * Osobno od `kontekstSzkicu`, bo wymaga SIECI, a tamten ma zostać czystym
 * odczytem (blizna 0.18.0: otwarcie rozmowy nie strzela do Allegro). Osobno
 * też dlatego, że numeracja faktów musi biec dalej, a nie od nowa — `F12`
 * w odwołaniu modelu ma znaczyć jedno zdanie, nie dwa.
 *
 * Pytamy wyłącznie o kartoteki, które serwer sam położył w faktach. Nigdy
 * o symbol z treści wiadomości: klient nie wybiera, o co pytamy Allegro.
 *
 * Pusta mapa nie dokłada ani jednego faktu i to jest właściwe zachowanie:
 * „nie znamy aktywnej aukcji na tę kartotekę" ma wyglądać jak cisza, a nie
 * jak zdanie, które model mógłby wziąć za zaproszenie do zgadywania.
 */
export function dopiszLinkiOfert(
  k: KontekstSzkicu, linki: Map<string, LinkDoOferty>,
): KontekstSzkicu {
  if (linki.size === 0) return k;
  const fakty = [...k.fakty];
  for (const kartoteka of k.kartoteki.values()) {
    const l = linki.get(zwin(kartoteka.symbol));
    if (!l) continue;
    fakty.push({
      id: `F${fakty.length + 1}`,
      rodzaj: "oferta_link",
      /* Bez półpauzy, i to nie jest drobiazg: `copilot.anthropic.ts` przyznaje
         w komentarzu, że zakaz myślnika jest najsłabszą z pięciu reguł, bo
         model czyta nasz własny tekst jako wzorzec. Fakt czyta tak samo. */
      zdanie: `NASZA AKTYWNA OFERTA na kartotekę ${kartoteka.symbol}: „${l.nazwa}”, adres: ${l.link}`
        .replace(/\s+/g, " ").trim(),
    });
  }
  if (fakty.length === k.fakty.length) return k;
  return {
    ...k,
    fakty,
    tekstFaktow: fakty.map((f) => `${f.id}: ${f.zdanie}`).join("\n") as FaktyBezpieczne,
  };
}

/**
 * Dociąga stan paczki zamówienia rozmowy, gdy zapisany jest pusty albo stary.
 *
 * Bez sparowanego konta nie pytamy — wzorzec tras reklamacji i dyskusji. Deps
 * przekazane jawnie (testy) omijają ten wyłącznik, bo wstrzykują własne
 * zapytanie i nie dotykają sieci.
 */
export async function odswiezPrzesylke(
  conversationId: number, deps?: PrzesylkaDeps, teraz = Date.now(),
): Promise<void> {
  if (!deps && !config.allegro.clientId) return;
  const numer = numerZamowieniaRozmowy(conversationId);
  const id = numer ? idZamowienia(db(), numer.konto, numer.externalId) : null;
  if (id === null || !przesylkaDoOdswiezenia(przesylkaZamowienia(db(), id), teraz)) return;
  await sprawdzPrzesylke(db(), id, deps).catch(() => undefined);
}

/**
 * Zamówienie rozmowy od nowa przed szkicem — płatność i termin nadania
 * zmieniają się po pierwszym pobraniu. Ta sama bramka co przy przesyłce:
 * bez konta Allegro i bez wstrzykniętych zależności nie pytamy nikogo.
 */
async function odswiezZamowienieRozmowy(
  conversationId: number, deps: PrzesylkaDeps | undefined, teraz: number,
): Promise<void> {
  if (!deps && !config.allegro.clientId) return;
  const numer = numerZamowieniaRozmowy(conversationId);
  const id = numer ? idZamowienia(db(), numer.konto, numer.externalId) : null;
  if (id === null) return;
  await odswiezZamowienie(db(), id, deps, teraz).catch(() => undefined);
}

/**
 * Ułożenie szkicu: fakty → model → SPRAWDZENIE → zapis. Rzuca, gdy dostawca
 * odmówił albo gdy model wyszedł poza fakty; w obu razach wywołanie było
 * płatne i ląduje w księdze jako `blad`.
 */
/**
 * KTO POPROSIŁ O SZKIC. `id: null` znaczy „nikt, zrobił to takt" (0.317.0)
 * i jest to decyzja o źródle wyrażona w danych, nie luka: `przez_user_id`
 * zostaje wtedy puste, a `przez` niesie słowo „automat". Podpisanie
 * automatycznego szkicu kontem agenta, który akurat był zalogowany,
 * zafałszowałoby jedyny pomiar, jaki mamy — ocenę szkicu przez człowieka.
 */
export type AutorSzkicu = {
  id: number | null; name: string;
  /**
   * Pod jakim zadaniem wywołanie staje w księdze; brak = `szkic`. Szkice przed
   * pracą (26 września 2026) mają własną etykietę, bo liczą własny limit, a sufit
   * godzinowy dnia liczy wyłącznie `szkic` — inaczej poranek zjadałby pierwszą
   * godzinę biura. Karta pomiaru pokazuje je dzięki temu osobno.
   */
  zadanie?: string;
};

export async function ulozSzkic(
  conversationId: number, kto: AutorSzkicu,
  nadaj: NadawcaSzkicu, subiekt: SubiektAdapter, teraz = new Date(),
  pobierzZdjecie?: Pobieracz, przesylka?: PrzesylkaDeps,
): Promise<SzkicCopilota> {
  /* TREŚĆ OFERTY PRZED KONTEKSTEM (0.253.0). Opis, parametry i lista
     zgodności kosztują żądanie NA OFERTĘ, więc idą po nie wyłącznie stąd:
     z kliknięcia „Ułóż odpowiedź", gdzie zapis i tak już jest. `kontekstSzkicu`
     zostaje czystym odczytem — inaczej samo otwarcie rozmowy strzelałoby do
     Allegro, a to jest ta reguła, którą 0.18.0 kupiło blizną.

     Odmowa nie przerywa szkicu: bez opisu jest on wart tyle, ile był wart
     do 0.252.0. Limit z Allegro przerywa, bo drugie żądanie pogłębia przerwę. */
  const oferta = ofertaRozmowy(db(), conversationId);
  if (oferta) await dociagnijTresc(oferta.konto, oferta.ofertaId);

  /* ZAMÓWIENIE I STAN PACZKI PRZED KONTEKSTEM, z tego samego powodu co treść
     oferty: żądania do Allegro wolno wysłać tylko stąd, a nie z otwarcia
     rozmowy. Zamówienie idzie pierwsze, bo płatność i termin nadania stoją
     pod werdyktem „wyślemy dziś". Odmowa Allegro nie przerywa szkicu:
     zostaje stan zapisany wcześniej albo milczenie. */
  await odswiezZamowienieRozmowy(conversationId, przesylka, teraz.getTime());
  await odswiezPrzesylke(conversationId, przesylka);

  const kontekst = kontekstSzkicu(conversationId, subiekt, teraz);

  /* LINKI DO NASZYCH AKTYWNYCH AUKCJI (0.270.0). Do 0.269.0 model nie dostawał
     ani jednego adresu, więc zamiast wskazać ofertę pisał klientowi, żeby
     poszukał po nazwie albo po EAN-ie — czyli zadawał mu pracę, którą mamy
     zrobioną. Powód nie był w instrukcji: `offer_snapshot` zna wyłącznie
     aukcje, pod którymi ktoś napisał, a odwrotnego wyszukania nie było wcale.

     JEDNO żądanie na komplet kartotek (`external.id` jest tablicą) i dopiero
     TU, nie w `kontekstSzkicu` — tamten zostaje czystym odczytem. Błąd, także
     limit, nie przerywa szkicu: to ostatnie żądanie do Allegro na tej drodze,
     więc nie ma czego chronić przed pogłębieniem przerwy. */
  const k = dopiszLinkiOfert(kontekst, await ofertyPoSygnaturze(
    [...kontekst.kartoteki.values()].map((x) => x.symbol)));

  /* ── ZDJĘCIA Z ROZMOWY ────────────────────────────────────────────────────
     Pobranie stoi PRZED asercją maskowania, bo bajty nie mają prawa wyjść,
     zanim tekst przejdzie kontrolę.

     PIKSELI ZAMASKOWAĆ SIĘ NIE DA i asercja niżej ich nie dotyczy — to nie
     jest przeoczenie, tylko cena zapisana wprost w nagłówku `copilot-zdjecia`
     i w polityce danych. Zdjęcie klienta idzie do dostawcy w całości.
     Właściciel zgodził się na to także dla TAKTU, pytany wprost.

     Awaria pobrania NIE wywraca szkicu: `przygotujZdjeciaRozmowy` liczy błędy
     i oddaje, co się udało. Szkic bez zdjęć jest tym, czym był wczoraj. */
  const zdjecia: WynikZdjec = await przygotujZdjeciaRozmowy(db(), conversationId, pobierzZdjecie);
  const spis = spisZdjec(zdjecia);
  /* Spis dopinamy do FAKTÓW, nie do wątku: wątek jest tekstem klienta i po to
     przeszedł przez maskowanie, żeby nic naszego się w nim nie znalazło. */
  const tekstFaktow = (spis ? `${k.tekstFaktow}\n\n${spis}` : k.tekstFaktow) as FaktyBezpieczne;

  /* Asercja przed siecią — na WĄTKU, bo tam jest tekst klienta. Faktów nie
     sprawdzamy tymi wzorcami celowo: dziewięć cyfr numeru OEM zapaliłoby
     „telefon" i to byłby fałszywy alarm, a nie zepsute maskowanie. */
  if (zostalyDaneOsobowe(String(k.watek))) {
    zapiszBlad(conversationId, "maskowanie", kto, teraz);
    throw new Error("Maskowanie nie oczyściło rozmowy — nic nie wyszło do dostawcy");
  }

  let odp: OdpowiedzSzkicu;
  try {
    odp = await nadaj(k.watek, tekstFaktow, zdjecia.zdjecia);
  } catch (e) {
    const slad = (e as { slad?: string }).slad || (e as Error).message;
    zapiszBlad(conversationId, slad, kto, teraz);
    throw e;
  }

  /* SPRAWDZENIE DETERMINISTYCZNE — orkiestrator, nie wyrocznia. Bez ponowienia:
     wywołanie jest zapłacone, agent widzi zdanie i klika drugi raz, jeśli chce. */
  const twierdzenia = zRozpoznaniaNiepewne(ocenTwierdzenia(odp.twierdzenia), k.fakty);
  /* Numer wolno wziąć z własnej wiedzy — ale nie po cichu. Niezadeklarowany
     jest tym samym, czym był każdy numer spoza faktów do 0.252.0: zdaniem,
     którego agent nie ma jak sprawdzić przed wysłaniem do klienta. */
  /* ── ODCZYT ZE ZDJĘĆ: NAJPIERW TOŻSAMOŚĆ, POTEM ZAUFANIE ──────────────────
     Odczyt powołany na `Z7`, gdy wysłaliśmy trzy zdjęcia, nie jest pomyłką
     w numeracji — to jedyny znany sposób, żeby przemycić przez `numery-
     SpozaFaktow` numer wzięty z niczego. Dlatego sprawdzenie jest takie samo
     jak przy faktach spoza listy: wywraca szkic, nie filtruje po cichu. */
  const wyslane = new Set(zdjecia.zdjecia.map((z) => z.numer));
  const zmyslone = odp.odczytZeZdjec.filter((o) => !wyslane.has(o.zdjecie));
  if (zmyslone.length) {
    zapiszWywolanie(conversationId, odp, "blad",
      `zdjecie_spoza_listy: ${zmyslone.map((o) => o.zdjecie).join(", ")}`, kto, teraz);
    throw new BladOdpowiedziCopilota(
      `Model powołał się na zdjęcie ${zmyslone[0]!.zdjecie}, którego nie dostał — szkic odrzucony.`,
      200, "zdjecie_spoza_listy");
  }
  /* Dopiero TERAZ odczyt staje się materiałem, z którego wolno cytować —
     na równi z faktami i wątkiem. Bez tego każde poprawne odczytanie
     tabliczki wywracałoby własny szkic na odsiewie numerów. */
  const zOdczytu = odp.odczytZeZdjec.map((o) => o.tekst).join("\n");
  const material = `${tekstFaktow}\n${k.watek}${zOdczytu ? `\n${zOdczytu}` : ""}`;

  const obce = numeryNiezadeklarowane(odp.tresc, material, odp.twierdzenia);
  if (obce.length) {
    zapiszWywolanie(conversationId, odp, "blad", `numer_niezadeklarowany: ${obce.join(", ")}`, kto, teraz);
    throw new BladOdpowiedziCopilota(
      `Model użył numeru ${obce[0]}, nie mówiąc, skąd go ma — szkic odrzucony. `
      + "Kliknij ponownie albo napisz odpowiedź sam.", 200, "numer_niezadeklarowany");
  }
  const znane = new Set(k.fakty.map((f) => f.id));
  const nieznane = odp.uzyteFakty.filter((f) => !znane.has(f));
  if (nieznane.length) {
    zapiszWywolanie(conversationId, odp, "blad", `fakt_spoza_listy: ${nieznane.join(", ")}`, kto, teraz);
    throw new BladOdpowiedziCopilota(
      `Model powołał się na fakt ${nieznane[0]}, którego nie dostał — szkic odrzucony.`, 200, "fakt_spoza_listy");
  }
  /* Nadmiar to BŁĄD, nie przycięcie: ucięte zdanie na końcu szkicu wyglądałoby
     na gotowe, a wysyłka i tak odmówiłaby ponad limitem Allegro. */
  if (odp.tresc.length > LIMIT_ZNAKOW) {
    zapiszWywolanie(conversationId, odp, "blad", `za_dlugi: ${odp.tresc.length}`, kto, teraz);
    throw new BladOdpowiedziCopilota(
      `Model napisał ${odp.tresc.length} znaków, a Allegro przyjmuje ${LIMIT_ZNAKOW} — szkic odrzucony.`,
      200, "za_dlugi");
  }

  /* Dopiero TERAZ, po sprawdzeniu: odwołania były potrzebne kontroli, klientowi nie. */
  const tresc = bezZnacznikow(odp.tresc);
  transaction(db(), () => {
    db().prepare(`INSERT INTO szkic_copilota
      (conversation_id,tresc,zastrzezenia,uzyte_fakty,message_id,model,at,przez,przez_user_id,
       twierdzenia,odczyt_zdjec,decyzja_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        tresc=excluded.tresc, zastrzezenia=excluded.zastrzezenia, uzyte_fakty=excluded.uzyte_fakty,
        message_id=excluded.message_id, model=excluded.model, at=excluded.at,
        przez=excluded.przez, przez_user_id=excluded.przez_user_id,
        twierdzenia=excluded.twierdzenia,
        odczyt_zdjec=excluded.odczyt_zdjec, decyzja_id=excluded.decyzja_id,
        /* Nowa propozycja — stara ocena jej nie dotyczy. */
        ocena=NULL, ocena_at=NULL`)
      .run(conversationId, tresc, JSON.stringify(odp.zastrzezenia), JSON.stringify(odp.uzyteFakty),
        k.ostatniaWiadomoscId, odp.model, teraz.toISOString(), kto.name, kto.id,
        JSON.stringify(twierdzenia), JSON.stringify(odp.odczytZeZdjec), k.decyzjaId);
    zapiszWywolanie(conversationId, odp, "ok", null, kto, teraz);
    /* Ładunki niosą identyfikatory i DŁUGOŚCI, nigdy treść (§19). */
    logEvent("copilot_szkic", kto.name, null, {
      conversationId, znakow: tresc.length, zastrzezen: odp.zastrzezenia.length,
      faktow: k.fakty.length, model: odp.model, tokeny: odp.zuzycie,
      /* Zdjęcia LICZBAMI, jak przy reklamacji (0.484.6). Od 0.330.0 żadne
         zdjęcie rozmowy nie doszło do modelu, a dziennik tego nie pokazał,
         bo liczby błędów nikt nie zapisywał. */
      zdjec: zdjecia.zdjecia.length, zdjecBledow: zdjecia.bledow,
      zdjecNieObraz: zdjecia.nieObrazy.length,
    }, kto.id, db());
    db().prepare("INSERT INTO conversation_event(conversation_id, event_type, payload) VALUES (?,?,?)")
      .run(conversationId, "copilot_szkic",
        JSON.stringify({ znakow: tresc.length, model: odp.model, autor: kto.name }));
  })();
  publishConversationEvent("assignment.changed", conversationId, { szkic: true });
  return szkicCopilota(conversationId)!;
}

/** Werdykt agenta o propozycji — jedyna liczba mówiąca, czy przycisk jest wart pieniędzy. */
export function ocenSzkic(
  conversationId: number, ocena: string, kto: { id: number; name: string }, teraz = new Date(),
): { ocena: OcenaSzkicu } {
  if (!(OCENY_SZKICU as readonly string[]).includes(ocena)) {
    throw new Error("Ocena może być „wstawiony”, „zastapiony” albo „odrzucony”.");
  }
  const jest = db().prepare("SELECT 1 FROM szkic_copilota WHERE conversation_id=?").get(conversationId);
  if (!jest) throw new Error("Ta rozmowa nie ma jeszcze szkicu Copilota");
  transaction(db(), () => {
    db().prepare("UPDATE szkic_copilota SET ocena=?, ocena_at=? WHERE conversation_id=?")
      .run(ocena, teraz.toISOString(), conversationId);
    logEvent("copilot_szkic_ocena", kto.name, null, { conversationId, ocena }, kto.id, db());
  })();
  return { ocena: ocena as OcenaSzkicu };
}

/** Odczyt propozycji dla osi rozmowy. `null` = nikt jeszcze nie prosił. */
export function szkicCopilota(conversationId: number): SzkicCopilota | null {
  const w = db().prepare(`SELECT tresc, zastrzezenia, uzyte_fakty, message_id, model, at, przez, ocena,
      twierdzenia, odczyt_zdjec
      FROM szkic_copilota WHERE conversation_id=?`).get(conversationId) as Record<string, unknown> | undefined;
  if (!w) return null;
  return {
    tresc: String(w.tresc),
    zastrzezenia: JSON.parse(String(w.zastrzezenia ?? "[]")) as string[],
    uzyteFakty: JSON.parse(String(w.uzyte_fakty ?? "[]")) as string[],
    messageId: w.message_id == null ? null : Number(w.message_id),
    model: String(w.model), at: String(w.at), przez: String(w.przez),
    ocena: w.ocena == null ? null : String(w.ocena) as OcenaSzkicu,
    twierdzenia: JSON.parse(String(w.twierdzenia ?? "[]")) as Twierdzenie[],
    odczytZeZdjec: JSON.parse(String(w.odczyt_zdjec ?? "[]")) as OdczytZdjecia[],
  };
}

function zapiszWywolanie(
  conversationId: number, odp: OdpowiedzSzkicu, wynik: "ok" | "blad", blad: string | null,
  kto: { id: number | null; zadanie?: string }, teraz: Date,
): void {
  db().prepare(`INSERT INTO copilot_wywolanie
    (zadanie,conversation_id,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,
     tokeny_cache_odczyt,ms,wynik,blad,przez_user_id,at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(kto.zadanie ?? "szkic", conversationId, odp.model, odp.zuzycie.wej, odp.zuzycie.wyj,
      odp.zuzycie.cacheZapis, odp.zuzycie.cacheOdczyt, odp.ms, wynik,
      blad ? blad.slice(0, 300) : null, kto.id, teraz.toISOString());
}

function zapiszBlad(
  conversationId: number, powod: string, kto: { id: number | null; zadanie?: string }, teraz: Date,
): void {
  db().prepare(`INSERT INTO copilot_wywolanie
    (zadanie,conversation_id,model,wynik,blad,przez_user_id,at)
    VALUES (?,?,'',?,?,?,?)`)
    .run(kto.zadanie ?? "szkic", conversationId, "blad", powod.slice(0, 300), kto.id, teraz.toISOString());
}
