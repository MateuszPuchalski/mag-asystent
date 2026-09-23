import type { KartotekaPasowania, KrawedzSieci, SiecPasowan } from "../api/typy";

/* ── Układ sieci pasowań: wyspy i rozkład sił ────────────────────────────────
   Czysta geometria, bez Reacta — żeby dało się ją sprawdzić testem bez DOM-u.

   WYSPY, NIE JEDEN KŁĘBEK. Pasowania rozpadają się na grupy, które nie mają
   ze sobą nic wspólnego: gaźnik GX160 ze swoimi uszczelkami nie łączy się
   z membraną do Walbro. Jeden rysunek całości zrobiłby z nich kłębek, w którym
   oko szuka granic, zanim przeczyta cokolwiek. Wyspa to spójna składowa
   grafu, rysowana na własnej karcie — granicę daje karta, nie wzrok.

   ROZKŁAD SIŁ BEZ BIBLIOTEKI. Ta sama decyzja co przy słupkach wglądu
   (`ui/wykres.tsx`): kilkadziesiąt linijek Fruchtermana–Reingolda nie
   uzasadnia zależności. Układ jest DETERMINISTYCZNY — start na okręgu
   w porządku symboli, stała liczba kroków — bo ten sam stan bazy ma dawać
   ten sam obrazek. Węzeł, który przeskakuje po każdym odświeżeniu, trzeba
   szukać od nowa, a to jest dokładnie ta uwaga, którą widok ma oszczędzić. */

export interface Wyspa {
  wezly: KartotekaPasowania[];
  krawedzie: KrawedzSieci[];
  /** Węzeł, do którego pasuje najwięcej — nazwa karty („gaźnik i jego uszczelki"). */
  srodek: KartotekaPasowania;
  /** Krawędzie inne niż zamiennik — to po nich sortujemy i to liczymy biuru. */
  pasowan: number;
}

/**
 * Rola węzła na rysunku. `cel` przyjmuje jakieś pasowanie (gaźnik), `czesc`
 * pasuje do czegoś (uszczelka), `zamiennik` stoi w sieci wyłącznie z opisu.
 * Cel wygrywa z częścią: łącznik, który pasuje do kolektora i do którego
 * pasuje uszczelka, czyta się jako „coś, do czego się dobiera".
 */
export type RolaWezla = "cel" | "czesc" | "zamiennik";

export function roleWezlow(krawedzie: KrawedzSieci[]): Map<number, RolaWezla> {
  const role = new Map<number, RolaWezla>();
  for (const k of krawedzie) {
    if (k.rodzaj === "zamiennik") {
      if (!role.has(k.z)) role.set(k.z, "zamiennik");
      if (!role.has(k.do)) role.set(k.do, "zamiennik");
      continue;
    }
    role.set(k.do, "cel");
    if (role.get(k.z) !== "cel") role.set(k.z, "czesc");
  }
  return role;
}

/**
 * Spójne składowe. `zZamiennikami === false` zdejmuje krawędzie zamienników
 * i węzły, które bez nich zostają same — wtedy dwie wyspy złączone wyłącznie
 * opisem kartoteki rozchodzą się na dwie, i tak ma być: to przełącznik
 * „pokaż tylko to, co ktoś wpisał".
 */
export function wyspy(siec: SiecPasowan, zZamiennikami = true): Wyspa[] {
  const krawedzie = zZamiennikami ? siec.krawedzie : siec.krawedzie.filter((k) => k.rodzaj !== "zamiennik");
  const uzyte = new Set(krawedzie.flatMap((k) => [k.z, k.do]));
  const wezly = siec.wezly.filter((w) => uzyte.has(w.twId));

  const rodzic = new Map<number, number>(wezly.map((w) => [w.twId, w.twId]));
  const korzen = (x: number): number => {
    let r = x;
    while (rodzic.get(r) !== r) r = rodzic.get(r)!;
    rodzic.set(x, r);
    return r;
  };
  for (const k of krawedzie) {
    if (!rodzic.has(k.z) || !rodzic.has(k.do)) continue;
    const a = korzen(k.z); const b = korzen(k.do);
    if (a !== b) rodzic.set(a, b);
  }

  const grupy = new Map<number, Wyspa>();
  for (const w of wezly) {
    const r = korzen(w.twId);
    const g = grupy.get(r) ?? { wezly: [], krawedzie: [], srodek: w, pasowan: 0 };
    g.wezly.push(w);
    grupy.set(r, g);
  }
  for (const k of krawedzie) {
    const g = grupy.get(korzen(k.z));
    if (!g) continue;
    g.krawedzie.push(k);
    if (k.rodzaj !== "zamiennik") g.pasowan += 1;
  }
  for (const g of grupy.values()) {
    const przyjmuje = new Map<number, number>();
    for (const k of g.krawedzie) if (k.rodzaj !== "zamiennik") przyjmuje.set(k.do, (przyjmuje.get(k.do) ?? 0) + 1);
    /* Remis rozstrzyga porządek symboli z serwera — ten sam środek przy każdym odczycie. */
    let naj = g.wezly[0]; let ile = -1;
    for (const w of g.wezly) {
      const n = przyjmuje.get(w.twId) ?? 0;
      if (n > ile) { naj = w; ile = n; }
    }
    g.srodek = naj;
  }
  /* Najwięcej pasowań pierwsze: tam jest najwięcej wiedzy do obejrzenia. */
  return [...grupy.values()].sort((a, b) =>
    b.pasowan - a.pasowan || b.wezly.length - a.wezly.length || a.srodek.symbol.localeCompare(b.srodek.symbol, "pl"));
}

