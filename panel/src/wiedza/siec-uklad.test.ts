import { describe, expect, it } from "vitest";
import type { KrawedzSieci, SiecWiedzy, WarstwaSieci, WezelSieci } from "../api/typy";
import { WARSTWY, naWarstwach, otoczenie, roleWezlow, uklad, wedlugTrafnosci, wyspy } from "./siec-uklad";

/* ── Układ sieci wiedzy ──────────────────────────────────────────────────────
   Cztery obietnice: wyspy to spójne składowe (bez zlepiania obcych grup);
   zdjęta warstwa zabiera węzły, które bez niej zostają same; otoczenie sięga
   dokładnie tyle kroków, ile wybrano; ten sam stan bazy daje ten sam obrazek,
   a węzły jednej wyspy nie stoją jeden na drugim.                          */

const WARSTWA: Record<KrawedzSieci["rodzaj"], WarstwaSieci> = {
  pasuje: "pasowania", nie_pasuje: "pasowania", propozycja: "pasowania", zabudowa: "zabudowy", zamiennik: "zamienniki",
};
const k = (z: string, d: string, rodzaj: KrawedzSieci["rodzaj"] = "pasuje", warstwa = WARSTWA[rodzaj]): KrawedzSieci => ({
  z, do: d, warstwa, rodzaj, polaryzacja: rodzaj === "zamiennik" || rodzaj === "zabudowa" ? null : "pasuje",
  wierszId: rodzaj === "zamiennik" ? null : 1, rola: null, pewnosc: "potwierdzone", obustronnie: false, zdanie: `${z}→${d}`,
});
const tw = (n: number, etykieta = `S-${n}`): WezelSieci =>
  ({ klucz: `tw:${n}`, rodzaj: "kartoteka", twId: n, etykieta, nazwa: `Nazwa ${etykieta}` });
const model = (n: number, rodzaj: "maszyna" | "silnik", etykieta: string): WezelSieci =>
  ({ klucz: `model:${n}`, rodzaj, twId: null, etykieta, nazwa: etykieta });

/* Łańcuch: uszczelki 2, 3 i negatyw 4 do gaźnika 1; gaźnik pasuje do silnika
   GX160, a GX160 stoi w kosiarce NAC. Zamiennik 5 gaźnika z opisu.
   Osobno: membrana 10 czeka do pompy 11. */
const SIEC: SiecWiedzy = {
  wezly: [tw(1, "GAZ"), tw(2), tw(3), tw(4), tw(5, "GAZ-ZAM"), tw(10), tw(11, "POMPA"),
    model(1, "silnik", "Honda GX160"), model(2, "maszyna", "NAC LS 46-450")],
  krawedzie: [k("tw:2", "tw:1"), k("tw:3", "tw:1"), k("tw:4", "tw:1", "nie_pasuje"), k("tw:1", "tw:5", "zamiennik"),
    k("tw:1", "model:1", "pasuje", "zastosowania"), k("model:1", "model:2", "zabudowa"),
    k("tw:10", "tw:11", "propozycja")],
};
const wszystkie = new Set(WARSTWY);
const klucze = (s: { wezly: WezelSieci[] }) => s.wezly.map((w) => w.klucz).sort();

describe("wyspy", () => {
  it("rozdziela niezależne grupy i sortuje po liczbie powiązań", () => {
    const l = wyspy(SIEC);
    expect(l.map((x) => x.wezly.length)).toEqual([7, 2]);
    /* Zamiennik nie liczy się jako wiedza — to odczyt opisu, nie wpis. */
    expect(l.map((x) => x.wiedzy)).toEqual([5, 1]);
    expect(l[0].srodek.etykieta).toBe("GAZ");
    expect(l[1].srodek.etykieta).toBe("POMPA");
  });

  it("zamiennik łączy wyspy — i tylko wtedy, gdy jego warstwa jest włączona", () => {
    const zlaczona = { ...SIEC, krawedzie: [...SIEC.krawedzie, k("tw:5", "tw:11", "zamiennik")] };
    expect(wyspy(zlaczona)).toHaveLength(1);
    expect(wyspy(naWarstwach(zlaczona, new Set<WarstwaSieci>(["pasowania", "zastosowania", "zabudowy"])))).toHaveLength(2);
  });
});

describe("warstwy", () => {
  it("zdjęta warstwa zabiera węzły, które bez niej zostają same", () => {
    const bezMaszyn = naWarstwach(SIEC, new Set<WarstwaSieci>(["pasowania", "zamienniki"]));
    expect(klucze(bezMaszyn)).not.toContain("model:1");
    expect(klucze(bezMaszyn)).not.toContain("model:2");
    const bezSilnikow = naWarstwach(SIEC, new Set<WarstwaSieci>(["pasowania", "zastosowania", "zamienniki"]));
    expect(klucze(bezSilnikow)).toContain("model:1");
    /* Kosiarka stoi w sieci tylko przez silnik. */
    expect(klucze(bezSilnikow)).not.toContain("model:2");
  });

  it("wszystkie warstwy włączone to cała sieć", () => {
    expect(naWarstwach(SIEC, wszystkie)).toEqual(SIEC);
  });
});

