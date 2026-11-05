import { describe, expect, it } from "vitest";
import { liniaPowodu, rozliczenieWerdyktu } from "./slownik";

/* ── Słownik reklamacji ──────────────────────────────────────────────────────
   1. LINIA ZGŁOSZENIA TO JEDYNY DOM powodu, żądania z kwotą i tytułu
      prawnego. Karta Produkt ich nie powtarza, więc linia ma mówić wszystko.
   2. KOD SPOZA SŁOWNIKA ZOSTAJE KODEM — zgadnięte słowo byłoby nieprawdą. */

const r = (p: Partial<Parameters<typeof liniaPowodu>[0]> = {}) => ({
  powodTyp: "NOT_AS_DESCRIBED", oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: null,
  waluta: "PLN", prawo: "COMPLAINT", ...p,
});

describe("liniaPowodu", () => {
  it("powód, żądanie i tytuł prawny w jednej linii", () => {
    expect(liniaPowodu(r())).toBe("Powód: niezgodny z opisem · chce zwrotu pieniędzy · rękojmia");
  });

  it("kwota stoi przy żądaniu, bo „chce zwrotu 40 zł” to jedno żądanie", () => {
    expect(liniaPowodu(r({ oczekiwanie: "PARTIAL_REFUND", oczekiwanaKwotaGrosze: 4000 })))
      .toBe("Powód: niezgodny z opisem · chce częściowego zwrotu 40,00 PLN · rękojmia");
  });

  it("bez powodu żądanie zaczyna linię wielką literą", () => {
    expect(liniaPowodu(r({ powodTyp: null, prawo: null }))).toBe("Chce zwrotu pieniędzy");
  });

  it("kody spoza słownika zostają kodami", () => {
    expect(liniaPowodu(r({ powodTyp: "NOWY_POWOD", oczekiwanie: "NOWE", prawo: "NOWE_PRAWO" })))
      .toBe("Powód: NOWY_POWOD · chce NOWE · NOWE_PRAWO");
  });

  it("brak wszystkiego to brak linii, nie pusty napis", () => {
    expect(liniaPowodu(r({ powodTyp: null, oczekiwanie: null, prawo: null }))).toBeNull();
  });
});

describe("rozliczenieWerdyktu", () => {
  it("uznanie mówi, co rozliczyć, a odrzucenie i nieznany kod — nic", () => {
    expect(rozliczenieWerdyktu("ACCEPTED_PARTIAL_REFUND")).toBe("częściowy zwrot");
    expect(rozliczenieWerdyktu("ACCEPTED_EXCHANGE")).toBe("wymiana");
    expect(rozliczenieWerdyktu("REJECTED_OTHER")).toBeNull();
    expect(rozliczenieWerdyktu(null)).toBeNull();
  });
});
