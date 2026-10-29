import { db } from "../db/db.js";
import { config } from "../config.js";
import { SORTOWANIA_BEZ_ZDJECIA, type SortBezZdjecia } from "../adapters/zdjecia.sgt.js";
import {
  WYMIARY,
  stanKartoteki,
  stanKartotekiDemo,
  tekstWymiaru,
  towaryBezWymiarow,
  towaryBezWymiarowDemo,
  type Pomiar,
  type TowarBezWymiarow,
} from "../adapters/wymiary.sgt.js";
import { enqueueSetWymiary } from "./queue.js";

/* ── Towary bez wagi albo wymiarów — ekran biura ─────────────────────────────
   Lista czyta Subiekt i niczego nie zapisuje (zasada „zero zapisu przy
   patrzeniu"). Zapis pomiaru idzie kolejką, jak lokalizacja i kod kreskowy,
   bo zapis do bazy firmy wykonuje tylko worker. */

export interface PozycjaBezWymiarow extends TowarBezWymiarow {
  /** Pomiar tego towaru czeka w kolejce i jeszcze nie wszedł do Subiekta. */
  oczekuje: boolean;
}

export interface ListaBezWymiarow {
  wlaczone: boolean;
  powod?: string;
  razem: number;
  pozycje: PozycjaBezWymiarow[];
}

type Zrodlo = typeof towaryBezWymiarow;
type ZrodloStanu = typeof stanKartoteki;
let zrodlo: Zrodlo | null = null;
let zrodloStanu: ZrodloStanu | null = null;

/** Wyłącznie dla testów: trasa w trybie mssql ma się dać sprawdzić bez bazy Subiekta. */
export function ustawZrodlaWymiarow(lista: Zrodlo | null, stan: ZrodloStanu | null = null): void {
  zrodlo = lista;
  zrodloStanu = stan;
}

const demo = () => config.sgtMode === "seeded";
const listaZrodla = (): Zrodlo => zrodlo ?? (demo() ? towaryBezWymiarowDemo : towaryBezWymiarow);
const stanZrodla = (): ZrodloStanu => zrodloStanu ?? (demo() ? stanKartotekiDemo : stanKartoteki);

/**
 * Dlaczego ekran nie działa — albo `null`, gdy działa.
 *
 * Demo działa zawsze, bo pisze do własnych kolumn. Produkcja czeka na trzy
 * klucze, a zdanie mówi, które ustawić: pusty ekran bez powodu wyglądałby
 * jak „każdy towar jest zmierzony".
 */
export function powodWylaczenia(): string | null {
  if (demo()) return null;
  const w = config.wymiary;
  if (w.poleDlugosc && w.poleSzerokosc && w.poleWysokosc) return null;
  return (
    "Wymiary czekają na konfigurację: wpisz w wertis.env, w których polach własnych Subiekta " +
    "firma trzyma długość, szerokość i wysokość (WYMIARY_POLE_DLUGOSC, WYMIARY_POLE_SZEROKOSC, " +
    "WYMIARY_POLE_WYSOKOSC, np. tw_Pole4)."
  );
}

export const LIMIT_DOMYSLNY = 50;
const LIMIT_MAX = 200;

/** Liczba z zapytania albo wartość domyślna; śmieci nie wywracają strony. */
function calkowita(surowa: unknown, domyslna: number, min: number, max: number): number {
  const n = Math.trunc(Number(surowa));
  if (!Number.isFinite(n) || surowa === undefined || surowa === "") return domyslna;
  return Math.min(max, Math.max(min, n));
}

/** Które z podanych towarów mają pomiar w kolejce, jeszcze niewykonany. */
function oczekujace(twIds: number[]): Set<number> {
  if (twIds.length === 0) return new Set();
  const znaki = twIds.map(() => "?").join(",");
  const wiersze = db()
    .prepare(
      `SELECT DISTINCT tw_id FROM sfera_queue
       WHERE type = 'set_wymiary' AND status IN ('pending', 'processing', 'waiting_for_doc')
         AND tw_id IN (${znaki})`
    )
    .all(...twIds) as Array<{ tw_id: number }>;
  return new Set(wiersze.map((w) => w.tw_id));
}

