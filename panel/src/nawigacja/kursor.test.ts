import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { celKursora, useKursorListy } from "./kursor";

describe("kursor kolejki", () => {
  it("chodzi o jedno w obie strony i nie wychodzi poza listę", () => {
    expect(celKursora(3, 1, 1, 1)).toBe(2);
    expect(celKursora(3, 1, 1, -1)).toBe(0);
    expect(celKursora(3, 2, 2, 1)).toBe(2);
    expect(celKursora(3, 0, 0, -1)).toBe(0);
  });

  it("po zejściu sprawy z listy `j` otwiera tę, która stanęła na jej miejscu", () => {
    // Sprawa z pozycji 1 zeszła: dawna pozycja 2 jest teraz pod indeksem 1.
    expect(celKursora(2, -1, 1, 1)).toBe(1);
    expect(celKursora(2, -1, 1, -1)).toBe(0);
  });

  it("po zejściu ostatniej sprawy staje na nowej ostatniej", () => {
    expect(celKursora(2, -1, 2, 1)).toBe(1);
  });

  it("pusta lista nie ma celu", () => {
    expect(celKursora(0, -1, 0, 1)).toBeNull();
  });
});

describe("kursor pamięta miejsce tylko na swojej liście", () => {
  const lista = (ids: number[]) => ids.map((id) => ({ id }));

  it("po zmianie listy przy otwartej sprawie spoza niej zaczyna od góry", () => {
    const otwarte: number[] = [];
    const hak = renderHook(({ widoczne, tryb }: { widoczne: Array<{ id: number }>; tryb: string }) =>
      useKursorListy(widoczne, 13, (el) => otwarte.push(el.id), tryb),
      { initialProps: { widoczne: lista([11, 12, 13, 14]), tryb: "praca" } });
    /* Sprawa 13 stoi na trzecim miejscu; nowa lista jej nie zawiera. */
    hak.rerender({ widoczne: lista([21, 22, 23, 24]), tryb: "mm" });
    hak.result.current(1);
    hak.result.current(-1);
    expect(otwarte).toEqual([21, 21]);
  });

  it("na tej samej liście dalej otwiera sprawę, która stanęła na zwolnionym miejscu", () => {
    const otwarte: number[] = [];
    const hak = renderHook(({ widoczne }: { widoczne: Array<{ id: number }> }) =>
      useKursorListy(widoczne, 13, (el) => otwarte.push(el.id), "praca"),
      { initialProps: { widoczne: lista([11, 12, 13, 14]) } });
    hak.rerender({ widoczne: lista([11, 12, 14]) });
    hak.result.current(1);
    expect(otwarte).toEqual([14]);
  });
});
