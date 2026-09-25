import { describe, expect, it } from "vitest";
import { podpisTygodnia, zmiana } from "./porownanie";

describe("porównanie tygodni", () => {
  it("różnica w sztukach, ze znakiem minus typograficznym", () => {
    expect(zmiana(12, 9)).toBe("+3");
    expect(zmiana(9, 12)).toBe("−3");
    expect(zmiana(0.33, 0.25)).toBe("+0,08");
    expect(zmiana(4, 4)).toBe("bez zmian");
  });

  it("brak któregoś tygodnia to kreska, nie zero", () => {
    expect(zmiana(5, null)).toBe("—");
    expect(zmiana(null, 5)).toBe("—");
    expect(zmiana(5, undefined)).toBe("—");
  });

  it("podpis z dat serwera", () => {
    expect(podpisTygodnia({ tydzien: "2026-W38", dni: ["2026-09-14", "2026-09-20"] })).toBe("t38 · 14.09–20.09.2026");
    expect(podpisTygodnia({ tydzien: "2027-W01", dni: ["2027-01-04", "2027-01-10"] })).toBe("t1 · 04.01–10.01.2027");
  });
});