/** Strona listy. Wyjątek źródła idzie wyżej: awaria bazy to nie „funkcja wyłączona". */
export async function listaBezWymiarow(zapytanie: {
  q?: unknown;
  limit?: unknown;
  offset?: unknown;
  sortuj?: unknown;
  naStanie?: unknown;
  sprzedane?: unknown;
}): Promise<ListaBezWymiarow> {
  const powod = powodWylaczenia();
  if (powod) return { wlaczone: false, powod, razem: 0, pozycje: [] };

  const q = String(zapytanie.q ?? "").trim().slice(0, 100);
  const limit = calkowita(zapytanie.limit, LIMIT_DOMYSLNY, 1, LIMIT_MAX);
  const offset = calkowita(zapytanie.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  /* Nieznana nazwa wraca do domyślnej: stara zakładka nie wywróci ekranu błędem 400. */
  const sortuj = (SORTOWANIA_BEZ_ZDJECIA as readonly string[]).includes(String(zapytanie.sortuj))
    ? (zapytanie.sortuj as SortBezZdjecia)
    : "sprzedaz";
  const tak = (v: unknown) => v === "1" || v === "true";

  const { razem, pozycje } = await listaZrodla()({
    q, limit, offset, sortuj, naStanie: tak(zapytanie.naStanie), sprzedane: tak(zapytanie.sprzedane),
  });
  const czeka = oczekujace(pozycje.map((p) => p.twId));
  return { wlaczone: true, razem, pozycje: pozycje.map((p) => ({ ...p, oczekuje: czeka.has(p.twId) })) };
}

/* Granice pomiaru. Nie są fizyką, tylko sitem na pomyłkę rzędu wielkości:
   „1250" wpisane w kilogramy zamiast gramów albo milimetry w polu centymetrów. */
export const MASA_MAX_KG = 2000;
export const WYMIAR_MAX_CM = 1000;

const NAZWY: Record<keyof Pomiar, string> = {
  masaKg: "Waga",
  dlugosc: "Długość",
  szerokosc: "Szerokość",
  wysokosc: "Wysokość",
};

/**
 * Liczba z pola formularza: liczba albo tekst z przecinkiem lub kropką.
 * Puste i `null` znaczą „tego nie mierzyłem" i zostawiają pole w Subiekcie.
 */
function liczbaPola(v: unknown): number | null | "zle" {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : "zle";
  if (typeof v !== "string") return "zle";
  const t = v.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return "zle";
  return Number(t);
}

/** Pomiar z ciała żądania albo zdanie, co jest nie tak. */
export function pomiarZCiala(cialo: unknown):
  | { ok: true; pomiar: Pomiar }
  | { ok: false; error: string } {
  const c = (cialo && typeof cialo === "object" ? cialo : {}) as Record<string, unknown>;
  const pomiar: Pomiar = { masaKg: null, dlugosc: null, szerokosc: null, wysokosc: null };
  for (const k of ["masaKg", ...WYMIARY] as const) {
    const n = liczbaPola(c[k]);
    if (n === "zle") return { ok: false, error: `${NAZWY[k]}: wpisz liczbę, np. 12,5.` };
    if (n === null) continue;
    const max = k === "masaKg" ? MASA_MAX_KG : WYMIAR_MAX_CM;
    const jednostka = k === "masaKg" ? "kg" : "cm";
    /* Zaokrąglamy PRZED progiem zera: „0,04" cm to po zaokrągleniu zero,
       a zero w polu znaczy „nie zmierzono", nie pomiar. */
    const r = k === "masaKg" ? Math.round(n * 1000) / 1000 : Math.round(n * 10) / 10;
    if (r <= 0) return { ok: false, error: `${NAZWY[k]} musi być większa od zera.` };
    if (r > max) return { ok: false, error: `${NAZWY[k]} ponad ${max} ${jednostka} — sprawdź jednostkę.` };
    pomiar[k] = r;
  }
  if (Object.values(pomiar).every((v) => v === null)) {
    return { ok: false, error: "Wpisz co najmniej jedną wartość pomiaru." };
  }
  return { ok: true, pomiar };
}

export type WynikZapisu =
  | { ok: true; queueId: number; pomiar: Pomiar }
  | { ok: false; kod: 400 | 404 | 409; error: string };

/**
 * Pomiar → zadanie w kolejce. Do Subiekta wpisuje go worker.
 *
 * Wyjątek przy odczycie stanu kartoteki przechodzi wyżej jako awaria bazy:
 * bez stanu „przed" audyt nie umiałby cofnąć zmiany, więc lepiej nie zapisać.
 */
export async function zapiszPomiar(
  twId: number,
  cialo: unknown,
  autor: { nazwa: string; ref: number | null }
): Promise<WynikZapisu> {
  const powod = powodWylaczenia();
  if (powod) return { ok: false, kod: 409, error: powod };
  const wejscie = pomiarZCiala(cialo);
  if (!wejscie.ok) return { ok: false, kod: 400, error: wejscie.error };
  const przed = await stanZrodla()(twId);
  if (!przed) return { ok: false, kod: 404, error: `Nie ma w Subiekcie towaru o tw_Id=${twId}.` };

  const p = wejscie.pomiar;
  const opis = [
    p.masaKg !== null ? `${String(p.masaKg).replace(".", ",")} kg` : null,
    WYMIARY.some((w) => p[w] !== null)
      ? WYMIARY.map((w) => { const cm = p[w]; return cm === null ? "–" : tekstWymiaru(cm); }).join(" × ") + " cm"
      : null,
  ].filter(Boolean).join(", ");
  const queueId = enqueueSetWymiary(
    twId,
    p,
    { createdBy: autor.nazwa, createdByRef: autor.ref, twId, label: "Wymiary · " + przed.symbol, detail: opis },
    { masa: przed.masa, dlugosc: przed.dlugosc, szerokosc: przed.szerokosc, wysokosc: przed.wysokosc }
  );
  return { ok: true, queueId, pomiar: p };
}
