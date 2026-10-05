import type { CenaPoziomu } from "../api/typy";
import { zlote } from "../api/zwroty";
import { odmien } from "../ui";

/* ── CENY KARTOTEKI NA JEDNEJ OSI: CZYSTY UKŁAD ───────────────────────────────
   Tu nie ma DOM-u ani Reacta. Wejście to ceny, oferta, szerokość i funkcja
   miary tekstu, a wyjście to położenie każdej kropki i każdej etykiety.
   Dzięki temu układ sprawdza test bez przeglądarki (`cenyNaOsi.test.ts`),
   a komponent (`OsCenKartoteki.tsx`) tylko rysuje to, co tu policzono.

   Rozkład etykiet to nasza reguła, nie biblioteki: skala to jedna linijka,
   a reszta to pytanie, gdzie postawić podpis, żeby nie zasłonił cudzej
   kropki. Żadna biblioteka wykresów nie zna tej odpowiedzi za nas.        */

export type Mierz = (tekst: string, waga: 400 | 700, rozmiar: 11 | 12) => number;

export type PunktOsi = {
  /** `p${poziom}` albo "oferta". */
  id: string;
  rodzaj: "poziom" | "oferta";
  grosze: number;
  netto: number | null;
  nazwy: string[];
  /** `nazwaGrupy(nazwy)` albo "oferta". */
  nazwa: string;
  /** "49,51" bez waluty; dla oferty pusta. */
  kwota: string;
  klucz: boolean;
  x: number;
};

export type EtykietaOsi = {
  punkt: PunktOsi;
  lewo: number;
  gora: number;
  szer: number;
  wys: number;
  /** -1 nad osią, 1 pod osią. */
  strona: -1 | 1;
  pas: number;
  /** Ile cudzych znaczników stoi pod etykietą — dla testu i diagnozy. */
  cudze: number;
};

export type Grupa = { cena: CenaPoziomu; nazwy: string[] };

export type Polozenie = { min: number; max: number; zdanie: string; krotko: string };

export type UkladOsi =
  | { tryb: "lista"; grupy: Grupa[]; polozenie: Polozenie | null }
  | {
      tryb: "os"; grupy: Grupa[]; polozenie: Polozenie; waluta: string; punkty: PunktOsi[];
      pozaOsia: Grupa[]; zakres: { od: number; do: number }; min: number; max: number;
      linie: 1 | 2; osY: number; wysokosc: number; etykiety: EtykietaOsi[]; szerokosc: number;
    };

export type UkladNaOsi = Extract<UkladOsi, { tryb: "os" }>;

/* Wartości muszą się zgadzać z klasami w `OsCenKartoteki.tsx`: pas 14 px to
   `h-3.5`, pas 28 px to `h-7`, odstęp nazwy od kwoty to `ml-1`, a wypełnienie
   etykiety to `px-0.5`. Rozjazd liczby i klasy daje napis szerszy od miejsca,
   które mu policzono. */
export const GEOMETRIA = {
  /** Skrajny znacznik z obwódką mieści się w bloku. */
  PAD: 10,
  /** 8 px — najmniejszy czytelny znacznik. */
  R_POZIOM: 4,
  /** Środek bursztynowego pierścienia. */
  R_OFERTA: 6,
  GRUBOSC_OFERTY: 2.5,
  /**
   * Od środka osi do pasa. Kropka poziomu ma 6 px ogonka, pierścień oferty
   * niecałe 3 px. Etykieta przy pierścieniu stoi tuż przy nim, a dłuższy
   * ogonek kosztowałby wysokość bloku, czyli właśnie skargę właściciela.
   */
  PASMO: 10,
  /** Strona osi bez pasa: tylko miejsce na znacznik. */
  KRAWEDZ: 10,
  ODSTEP_PASOW: 2,
  PAS: { 1: 14, 2: 28 },
  PRZERWA: { 1: 9, 2: 8 },
  MAX_PASOW: { 1: 3, 2: 2 },
  /** Znacznik stoi co najmniej 3 px od brzegu własnej etykiety. */
  ZAKOTWICZENIE: 3,
  ODSTEP_NAZWA_KWOTA: 4,
  WYPELNIENIE: 2,
  WIAZKA: 64,
  KARA_PAS: 1000,
  KARA_GLEBIA: 6,
  KARA_OFERTA_POD: 40,
  KARA_POZIOM_NAD: 4,
  /** Klucz poza pierwszym pasem pod osią kosztuje więcej niż oferta pod osią. */
  KARA_KLUCZ: 50,
  /** Etykieta nie na środku znacznika. */
  KARA_KOTWICA: 3,
  /** Cudzy znacznik pod etykietą w pasie 1; głębiej połowa. */
  KARA_CUDZY: 15,
} as const;

