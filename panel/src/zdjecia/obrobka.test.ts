import { describe, expect, it } from "vitest";
import {
  LIMIT_BAJTOW, MAKS_PRZESUNIECIA, bajtyBase64, kadrWPikselach, kadrZPrzeciagniecia, kwadratWokol,
  obroc, percentyleKanalow, ramkaAlfy, tablicaPoziomow, wymiaryWLimicie, wyrownajPoziomy, zakodujJakNajlzej, zakodujWLimicie,
} from "./obrobka";

/* Rachunek obróbki na tablicach pikseli, bez płótna. Powód podziału stoi
   w nagłówku `obrobka.ts`: płótno sprawdza się okiem, liczby — tutaj. */

/** Obraz RGBA z listy pikseli [r, g, b, a]. */
const obraz = (piksele: number[][]) => new Uint8ClampedArray(piksele.flat());

/** Obraz o jednej szarości na całej powierzchni plus kilka pikseli skrajnych. */
function szary(n: number, wartosc: number, skrajne: Array<[number, number]> = []): Uint8ClampedArray {
  const p: number[][] = Array.from({ length: n }, () => [wartosc, wartosc, wartosc, 255]);
  skrajne.forEach(([i, v]) => { p[i] = [v, v, v, 255]; });
  return obraz(p);
}

describe("poziomy", () => {
  it("percentyle pomijają piksele tła o alfie do progu", () => {
    const d = obraz([[10, 20, 30, 255], [200, 210, 220, 255], [0, 0, 0, 0], [255, 255, 255, 8]]);
    const p = percentyleKanalow(d, 0, 1);
    expect(p).toEqual({ lo: [10, 20, 30], hi: [200, 210, 220] });
  });

  it("obraz bez treści nie ma percentyli", () => {
    expect(percentyleKanalow(obraz([[50, 50, 50, 0]]))).toBeNull();
  });

  it("pojedyncze skrajne piksele nie przesuwają progów 0,5% i 99,5%", () => {
    /* 1000 pikseli: po dwa czarne i białe to 0,2% — szum, nie czerń ani biel zdjęcia. */
    const pol = Array.from({ length: 1000 }, (_, i) => {
      const v = 60 + Math.floor((i / 1000) * 120);
      return [v, v, v, 255];
    });
    pol[0] = [0, 0, 0, 255]; pol[1] = [0, 0, 0, 255];
    pol[998] = [255, 255, 255, 255]; pol[999] = [255, 255, 255, 255];
    const p = percentyleKanalow(obraz(pol))!;
    expect(p.lo[0]).toBeGreaterThanOrEqual(60);
    expect(p.hi[0]).toBeLessThanOrEqual(180);
  });

  it("rozciąga zakres kanału do pełnej skali, gdy mieści się w limicie", () => {
    const t = tablicaPoziomow(20, 230);
    expect(t[20]).toBe(0);
    expect(t[230]).toBe(255);
    expect(t[125]).toBe(Math.round((125 - 20) * (255 / 210)));
  });

  it("siła jest przycięta: czarny punkt nie wchodzi wyżej niż limit, wzmocnienie ≤ 1,6", () => {
    const t = tablicaPoziomow(120, 180);
    /* Czarny stanął na limicie, nie na 120 — ciemna doniczka nie rozjedzie się do jaskrawej czerwieni. */
    expect(t[MAKS_PRZESUNIECIA]).toBe(0);
    expect(t[255 - MAKS_PRZESUNIECIA]).toBe(255);
    for (let v = 1; v < 256; v++) expect(t[v] - t[v - 1]).toBeLessThanOrEqual(2);
  });

  it("kanał prawie płaski zostaje bez zmian — szum matrycy to nie kontrast", () => {
    const t = tablicaPoziomow(100, 120);
    for (let v = 0; v < 256; v++) expect(t[v]).toBe(v);
  });

  it("wyrównanie zmienia RGB i nie dotyka alfy", () => {
    const d = obraz([[40, 40, 40, 255], [200, 200, 200, 128], [120, 120, 120, 255]]);
    expect(wyrownajPoziomy(d)).toBe(true);
    expect(d[3]).toBe(255);
    expect(d[7]).toBe(128);
    expect(d[0]).toBe(0);
    /* Biały punkt stoi na limicie 207, nie na 200, więc 200 nie dochodzi do pełnej bieli. */
    expect(d[4]).toBe(Math.round(160 * 255 / 167));
  });

  it("obraz już pełnej skali zostaje taki sam", () => {
    const d = szary(10, 128, [[0, 0], [9, 255]]);
    const kopia = new Uint8ClampedArray(d);
    wyrownajPoziomy(d);
    expect([...d]).toEqual([...kopia]);
  });
});

