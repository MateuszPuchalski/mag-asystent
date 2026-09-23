import { describe, expect, it } from "vitest";
import { rodzinaZdarzenia } from "./rodziny";
import { granicaDoby, paramyDziennika, FILTR_PUSTY } from "../api/wglad";

describe("rodzina zdarzenia (z biura 0.427.0)", () => {
  it("błąd wygrywa z każdą inną rodziną — kolejność testów ma znaczenie", () => {
    expect(rodzinaZdarzenia("queue_failed")).toBe("blad");
    expect(rodzinaZdarzenia("putaway_rejected")).toBe("blad");
    expect(rodzinaZdarzenia("device_drop")).toBe("blad");
  });

  it("dostawy, zwroty i reszta", () => {
    expect(rodzinaZdarzenia("putaway_line_done")).toBe("dostawa");
    expect(rodzinaZdarzenia("kosz_zwrotow_dolozono")).toBe("zwrot");
    expect(rodzinaZdarzenia("scan")).toBe("inne");
  });
});

describe("filtr dziennika liczy dobę LOKALNĄ (0.440.0)", () => {
  /* Biuro wysyłało gołe „2026-09-22", a serwer porównuje je napisowo z czasem
     w UTC — więc doba zaczynała się o 02:00 czasu polskiego. */
  it("granice doby to północ i koniec doby przeglądarki, w UTC", () => {
    expect(granicaDoby("2026-09-22", false)).toBe(new Date(2026, 8, 22).toISOString());
    expect(granicaDoby("2026-09-22", true)).toBe(new Date(2026, 8, 22, 23, 59, 59, 999).toISOString());
    expect(granicaDoby("", false)).toBe("");
  });

  it("puste pola nie trafiają do zapytania, limit zawsze", () => {
    expect(paramyDziennika(FILTR_PUSTY)).toBe("limit=100");
    const p = new URLSearchParams(paramyDziennika({ ...FILTR_PUSTY, od: "2026-09-22", device: " KOL-03 ", userRef: "7" }));
    expect(p.get("od")).toBe(new Date(2026, 8, 22).toISOString());
    expect(p.get("device")).toBe("KOL-03");
    expect(p.get("userRef")).toBe("7");
    expect(p.has("do")).toBe(false);
  });
});