const G = GEOMETRIA;

/** Kwota bez waluty, jak w etykiecie i w tabeli: walutę mówi nagłówek. */
export const kwota = (grosze: number): string => (grosze / 100).toFixed(2).replace(".", ",");

/**
 * Czy ten poziom NIE MA ceny brutto — `null` albo zero.
 *
 * Zero jest tu brakiem, nie kwotą: cennik zakupowy Subiekta wypełnia wyłącznie
 * kolumnę netto, a druga strona pary zostaje zerem. Podanie tego zera jako
 * ceny znaczyłoby „za darmo". Decyzja właściciela: zero to brak, nie cena.
 */
export function brakBrutto(c: CenaPoziomu): boolean {
  return c.bruttoGrosze === null || c.bruttoGrosze === 0;
}

/**
 * Poziomy o TEJ SAMEJ parze brutto–netto sklejone w jedną grupę.
 *
 * Zrzut właściciela: sześć poziomów, pięć z nich co do grosza równych. Agent
 * czytał sześć wierszy, żeby dowiedzieć się jednej ceny. Kolejność grup to
 * kolejność Subiekta: grupa stoi tam, gdzie pierwszy poziom tej ceny, bo agent
 * uczy się miejsca, nie liczby.
 */
export function grupujCeny(ceny: CenaPoziomu[]): Grupa[] {
  const grupy = new Map<string, Grupa>();
  for (const c of ceny) {
    const klucz = `${c.bruttoGrosze ?? "-"}|${c.nettoGrosze ?? "-"}|${c.waluta}`;
    const nazwa = c.nazwa || `poziom ${c.poziom}`;
    const g = grupy.get(klucz);
    if (g) g.nazwy.push(nazwa); else grupy.set(klucz, { cena: c, nazwy: [nazwa] });
  }
  return [...grupy.values()];
}

/**
 * Nazwa grupy: „Detaliczna i 1 inny". Lista i oś wołają tę samą funkcję,
 * więc grupa nazywa się wszędzie tak samo. Pełne nazwy stoją w dymku,
 * w tekście dla czytnika i w tabeli.
 */
export function nazwaGrupy(nazwy: string[]): string {
  if (nazwy.length === 1) return nazwy[0];
  const r = nazwy.length - 1;
  return `${nazwy[0]} i ${r} ${odmien(r, "inny", "inne", "innych")}`;
}

/* Procent zaokrąglony do zera mówiłby „0% nad", czyli nieprawdę: oferta
   stoi nad poziomem, tylko o mniej niż procent. */
const procent = (p: number): string => (p === 0 ? "mniej niż 1%" : `${p}%`);

/* ── POŁOŻENIE OFERTY WOBEC CENNIKA ─────────────────────────────────────────
   Nagranie właściciela: oferta sprzedawała nóż za 45,00 zł, a detaliczna
   w kartotece to 29,06 zł — o 55% mniej. Tabela sześciu cen tego nie mówiła,
   bo cena oferty stała trzy sekcje wyżej, a porównanie trzeba było zrobić
   w głowie. Zdanie nazywa kierunek i skalę rozjazdu.

   Która cena jest nieaktualna, zdanie NIE rozstrzyga — mówi tylko, że się
   rozjechały. Rozstrzyga człowiek w Allegro albo w Subiekcie. */

