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

export interface Grupa<P> { symbol: string; pliki: P[] }

export interface Rozbior<P> {
  /** Jeden wpis na symbol, w kolejności pierwszego pliku. */
  grupy: Grupa<P>[];
  /** Zdjęcia, których nazwa nie może być symbolem. */
  niesymbole: P[];
  /** Pliki, które nie są zdjęciami. */
  odrzucone: P[];
}

/** Podział wybranych plików: grupy po symbolu, nazwy niebędące symbolem i nie-zdjęcia. */
export function rozbierz<P extends { name: string; type: string }>(pliki: readonly P[]): Rozbior<P> {
  const grupy = new Map<string, Grupa<P>>();
  const niesymbole: P[] = [];
  const odrzucone: P[] = [];
  for (const p of pliki) {
    if (!czyZdjecie(p)) { odrzucone.push(p); continue; }
    const s = symbolZNazwy(p.name);
    if (!s) { niesymbole.push(p); continue; }
    const g = grupy.get(s);
    if (g) g.pliki.push(p); else grupy.set(s, { symbol: s, pliki: [p] });
  }
  return { grupy: [...grupy.values()], niesymbole, odrzucone };
}

/** Wariant pliku po wczytaniu: wymiary znamy dopiero z płótna. */
export interface Wariant { nazwa: string; typ: string; bajtow: number; szer: number; wys: number }

/**
 * Jeden plik na symbol: więcej pikseli wygrywa.
 *
 * Przy remisie PNG przed resztą, bo PNG bywa wycięty z tłem i nie niesie
 * strat kompresji. Dalej większy plik, bo przy tych samych wymiarach
 * niesie więcej szczegółu. Na końcu nazwa, żeby wybór był powtarzalny.
 */
export function wybierzWariant<W extends Wariant>(warianty: readonly W[]): W {
  const png = (w: W) => (w.typ === "image/png" || /\.png$/i.test(w.nazwa) ? 1 : 0);
  return [...warianty].sort((a, b) =>
    b.szer * b.wys - a.szer * a.wys || png(b) - png(a) || b.bajtow - a.bajtow
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
