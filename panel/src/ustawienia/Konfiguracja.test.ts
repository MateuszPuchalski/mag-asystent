import { describe, expect, it } from "vitest";
import { dataLokalna } from "../ui";
import type { WierszKonfiguracji } from "../api/ustawienia";
import { wartoscSlowem } from "./Konfiguracja";

/* Wartość słowem (@wydanie) — to, co wiersz decyzji właściciela pokazuje
   po prawej. Każdy przypadek to wiersz, który inaczej wróciłby do kreski
   albo do surowej wartości z pliku. */
const w = (x: Partial<WierszKonfiguracji>): WierszKonfiguracji => ({
  klucz: "K", grupa: "zwroty", kto: "wlasciciel", opis: "Opis.", czyta: ["serwer"], tajny: false,
  zrodlo: "domyslna", wartosc: null, edycja: null, ...x,
});

describe("wartoscSlowem", () => {
  it("liczba z odmienioną jednostką", () => {
    const jednostka: [string, string, string] = ["dzień", "dni", "dni"];
    expect(wartoscSlowem(w({ obowiazuje: "1", jednostka }))).toBe("1 dzień");
    expect(wartoscSlowem(w({ obowiazuje: "3", jednostka }))).toBe("3 dni");
    expect(wartoscSlowem(w({ obowiazuje: "45", jednostka }))).toBe("45 dni");
  });

  it("słowo z rejestru wygrywa z wartością z pliku", () => {
    expect(wartoscSlowem(w({ obowiazuje: "0", wartosci: { "0": "wyłączony", "1": "włączony" } }))).toBe("wyłączony");
  });

  it("data lokalnie, pusty próg jako „bez progu”", () => {
    const iso = "2026-08-19T22:00:00.000Z";
    expect(wartoscSlowem(w({ obowiazuje: iso, rodzaj: "data" }))).toBe(dataLokalna(iso));
    expect(wartoscSlowem(w({ obowiazuje: "", rodzaj: "data" }))).toBe("bez progu");
  });

  it("obowiązująca przed wartością z pliku; bez obu — „domyślna”", () => {
    /* Przy dacie z pliku serwer zwraca ją znormalizowaną: to ona obowiązuje. */
    expect(wartoscSlowem(w({ zrodlo: "plik", wartosc: "7", obowiazuje: "8" }))).toBe("8");
    /* Klucz workera C#: serwer nie zna domyślnej, więc jej nie zmyśla. */
    expect(wartoscSlowem(w({ zrodlo: "plik", wartosc: "3", obowiazuje: null }))).toBe("3");
    expect(wartoscSlowem(w({ obowiazuje: null }))).toBe("domyślna");
  });

  it("sekret tylko jako ustawiony albo brak", () => {
    expect(wartoscSlowem(w({ tajny: true, zrodlo: "plik" }))).toBe("ustawiony");
    expect(wartoscSlowem(w({ tajny: true }))).toBe("brak");
  });
});