/** Gdzie cena oferty stoi wobec poziomów brutto kartoteki; `null`, gdy nie ma czego porównać. */
export function polozenieOferty(ceny: CenaPoziomu[], oferta: { grosze: number; waluta: string }): Polozenie | null {
  const brutto = ceny.filter((c) => !brakBrutto(c) && c.waluta === oferta.waluta)
    .map((c) => ({ grosze: c.bruttoGrosze as number, nazwa: c.nazwa || `poziom ${c.poziom}` }));
  if (brutto.length === 0) return null;
  const najnizszy = brutto.reduce((a, b) => (b.grosze < a.grosze ? b : a));
  const najwyzszy = brutto.reduce((a, b) => (b.grosze > a.grosze ? b : a));
  const rowne = brutto.filter((b) => b.grosze === oferta.grosze).map((b) => b.nazwa);
  /* Zdanie mówi samo POŁOŻENIE. Kwotę oferty mówi karta zakupu, dymek
     pierścienia i nazwa figury dla czytnika ekranu; czwarty zapis tej samej
     liczby w jednym zdaniu zasłaniał to, co zdanie ma powiedzieć. */
  let zdanie: string;
  let krotko: string;
  if (oferta.grosze > najwyzszy.grosze) {
    const p = procent(Math.round((oferta.grosze / najwyzszy.grosze - 1) * 100));
    zdanie = `Oferta stoi ${p} nad najwyższym poziomem (${najwyzszy.nazwa} ${zlote(najwyzszy.grosze, oferta.waluta)}).`;
    krotko = `${p} nad najwyższym poziomem`;
  } else if (oferta.grosze < najnizszy.grosze) {
    const p = procent(Math.round((1 - oferta.grosze / najnizszy.grosze) * 100));
    zdanie = `Oferta stoi ${p} pod najniższym poziomem (${najnizszy.nazwa} ${zlote(najnizszy.grosze, oferta.waluta)}).`;
    krotko = `${p} pod najniższym poziomem`;
  } else if (rowne.length > 0) {
    /* Bez kwoty: równość podałaby cenę oferty, a jej dom to karta zakupu. */
    zdanie = rowne.length === 1 ? `Oferta równa poziomowi ${rowne[0]}.` : `Oferta równa poziomom: ${rowne.join(", ")}.`;
    krotko = `równa: ${rowne.join(", ")}`;
  } else {
    zdanie = "Oferta mieści się między poziomami kartoteki.";
    krotko = "między poziomami kartoteki";
  }
  return { min: Math.min(najnizszy.grosze, oferta.grosze), max: Math.max(najwyzszy.grosze, oferta.grosze), zdanie, krotko };
}

/**
 * Klucz: pierwszy poziom „detal…" w kolejności Subiekta, a bez niego pierwszy
 * z ceną brutto. To kwota czytana najczęściej, więc dostaje stałe miejsce:
 * pierwszy pas pod osią. Agent uczy się miejsca, nie szuka liczby.
 */
export function kluczowa(naOsi: Grupa[]): Grupa | undefined {
  return naOsi.find((g) => g.nazwy.some((n) => /detal/i.test(n))) ?? naOsi[0];
}

type Linie = 1 | 2;
type Kotwica = "srodek" | "poczatek" | "koniec";
type El = { p: PunktOsi; x: number; w: number };
/* Stan wiązki. Pasy w `Map`, pozycje i kotwice w tablicach po indeksie
   etykiety: wiązka kopiuje stan tysiące razy na jeden punkt, a kopia obiektu
   o kluczach liczbowych kosztowała więcej niż cała reszta układu. `Map`
   zachowuje kolejność wstawiania, więc ocena sumuje w tej samej kolejności. */
type Stan = {
  pasy: Map<string, number[]>;
  poz: number[];
  kotwice: Kotwica[];
  gl: Record<number, number>;
  koszt: number;
};