export interface Uklad {
  pozycje: Map<number, { x: number; y: number }>;
  szer: number;
  wys: number;
}

/** Margines na podpis pod węzłem. Symbol ma do szesnastu znaków, stąd szerzej w poziomie. */
const MARGINES_X = 64;
const MARGINES_Y = 28;
/** Pożądana odległość sąsiadów. Mniej i symbole sąsiadów nachodzą na siebie. */
const ODSTEP = 96;

/**
 * Fruchterman–Reingold na jednej wyspie. Kroki maleją przy dużych wyspach,
 * bo koszt rośnie z kwadratem węzłów, a układ i tak stygnie wcześniej.
 */
export function uklad(w: Pick<Wyspa, "wezly" | "krawedzie">): Uklad {
  const n = w.wezly.length;
  const pozycje = new Map<number, { x: number; y: number }>();
  if (n === 0) return { pozycje, szer: 0, wys: 0 };

  const idx = new Map(w.wezly.map((x, i) => [x.twId, i]));
  const promien = n === 1 ? 0 : (ODSTEP * n) / (2 * Math.PI) / 1.5 + ODSTEP / 2;
  const x = w.wezly.map((_, i) => promien * Math.cos((2 * Math.PI * i) / n));
  const y = w.wezly.map((_, i) => promien * Math.sin((2 * Math.PI * i) / n));
  /* Krawędzie bez dubli kierunku: A→B i B→A ciągną tak samo jak jedna. */
  const pary = [...new Set(w.krawedzie
    .filter((k) => idx.has(k.z) && idx.has(k.do) && k.z !== k.do)
    .map((k) => { const a = idx.get(k.z)!; const b = idx.get(k.do)!; return a < b ? `${a}:${b}` : `${b}:${a}`; }))]
    .map((s) => s.split(":").map(Number) as [number, number]);

  const kroki = n > 150 ? 80 : n > 60 ? 160 : 300;
  let temp = ODSTEP;
  const k2 = ODSTEP * ODSTEP;
  for (let t = 0; t < kroki; t++) {
    const dx = new Array<number>(n).fill(0);
    const dy = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let rx = x[i] - x[j]; let ry = y[i] - y[j];
        let d2 = rx * rx + ry * ry;
        /* Dwa węzły w jednym punkcie: rozsuń je w stałą stronę, nie losową. */
        if (d2 < 0.01) { rx = 0.1 * (i - j); ry = 0.1; d2 = rx * rx + ry * ry; }
        const f = k2 / d2;
        dx[i] += rx * f; dy[i] += ry * f;
        dx[j] -= rx * f; dy[j] -= ry * f;
      }
    }
    for (const [a, b] of pary) {
      const rx = x[a] - x[b]; const ry = y[a] - y[b];
      const d = Math.sqrt(rx * rx + ry * ry) || 0.1;
      const f = d / ODSTEP;
      dx[a] -= rx * f; dy[a] -= ry * f;
      dx[b] += rx * f; dy[b] += ry * f;
    }
    /* Słaba grawitacja do środka: bez niej osobne gałęzie jednej wyspy
       odpływają i karta robi się szeroka na pustkę. */
    for (let i = 0; i < n; i++) { dx[i] -= x[i] * 0.02; dy[i] -= y[i] * 0.02; }
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (d > 0) { const s = Math.min(d, temp) / d; x[i] += dx[i] * s; y[i] += dy[i] * s; }
    }
    temp = Math.max(1, temp * 0.97);
  }

  const minX = Math.min(...x); const minY = Math.min(...y);
  w.wezly.forEach((wz, i) => pozycje.set(wz.twId, { x: x[i] - minX + MARGINES_X, y: y[i] - minY + MARGINES_Y }));
  return {
    pozycje,
    szer: Math.max(...x) - minX + 2 * MARGINES_X,
    wys: Math.max(...y) - minY + 2 * MARGINES_Y,
  };
}

/** Szukanie po symbolu i nazwie, bez wielkości liter i bez spacji — symbol pisze się różnie. */
export const zwin = (s: string) => s.toLocaleLowerCase("pl").replace(/\s+/g, "");
export const pasujeDoFrazy = (w: KartotekaPasowania, fraza: string) =>
  !fraza || zwin(w.symbol).includes(fraza) || zwin(w.nazwa).includes(fraza);
