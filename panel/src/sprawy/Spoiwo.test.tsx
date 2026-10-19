import { describe, it, expect } from "vitest";
import type { PrzystanekDrogi, SprawaZakupu } from "../api/typy";
import { adresPrzystanku, inneSprawyZakupu, KOLEJKI } from "./Spoiwo";

/* ── Spoiwo kolejek (`docs/obsluga-klienta-calosc.md`) ───────────────────────
   Słownik kolejek i składanie ich spraw w przystanki paska drogi. Testy
   pilnują tego, co przy kopiowaniu w kilku miejscach rozjechałoby się pierwsze:

   1. DYSKUSJA NIE JEST REKLAMACJĄ. Jedna plakietka na oba byty to błąd,
      który kosztował już jedno wydanie.
   2. SPRAWA Z DROGI I Z RODZEŃSTWA STOI RAZ, i niesie stan z wiersza rodzeństwa.
   3. STAN NIE JEST ZGADYWANY. Zwrot i rozmowa nie mają wiersza rodzeństwa, więc
      zostają bez „otwarta”, bo brak stanu to nie jest stan otwarty.             */

const sprawa = (n: Partial<SprawaZakupu> = {}): SprawaZakupu => ({
  id: 7, typ: "CLAIM", numer: "12/2026", temat: "Nie działa", statusAllegro: null,
  decyzjaDo: null, otwartoAt: "2026-09-10T08:00:00Z", prowadzi: null, otwarta: true, ...n,
});

const przystanek = (n: Partial<PrzystanekDrogi> = {}): PrzystanekDrogi => ({
  rodzaj: "rozmowa", id: 1, at: "2026-09-01T08:00:00Z", opis: null, ...n,
});

describe("inneSprawyZakupu", () => {
  it("rozróżnia dyskusję od reklamacji po kolumnie `typ`", () => {
    const inne = inneSprawyZakupu([], [
      sprawa({ id: 7, typ: "CLAIM" }), sprawa({ id: 9, typ: "DISPUTE", numer: null }),
    ], null);
    expect(inne.map((s) => `${s.rodzaj}-${s.id}`)).toEqual(["reklamacja-7", "dyskusja-9"]);
    expect(Object.keys(KOLEJKI)).toEqual(["rozmowa", "dyskusja", "reklamacja", "zwrot", "pomylka"]);
  });

  it("sprawa z drogi i z rodzeństwa staje raz, ze stanem, terminem i prowadzącym", () => {
    const inne = inneSprawyZakupu(
      [przystanek({ rodzaj: "reklamacja", id: 7, at: "2026-09-10T08:00:00Z", opis: "Nie działa" })],
      [sprawa({ id: 7, decyzjaDo: "2026-09-20T00:00:00Z", prowadzi: "Ola" })], null);
    expect(inne).toHaveLength(1);
    expect(inne[0]).toMatchObject({ otwarta: true, decyzjaDo: "2026-09-20T00:00:00Z", prowadzi: "Ola",
      numer: "12/2026", opis: "Nie działa" });
  });

  it("zwrot i rozmowa niosą opis z drogi, ale nie udają stanu", () => {
    const inne = inneSprawyZakupu([
      przystanek({ rodzaj: "zwrot", id: 5, opis: "RET-1" }), przystanek({ rodzaj: "rozmowa", id: 1, opis: "Pytanie" }),
    ], [], null);
    expect(inne.map((s) => s.opis)).toEqual(["RET-1", "Pytanie"]);
    for (const s of inne) {
      expect(s.otwarta).toBeUndefined();
      expect(s.decyzjaDo).toBeUndefined();
    }
  });

  it("pomija sprawę, której kroki rysuje sam pasek", () => {
    const inne = inneSprawyZakupu([przystanek({ rodzaj: "reklamacja", id: 7 })], [sprawa({ id: 7 })],
      { rodzaj: "reklamacja", id: 7 });
    expect(inne).toEqual([]);
  });

  it("zamknięta sprawa niesie `otwarta: false`", () => {
    const [s] = inneSprawyZakupu([], [sprawa({ otwarta: false })], null);
    expect(s.otwarta).toBe(false);
  });
});

describe("adresPrzystanku", () => {
  it("pomyłka prowadzi do swojego wiersza na liście, z miesiącem; reszta do ścieżki sprawy", () => {
    expect(adresPrzystanku("pomylka", 5, "2026-09-14")).toBe("/obsluga/pomylki?id=5&miesiac=2026-09");
    expect(adresPrzystanku("zwrot", 8, "2026-09-14T10:00:00Z")).toBe("/obsluga/zwroty/8");
  });
});
