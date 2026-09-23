import type { KrawedzSieci, SiecWiedzy, WarstwaSieci, WezelSieci } from "../api/typy";

/* ── Układ sieci wiedzy: warstwy, wyspy, otoczenie i rozkład sił ─────────────
   Czysta geometria i teoria grafów, bez Reacta — żeby dało się ją sprawdzić
   testem bez DOM-u.

   WYSPY, NIE JEDEN KŁĘBEK. Wiedza rozpada się na grupy, które nie mają ze
   sobą nic wspólnego: gaźnik GX160 ze swoimi uszczelkami i kosiarkami nie
   łączy się z membraną do Walbro. Jeden rysunek całości zrobiłby z nich
   kłębek, w którym oko szuka granic, zanim przeczyta cokolwiek. Wyspa to
   spójna składowa grafu, rysowana na własnej karcie — granicę daje karta.

   OTOCZENIE ZAMIAST ZOOMU. Maszyna, do której pasuje sto części, sklei
   całą bazę w jedną wyspę. Wtedy pytanie „co pasuje do tego" odpowiada
   otoczenie węzła — wszystko w zasięgu jednego, dwóch albo trzech kroków.
   Mniej rzeczy na ekranie, a nie mniejsze litery.

   ROZKŁAD SIŁ BEZ BIBLIOTEKI. Ta sama decyzja co przy słupkach wglądu
   (`ui/wykres.tsx`): kilkadziesiąt linijek Fruchtermana–Reingolda nie
   uzasadnia zależności. Układ jest DETERMINISTYCZNY — start na okręgu
   w porządku z serwera, stała liczba kroków — bo ten sam stan bazy ma dawać
   ten sam obrazek. Węzeł, który przeskakuje po każdym odświeżeniu, trzeba
   szukać od nowa, a to jest dokładnie ta uwaga, którą widok ma oszczędzić. */

export const WARSTWY: WarstwaSieci[] = ["pasowania", "zastosowania", "zabudowy", "zamienniki"];

export interface Wyspa {
  wezly: WezelSieci[];
  krawedzie: KrawedzSieci[];
  /** Węzeł, do którego wchodzi najwięcej — nazwa karty („gaźnik i jego uszczelki"). */
  srodek: WezelSieci;
  /** Krawędzie inne niż zamiennik — to po nich sortujemy i to liczymy biuru. */
  wiedzy: number;
}

/**
 * Rola węzła na rysunku. Maszyna i silnik mają ją z rodzaju. Kartoteka jest
 * `cel`, gdy coś do niej pasuje (gaźnik), `czesc`, gdy ona pasuje do czegoś
 * (uszczelka), a `zamiennik`, gdy stoi w sieci wyłącznie z opisu. Cel wygrywa
 * z częścią: gaźnik pasuje do silnika, ale do niego dobiera się uszczelki.
 */
export type RolaWezla = "cel" | "czesc" | "zamiennik" | "maszyna" | "silnik";

export function roleWezlow(wezly: WezelSieci[], krawedzie: KrawedzSieci[]): Map<string, RolaWezla> {
  const role = new Map<string, RolaWezla>();
  for (const w of wezly) if (w.rodzaj !== "kartoteka") role.set(w.klucz, w.rodzaj);
  for (const k of krawedzie) {
    if (k.warstwa === "pasowania") role.set(k.do, "cel");
    if ((k.warstwa === "pasowania" || k.warstwa === "zastosowania") && role.get(k.z) !== "cel") role.set(k.z, "czesc");
  }
  for (const w of wezly) if (!role.has(w.klucz)) role.set(w.klucz, "zamiennik");
  return role;
}

/**
 * Warstwy włączone przez biuro. Węzeł, który bez zdjętej warstwy zostaje
 * sam, znika razem z nią — kosiarka bez zastosowań nie jest wiedzą o
 * pasowaniu, tylko kropką na pustej karcie.
 */
export function naWarstwach(siec: SiecWiedzy, warstwy: ReadonlySet<WarstwaSieci>): SiecWiedzy {
  const krawedzie = siec.krawedzie.filter((k) => warstwy.has(k.warstwa));
  const uzyte = new Set(krawedzie.flatMap((k) => [k.z, k.do]));
  return { wezly: siec.wezly.filter((w) => uzyte.has(w.klucz)), krawedzie };
}

/**
 * Otoczenie węzła: wszystko w zasięgu `kroki` krawędzi, bez względu na
 * kierunek. Kierunek mówi, CO do czego pasuje; sąsiedztwo pyta tylko, czy
 * to w ogóle ma ze sobą coś wspólnego.
 */
export function otoczenie(siec: SiecWiedzy, klucz: string, kroki: number): SiecWiedzy {
  const sasiedzi = new Map<string, string[]>();
  for (const k of siec.krawedzie) {
    sasiedzi.set(k.z, [...(sasiedzi.get(k.z) ?? []), k.do]);
    sasiedzi.set(k.do, [...(sasiedzi.get(k.do) ?? []), k.z]);
  }
  const zasieg = new Set([klucz]);
  let front = [klucz];
  for (let i = 0; i < kroki && front.length > 0; i++) {
    const nowy: string[] = [];
    for (const x of front) for (const y of sasiedzi.get(x) ?? []) if (!zasieg.has(y)) { zasieg.add(y); nowy.push(y); }
    front = nowy;
  }
  return {
    wezly: siec.wezly.filter((w) => zasieg.has(w.klucz)),
    krawedzie: siec.krawedzie.filter((k) => zasieg.has(k.z) && zasieg.has(k.do)),
  };
}

