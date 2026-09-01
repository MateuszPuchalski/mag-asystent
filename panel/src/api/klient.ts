/* Jedno wejście do serwera dla całego panelu. Sesja jedzie nagłówkiem
   `x-session`, nie ciasteczkiem — ten sam wzorzec, co kolektor. */

const KLUCZ = "wertis-panel-token";

/** Sesja wygasła albo jej nie ma — ekran ma wrócić do logowania, nie do błędu. */
export class BrakSesji extends Error {}

/** Konflikt wersji (409). Szczegóły rysują ekran, więc jadą dalej w całości. */
export class Konflikt extends Error {
  constructor(message: string, public readonly szczegoly: Record<string, unknown>) {
    super(message);
  }
}

export const token = () => localStorage.getItem(KLUCZ) ?? "";
export const zapiszToken = (t: string) => localStorage.setItem(KLUCZ, t);
export const wyczyscToken = () => localStorage.removeItem(KLUCZ);

export async function api<T = any>(sciezka: string, init: RequestInit = {}): Promise<T> {
  const odp = await fetch(sciezka, {
    ...init,
    headers: { "content-type": "application/json", "x-session": token(), ...(init.headers ?? {}) },
  });
  const dane = await odp.json().catch(() => ({}));
  if (odp.status === 401) throw new BrakSesji(dane.error ?? "Sesja wygasła — zaloguj się");
  /* 409 dostaje własny typ, bo panel MUSI umieć go narysować inaczej niż błąd:
     przy konflikcie świeżości szkic zostaje, a agent decyduje, co dalej. */
  if (odp.status === 409) {
    const { error, ...reszta } = dane;
    throw new Konflikt(error ?? "Konflikt wersji", reszta);
  }
  if (!odp.ok) throw new Error(dane.error ?? `Błąd ${odp.status}`);
  return dane as T;
}
