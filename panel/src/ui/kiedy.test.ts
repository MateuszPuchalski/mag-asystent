import { afterAll, describe, expect, it, vi } from "vitest";
import { kiedy } from "./index";

/* `kiedy` skraca chwilę w wierszu listy. Dzień liczy się od lokalnej północy,
   nie co 24 godziny — inaczej wiadomość z 23:50 byłaby o 00:10 „dzisiaj". */

/* Strefa magazynu, nie UTC z CI. W UTC doba nigdy nie ma 23 godzin, więc test
   zmiany czasu przechodziłby także z `Math.floor` i niczego by nie pilnował.
   Strefa staje PRZED pierwszą datą pliku, bo `new Date(rok, …)` czyta ją przy
   tworzeniu. Node czyta `TZ` w biegu; `afterAll` oddaje ją następnym plikom. */
vi.stubEnv("TZ", "Europe/Warsaw");
afterAll(() => { vi.unstubAllEnvs(); });

const o = (rok: number, m: number, d: number, g = 12, min = 0) => new Date(rok, m, d, g, min);
const teraz = o(2026, 9, 5, 0, 10);

describe("kiedy", () => {
  it("dziś — sama godzina", () => {
    expect(kiedy(o(2026, 9, 5, 0, 5).toISOString(), teraz)).toBe("00:05");
  });

  it("wczoraj — słowo, także dziesięć minut przed północą", () => {
    expect(kiedy(o(2026, 9, 4, 23, 50).toISOString(), teraz)).toBe("wczoraj");
    expect(kiedy(o(2026, 9, 4, 0, 1).toISOString(), teraz)).toBe("wczoraj");
  });

  it("wcześniej w tym roku — dzień i miesiąc, bez roku", () => {
    expect(kiedy(o(2026, 9, 3).toISOString(), teraz)).toBe("03.10");
    expect(kiedy(o(2026, 0, 1).toISOString(), teraz)).toBe("01.01");
  });

  it("w poprzednim roku — z rokiem, bo bez niego to inna data", () => {
    expect(kiedy(o(2025, 11, 31).toISOString(), teraz)).toBe("31.12.2025");
  });

  it("doba przy zmianie czasu ma 23 godziny i dalej jest „wczoraj”", () => {
    /* Bez tej asercji test przeszedłby po cichu w UTC — patrz nagłówek pliku. */
    expect(o(2026, 2, 30, 0).getTime() - o(2026, 2, 29, 0).getTime()).toBe(23 * 3_600_000);
    expect(kiedy(o(2026, 2, 29, 1, 0).toISOString(), o(2026, 2, 30, 9, 0))).toBe("wczoraj");
  });

  it("brak chwili to kreska, jak w `czas()`", () => {
    expect(kiedy(null, teraz)).toBe("—");
    expect(kiedy(undefined, teraz)).toBe("—");
  });
});
