import { describe, expect, it } from "vitest";
import { lukaReczna, wersjaWPolu, wersjeSzkicu, zwin } from "./wersjeSzkicu";
import type { SzkicCopilota, WymianaCopilota } from "../api/typy";

/* ── Wersje szkicu Copilota ──────────────────────────────────────────────────
   Wersją jest oryginał i każda wymiana z `szkicPo`. Historia należy do
   jednego szkicu: poprawki sprzed „Ułóż ponownie” do niej nie wchodzą.     */

const szkic = (n: Partial<SzkicCopilota> = {}): SzkicCopilota => ({
  tresc: "Dzień dobry, nóż pasuje.", zastrzezenia: ["brak tabliczki"], uzyteFakty: [],
  messageId: 1, model: "m", at: "2026-10-20T10:00:00Z", przez: "Copilot", ocena: null,
  twierdzenia: [], odczytZeZdjec: [], ...n,
});

const tw = (teza: string) => ({ teza, zrodlo: "model" as const, odwolanie: null,
  pewnosc: "prawdopodobne" as const, obnizona: false });

const wymiana = (id: number, at: string, n: Partial<WymianaCopilota> = {}): WymianaCopilota => ({
  id, pytanie: "popraw", odpowiedz: "Dodałem link.", twierdzenia: [], model: "m", at, przez: "A. L.",
  szkicPrzed: null, szkicPo: null, szkicTwierdzenia: [], szkicZastrzezenia: [], szkicOdrzucony: null, ...n,
});

describe("wersjeSzkicu", () => {
  it("oryginał to wersja 1, każda poprawka następna — pytania i odrzucenia nie są wersjami", () => {
    const w = wersjeSzkicu(szkic(), [
      wymiana(1, "2026-10-20T10:01:00.000Z", { szkicPrzed: "Dzień dobry, nóż pasuje.",
        szkicPo: "Dzień dobry, nóż pasuje do LS 46.", szkicTwierdzenia: [tw("pasuje do LS 46")] }),
      wymiana(2, "2026-10-20T10:02:00.000Z"),
      wymiana(3, "2026-10-20T10:03:00.000Z", { szkicPrzed: "x", szkicOdrzucony: "numer bez źródła" }),
      wymiana(4, "2026-10-20T10:04:00.000Z", { szkicPrzed: "y", szkicPo: "Wersja trzecia." }),
    ]);
    expect(w.map((v) => [v.nr, v.zrodlo, v.tresc])).toEqual([
      [1, "szkic", "Dzień dobry, nóż pasuje."],
      [2, "wymiana", "Dzień dobry, nóż pasuje do LS 46."],
      [3, "wymiana", "Wersja trzecia."],
    ]);
    expect(w[0].zastrzezenia).toEqual(["brak tabliczki"]);
    expect(w[1].twierdzenia).toEqual([tw("pasuje do LS 46")]);
  });

  it("poprawki sprzed obecnego szkicu nie wchodzą do jego historii", () => {
    const w = wersjeSzkicu(szkic({ at: "2026-10-20T12:00:00Z" }), [
      wymiana(1, "2026-10-20T11:00:00.000Z", { szkicPrzed: "a", szkicPo: "stara poprawka" }),
      wymiana(2, "2026-10-20T12:05:00.000Z", { szkicPrzed: "b", szkicPo: "nowa poprawka" }),
    ]);
    expect(w.map((v) => v.tresc)).toEqual(["Dzień dobry, nóż pasuje.", "nowa poprawka"]);
  });

  it("bez szkicu wersjami są same poprawki, od numeru 1", () => {
    const w = wersjeSzkicu(null, [wymiana(1, "2026-10-20T10:01:00Z", { szkicPrzed: "a", szkicPo: "b" })]);
    expect(w.map((v) => [v.nr, v.tresc])).toEqual([[1, "b"]]);
  });

  it("stara wymiana bez pól szkicu nie wywraca listy", () => {
    const stara = { id: 9, pytanie: "skąd wiesz?", odpowiedz: "Z karty.", twierdzenia: [], model: "m",
      at: "2026-10-20T10:01:00Z", przez: "A. L." } as WymianaCopilota;
    expect(wersjeSzkicu(szkic(), [stara])).toHaveLength(1);
    expect(lukaReczna(wersjeSzkicu(szkic(), [stara]), stara)).toBeNull();
  });
});

describe("wersjaWPolu", () => {
  const w = wersjeSzkicu(szkic(), [
    wymiana(1, "2026-10-20T10:01:00Z", { szkicPrzed: "x", szkicPo: "Druga  wersja." }),
    wymiana(2, "2026-10-20T10:02:00Z", { szkicPrzed: "x", szkicPo: "Dzień dobry, nóż pasuje." }),
  ]);

  it("porównuje po zwinięciu białych znaków i bierze NAJNOWSZĄ równą wersję", () => {
    expect(wersjaWPolu(w, "Druga\nwersja. ")?.nr).toBe(2);
    /* Wersja 3 brzmi jak oryginał — wygrywa nowsza. */
    expect(wersjaWPolu(w, "Dzień dobry, nóż pasuje.")?.nr).toBe(3);
  });

  it("puste pole i tekst agenta nie są żadną wersją", () => {
    expect(wersjaWPolu(w, "")).toBeNull();
    expect(wersjaWPolu(w, "   ")).toBeNull();
    expect(wersjaWPolu(w, "Mój tekst.")).toBeNull();
  });

  it("zwin skleja odstępy i nowe linie", () => {
    expect(zwin("  a \n\n b\t")).toBe("a b");
  });
});

describe("lukaReczna", () => {
  it("agent zmienił tekst przed poleceniem — luka niesie poprzednią wersję", () => {
    const wym = [
      wymiana(1, "2026-10-20T10:01:00Z", { szkicPrzed: "Dzień dobry, nóż pasuje.", szkicPo: "Wersja dwa." }),
      wymiana(2, "2026-10-20T10:02:00Z", { szkicPrzed: "Wersja dwa. Pozdrawiam.", szkicPo: "Wersja trzy." }),
    ];
    const w = wersjeSzkicu(szkic(), wym);
    expect(lukaReczna(w, wym[0])).toBeNull();
    const luka = lukaReczna(w, wym[1]);
    expect(luka?.poprzednia.nr).toBe(2);
    expect(luka?.przed).toBe("Wersja dwa. Pozdrawiam.");
  });

  it("czyste pytanie nie ma luki, a różnica samych odstępów to nie zmiana", () => {
    const wym = [wymiana(1, "2026-10-20T10:01:00Z"),
      wymiana(2, "2026-10-20T10:02:00Z", { szkicPrzed: "Dzień dobry,\nnóż pasuje.", szkicPo: "Inaczej." })];
    const w = wersjeSzkicu(szkic(), wym);
    expect(lukaReczna(w, wym[0])).toBeNull();
    expect(lukaReczna(w, wym[1])).toBeNull();
  });
});
