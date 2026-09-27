import { vi } from "vitest";

/**
 * Atrapa `fetch`, która LICZY ZAPISY (0.544.0).
 *
 * Reguła „zero zapisu przy patrzeniu" ma strażnika tylko wtedy, gdy test
 * ekranu widzi każde żądanie inne niż GET. Test, który podmienia moduł
 * `../api/...`, widzi wyłącznie haki, które sam podstawił. Zapis wołany
 * z pominięciem haka przeszedłby więc niezauważony. Ta atrapa siedzi
 * poziom niżej, na samym `fetch`, gdzie pominąć jej nie ma jak.
 *
 * `odczyt` dostaje adres GET i oddaje ciało odpowiedzi albo `undefined`,
 * gdy adresu nie zna. Nieznany adres trafia do `nieznane`, a test ma
 * sprawdzić, że ta lista jest pusta. Wyjątek rzucony w atrapie tego nie
 * zastąpi: zapytanie połyka go jako własny błąd, a test dalej świeci na
 * zielono, choć ekran nie narysował połowy danych.
 */
export function atrapaZapisow(odczyt: (url: string) => unknown): {
  wyslane: string[]; nieznane: string[];
} {
  const stan = { wyslane: [] as string[], nieznane: [] as string[] };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    if (metoda !== "GET") {
      stan.wyslane.push(`${metoda} ${url}`);
      return new Response("{}", { status: 200 });
    }
    const cialo = odczyt(url);
    if (cialo === undefined) {
      stan.nieznane.push(url);
      return new Response(JSON.stringify({ error: "nieznany adres w teście" }), { status: 404 });
    }
    return new Response(JSON.stringify(cialo), { status: 200 });
  }));
  return stan;
}
