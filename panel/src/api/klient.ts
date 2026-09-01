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
  /* `content-type` TYLKO wtedy, gdy jest co opisywać. Nagłówek wysyłany zawsze
     wywraca każde żądanie BEZ CIAŁA: domyślny parser Fastify odrzuca pustą
     treść zadeklarowaną jako JSON (FST_ERR_CTP_EMPTY_JSON_BODY, 400), a ekran
     pokazuje wtedy gołe „Bad Request".

     To jest blizna z `biuro.html` (patrz komentarz przy tamtejszym `api()`)
     kupiona drugi raz. Tam kosztowała cztery martwe czynności naraz; tutaj —
     przycisk SYNCHRONIZUJ TERAZ, czyli ten, który ma pomóc, gdy synchronizacja
     stoi. Kolektor zna tę regułę osobno: `ApiService.kt` wysyła `EMPTY_BODY`
     bez nagłówka typu.

     Kusi, żeby to uprościć z powrotem do jednego obiektu. Nie upraszczaj:
     komunikat bez treści nie ma prawa deklarować typu treści. Pilnuje tego
     `klient.test.ts`. */
  const naglowki: Record<string, string> = {
    "x-session": token(),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body !== undefined && !naglowki["content-type"]) {
    naglowki["content-type"] = "application/json";
  }
  const odp = await fetch(sciezka, { ...init, headers: naglowki });
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
