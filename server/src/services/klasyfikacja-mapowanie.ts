import { KODY, type Akcja, type Kategoria } from "./klasyfikacja-slownik.js";
import type { Decyzja, WskazowkaAllegro } from "./klasyfikacja-polityka.js";

/* ── Rejestr mapowań struktury Allegro (specyfikacja z 20 września 2026) ─────

   Specyfikacja każe najpierw użyć tego, co Allegro mówi o wątku SAMO, a model
   wołać tylko tam, gdzie treść zostaje niejasna. W `beta.v1` wątek ma `type`
   (`COMMON` albo `POST_PURCHASE_ISSUE`) i opcjonalny `subType` z dziesięciu
   wartości (`ThreadVBeta1` w `docs/allegro/swagger.yaml`).

   TO JEST PROPOZYCJA, NIE ZWERYFIKOWANY FAKT. Specyfikacja mówi wprost: „The
   final mapping registry must be checked against the live API schema and
   approved labeled examples". Dlatego wąskich mapowań jest mało, a każde
   ma w komentarzu powód. Zmiana tabeli podnosi `MAPOWANIE_WERSJA`, bo pomiar
   zgodności mapowania z etykietą człowieka liczy się per wersja.

   TRZY REGUŁY Z TABELI SPECYFIKACJI:
   1. `COMMON` sam niczego nie mówi o zamiarze — brak wskazówki.
   2. Podtyp opisuje WĄTEK. Wąskie mapowanie rozstrzyga więc wyłącznie
      PIERWSZĄ wiadomość klienta, tę, którą Allegro założyło sprawę. Dopisek
      „dziękuję, doszło" w wątku o brakującym elemencie nie jest brakiem.
   3. Wartość nieznana zostaje zapisana, dostaje kod i idzie do modelu —
      nigdy nie jest po cichu dopasowana do najbliższej kategorii.          */

export const MAPOWANIE_WERSJA = "m1";

interface Wpis {
  kategoria: Kategoria;
  /** Kategorie, z którymi podtyp się nie kłóci — spór liczy się poza nimi. */
  zgodne: readonly Kategoria[];
  /** Wąskie: rozstrzyga pierwszą wiadomość bez modelu. */
  waska?: { akcja: Akcja; wymagaCzlowieka: boolean };
}

const ZWROT: readonly Kategoria[] = ["RETURN", "COMPLAINT", "CANCEL_ORDER"];

const PODTYPY: Record<string, Wpis> = {
  /* Specyfikacja podaje ten podtyp jako przykład: szerszy niż WRONG_PRODUCT.
     W sklepie z częściami najczęściej kryje się za nim część zgodna
     z zamówieniem, która nie pasuje — czyli pytanie o dobór. Tylko wskazówka. */
  PRODUCT_INCONSISTENT_WITH_THE_OFFER: { kategoria: "WRONG_PRODUCT",
    zgodne: ["WRONG_PRODUCT", "PRODUCT_COMPATIBILITY", "DAMAGED_PRODUCT", "MISSING_PRODUCT",
      "RETURN", "COMPLAINT"] },
  /* „Przyszło uszkodzone" nie mówi, czy winny jest transport, czy towar —
     a specyfikacja rozdziela te dwie kategorie. Tylko wskazówka. */
  PRODUCT_ARRIVED_DAMAGED: { kategoria: "DELIVERY_DAMAGED",
    zgodne: ["DELIVERY_DAMAGED", "DAMAGED_PRODUCT", "RETURN", "COMPLAINT"] },
  /* Wada w użyciu to wada towaru, ale klient może żądać reklamacji albo
     zwrotu — rozwiązanie wybiera klient, nie podtyp. Tylko wskazówka. */
  DEFECT_DETECTED_DURING_USE: { kategoria: "DAMAGED_PRODUCT",
    zgodne: ["DAMAGED_PRODUCT", "COMPLAINT", "RETURN", "PRODUCT_QUESTION"] },
  /* Paczka bez towaru bywa brakiem w paczce, a bywa zaginięciem — granica,
     którą specyfikacja stawia wprost. Tylko wskazówka. */
  NO_PRODUCT_IN_THE_SHIPMENT: { kategoria: "MISSING_PRODUCT",
    zgodne: ["MISSING_PRODUCT", "DELIVERY_LOST", "WRONG_PRODUCT", ...ZWROT] },
  /* Brak elementu w otrzymanej paczce — dokładnie definicja MISSING_PRODUCT.
     Wąskie: następny krok to zamówienie, żeby sprawdzić skład. */
  MISSING_PRODUCT_ELEMENTS: { kategoria: "MISSING_PRODUCT",
    zgodne: ["MISSING_PRODUCT", ...ZWROT],
    waska: { akcja: "GET_ORDER", wymagaCzlowieka: false } },
  /* Trzy podtypy zwrotu: każdy nazywa etap procesu zwrotu, nie zamiar do
     odgadnięcia. Brak zwrotu pieniędzy i kłopot z odesłaniem — zamówienie
     jako następny krok. */
  NO_REFUND: { kategoria: "RETURN", zgodne: ZWROT,
    waska: { akcja: "GET_ORDER", wymagaCzlowieka: false } },
  PROBLEM_WITH_SENDING_PRODUCT_BACK: { kategoria: "RETURN", zgodne: ZWROT,
    waska: { akcja: "GET_ORDER", wymagaCzlowieka: false } },
  /* „Sprzedawca nie chce przyjąć zwrotu" to SPÓR o nasze postępowanie —
     rozstrzyga człowiek, zawsze. */
  SELLER_DOES_NOT_WANT_TO_ACCEPT_RETURN: { kategoria: "RETURN", zgodne: ZWROT,
    waska: { akcja: "HUMAN_REVIEW", wymagaCzlowieka: true } },
  /* „Brak dokumentów" to najczęściej faktura, ale bywa instrukcją albo kartą
     gwarancyjną. Tylko wskazówka. */
  NO_DOCUMENTATIONS: { kategoria: "INVOICE",
    zgodne: ["INVOICE", "PRODUCT_QUESTION", "COMPLAINT"] },
};

