import { describe, expect, it } from "vitest";
import { sitoDecyzji } from "./sita";

const baza = { dostarczonoAt: null, paczkaAt: null, przesylkaStatus: null, sygnaly: [] };

describe("sitoDecyzji (@wydanie)", () => {
  it("doręczenie wygrywa, choćby przewoźnik dopisał później inny status", () => {
    expect(sitoDecyzji({ ...baza, dostarczonoAt: "2026-09-20T10:00:00Z",
      paczkaAt: "2026-09-18T10:00:00Z", przesylkaStatus: "RETURNED" })).toBe("doreczone");
  });

  it("etykieta bez żadnego wpisu przewoźnika to osobne sito, nie doręczenie", () => {
    expect(sitoDecyzji({ ...baza, paczkaAt: "2026-09-18T10:00:00Z" })).toBe("bez_skanu");
  });

  it("paczka ze statusem przewoźnika i bez doręczenia jest w drodze", () => {
    expect(sitoDecyzji({ ...baza, paczkaAt: "2026-09-18T10:00:00Z",
      przesylkaStatus: "IN_TRANSIT" })).toBe("w_drodze");
  });

  it("„nie odesłał” idzie za sygnałem serwera, a świeże zgłoszenie bez etykiety czeka", () => {
    expect(sitoDecyzji({ ...baza, sygnaly: ["nie_odeslany"] })).toBe("nie_odeslal");
    expect(sitoDecyzji({ ...baza, sygnaly: ["brak_dowodu"] })).toBe("w_drodze");
  });
});
