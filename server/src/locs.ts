/**
 * Kodowanie lokalizacji towaru w Subiekcie: pole `tw_Lokalizacja` trzyma kody
 * rozdzielone spacjami, a PIERWSZY kod jest lokalizacją pickingową (spec §5.2).
 * Ta decyzja mieszkała w 9 miejscach — tu jest jedno.
 *
 * Moduł bez zależności (importowalny i z adapterów, i z serwisów).
 */

/** Kody lokalizacji z pola `tw_Lokalizacja` (puste/None → pusta lista). */
export function parseLocs(raw: string | null | undefined): string[] {
  return raw ? raw.split(" ").filter(Boolean) : [];
}

/** Lokalizacja pickingowa (pierwsza) albo null, gdy towar nie ma lokalizacji. */
export function pickingLoc(raw: string | null | undefined): string | null {
  return parseLocs(raw)[0] ?? null;
}

/**
 * Rozbiór adresu regałowego na części składowe.
 *
 * Kod `A01-02-03` czyta się: **A01 = regał, 02 = kolumna, 03 = poziom**.
 * Trzeci segment jest wysokością i to on decyduje o koszcie pobrania —
 * ze strefy złotej ~3 s, z podłogi albo z drabiny 10–25 s.
 *
 * Zwraca `null` dla wszystkiego, co nie jest adresem regałowym (paleta,
 * literówka w kartotece) — wołający decyduje, co z takim wpisem zrobić.
 * Cicha zamiana na zera dałaby fałszywy poziom 0, czyli „podłoga".
 */
export interface Adres {
  alejka: string;
  /** Pełny numer regału z literą, np. `D05` — bo tak zapisuje się zakresy. */
  regal: string;
  kolumna: number;
  poziom: number;
}

const ADRES_RE = /^([A-Z])(\d{2})-(\d{2})-(\d{2})$/;

export function parseAdres(code: string | null | undefined): Adres | null {
  const m = ADRES_RE.exec((code ?? "").trim().toUpperCase());
  if (!m) return null;
  return { alejka: m[1], regal: m[1] + m[2], kolumna: Number(m[3]), poziom: Number(m[4]) };
}
