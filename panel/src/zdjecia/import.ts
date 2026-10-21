import type { PozycjaDopasowania } from "../api/zdjecia";

/* ── IMPORT ZDJĘĆ Z FOLDERU: RACHUNEK BEZ PŁÓTNA ───────────────────────────
   Właściciel trzyma zdjęcia w folderze, a nazwa pliku to symbol towaru.
   Tu stoi wszystko, co da się policzyć bez przeglądarki: symbol z nazwy,
   wybór jednego pliku na symbol i klasa po odpowiedzi serwera. Okno
   (`ImportZFolderu.tsx`) tylko rysuje te liczby i woła płótno. */

/** Najdłuższy symbol, jaki przyjmuje kartoteka Subiekta. Dłuższa nazwa to na pewno nie symbol. */
export const MAKS_SYMBOLU = 20;

/** Poniżej tego boku zdjęcie wygląda na Allegro słabo. Tylko ostrzegamy, bo właściciel woli małe niż żadne. */
export const MALY_BOK = 300;

/** Ile zdjęć naraz idzie do serwera. Dwa trzymają łącze zajęte, a nie zalewają kolejki Subiekta. */
export const WSPOLBIEZNOSC = 2;

/** Ile symboli mieści jedno pytanie `dopasuj` — limit serwera. */
export const SYMBOLI_NA_PYTANIE = 2000;

/* Rozszerzenia na wypadek pustego `type`: system bez skojarzeń nie podaje
   typu pliku, a zdjęcie i tak jest zdjęciem. */
const ROZSZERZENIA = /\.(jpe?g|png|webp|gif|bmp)$/i;

/** Czy plik w ogóle jest zdjęciem. Resztę folderu (PDF, Thumbs.db) pomijamy po cichu i liczymy. */
export function czyZdjecie(p: { name: string; type: string }): boolean {
  return p.type ? p.type.startsWith("image/") : ROZSZERZENIA.test(p.name);
}

/**
 * Symbol z nazwy pliku: bez rozszerzenia, przycięty, wielkimi literami.
 * `null`, gdy nazwa nie może być symbolem — pusta albo dłuższa od kartoteki.
 */
export function symbolZNazwy(nazwa: string): string | null {
  const kropka = nazwa.lastIndexOf(".");
  const rdzen = (kropka > 0 ? nazwa.slice(0, kropka) : nazwa).trim().toUpperCase();
  if (!rdzen || rdzen.length > MAKS_SYMBOLU) return null;
  return rdzen;
}

/* Dopiski, które ludzie doklejają do symbolu: `W08-0501-miniaturka`,
   `W08-0501-1`, `W08-0501 (2)`. Cyfr odcinamy najwyżej trzy, bo symbol
   sam kończy się czterema (`-0501`) i tych ruszyć nie wolno. */
const DOPISEK = /(?:[\s_-]+(?:miniaturka|miniatura|mini|thumbnail|thumb|small|\d{1,3})|\s*\(\d{1,3}\))$/i;

/** Rdzeń bez dopisków, zdejmowanych póki jakiś jest: `W08-0501-1-miniaturka` → `W08-0501`. */
export function bezDopiskow(rdzen: string): string {
  let r = rdzen.trim();
  for (let i = 0; i < 4; i++) {
    const krotszy = r.replace(DOPISEK, "").trim();
    if (krotszy === r || !krotszy) break;
    r = krotszy;
  }
  return r;
}

/**
 * Możliwe symbole jednego pliku, od najpewniejszego.
 *
 * Pełna nazwa idzie pierwsza, więc symbol z cyfrą na końcu wygrywa
 * z wersją przyciętą. Dalej nazwa bez dopisku, potem foldery od
 * najbliższego: plik `miniaturka.jpg` w folderze `W08-0501` należy do
 * `W08-0501`. Który kandydat jest symbolem, rozstrzyga Subiekt, nie wzorzec.
 */
