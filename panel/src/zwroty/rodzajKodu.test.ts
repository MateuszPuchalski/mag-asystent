import { describe, expect, it } from "vitest";
import { wygladaNaEan } from "./rodzajKodu";

/* Pomyłka w tę stronę wkłada etykietę do koszyka, w tamtą — kończy skan
   towaru zdaniem „Nie znam kodu". Oba kierunki kosztują czynność przy pudle. */

describe("Etykieta czy EAN", () => {
  it("rozpoznaje EAN-13, EAN-8, UPC-A i GTIN-14 z poprawną cyfrą kontrolną", () => {
    expect(wygladaNaEan("5901234123457")).toBe(true);
    expect(wygladaNaEan("96385074")).toBe(true);
    expect(wygladaNaEan("036000291452")).toBe(true);
    expect(wygladaNaEan("15901234123454")).toBe(true);
  });

  it("zła cyfra kontrolna to nie EAN — tak odpada większość cyfrowych etykiet", () => {
    expect(wygladaNaEan("5901234123458")).toBe(false);
  });

  it("etykiety przewoźników i numery zwrotów nie są EAN-em", () => {
    expect(wygladaNaEan("600000367616070023174201")).toBe(false); // InPost, 24 znaki
    expect(wygladaNaEan("1234/Z04A")).toBe(false);
    expect(wygladaNaEan("RR123456785PL")).toBe(false);
    expect(wygladaNaEan("59012341234")).toBe(false); // 11 cyfr — żaden standard
  });
});