describe("otoczenie", () => {
  it("sięga dokładnie tyle kroków, bez względu na kierunek strzałek", () => {
    expect(klucze(otoczenie(SIEC, "model:2", 1))).toEqual(["model:1", "model:2"]);
    expect(klucze(otoczenie(SIEC, "model:2", 2))).toEqual(["model:1", "model:2", "tw:1"]);
    expect(klucze(otoczenie(SIEC, "model:2", 3))).toEqual(["model:1", "model:2", "tw:1", "tw:2", "tw:3", "tw:4", "tw:5"]);
  });

  it("krawędź wychodząca poza zasięg nie wisi w powietrzu", () => {
    const o = otoczenie(SIEC, "model:2", 2);
    const s = new Set(klucze(o));
    expect(o.krawedzie.every((x) => s.has(x.z) && s.has(x.do))).toBe(true);
  });
});

describe("role węzłów", () => {
  it("cel przyjmuje pasowanie, część pasuje do czegoś, modele mają rolę z rodzaju", () => {
    const r = roleWezlow(SIEC.wezly, SIEC.krawedzie);
    expect([r.get("tw:1"), r.get("tw:2"), r.get("tw:5"), r.get("model:1"), r.get("model:2")])
      .toEqual(["cel", "czesc", "zamiennik", "silnik", "maszyna"]);
  });

  it("kartoteka przypięta tylko do maszyny jest częścią, nie samym zamiennikiem", () => {
    const r = roleWezlow([tw(7), model(2, "maszyna", "NAC")], [k("tw:7", "model:2", "pasuje", "zastosowania")]);
    expect(r.get("tw:7")).toBe("czesc");
  });
});

describe("układ", () => {
  it("ten sam stan daje ten sam obrazek", () => {
    const a = uklad(wyspy(SIEC)[0]);
    const b = uklad(wyspy(SIEC)[0]);
    expect([...a.pozycje.entries()]).toEqual([...b.pozycje.entries()]);
  });

  it("gwiazda dwudziestu części: bez NaN, w ramie, bez węzłów jeden na drugim", () => {
    const gwiazda = { wezly: [model(1, "maszyna", "NAC"), ...Array.from({ length: 20 }, (_, i) => tw(100 + i))],
      krawedzie: Array.from({ length: 20 }, (_, i) => k(`tw:${100 + i}`, "model:1", "pasuje", "zastosowania")) };
    const u = uklad(gwiazda);
    const p = [...u.pozycje.values()];
    expect(p.every((x) => Number.isFinite(x.x) && Number.isFinite(x.y))).toBe(true);
    expect(p.every((x) => x.x > 0 && x.y > 0 && x.x < u.szer && x.y < u.wys)).toBe(true);
    let najblizej = Infinity;
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      najblizej = Math.min(najblizej, Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y));
    }
    /* Dwa kształty po dziesięć pikseli i odstęp na oko — mniej to już zlepek. */
    expect(najblizej).toBeGreaterThan(30);
  });

  it("pojedynczy węzeł i pusta wyspa nie wywracają rachunku", () => {
    expect(uklad({ wezly: [tw(1)], krawedzie: [] }).pozycje.get("tw:1")).toBeDefined();
    expect(uklad({ wezly: [], krawedzie: [] }).szer).toBe(0);
  });
});

describe("normalizacja skali", () => {
  it("krawędzie wracają do odstępu, zamiast rozpychać wyspę na cały ekran", () => {
    /* Kształt wyspy z pierwszego zrzutu: gaźnik z uszczelkami, zamiennikami
       i ogonem przez maszynę do silnika. */
    const w = { wezly: [tw(1), ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => tw(n)), model(1, "maszyna", "M"), model(2, "silnik", "S"),
      tw(20), tw(21), tw(22), tw(23)],
    krawedzie: [2, 3, 4, 5].map((n) => k(`tw:${n}`, "tw:1")).concat([6, 7].map((n) => k("tw:1", `tw:${n}`, "zamiennik")),
      [k("tw:8", "tw:6", "zamiennik"), k("tw:9", "tw:7", "zamiennik"), k("tw:1", "model:1", "nie_pasuje", "zastosowania"),
        k("model:2", "model:1", "zabudowa"), k("tw:20", "model:2", "pasuje", "zastosowania"), k("tw:21", "tw:20"),
        k("tw:22", "tw:21", "zamiennik"), k("tw:23", "tw:22", "zamiennik")]) };
    const u = uklad(w);
    const p = u.pozycje;
    const dl = w.krawedzie.map((e) => Math.hypot(p.get(e.z)!.x - p.get(e.do)!.x, p.get(e.z)!.y - p.get(e.do)!.y)).sort((a, b) => a - b);
    expect(dl[Math.floor(dl.length / 2)]).toBeLessThan(140);
    expect(u.szer).toBeLessThan(1000);
  });
});

describe("skróty do otoczenia", () => {
  it("początek symbolu przed środkiem symbolu, symbol przed nazwą", () => {
    const wezly: WezelSieci[] = [
      { klucz: "tw:1", rodzaj: "kartoteka", twId: 1, etykieta: "76-052", nazwa: "Zestaw membran Piła NAC CS45" },
      { klucz: "tw:2", rodzaj: "kartoteka", twId: 2, etykieta: "GAZ-NAC-1", nazwa: "Gaźnik" },
      { klucz: "model:1", rodzaj: "maszyna", twId: null, etykieta: "NAC LS 46-450", nazwa: "NAC LS 46-450" },
      { klucz: "tw:3", rodzaj: "kartoteka", twId: 3, etykieta: "X-1", nazwa: "Nic wspólnego" },
    ];
    expect(wedlugTrafnosci(wezly, "nac").map((w) => w.etykieta)).toEqual(["NAC LS 46-450", "GAZ-NAC-1", "76-052"]);
  });
});