/** Podtypy, które Allegro zna, a my świadomie NIE mapujemy. */
const BEZ_WSKAZOWKI = new Set(["OTHER"]);

const TYPY = new Set(["COMMON", "POST_PURCHASE_ISSUE"]);

export interface StrukturaDoMapowania {
  typ: string | null;
  podtyp: string | null;
  /** Czy wątek niesie zamówienie — od tego zależy flaga braku danych zamówienia. */
  zZamowieniem: boolean;
}

export interface WynikMapowania {
  /** Decyzja bez modelu — tylko przy wąskim podtypie i pierwszej wiadomości. */
  waska: Decyzja | null;
  /** Szeroka wskazówka dla polityki — tylko przy pierwszej wiadomości. */
  wskazowka: WskazowkaAllegro | null;
  /** Kody do dołożenia do decyzji (nieznany typ albo podtyp). */
  kody: string[];
  /** Nieznana wartość do zdarzenia „do przeglądu mapowań", albo `null`. */
  nieznane: string | null;
}

const PUSTO: WynikMapowania = { waska: null, wskazowka: null, kody: [], nieznane: null };

/**
 * Mapowanie struktury wątku. `pierwsza` mówi, czy rozpoznawana wiadomość
 * jest pierwszą wiadomością klienta w wątku — patrz reguła 2 wyżej.
 */
export function mapujStrukture(st: StrukturaDoMapowania, pierwsza: boolean): WynikMapowania {
  if (!st.typ) return PUSTO;
  if (!TYPY.has(st.typ)) {
    return { ...PUSTO, kody: [KODY.typNieznany], nieznane: `type=${st.typ}` };
  }
  if (st.typ === "COMMON" || !st.podtyp || BEZ_WSKAZOWKI.has(st.podtyp)) return PUSTO;
  const wpis = PODTYPY[st.podtyp];
  if (!wpis) return { ...PUSTO, kody: [KODY.podtypNieznany], nieznane: `subType=${st.podtyp}` };
  if (!pierwsza) return PUSTO;

  if (wpis.waska) {
    return {
      ...PUSTO,
      waska: {
        zrodlo: "ALLEGRO_MAPPING",
        status: "SUCCESS",
        kategoria: wpis.kategoria,
        dodatkowe: [],
        kategoriaModelu: null,
        kategoriaAllegro: wpis.kategoria,
        akcja: wpis.waska.akcja,
        akcjaModelu: null,
        wymagaCzlowieka: wpis.waska.wymagaCzlowieka,
        /* Wątek sprawy posprzedażowej niesie zamówienie w `orders`. Gdy go
           nie niesie, zachowawczo: dane są potrzebne. */
        brakDanychZamowienia: !st.zZamowieniem,
        brakDanychProduktu: false,
        pewnosc: null,
        uzasadnienie: null,
        kody: [],
      },
    };
  }
  return { ...PUSTO, wskazowka: { kategoria: wpis.kategoria, zgodne: wpis.zgodne } };
}