function szerokoscEtykiety(p: PunktOsi, linie: Linie, mierz: Mierz): number {
  const wn = mierz(p.nazwa, 400, 11);
  const wk = p.kwota ? mierz(p.kwota, 700, 12) : 0;
  /* Przy pustej kwocie bez odstępu, bo `ml-1` stoi na elemencie kwoty, którego
     wtedy nie ma. Piksel zapasu pokrywa różnicę miary kanwy i DOM-u. */
  const w = linie === 1 ? wn + (p.kwota ? G.ODSTEP_NAZWA_KWOTA + wk : 0) : Math.max(wn, wk);
  return Math.ceil(w) + 1 + 2 * G.WYPELNIENIE;
}

/** Regresja izotoniczna (pool adjacent violators), wagi równe. */
function pav(y: number[]): number[] {
  const bloki: Array<{ s: number; n: number }> = [];
  for (const v of y) {
    bloki.push({ s: v, n: 1 });
    while (bloki.length > 1) {
      const b = bloki[bloki.length - 1], a = bloki[bloki.length - 2];
      if (a.s / a.n <= b.s / b.n) break;
      a.s += b.s; a.n += b.n; bloki.pop();
    }
  }
  const out: number[] = [];
  for (const b of bloki) for (let i = 0; i < b.n; i++) out.push(b.s / b.n);
  return out;
}

/* Gdzie etykieta CHCE stać: znacznik pod środkiem, pod pierwszą albo pod
   ostatnią literą. Dwie ostatnie pozwalają zejść z cudzego znacznika. */
const KOTWICE: Kotwica[] = ["srodek", "poczatek", "koniec"];
function cel(e: El, kotwica: Kotwica): number {
  if (kotwica === "poczatek") return e.x - G.ZAKOTWICZENIE - G.WYPELNIENIE;
  if (kotwica === "koniec") return e.x - e.w + G.ZAKOTWICZENIE + G.WYPELNIENIE;
  return e.x - e.w / 2;
}

/* Jeden pas, etykiety po x. Suwak: znacznik leży w etykiecie co najmniej
   3 px od brzegu i nigdzie indziej. Szukamy pozycji najbliższych celom
   (najmniejsze kwadraty odległości) bez nachodzenia. Po podstawieniu
   t_i = s_i − C_i warunek „bez nachodzenia" znaczy „t niemalejące", a to
   jest dokładnie regresja izotoniczna (PAV). Potem przycinamy do przedziału,
   w którym pas da się złożyć; `null`, gdy takiego nie ma. */
function upakujPas(el: El[], cele: number[], W: number, przerwa: number): number[] | null {
  const n = el.length, m = G.ZAKOTWICZENIE;
  const lo: number[] = [], hi: number[] = [], C: number[] = [];
  let acc = 0;
  for (let k = 0; k < n; k++) {
    C[k] = acc; acc += el[k].w + przerwa;
    lo[k] = Math.max(0, el[k].x - el[k].w + m);
    hi[k] = Math.min(W - el[k].w, el[k].x - m);
    if (lo[k] > hi[k]) return null;
  }
  const e: number[] = [], l: number[] = [];
  e[0] = lo[0];
  for (let k = 1; k < n; k++) e[k] = Math.max(lo[k], e[k - 1] + el[k - 1].w + przerwa);
  l[n - 1] = hi[n - 1];
  for (let k = n - 2; k >= 0; k--) l[k] = Math.min(hi[k], l[k + 1] - przerwa - el[k].w);
  for (let k = 0; k < n; k++) if (e[k] > l[k] + 1e-6) return null;
  const t = pav(cele.map((c, k) => c - C[k]));
  return t.map((v, k) => Math.min(l[k], Math.max(e[k], v + C[k])));
}

/* Klucz pasa „strona:głębokość" rozbity raz. Ocena i prowadnice pytają
   o niego przy każdym z tysięcy stanów wiązki, a `split` za każdym razem
   był tam najdroższą linijką. */
const PASY = new Map<string, readonly [number, number]>();
function rozbij(klucz: string): readonly [number, number] {
  let sd = PASY.get(klucz);
  if (!sd) {
    const [s, d] = klucz.split(":").map(Number);
    sd = [s, d];
    PASY.set(klucz, sd);
  }
  return sd;
}

