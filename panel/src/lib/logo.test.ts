import { describe, expect, it } from "vitest";
import { LOGO_MAX_ZNAKOW, ramkaWidoczna, wBoku, zmniejszajAzZmiesci } from "./logo";

/* ── Rachunek logo dostawcy (0.444.0) ──────────────────────────────────────
   Płótna jsdom nie ma, więc testujemy to, co w `naPng` jest rachunkiem:
   ramkę widocznej treści (to ona usuwa „powietrze" z 0.87.0) i pętlę
   zmniejszania, która ratuje zdjęcie szyldu przed limitem serwera. */

/** Obraz RGBA `w×h` z pikselami widocznymi tam, gdzie `widoczny(x,y)`. */
function obraz(w: number, h: number, widoczny: (x: number, y: number) => number) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = widoczny(x, y);
  return d;
}

describe("ramkaWidoczna", () => {
  it("obcina przezroczysty margines szerokiego logotypu", () => {
    const d = obraz(10, 10, (x, y) => (x >= 2 && x <= 7 && y >= 4 && y <= 5 ? 255 : 0));
    expect(ramkaWidoczna(d, 10, 10)).toEqual({ x: 2, y: 4, w: 6, h: 2 });
  });

  it("piksel prawie przezroczysty (≤ progu) liczy się jako pusty", () => {
    const d = obraz(4, 4, (x, y) => (x === 0 && y === 0 ? 8 : x === 3 && y === 3 ? 9 : 0));
    expect(ramkaWidoczna(d, 4, 4)).toEqual({ x: 3, y: 3, w: 1, h: 1 });
  });

  it("obraz cały pusty daje null — zapisujemy wtedy całość, nie jeden piksel", () => {
    expect(ramkaWidoczna(obraz(3, 3, () => 0), 3, 3)).toBeNull();
  });
});

describe("zmniejszajAzZmiesci", () => {
  it("mały logotyp zostaje w 256 px, bez drugiego kodowania", () => {
    const boki: number[] = [];
    zmniejszajAzZmiesci((b) => { boki.push(b); return "x".repeat(1000); });
    expect(boki).toEqual([256]);
  });

  it("za ciężkie zdjęcie szyldu schodzi połowami, aż się zmieści", () => {
    const boki: number[] = [];
    const wynik = zmniejszajAzZmiesci((b) => { boki.push(b); return "x".repeat(b * 1000); });
    expect(boki).toEqual([256, 128]);
    expect(wynik.length).toBeLessThanOrEqual(LOGO_MAX_ZNAKOW);
  });

  it("nie schodzi poniżej 64 px — resztę odmówi serwer, z powodem", () => {
    const boki: number[] = [];
    zmniejszajAzZmiesci((b) => { boki.push(b); return "x".repeat(LOGO_MAX_ZNAKOW + 1); });
    expect(boki).toEqual([256, 128, 64]);
  });
});

describe("wBoku", () => {
  it("wpisuje dłuższy bok i nigdy nie powiększa", () => {
    expect(wBoku(1000, 250, 256)).toEqual({ w: 256, h: 64 });
    expect(wBoku(100, 40, 256)).toEqual({ w: 100, h: 40 });
    expect(wBoku(5000, 1, 256)).toEqual({ w: 256, h: 1 });
  });
});
