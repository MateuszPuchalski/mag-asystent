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