/* Prowadnica do pasa 2 przechodzi przez pas 1 — nie może przeciąć etykiety,
   bo wtedy kreska wyglądałaby jak podkreślenie cudzej kwoty. */
function prowadniceWolne(pasy: Map<string, number[]>, poz: number[], el: El[], s: number): boolean {
  for (const [klucz, czl] of pasy) {
    const [ks, d] = rozbij(klucz);
    if (ks !== s || d < 2) continue;
    for (const j of czl) {
      for (let d2 = 1; d2 < d; d2++) {
        for (const q of pasy.get(`${s}:${d2}`) || []) {
          if (el[j].x >= poz[q] - 2 && el[j].x <= poz[q] + el[q].w + 2) return false;
        }
      }
    }
  }
  return true;
}

/* Ile cudzych znaczników stoi pod etykietą. To kara, a nie zakaz: cudza
   kropka pod napisem „Bazowa 33,00" czyta się jak kropka Bazowej, a wszystkie
   trzy recenzje prototypu wskazały właśnie ten błąd. Poziom o cenie oferty
   siedzi w jej pierścieniu, więc to jedno miejsce, nie cudzy znacznik. */
function cudzePod(e: El, lewo: number, el: El[]): number {
  let n = 0;
  for (const f of el) {
    if (f === e || Math.abs(f.x - e.x) < 1.5) continue;
    if (f.x > lewo + 1 && f.x < lewo + e.w - 1) n++;
  }
  return n;
}

/* Koszt. Pas kosztuje 1000, bo każdy pas to wysokość bloku, a wysokość jest
   właśnie skargą właściciela („za dużo miejsca"). Żadna suma kar za położenie
   nie przebije jednego pasa więcej. Dalej liczy się przesunięcie od celu,
   cudzy znacznik pod etykietą, głębokość i preferencje stron: oferta nad
   osią, poziomy Subiekta pod nią, klucz w pierwszym pasie pod osią. */
function ocena(st: Omit<Stan, "koszt">, el: El[]): number {
  let k = G.KARA_PAS * (st.gl[-1] + st.gl[1]);
  for (const [klucz, czl] of st.pasy) {
    const [s, d] = rozbij(klucz);
    for (const j of czl) {
      const q = el[j];
      const v = st.kotwice[j];
      k += Math.abs(st.poz[j] - cel(q, v));
      if (v !== "srodek") k += G.KARA_KOTWICA;
      k += cudzePod(q, st.poz[j], el) * (d === 1 ? G.KARA_CUDZY : G.KARA_CUDZY / 2);
      k += G.KARA_GLEBIA * (d - 1);
      if (q.p.rodzaj === "oferta" && s > 0) k += G.KARA_OFERTA_POD;
      if (q.p.rodzaj === "poziom" && s < 0) k += G.KARA_POZIOM_NAD;
      if (q.p.klucz && !(s > 0 && d === 1)) k += G.KARA_KLUCZ;
    }
  }
  return k;
}

type Pasy = { linie: Linie; osY: number; wysokosc: number; etykiety: EtykietaOsi[] };

/* Wiązka 64 stanów idzie po punktach w kolejności osi. Nie gwarantuje
   optimum, ale jest deterministyczna i przy dziesięciu poziomach liczy się
   w kilka milisekund. Przy remisie x oferta idzie pierwsza. */
