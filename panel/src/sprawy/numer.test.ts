import { describe, expect, it } from "vitest";
import { krotkiNumerZamowienia } from "./numer";

describe("krotkiNumerZamowienia", () => {
  it("UUID skraca się do ośmiu pierwszych znaków", () => {
    expect(krotkiNumerZamowienia("663f38f1-b98e-11f1-97b7-874d04101a2b")).toBe("663f38f1");
  });

  it("numer cyfrowy zostaje w całości, bo ucięty wskazywałby inne zamówienie", () => {
    expect(krotkiNumerZamowienia("17147703077")).toBe("17147703077");
  });

  it("napis, który tylko przypomina UUID, nie jest ruszany", () => {
    expect(krotkiNumerZamowienia("ord-1")).toBe("ord-1");
    expect(krotkiNumerZamowienia("663f38f1-b98e")).toBe("663f38f1-b98e");
  });
});
