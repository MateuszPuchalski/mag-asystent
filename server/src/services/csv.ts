/**
 * Jedno miejsce na składanie CSV — wcześniej każdy eksport (audyt, problemy,
 * reslot, rekoncyliacja) miał własną kopię escapowania i BOM-a, a kopie już
 * zaczęły się rozjeżdżać w szczegółach cytowania.
 *
 * Dwa separatory są celowe i zostają: `;` dla eksportów „dla biura" (Excel PL
 * otwiera bez kreatora importu), `,` dla audytu (RFC 4180 — plik przenośny,
 * kosztem kroku „Dane → Tekst jako kolumny" w Excelu).
 */

export type SeparatorCsv = ";" | ",";

/** Pole CSV wg RFC 4180: cudzysłów podwajamy, całość cytujemy, gdy trzeba. */
export function poleCsv(v: unknown, separator: SeparatorCsv): string {
  if (v == null) return "";
  const s = String(v);
  return s.includes('"') || s.includes(separator) || /[\r\n]/.test(s)
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

/** Jeden wiersz danych: pola po escapowaniu, sklejone separatorem. */
export function wierszCsv(pola: unknown[], separator: SeparatorCsv): string {
  return pola.map((p) => poleCsv(p, separator)).join(separator);
}

/**
 * Gotowy plik z linii (nagłówki i komentarze podaje wywołujący — bez
 * escapowania, wiersze danych przez `wierszCsv`). BOM na początku, bo bez
 * niego Excel czyta UTF-8 jako ANSI i polskie znaki się sypią — ten sam
 * problem, co z plikami .ps1 instalatora. Końce linii CRLF.
 */
export function zbudujCsv(linie: string[]): string {
  return "﻿" + linie.join("\r\n") + "\r\n";
}
