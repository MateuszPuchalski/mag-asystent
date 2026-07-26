import type { Adres } from "../locs.js";

/* ── Strefa złota: poziomy 75–140 cm ────────────────────────────────────────
   Wysokość, na której sięga się bez schylania i bez drabiny. Pobranie stamtąd
   to ~3 s; z podłogi albo z góry regału 10–25 s. Przy 342 m² to jest RZĄD
   WIELKOŚCI więcej niż cała droga po magazynie — dlatego przeslotowanie liczy
   pion, a nie odległość.

   Reguły są PER ZAKRES REGAŁÓW, nie globalne: ten sam numer poziomu oznacza
   inną wysokość w różnych alejkach, bo regały mają różną geometrię.

   Zapis właściciela, słowo w słowo:
     „A,B,J,H(2,3,4) poziom  C(2,3) D01-D05(2,3), E03-04(2), E05-08(2,3),
      F(4,8), G(3,7)"

   `E05-08` to korekta wcześniejszego `E04-08` i ona rozstrzyga notację: to
   ZAKRESY REGAŁÓW (E05…E08), nie „regał-kolumna" — poprzednia wersja nakładała
   E04 na `E03-04`. `D01-D05` znaczy to samo, tylko z powtórzoną literą.

   F i G mają DWA NIEPRZYLEGŁE poziomy i to nie jest pomyłka: są to najwyższe
   alejki (F sięga poziomu 15, G poziomu 9), czyli najpewniej dwie kondygnacje
   regałów, każda ze swoją strefą złotą.                                      */

export interface RegulaStrefy {
  /** Cała alejka — gdy nie podano zakresu regałów. */
  alejka?: string;
  /** Zakres regałów włącznie, np. `D01`…`D05`. */
  od?: string;
  do?: string;
  poziomy: number[];
}

export const STREFA_ZLOTA: RegulaStrefy[] = [
  { alejka: "A", poziomy: [2, 3, 4] },
  { alejka: "B", poziomy: [2, 3, 4] },
  { alejka: "H", poziomy: [2, 3, 4] },
  { alejka: "J", poziomy: [2, 3, 4] },
  { alejka: "C", poziomy: [2, 3] },
  { od: "D01", do: "D05", poziomy: [2, 3] },
  { od: "E03", do: "E04", poziomy: [2] },
  { od: "E05", do: "E08", poziomy: [2, 3] },
  { alejka: "F", poziomy: [4, 8] },
  { alejka: "G", poziomy: [3, 7] },
];

/** Numer regału bez litery — do porównań zakresu (`D05` → 5). */
const nr = (regal: string): number => Number(regal.slice(1));

function regulaDla(adres: Adres): RegulaStrefy | null {
  for (const r of STREFA_ZLOTA) {
    if (r.alejka) {
      if (r.alejka === adres.alejka) return r;
      continue;
    }
    if (!r.od || !r.do) continue;
    if (r.od[0] !== adres.alejka) continue;
    if (nr(adres.regal) >= nr(r.od) && nr(adres.regal) <= nr(r.do)) return r;
  }
  return null;
}

/**
 * Czy adres leży w strefie złotej.
 *
 * `null` znaczy **„nie wiem"** — dla tego regału nie ma reguły — a nie „nie".
 * Ta trójwartościowość jest istotna: gdyby brak reguły znaczył „poza strefą",
 * martwy towar z takiego regału zniknąłby z listy eksmisji, a szybkorotujący
 * trafiłby na listę awansów bez żadnej podstawy. Regały bez reguły idą na
 * osobną, czwartą listę — widoczne, zamiast po cichu źle zaklasyfikowane.
 *
 * Dziś bez reguły są `D00`, `D06`, `D07`, `E01`.
 */
export function wStrefieZlotej(adres: Adres): boolean | null {
  const r = regulaDla(adres);
  return r ? r.poziomy.includes(adres.poziom) : null;
}

/** Poziomy strefy złotej dla regału — do podpowiedzi „dokąd przenieść". */
export function poziomyStrefy(adres: Adres): number[] | null {
  return regulaDla(adres)?.poziomy ?? null;
}
