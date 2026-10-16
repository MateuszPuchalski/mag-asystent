import { describe, expect, it } from "vitest";
import { celKursora } from "./kursor";

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
