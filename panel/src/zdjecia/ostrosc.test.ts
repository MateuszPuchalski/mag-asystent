import { describe, expect, it } from "vitest";
import { lepszeOd, ocenPiksele, odNajgorszych, podProgiem, skaluj, wymiaryPomiaru, type Ocena } from "./ostrosc";

/* ── Miara ostrości na syntetycznych pikselach ─────────────────────────────
   Obrazy budujemy z funkcji szarości, żeby każdy test mówił, co porównuje:
   ostrą krawędź z rozmytą, przedmiot z białym tłem i bez, mały obraz
   powiększony z tym samym obrazem w pełnym rozmiarze. */

/** Obraz RGBA z funkcji szarości (x, y) → 0..255, nieprzezroczysty. */
function obraz(szer: number, wys: number, f: (x: number, y: number) => number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(szer * wys * 4);
  for (let y = 0; y < wys; y++) for (let x = 0; x < szer; x++) {
    const v = f(x, y), i = (y * szer + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  return d;
}

/** Szachownica o polu `pole` px: dużo krawędzi, jak napisy na opakowaniu. */
const szachownica = (pole: number) => (x: number, y: number) =>
  (Math.floor(x / pole) + Math.floor(y / pole)) % 2 ? 200 : 20;

/** Ta sama szachownica zmniejszona średnią z bloków `k`×`k` — mały plik z tego samego ujęcia. */
function zmniejszona(szer: number, pole: number, k: number): Uint8ClampedArray {
  const f = szachownica(pole);
  return obraz(szer / k, szer / k, (x, y) => {
    let s = 0;
    for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) s += f(x * k + xx, y * k + yy);
    return s / (k * k);
  });
}

describe("ocenPiksele", () => {
  it("ostra krawędź ma wyższą ostrość niż ta sama krawędź rozmyta", () => {
    const ostra = ocenPiksele(obraz(400, 400, (x) => (x < 200 ? 30 : 255)), 400, 400);
    const rozmyta = ocenPiksele(obraz(400, 400, (x) => 30 + Math.min(225, Math.max(0, (x - 190) * 11.25))), 400, 400);
    expect(ostra.ostrosc).not.toBeNull();
    expect(rozmyta.ostrosc).not.toBeNull();
    expect(ostra.ostrosc!).toBeGreaterThan(rozmyta.ostrosc! * 10);
  });

  it("białe tło nie zaniża wyniku: połowa kadru biała daje tę samą ostrość", () => {
    const f = szachownica(4);
    const caly = ocenPiksele(obraz(400, 400, f), 400, 400);
    const zTlem = ocenPiksele(obraz(400, 400, (x, y) => (y < 200 ? f(x, y) : 255)), 400, 400);
    expect(zTlem.ostrosc! / caly.ostrosc!).toBeGreaterThan(0.85);
    expect(zTlem.ostrosc! / caly.ostrosc!).toBeLessThan(1.15);
  });

  it("mały obraz powiększony do pomiaru wychodzi miększy niż ten sam obraz duży", () => {
    const duzy = ocenPiksele(obraz(400, 400, szachownica(8)), 400, 400);
    const maly = ocenPiksele(zmniejszona(400, 8, 4), 100, 100);
    expect(maly.bok).toBe(100);
    expect(duzy.bok).toBe(400);
    expect(maly.ostrosc!).toBeLessThan(duzy.ostrosc! * 0.5);
  });

  it("duży obraz zmniejszony do pomiaru daje tę samą miarę co obraz już w rozmiarze pomiaru", () => {
    const duzy = ocenPiksele(obraz(800, 800, szachownica(8)), 800, 800);
    const wPomiarze = ocenPiksele(obraz(400, 400, szachownica(4)), 400, 400);
    expect(duzy.bok).toBe(800);
    expect(duzy.ostrosc! / wPomiarze.ostrosc!).toBeGreaterThan(0.9);
    expect(duzy.ostrosc! / wPomiarze.ostrosc!).toBeLessThan(1.1);
  });

  it("przedmiot poniżej 5% kadru: ostrości nie da się ocenić", () => {
    const o = ocenPiksele(obraz(400, 400, (x, y) => (x > 190 && x < 210 && y > 190 && y < 210 ? 0 : 255)), 400, 400);
    expect(o).toEqual({ bok: 400, ostrosc: null });
  });

  it("przezroczystość liczy się jak biel", () => {
    const d = obraz(400, 400, szachownica(4));
    for (let i = 3; i < d.length; i += 4) d[i] = 0;
    expect(ocenPiksele(d, 400, 400).ostrosc).toBeNull();
  });
});

describe("skalowanie", () => {
  it("dłuższy bok idzie do 400, proporcje zostają", () => {
    expect(wymiaryPomiaru(1200, 600)).toEqual({ szer: 400, wys: 200 });
    expect(wymiaryPomiaru(100, 200)).toEqual({ szer: 200, wys: 400 });
  });

  it("w dół średnia z bloku, w górę bez wychodzenia poza zakres", () => {
    const g = new Float32Array([0, 100, 100, 0]);
    expect([...skaluj(g, 2, 2, 1, 1)]).toEqual([50]);
    const w = skaluj(g, 2, 2, 4, 4);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...w)).toBeLessThanOrEqual(100);
  });
});

describe("porównanie i porządek", () => {
  const o = (bok: number, ostrosc: number | null): Ocena => ({ bok, ostrosc });

  it("oferta lepsza, gdy ma większy bok albo wyższą ostrość", () => {
    expect(lepszeOd(o(300, 50), o(800, 40))).toBe(true);
    expect(lepszeOd(o(800, 50), o(800, 90))).toBe(true);
    expect(lepszeOd(o(800, 50), o(800, 50))).toBe(false);
    expect(lepszeOd(o(800, 90), o(600, 50))).toBe(false);
    expect(lepszeOd(o(800, null), o(800, 50))).toBe(true);
    expect(lepszeOd(o(800, 50), o(800, null))).toBe(false);
  });

  it("pod progiem: mały bok albo niska ostrość; brak miary to nie niska ostrość", () => {
    expect(podProgiem(o(300, 500), 400, 100)).toBe(true);
    expect(podProgiem(o(800, 50), 400, 100)).toBe(true);
    expect(podProgiem(o(800, null), 400, 100)).toBe(false);
    expect(podProgiem(o(800, 150), 400, 100)).toBe(false);
  });

  it("od najgorszych: ostrość rosnąco, bez miary na końcu, remis rozstrzyga mniejszy bok", () => {
    const l = [o(800, null), o(800, 90), o(300, null), o(800, 10), o(500, 10)];
    expect(l.sort(odNajgorszych)).toEqual([o(500, 10), o(800, 10), o(800, 90), o(300, null), o(800, null)]);
  });
});