describe("ramka treści", () => {
  it("obejmuje piksele o alfie ponad próg", () => {
    /* 4×3, treść w (1,1) i (2,2); piksel o alfie 8 w rogu to tło. */
    const d = new Uint8ClampedArray(4 * 3 * 4);
    const ustaw = (x: number, y: number, a: number) => { d[(y * 4 + x) * 4 + 3] = a; };
    ustaw(0, 0, 8); ustaw(1, 1, 255); ustaw(2, 2, 9);
    expect(ramkaAlfy(d, 4, 3)).toEqual({ x: 1, y: 1, szer: 2, wys: 2 });
  });

  it("pusty obraz nie ma ramki", () => {
    expect(ramkaAlfy(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
});

describe("kwadrat", () => {
  it("towar mniejszy niż limit: bok = treść + 5% z każdej strony, bez powiększania", () => {
    const g = kwadratWokol(400, 200);
    expect(g.bok).toBe(440);
    expect(g).toMatchObject({ szer: 400, wys: 200, x: 20, y: 120 });
  });

  it("towar większy: bok przycięty do 800, treść zmniejszona proporcjonalnie i wyśrodkowana", () => {
    const g = kwadratWokol(1500, 3000);
    expect(g.bok).toBe(800);
    expect(g.wys).toBe(Math.round(3000 * 800 / 3300));
    expect(g.szer).toBe(Math.round(1500 * 800 / 3300));
    expect(g.x * 2 + g.szer).toBeLessThanOrEqual(800);
    expect(Math.abs(g.x * 2 + g.szer - 800)).toBeLessThanOrEqual(1);
    expect(g.y).toBe(Math.floor((800 - g.wys) / 2));
  });

  it("wymiary w limicie nie powiększają i trzymają proporcję", () => {
    expect(wymiaryWLimicie(800, 600, 1600)).toEqual({ szer: 800, wys: 600 });
    expect(wymiaryWLimicie(4000, 3000, 1600)).toEqual({ szer: 1600, wys: 1200 });
  });
});

describe("kadr", () => {
  it("z przeciągnięcia w dowolnym kierunku, przycięty do obrazu", () => {
    expect(kadrZPrzeciagniecia({ x: 0.8, y: 0.9 }, { x: 0.2, y: -0.1 }))
      .toEqual({ x: 0.2, y: 0, szer: expect.closeTo(0.6), wys: expect.closeTo(0.9) });
  });

  it("samo kliknięcie to nie kadr", () => {
    expect(kadrZPrzeciagniecia({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.6 })).toBeNull();
  });

  it("w pikselach nie wychodzi poza krawędź", () => {
    expect(kadrWPikselach({ x: 0.5, y: 0.5, szer: 0.6, wys: 0.6 }, 100, 50)).toEqual({ x: 50, y: 25, szer: 50, wys: 25 });
  });
});

describe("jakość pliku", () => {
  it("liczy bajty base64 z dopełnieniem", () => {
    expect(bajtyBase64("QQ==")).toBe(1);
    expect(bajtyBase64("QUI=")).toBe(2);
    expect(bajtyBase64("QUJD")).toBe(3);
  });

  it("schodzi z jakością, aż plik zmieści się w limicie", async () => {
    const proby: number[] = [];
    /* Atrapa kodera: rozmiar rośnie z jakością, jak w prawdziwym JPEG-u. */
    const koduj = (q: number) => { proby.push(q); return "A".repeat(Math.round(q * 1000)); };
    const w = await zakodujWLimicie(koduj, 500, [0.85, 0.75, 0.65, 0.55]);
    expect(w).toMatchObject({ miesciSie: true, jakosc: 0.65 });
    expect(proby).toEqual([0.85, 0.75, 0.65]);
  });

  /* Gotowe zdjęcie ma ważyć jak najmniej: stajemy na pierwszej jakości
     w celu, a bez trafienia bierzemy najlżejszą próbę, byle w limicie serwera. */
  it("jak najlżej: pierwsza jakość w celu, inaczej najlżejsza próba w limicie", async () => {
    /* Atrapa: 1000 znaków base64 na jakość 1, czyli 0,68 → 510 B, a 0,6 → 450 B. */
    const koduj = (q: number) => "A".repeat(Math.round(q * 1000));
    expect(await zakodujJakNajlzej(koduj, 520, 900, [0.82, 0.75, 0.68, 0.6])).toMatchObject({ jakosc: 0.68, miesciSie: true });
    expect(await zakodujJakNajlzej(koduj, 100, 900, [0.82, 0.6])).toMatchObject({ jakosc: 0.6, miesciSie: true });
    expect(await zakodujJakNajlzej(koduj, 100, 400, [0.82, 0.6])).toMatchObject({ jakosc: 0.6, miesciSie: false });
  });

  it("przyznaje, gdy nawet najniższa jakość nie wystarcza", async () => {
    const w = await zakodujWLimicie(() => "A".repeat(LIMIT_BAJTOW * 2), LIMIT_BAJTOW, [0.85, 0.45]);
    expect(w).toMatchObject({ miesciSie: false, jakosc: 0.45 });
  });
});

describe("obrót", () => {
  it("chodzi w kółko w obie strony", () => {
    expect(obroc(0, -1)).toBe(270);
    expect(obroc(270, 1)).toBe(0);
    expect(obroc(90, 1)).toBe(180);
  });
});