export function kandydaci(p: { name: string; webkitRelativePath?: string }): string[] {
  const wynik: string[] = [];
  const dodaj = (rdzen: string) => {
    for (const r of [rdzen, bezDopiskow(rdzen)]) {
      const s = symbolZNazwy(r);
      if (s && !wynik.includes(s)) wynik.push(s);
    }
  };
  const kropka = p.name.lastIndexOf(".");
  dodaj(kropka > 0 ? p.name.slice(0, kropka) : p.name);
  /* Ścieżkę względną daje tylko wybór folderu; pliki luzem jej nie mają. */
  const foldery = (p.webkitRelativePath ?? "").split("/").slice(0, -1).reverse();
  for (const f of foldery) dodaj(f);
  return wynik;
}

export interface Grupa<P> { symbol: string; pliki: P[] }

export interface Rozbior<P> {
  /** Zdjęcia z kandydatami na symbol, w kolejności wyboru. */
  pliki: Array<{ plik: P; kandydaci: string[] }>;
  /** Zdjęcia bez żadnego kandydata — ani nazwa, ani folder nie mogą być symbolem. */
  niesymbole: P[];
  /** Pliki, które nie są zdjęciami. */
  odrzucone: P[];
}

/** Podział wybranych plików: zdjęcia z kandydatami, zdjęcia bez kandydata i nie-zdjęcia. */
export function rozbierz<P extends { name: string; type: string; webkitRelativePath?: string }>(
  pliki: readonly P[]): Rozbior<P> {
  const zKandydatami: Rozbior<P>["pliki"] = [];
  const niesymbole: P[] = [];
  const odrzucone: P[] = [];
  for (const p of pliki) {
    if (!czyZdjecie(p)) { odrzucone.push(p); continue; }
    const k = kandydaci(p);
    if (k.length === 0) niesymbole.push(p); else zKandydatami.push({ plik: p, kandydaci: k });
  }
  return { pliki: zKandydatami, niesymbole, odrzucone };
}

/**
 * Grupy po symbolu po odpowiedzi `dopasuj`.
 *
 * Plik dostaje pierwszego kandydata, którego Subiekt zna — także
 * niejednoznacznego, bo to wciąż towar, tylko do ręcznego wyboru.
 * Plik bez trafienia stoi pod swoim pierwszym kandydatem i wychodzi
 * jako „brak w Subiekcie”.
 */
export function przypiszSymbole<P>(pliki: ReadonlyArray<{ plik: P; kandydaci: string[] }>,
  znane: ReadonlyMap<string, PozycjaDopasowania>): Grupa<P>[] {
  const grupy = new Map<string, Grupa<P>>();
  for (const { plik, kandydaci: k } of pliki) {
    const s = k.find((x) => { const p = znane.get(x); return !!p && (p.twId !== null || !!p.niejednoznaczny); }) ?? k[0];
    const g = grupy.get(s);
    if (g) g.pliki.push(plik); else grupy.set(s, { symbol: s, pliki: [plik] });
  }
  return [...grupy.values()];
}

/** Wariant pliku po wczytaniu: wymiary znamy dopiero z płótna. */
export interface Wariant { nazwa: string; typ: string; bajtow: number; szer: number; wys: number }

/* Zdjęcie główne oferty: w folderach Allegro to `min.jpg` albo
   `W08-0501-miniaturka.jpg`. Reszta (`2`, `kat`, `ls1`) to ujęcia
   dodatkowe i aranżacje, które na kartę towaru się nie nadają. */
const GLOWNE = /(?:^|[\s_-])(?:min|mini|miniaturka|miniatura|glowne|główne|main)$/i;

/** Czy nazwa pliku wskazuje zdjęcie główne oferty. */
export function czyGlowne(nazwa: string): boolean {
  const kropka = nazwa.lastIndexOf(".");
  return GLOWNE.test((kropka > 0 ? nazwa.slice(0, kropka) : nazwa).trim());
}

