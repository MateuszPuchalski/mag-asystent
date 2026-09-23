import { describe, expect, it } from "vitest";
import type { Zwrot } from "../api/typy";
import { szablonyWiadomosci } from "./Wiadomosc";

/* Szablon mówi do klienta w imieniu firmy, więc strażnicy pilnują faktów:
   nazwy, powodu i kwoty — i tego, żeby szablon bez treści się nie pokazał. */

const pozycja = (n: Record<string, unknown> = {}) => ({
  id: 1, nazwa: "Sekator NAC", ilosc: 1, cenaGrosze: 4999, waluta: "PLN", ocena: "stan",
  potracenieGrosze: null, potraceniePowod: null, ...n,
});
const zwrot = (n: Record<string, unknown> = {}) => ({
  id: 1, orderId: "ord-9", zamowienie: null, werdykt: "przyjety", werdyktPowod: null,
  kwotaGrosze: 4999, waluta: "PLN", rozmowy: [], pozycje: [pozycja()], ...n,
}) as unknown as Zwrot;

describe("Gotowa wiadomość do klienta", () => {
  it("potrącenie daje szablon z nazwą, powodem, potrąceniem i kwotą", () => {
    const s = szablonyWiadomosci(zwrot({
      kwotaGrosze: 3999,
      pozycje: [pozycja({ potracenieGrosze: 1000, potraceniePowod: "rysa na ostrzu" })],
    }));
    expect(s.map((x) => x.id)).toEqual(["pomniejszony"]);
    expect(s[0].tresc).toContain("Sekator NAC: rysa na ostrzu");
    expect(s[0].tresc).toContain("zamówienia ord-9");
    expect(s[0].tresc).toMatch(/oddajemy 39,99/);
  });

  it("towar do utylizacji daje pytanie o stan przy nadaniu", () => {
    const s = szablonyWiadomosci(zwrot({ pozycje: [pozycja({ ocena: "utylizacja" })] }));
    expect(s.map((x) => x.id)).toContain("uszkodzony");
  });

  it("odmowa niesie powód werdyktu", () => {
    const s = szablonyWiadomosci(zwrot({ werdykt: "odrzucony", werdyktPowod: "towar używany" }));
    expect(s.find((x) => x.id === "odmowa")?.tresc).toContain("Powód: towar używany.");
  });

  it("zwrot bez decyzji i bez kwoty nie ma jeszcze czego napisać", () => {
    expect(szablonyWiadomosci(zwrot({ werdykt: null, kwotaGrosze: null }))).toEqual([]);
  });
});
