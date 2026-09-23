import { odmien } from "../ui";

/* ── Liczby analizy po polsku (z `biuro.html`, w panelu od 0.440.0) ──────
   Trzy małe funkcje, które biuro trzymało przy wykresach. Osobny plik, bo
   każda ma pułapkę, którą test ma przytrzymać: przecinek dziesiętny, odmianę
   ułamka i zdanie o szczycie, które przy medianie zero NIE wolno dzielić. */

/** Liczba po polsku: przecinek dziesiętny, bez zbędnego „,0". */
export const liczbaPl = (n: number | null | undefined): string =>
  n == null ? "—" : String(n).replace(".", ",");

/**
 * Liczba dni z właściwą końcówką. Ułamek idzie do dopełniacza liczby
 * pojedynczej — „1,2 dnia", nie „1,2 dni" — bo połowa dnia nie jest dniami.
 */
export const dniPl = (n: number | null | undefined): string =>
  n == null ? "—" : `${liczbaPl(n)} ${Number.isInteger(n) ? odmien(n, "dzień", "dni", "dni") : "dnia"}`;

/** Dzień z osi analizy jako „26.08" — data przychodzi już LOKALNA, z serwera. */
export const dzienSkrot = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/**
 * Zdanie o szczycie — z FAKTÓW, nie z interpretacji.
 *
 * Makieta biura pisała pod wykresem „szczyt zbiega się z sezonem kosiarek".
 * Drugiej połowy takiego zdania nie da się policzyć: to sąd człowieka. Serwer
 * oddaje więc sam szczyt i medianę reszty, a przy za cienkiej próbce — `null`,
 * i wtedy zdania nie ma. Milczenie jest lepsze od zdania, które brzmi jak
 * wniosek, a jest szumem.
 *
 * Mediana zero NIE znaczy „w pozostałych nie było nic" — znaczy, że połowa
 * okresów jest pusta. Dlatego wtedy nie ma ilorazu, tylko sama mediana.
 */
export function zdanieOSzczycie(ile: number, medianaPozostalych: number, gdzie: string, rzeczownik: string): string {
  const razy = medianaPozostalych > 0
    ? (ile / medianaPozostalych).toFixed(1).replace(".", ",") : null;
  return `Szczyt ${gdzie} — ${ile} ${rzeczownik}${razy
    ? `, czyli ${razy}× mediana pozostałych (${liczbaPl(medianaPozostalych)})`
    : ", przy medianie 0 w pozostałych"}.`;
}