/**
 * Jeden plik na symbol. Pierwsze wygrywa zdjęcie główne (`min`, `miniaturka`),
 * dalej więcej pikseli.
 *
 * Przy remisie PNG przed resztą, bo PNG bywa wycięty z tłem i nie niesie
 * strat kompresji. Dalej większy plik, bo przy tych samych wymiarach
 * niesie więcej szczegółu. Na końcu nazwa, żeby wybór był powtarzalny.
 */
export function wybierzWariant<W extends Wariant>(warianty: readonly W[]): W {
  const png = (w: W) => (w.typ === "image/png" || /\.png$/i.test(w.nazwa) ? 1 : 0);
  const glowne = (w: W) => (czyGlowne(w.nazwa) ? 1 : 0);
  return [...warianty].sort((a, b) =>
    glowne(b) - glowne(a) || b.szer * b.wys - a.szer * a.wys || png(b) - png(a) || b.bajtow - a.bajtow
      || a.nazwa.localeCompare(b.nazwa))[0];
}

export type Klasa = "do_importu" | "ma_zdjecie" | "czeka" | "zablokowany" | "niejednoznaczny" | "nieznany_symbol";

/**
 * Klasa symbolu po odpowiedzi `dopasuj`.
 * Kolejność sprawdzeń to kolejność ważności: brak towaru przesłania resztę,
 * a istniejące zdjęcie przesłania kolejkę, bo nadpisywać go nie chcemy.
 */
export function klasyfikuj(p: PozycjaDopasowania | undefined): Klasa {
  /* Kilka kartotek z jednym symbolem to nie brak towaru. Zgadywanie
     kartoteki dałoby zdjęcie złemu towarowi, więc taki symbol idzie ręcznie. */
  if (p?.niejednoznaczny) return "niejednoznaczny";
  if (!p || p.twId === null) return "nieznany_symbol";
  if (p.maZdjecie) return "ma_zdjecie";
  if (p.oczekuje) return "czeka";
  if (p.zablokowany) return "zablokowany";
  return "do_importu";
}

/**
 * Jeden wpis na towar. Dwa symbole mogą trafić w tę samą kartotekę,
 * a drugie zdjęcie tego towaru serwer odrzuci jako czekające. Pliki
 * scalamy, więc wybór lepszego pliku obejmuje oba symbole.
 */
export function jedenNaTowar<P>(lista: ReadonlyArray<{ symbol: string; twId: number; pliki: P[] }>):
  Array<{ symbol: string; twId: number; pliki: P[] }> {
  const mapa = new Map<number, { symbol: string; twId: number; pliki: P[] }>();
  for (const w of lista) {
    const juz = mapa.get(w.twId);
    if (juz) juz.pliki.push(...w.pliki); else mapa.set(w.twId, { ...w, pliki: [...w.pliki] });
  }
  return [...mapa.values()];
}

/** Symbole w paczkach po limicie serwera, bez powtórzeń. */
export function paczki(symbole: readonly string[], rozmiar = SYMBOLI_NA_PYTANIE): string[][] {
  const unikalne = [...new Set(symbole)];
  const wynik: string[][] = [];
  for (let i = 0; i < unikalne.length; i += rozmiar) wynik.push(unikalne.slice(i, i + rozmiar));
  return wynik;
}

/**
 * Praca nad listą w `wspolbieznosc` torach naraz.
 *
 * `stop` pytany przed KAŻDYM kolejnym zadaniem: zatrzymanie kończy bieżące,
 * a nowych nie zaczyna. Błąd pracy nie przerywa reszty — `praca` ma go
 * zapisać sama, bo jeden zły plik nie może zatrzymać trzystu dobrych.
 */
export async function poKolei<T>(zadania: readonly T[], wspolbieznosc: number,
  praca: (t: T) => Promise<void>, stop: () => boolean = () => false): Promise<void> {
  let i = 0;
  const tor = async () => {
    while (i < zadania.length && !stop()) {
      const t = zadania[i++];
      try { await praca(t); } catch { /* praca zapisuje błąd sama — patrz opis */ }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(wspolbieznosc, zadania.length)) }, tor));
}