function ulozPasy(punkty: PunktOsi[], W: number, linie: Linie, mierz: Mierz): Pasy | null {
  const h = G.PAS[linie], przerwa = G.PRZERWA[linie], maxD = G.MAX_PASOW[linie];
  const el: El[] = punkty.map((p) => ({ p, x: p.x, w: szerokoscEtykiety(p, linie, mierz) }))
    .sort((a, b) => a.x - b.x || (a.p.rodzaj === "oferta" ? -1 : b.p.rodzaj === "oferta" ? 1 : 0));
  let stany: Stan[] = [{ pasy: new Map(), poz: [], kotwice: [], gl: { [-1]: 0, [1]: 0 }, koszt: 0 }];
  for (let i = 0; i < el.length; i++) {
    const nowe: Stan[] = [];
    for (const st of stany) {
      for (const s of [-1, 1]) {
        const doD = Math.min(st.gl[s] + 1, maxD);
        for (let d = 1; d <= doD; d++) {
          const k = `${s}:${d}`;
          const czl = [...(st.pasy.get(k) || []), i];
          for (const v of KOTWICE) {
            const pozycje = upakujPas(czl.map((j) => el[j]), czl.map((j) => cel(el[j], j === i ? v : st.kotwice[j])), W, przerwa);
            if (!pozycje) continue;
            const kotwice = st.kotwice.slice();
            kotwice[i] = v;
            const pasy = new Map(st.pasy).set(k, czl);
            const poz = st.poz.slice();
            czl.forEach((j, n) => { poz[j] = pozycje[n]; });
            /* Bez pasa 2 po tej stronie nie ma prowadnicy, która mogłaby
               przeciąć płytszą etykietę, więc sprawdzanie nic by nie dało. */
            if (Math.max(st.gl[s], d) >= 2 && !prowadniceWolne(pasy, poz, el, s)) continue;
            const gl = { ...st.gl, [s]: Math.max(st.gl[s], d) };
            const bez = { pasy, poz, kotwice, gl };
            nowe.push({ ...bez, koszt: ocena(bez, el) });
          }
        }
      }
    }
    if (nowe.length === 0) return null;
    nowe.sort((a, b) => a.koszt - b.koszt);
    stany = nowe.slice(0, G.WIAZKA);
  }
  const best = stany[0];
  const gA = best.gl[-1], gB = best.gl[1];
  const osY = gA ? G.PASMO + gA * h + (gA - 1) * G.ODSTEP_PASOW : G.KRAWEDZ;
  const wysokosc = osY + (gB ? G.PASMO + gB * h + (gB - 1) * G.ODSTEP_PASOW : G.KRAWEDZ);
  const etykiety: EtykietaOsi[] = [];
  for (const [klucz, czl] of best.pasy) {
    const [s, d] = rozbij(klucz);
    const gora = s < 0
      ? osY - G.PASMO - d * h - (d - 1) * G.ODSTEP_PASOW
      : osY + G.PASMO + (d - 1) * (h + G.ODSTEP_PASOW);
    for (const j of czl) {
      etykiety.push({ punkt: el[j].p, lewo: Math.round(best.poz[j]), gora, szer: el[j].w, wys: h,
        strona: s < 0 ? -1 : 1, pas: d, cudze: cudzePod(el[j], best.poz[j], el) });
    }
  }
  return { linie, osY, wysokosc, etykiety };
}

/**
 * Układ bloku cen przy danej szerokości kolumny.
 *
 * Bez oferty oś nie ma o co pytać (reklamacje, oferta niepobrana) — zostaje
 * dzisiejsza lista, bez zmian. Ta sama lista staje, gdy etykiet nie da się
 * ułożyć w kolumnie: lista, nie nachodzące napisy.
 */
