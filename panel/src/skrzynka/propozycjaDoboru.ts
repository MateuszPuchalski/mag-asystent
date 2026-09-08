import type { DaneDoboru, SzkicCopilota } from "../api/typy";

/**
 * Dane doboru rozpoznane w rozmowie (etap F, przyrost trzeci) — co z nich
 * jest NOWE wobec tego, co agent wpisał sam.
 *
 * Jedna funkcja dla dwóch ekranów: karta w zakładce Dobór pokazuje te pola
 * i wpisuje je jednym kliknięciem, a karta szkicu w edytorze tylko o nich
 * mówi. Gdyby każdy liczył to po swojemu, edytor obiecywałby dane, których
 * Dobór nie pokazuje. Serwer stosuje tę samą regułę przy zapisie: wartość
 * agenta zostaje, propozycja wchodzi wyłącznie w puste pola.
 */
export const NAZWY_POL: Array<{ klucz: keyof Omit<DaneDoboru, "parametry">; nazwa: string }> = [
  { klucz: "marka", nazwa: "Marka" }, { klucz: "model", nazwa: "Model" },
  { klucz: "wariant", nazwa: "Wariant" }, { klucz: "rocznik", nazwa: "Rocznik" },
  { klucz: "nrSeryjny", nazwa: "Nr seryjny" }, { klucz: "silnik", nazwa: "Silnik" },
  { klucz: "oem", nazwa: "Numer OEM / symbol" }, { klucz: "nazwaCzesci", nazwa: "Część" },
];

export interface PoleZRozmowy { klucz: string; nazwa: string; wartosc: string }

export function propozycjaDoboru(szkic: SzkicCopilota | null | undefined, dane: DaneDoboru | undefined): {
  /** Pola, których agent nie ma — te wejdą po kliknięciu. */
  nowe: PoleZRozmowy[];
  /** Pola, które agent ma INACZEJ niż model widzi — zostają jego; karta tylko to mówi. */
  inaczej: PoleZRozmowy[];
} {
  const p = szkic?.daneDoboru;
  if (!p || !dane || szkic.daneOcena !== null) return { nowe: [], inaczej: [] };
  const nowe: PoleZRozmowy[] = [];
  const inaczej: PoleZRozmowy[] = [];
  for (const { klucz, nazwa } of NAZWY_POL) {
    const w = p[klucz];
    if (!w) continue;
    if (!dane[klucz]) nowe.push({ klucz, nazwa, wartosc: w });
    else if (dane[klucz] !== w) inaczej.push({ klucz, nazwa, wartosc: w });
  }
  for (const [nazwa, wartosc] of Object.entries(p.parametry)) {
    if (!(nazwa in dane.parametry)) nowe.push({ klucz: `p-${nazwa}`, nazwa, wartosc });
    else if (dane.parametry[nazwa] !== wartosc) inaczej.push({ klucz: `p-${nazwa}`, nazwa, wartosc });
  }
  return { nowe, inaczej };
}
