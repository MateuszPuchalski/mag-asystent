import { describe, expect, it } from "vitest";
import type { KrawedzSieci, SiecPasowan } from "../api/typy";
import { roleWezlow, uklad, wyspy } from "./siec-uklad";

/* ── Układ sieci pasowań ─────────────────────────────────────────────────────
   Trzy obietnice: wyspy to spójne składowe (bez zlepiania obcych grup), ten
   sam stan bazy daje ten sam obrazek, a węzły jednej wyspy nie stoją jeden
   na drugim.                                                               */

const k = (z: number, d: number, rodzaj: KrawedzSieci["rodzaj"] = "pasuje"): KrawedzSieci => ({
  z, do: d, rodzaj, polaryzacja: rodzaj === "zamiennik" ? null : "pasuje", pasowanieId: rodzaj === "zamiennik" ? null : z * 100 + d,
  rola: rodzaj === "zamiennik" ? null : "uszczelka", pewnosc: "potwierdzone", obustronnie: false, zdanie: `${z}→${d}`,
});
const w = (twId: number, symbol = `S-${twId}`) => ({ twId, symbol, nazwa: `Nazwa ${symbol}` });

/* Gaźnik 1 z trzema uszczelkami i zamiennikiem 5; osobno membrana 10 do pompy 11. */
const SIEC: SiecPasowan = {
  wezly: [w(1, "GAZ"), w(2), w(3), w(4), w(5, "GAZ-ZAM"), w(10), w(11, "POMPA")],
  krawedzie: [k(2, 1), k(3, 1), k(4, 1, "nie_pasuje"), k(1, 5, "zamiennik"), k(10, 11, "propozycja")],
};

describe("wyspy", () => {
  it("rozdziela niezależne grupy i sortuje po liczbie pasowań", () => {
    const l = wyspy(SIEC);
    expect(l.map((x) => x.wezly.map((y) => y.twId).sort((a, b) => a - b))).toEqual([[1, 2, 3, 4, 5], [10, 11]]);
    expect(l.map((x) => x.pasowan)).toEqual([3, 1]);
    expect(l[0].srodek.symbol).toBe("GAZ");
    expect(l[1].srodek.symbol).toBe("POMPA");
  });

  it("bez zamienników węzeł znany tylko z opisu znika, a wyspa go nie wlicza", () => {
    const l = wyspy(SIEC, false);
    expect(l[0].wezly.map((x) => x.twId)).not.toContain(5);
    expect(l[0].krawedzie.every((x) => x.rodzaj !== "zamiennik")).toBe(true);
  });

  it("zamiennik łączy wyspy — i tylko wtedy, gdy przełącznik go pokazuje", () => {
    const zlaczona = { ...SIEC, krawedzie: [...SIEC.krawedzie, k(5, 11, "zamiennik")] };
    expect(wyspy(zlaczona)).toHaveLength(1);
    expect(wyspy(zlaczona, false)).toHaveLength(2);
  });
});

describe("role węzłów", () => {
  it("cel przyjmuje pasowanie, część pasuje, zamiennik stoi tylko z opisu", () => {
    const r = roleWezlow(SIEC.krawedzie);
    expect([r.get(1), r.get(2), r.get(5)]).toEqual(["cel", "czesc", "zamiennik"]);
  });
});

describe("układ", () => {
  it("ten sam stan daje ten sam obrazek", () => {
    const a = uklad(wyspy(SIEC)[0]);
    const b = uklad(wyspy(SIEC)[0]);
    expect([...a.pozycje.entries()]).toEqual([...b.pozycje.entries()]);
  });

  it("gwiazda dwudziestu uszczelek: bez NaN, w ramie, bez węzłów jeden na drugim", () => {
    const gwiazda = { wezly: [w(1), ...Array.from({ length: 20 }, (_, i) => w(100 + i))],
      krawedzie: Array.from({ length: 20 }, (_, i) => k(100 + i, 1)) };
    const u = uklad(gwiazda);
    const p = [...u.pozycje.values()];
    expect(p.every((x) => Number.isFinite(x.x) && Number.isFinite(x.y))).toBe(true);
    expect(p.every((x) => x.x > 0 && x.y > 0 && x.x < u.szer && x.y < u.wys)).toBe(true);
    let najblizej = Infinity;
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      najblizej = Math.min(najblizej, Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y));
    }
    /* Dwa kółka po dziesięć pikseli i odstęp na oko — mniej to już zlepek. */
    expect(najblizej).toBeGreaterThan(30);
  });

  it("pojedynczy węzeł i pusta wyspa nie wywracają rachunku", () => {
    expect(uklad({ wezly: [w(1)], krawedzie: [] }).pozycje.get(1)).toBeDefined();
    expect(uklad({ wezly: [], krawedzie: [] }).szer).toBe(0);
  });
});
