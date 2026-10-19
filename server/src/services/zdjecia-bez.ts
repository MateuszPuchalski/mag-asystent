import { db } from "../db/db.js";
import { config } from "../config.js";
import {
  SORTOWANIA_BEZ_ZDJECIA,
  towaryBezZdjecia,
  type SortBezZdjecia,
  type TowarBezZdjecia,
} from "../adapters/zdjecia.sgt.js";
import { dodawanieWlaczone } from "./zdjecia-wlasne.js";

/* ── Lista kartotek bez zdjęcia — ekran biura ────────────────────────────────
   Odczyt i nic więcej: otwarcie ekranu niczego nie zapisuje (CLAUDE.md,
   „zero zapisu przy patrzeniu"). Źródłem jest Subiekt, a nasza baza dokłada
   tylko jedno: czy zdjęcie już czeka u nas na wejście do kartoteki. */

export interface PozycjaBezZdjecia extends TowarBezZdjecia {
  /** Zdjęcie leży w WERTIS, ale Subiekt go jeszcze nie ma. */
  oczekuje: boolean;
}

export interface ListaBezZdjecia {
  wlaczone: boolean;
  powod?: string;
  razem: number;
  pozycje: PozycjaBezZdjecia[];
}

type Zrodlo = typeof towaryBezZdjecia;
let zrodlo: Zrodlo = towaryBezZdjecia;

/** Wyłącznie dla testów: w CI nie ma bazy Subiekta, a trasa ma się dać sprawdzić. */
export function ustawZrodloBezZdjecia(fn: Zrodlo | null): void {
  zrodlo = fn ?? towaryBezZdjecia;
}

export const LIMIT_DOMYSLNY = 50;
const LIMIT_MAX = 200;

/** Liczba z zapytania albo wartość domyślna; śmieci nie wywracają strony. */
function calkowita(surowa: unknown, domyslna: number, min: number, max: number): number {
  const n = Math.trunc(Number(surowa));
  if (!Number.isFinite(n) || surowa === undefined || surowa === "") return domyslna;
  return Math.min(max, Math.max(min, n));
}

/**
 * Dlaczego lista nie działa — albo `null`, gdy działa.
 *
 * Zdanie mówi, który klucz ustawić. Pusty ekran bez powodu wygląda jak
 * „wszystkie towary mają zdjęcia", a to byłoby kłamstwo.
 */
export function powodWylaczenia(): string | null {
  if (!dodawanieWlaczone()) {
    return "Dodawanie zdjęć jest w tej instalacji wyłączone (ZDJECIA_DODAWANIE).";
  }
  if (config.zdjecia.zrodlo !== "blob") {
    return (
      "Listę towarów bez zdjęcia czyta się z bazy Subiekta, a ta instalacja " +
      "nie czyta z niej zdjęć (ZDJECIA_ZRODLO=blob)."
    );
  }
  return null;
}

/** Które z podanych towarów mają u nas zdjęcie, którego Subiekt jeszcze nie ma. */
function oczekujace(twIds: number[]): Set<number> {
  if (twIds.length === 0) return new Set();
  const znaki = twIds.map(() => "?").join(",");
  const wiersze = db()
    .prepare(
      `SELECT tw_id FROM zdjecie_wlasne WHERE w_subiekcie_at IS NULL AND tw_id IN (${znaki})`
    )
    .all(...twIds) as Array<{ tw_id: number }>;
  return new Set(wiersze.map((w) => w.tw_id));
}

/**
 * Strona listy. Wyjątek źródła przechodzi wyżej: awaria bazy to nie
 * „funkcja wyłączona" i panel ma pokazać ją jako błąd, nie jako stan.
 */
export async function listaBezZdjecia(zapytanie: {
  q?: unknown;
  limit?: unknown;
  offset?: unknown;
  sortuj?: unknown;
  naStanie?: unknown;
}): Promise<ListaBezZdjecia> {
  const powod = powodWylaczenia();
  if (powod) return { wlaczone: false, powod, razem: 0, pozycje: [] };

  const q = String(zapytanie.q ?? "").trim().slice(0, 100);
  const limit = calkowita(zapytanie.limit, LIMIT_DOMYSLNY, 1, LIMIT_MAX);
  const offset = calkowita(zapytanie.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  /* Nieznana nazwa wraca do domyślnej: stara zakładka w przeglądarce nie
     może wywrócić ekranu błędem 400. */
  const sortuj = (SORTOWANIA_BEZ_ZDJECIA as readonly string[]).includes(String(zapytanie.sortuj))
    ? (zapytanie.sortuj as SortBezZdjecia)
    : "stan";
  const naStanie = zapytanie.naStanie === "1" || zapytanie.naStanie === "true";

  const { razem, pozycje } = await zrodlo({ q, limit, offset, sortuj, naStanie });
  const czeka = oczekujace(pozycje.map((p) => p.twId));
  return {
    wlaczone: true,
    razem,
    pozycje: pozycje.map((p) => ({ ...p, oczekuje: czeka.has(p.twId) })),
  };
}