export function ulozOsCen(ceny: CenaPoziomu[], oferta: { grosze: number; waluta: string } | null,
  szerokosc: number, mierz: Mierz): UkladOsi {
  const grupy = grupujCeny(ceny);
  const polozenie = oferta ? polozenieOferty(ceny, oferta) : null;
  if (!oferta || !polozenie) return { tryb: "lista", grupy, polozenie };
  const W = szerokosc;
  const waluta = oferta.waluta;
  const naOsi = grupy.filter((g) => !brakBrutto(g.cena) && g.cena.waluta === waluta);
  const pozaOsia = grupy.filter((g) => !naOsi.includes(g));
  const klucz = kluczowa(naOsi);
  const punkty: PunktOsi[] = naOsi.map((g) => ({
    id: `p${g.cena.poziom}`, rodzaj: "poziom", grosze: g.cena.bruttoGrosze as number, netto: g.cena.nettoGrosze,
    nazwy: g.nazwy, nazwa: nazwaGrupy(g.nazwy), kwota: "", klucz: g === klucz, x: 0,
  }));
  /* Etykieta oferty bez kwoty: kwota to fakt karty zakupu (każdy fakt stoi
     raz), a tu niesie ją dymek i nazwa figury. */
  punkty.push({ id: "oferta", rodzaj: "oferta", grosze: oferta.grosze, netto: null, nazwy: ["oferta"],
    nazwa: "oferta", kwota: "", klucz: false, x: 0 });
  const gr = punkty.map((q) => q.grosze);
  const min = Math.min(...gr), max = Math.max(...gr);
  const x0 = G.PAD, x1 = W - G.PAD;
  for (const q of punkty) {
    q.x = max === min ? (x0 + x1) / 2 : x0 + ((q.grosze - min) / (max - min)) * (x1 - x0);
    q.kwota = q.rodzaj === "oferta" ? "" : kwota(q.grosze);
  }
  const lv = naOsi.map((g) => g.cena.bruttoGrosze as number);
  const zakres = { od: Math.min(...lv), do: Math.max(...lv) };
  const kandydaci = ([1, 2] as const).map((l) => ulozPasy(punkty, W, l, mierz))
    .filter((k): k is Pasy => k !== null);
  /* Układ niewykonalny (bardzo wiele poziomów w wąskiej kolumnie): lista,
     nie nachodzące napisy. */
  if (kandydaci.length === 0) return { tryb: "lista", grupy, polozenie };
  /* Wygrywa niższy blok, bo wysokość jest skargą; przy remisie jedna linia,
     bo nazwę i kwotę czyta się wtedy jednym spojrzeniem. */
  kandydaci.sort((a, b) => a.wysokosc - b.wysokosc || a.linie - b.linie);
  return { tryb: "os", grupy, polozenie, waluta, punkty, pozaOsia, zakres, min, max, szerokosc: W, ...kandydaci[0] };
}

/** Etykiety w kolejności osi; przy remisie oferta pierwsza. Tak czyta je klawiatura i czytnik. */
export function poKolejnosciOsi(etykiety: EtykietaOsi[]): EtykietaOsi[] {
  return [...etykiety].sort((a, b) => a.punkt.x - b.punkt.x
    || (a.punkt.rodzaj === "oferta" ? -1 : b.punkt.rodzaj === "oferta" ? 1 : 0));
}

/**
 * Który punkt wskazuje kursor. Celem jest CAŁY pas wykresu, nie kropka 8 px:
 * najpierw etykieta pod kursorem (z marginesem 2 px), a poza etykietami
 * najbliższy znacznik w poziomie. Remis bierze oferta.
 */
export function trafienie(u: UkladNaOsi, px: number, py: number): string | null {
  for (const e of poKolejnosciOsi(u.etykiety)) {
    if (px >= e.lewo - 2 && px <= e.lewo + e.szer + 2 && py >= e.gora - 2 && py <= e.gora + e.wys + 2) return e.punkt.id;
  }
  let naj: string | null = null, d = Infinity;
  for (const p of u.punkty) {
    const dd = Math.abs(p.x - px) + (p.rodzaj === "oferta" ? -0.01 : 0);
    if (dd < d) { d = dd; naj = p.id; }
  }
  return naj;
}

/**
 * Punkty w jednym miejscu osi, oferta pierwsza. Poziom o cenie oferty siedzi
 * w jej pierścieniu, więc wskazanie jednego pokazuje oba w jednym dymku.
 */
export function wspolneMiejsce(u: UkladNaOsi, id: string | null): PunktOsi[] {
  const p = id === null ? undefined : u.punkty.find((q) => q.id === id);
  if (!p) return [];
  return u.punkty.filter((q) => Math.abs(q.x - p.x) < 1.5)
    .sort((a, b) => (a.rodzaj === "oferta" ? -1 : b.rodzaj === "oferta" ? 1 : 0));
}
