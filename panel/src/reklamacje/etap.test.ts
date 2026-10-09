import { describe, expect, it } from "vitest";
import { ileReklamacji, tytulStatusu } from "./etap";

/* ── Słowa o stanie sprawy ───────────────────────────────────────────────────
   Dwie funkcje z więcej niż jednym czytelnikiem. Pilnujemy, że surowy kod
   Allegro trafia do podpowiedzi, a licznik historii mówi liczbą z odmianą
   i nie wymienia zer. */

describe("Słowa o stanie sprawy", () => {
  it("surowy kod Allegro idzie do podpowiedzi, a jego brak mówi o sobie", () => {
    expect(tytulStatusu("CLAIM_SUBMITTED")).toBe("Status w Allegro: CLAIM_SUBMITTED");
    expect(tytulStatusu(null)).toBe("Allegro nie podało statusu");
  });

  it("licznik historii mówi liczbą i rozstrzygnięciami, a zer nie wymienia", () => {
    expect(ileReklamacji({ ile: 2, uznanych: 1, odrzuconych: 1 })).toBe("2 reklamacje (1 uznana, 1 odrzucona)");
    expect(ileReklamacji({ ile: 5, uznanych: 0, odrzuconych: 0 })).toBe("5 reklamacji");
    expect(ileReklamacji({ ile: 2, uznanych: 1, odrzuconych: 1 }, " u nas"))
      .toBe("2 reklamacje u nas (1 uznana, 1 odrzucona)");
  });
});