/** Spójne składowe, najwięcej wiedzy pierwsze. */
export function wyspy(siec: SiecWiedzy): Wyspa[] {
  const rodzic = new Map<string, string>(siec.wezly.map((w) => [w.klucz, w.klucz]));
  const korzen = (x: string): string => {
    let r = x;
    while (rodzic.get(r) !== r) r = rodzic.get(r)!;
    rodzic.set(x, r);
    return r;
  };
  for (const k of siec.krawedzie) {
    if (!rodzic.has(k.z) || !rodzic.has(k.do)) continue;
    const a = korzen(k.z); const b = korzen(k.do);
    if (a !== b) rodzic.set(a, b);
  }

  const grupy = new Map<string, Wyspa>();
  for (const w of siec.wezly) {
    const r = korzen(w.klucz);
    const g = grupy.get(r) ?? { wezly: [], krawedzie: [], srodek: w, wiedzy: 0 };
    g.wezly.push(w);
    grupy.set(r, g);
  }
  for (const k of siec.krawedzie) {
    const g = rodzic.has(k.z) ? grupy.get(korzen(k.z)) : undefined;
    if (!g) continue;
    g.krawedzie.push(k);
    if (k.warstwa !== "zamienniki") g.wiedzy += 1;
  }
  for (const g of grupy.values()) {
    const przyjmuje = new Map<string, number>();
    for (const k of g.krawedzie) if (k.warstwa !== "zamienniki") przyjmuje.set(k.do, (przyjmuje.get(k.do) ?? 0) + 1);
    /* Remis rozstrzyga porządek z serwera — ten sam środek przy każdym odczycie. */
    let naj = g.wezly[0]; let ile = -1;
    for (const w of g.wezly) {
      const n = przyjmuje.get(w.klucz) ?? 0;
      if (n > ile) { naj = w; ile = n; }
    }
    g.srodek = naj;
  }
  return [...grupy.values()].sort((a, b) =>
    b.wiedzy - a.wiedzy || b.wezly.length - a.wezly.length || a.srodek.etykieta.localeCompare(b.srodek.etykieta, "pl"));
}

export interface Uklad {
  pozycje: Map<string, { x: number; y: number }>;
  szer: number;
  wys: number;
}

/** Margines na podpis pod węzłem. Symbol ma do szesnastu znaków, stąd szerzej w poziomie. */
const MARGINES_X = 64;
const MARGINES_Y = 30;
/** Pożądana odległość sąsiadów. Mniej i symbole sąsiadów nachodzą na siebie. */
const ODSTEP = 100;
/** Najbliżej, jak mogą stanąć dwa węzły po normalizacji — tyle zajmuje podpis z oddechem. */
const MIN_ODLEGLOSC = 56;

/**
 * Fruchterman–Reingold na jednej wyspie. Kroki maleją przy dużych wyspach,
 * bo koszt rośnie z kwadratem węzłów, a układ i tak stygnie wcześniej.
 */
export function uklad(w: Pick<Wyspa, "wezly" | "krawedzie">): Uklad {
  const n = w.wezly.length;
  const pozycje = new Map<string, { x: number; y: number }>();
  if (n === 0) return { pozycje, szer: 0, wys: 0 };

  const idx = new Map(w.wezly.map((x, i) => [x.klucz, i]));
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

  /* NORMALIZACJA SKALI. Siły same z siebie rozpychają drzewo: w gwieździe
     z ogonami krawędzie wychodziły po 250 px zamiast stu, a wyspa
     siedemnastu węzłów zajmowała 1400 px szerokości (zrzut z seeda). Skala
     sprowadza medianę krawędzi do odstępu, ale nigdy nie ściska dwóch węzłów
     bliżej niż na podpis. */
  if (pary.length > 0 && n > 2) {
    const dlugosci = pary.map(([a, b]) => Math.hypot(x[a] - x[b], y[a] - y[b])).sort((p, q) => p - q);
    const mediana = dlugosci[Math.floor(dlugosci.length / 2)];
    let najblizej = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) najblizej = Math.min(najblizej, Math.hypot(x[i] - x[j], y[i] - y[j]));
    let skala = mediana > 0 ? ODSTEP / mediana : 1;
    if (najblizej * skala < MIN_ODLEGLOSC) skala = MIN_ODLEGLOSC / Math.max(najblizej, 0.1);
    for (let i = 0; i < n; i++) { x[i] *= skala; y[i] *= skala; }
  }

  const minX = Math.min(...x); const minY = Math.min(...y);
  w.wezly.forEach((wz, i) => pozycje.set(wz.klucz, { x: x[i] - minX + MARGINES_X, y: y[i] - minY + MARGINES_Y }));
  return {
    pozycje,
    szer: Math.max(...x) - minX + 2 * MARGINES_X,
    wys: Math.max(...y) - minY + 2 * MARGINES_Y,
  };
}

/** Szukanie po etykiecie i nazwie, bez wielkości liter i bez spacji — symbol pisze się różnie. */
export const zwin = (s: string) => s.toLocaleLowerCase("pl").replace(/\s+/g, "");
export const pasujeDoFrazy = (w: WezelSieci, fraza: string) =>
  !fraza || zwin(w.etykieta).includes(fraza) || zwin(w.nazwa).includes(fraza);

/**
 * Trafność dla skrótów do otoczenia: początek symbolu, potem symbol, na końcu
 * nazwa. „nac" ma dać kosiarkę NAC przed zestawem membran, w którego nazwie
 * NAC stoi na szarym końcu.
 */
export function wedlugTrafnosci(wezly: WezelSieci[], fraza: string): WezelSieci[] {
  const ranga = (w: WezelSieci) => zwin(w.etykieta).startsWith(fraza) ? 0 : zwin(w.etykieta).includes(fraza) ? 1 : 2;
  return wezly.filter((w) => pasujeDoFrazy(w, fraza))
    .map((w, i) => ({ w, r: ranga(w), i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.w);
}
