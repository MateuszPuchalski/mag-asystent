import { describe, expect, it } from "vitest";
import { dniPl, dzienSkrot, liczbaPl, zdanieOSzczycie } from "./liczby";

/* Każda z tych funkcji miała w biurze pułapkę, którą łatwo zgubić przy
   przepisywaniu: kropka dziesiętna, odmiana ułamka i dzielenie przez zero. */
describe("liczby analizy po polsku (0.440.0)", () => {
  it("przecinek dziesiętny i brak zbędnego „,0”", () => {
    expect(liczbaPl(4.2)).toBe("4,2");
    expect(liczbaPl(12)).toBe("12");
    expect(liczbaPl(null)).toBe("—");
  });

  it("ułamek dnia idzie do dopełniacza liczby pojedynczej", () => {
    expect(dniPl(1)).toBe("1 dzień");
    expect(dniPl(3)).toBe("3 dni");
    expect(dniPl(1.5)).toBe("1,5 dnia");
    expect(dniPl(null)).toBe("—");
  });

  it("dzień z osi jako „26.08” — z napisu, bez przeliczania strefy", () => {
    expect(dzienSkrot("2026-08-26")).toBe("26.08");
  });

  it("zdanie o szczycie nie dzieli przez zero", () => {
    expect(zdanieOSzczycie(12, 4, "26.08", "pozycji"))
      .toBe("Szczyt 26.08 — 12 pozycji, czyli 3,0× mediana pozostałych (4).");
    expect(zdanieOSzczycie(9, 0, "w tygodniu 36", "dostaw"))
      .toBe("Szczyt w tygodniu 36 — 9 dostaw, przy medianie 0 w pozostałych.");
  });
});
