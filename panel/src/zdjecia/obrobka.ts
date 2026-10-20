/* ── RACHUNEK OBRÓBKI ZDJĘCIA TOWARU ─────────────────────────────────────────
   Same liczby, bez płótna i bez DOM-u. Płótno rysuje `obraz.ts`, a tu stoi
   to, co da się sprawdzić w teście na tablicy pikseli: poziomy, ramka
   treści, kwadrat i dobór jakości. Rachunek wymieszany z rysowaniem dałoby
   się sprawdzić tylko okiem w przeglądarce. */

/** Piksel o alfie do tej wartości liczy się jako tło, nie treść. */
export const PROG_ALFY = 8;

/** Dłuższy bok zdjęcia wysyłanego do usuwania tła. Więcej nie poprawia wycięcia, a wydłuża wysyłkę. */
export const MAKS_BOKU_WYSYLKI = 1600;

/** Bok gotowego kwadratu, decyzją właściciela. Wystarcza karcie towaru i wydrukowi, a plik jest lżejszy niż przy 1024. */
export const MAKS_BOKU_GOTOWEGO = 800;

/** Margines wokół towaru w kwadracie, jako część dłuższego boku treści. */
export const MARGINES_KWADRATU = 0.05;

/** Limit bajtów po zdekodowaniu base64; serwer przyjmuje 512 KB, zostawiamy zapas na nagłówki. */
export const LIMIT_BAJTOW = 500 * 1024;

/* Jakość schodzi krokami, a nie bisekcją. Pięć prób to pięć kodowań płótna,
   czyli ułamek sekundy, a krok 0,1 jest najmniejszym, który widać w pliku. */
export const JAKOSCI_WYSYLKI = [0.85, 0.75, 0.65, 0.55, 0.45] as const;
/* Gotowe zdjęcie ma ważyć jak najmniej, decyzją właściciela. Dolna jakość
   0,52 to granica, poniżej której na białym tle widać kostki JPEG-a. */
export const JAKOSCI_GOTOWEGO = [0.82, 0.75, 0.68, 0.6, 0.52] as const;

/** Waga, do której schodzimy z jakością. Kwadrat 800 px na białym zwykle mieści się w niej przy 0,7. */
export const CEL_BAJTOW_GOTOWEGO = 60 * 1024;

/* ── POZIOMY: ŁAGODNE ROZCIĄGNIĘCIE KANAŁÓW ─────────────────────────────────
   Zdjęcie z biurka ma szarą biel i zgaszoną czerń, bo robi je telefon pod
   lampą. Rozciągnięcie każdego kanału między percentylami 0,5% i 99,5%
   przywraca kontrast i zdejmuje żółty odcień lampy.

   Siła jest przycięta z dwóch stron. Czarny punkt nie wchodzi wyżej niż
   MAKS_PRZESUNIECIA, a biały niżej niż 255 minus tyle samo. Wzmocnienie nie
   przekracza więc 255/159, czyli 1,6. Bez tego ciemne zdjęcie czerwonej
   doniczki rozjechałoby się do jaskrawej czerwieni, której towar nie ma.

   Kanał o zakresie węższym niż MIN_ZAKRESU zostaje bez zmian. To zdjęcie
   jednobarwnej rzeczy, a rozciąganie zrobiłoby z szumu matrycy plamy. */
export const MAKS_PRZESUNIECIA = 48;
export const MIN_ZAKRESU = 32;
export const PERCENTYL_DOL = 0.005;
export const PERCENTYL_GORA = 0.995;

type Tablica = Uint8ClampedArray | Uint8Array | number[];
export type Trojka = [number, number, number];

/**
 * Percentyle każdego kanału RGB, liczone tylko z pikseli treści (alfa ponad próg).
 * `null`, gdy obraz nie ma ani jednego takiego piksela.
 */
export function percentyleKanalow(dane: Tablica, dol = PERCENTYL_DOL, gora = PERCENTYL_GORA):
  { lo: Trojka; hi: Trojka } | null {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;
  for (let i = 0; i + 3 < dane.length; i += 4) {
    if (dane[i + 3] <= PROG_ALFY) continue;
    hist[0][dane[i]]++; hist[1][dane[i + 1]]++; hist[2][dane[i + 2]]++;
    n++;
  }
  if (n === 0) return null;
  const prog = (h: Uint32Array, czesc: number, odDolu: boolean): number => {
    const cel = n * czesc;
    let suma = 0;
    for (let v = 0; v < 256; v++) {
      suma += h[v];
      /* Dolny percentyl: pierwsza wartość, poniżej której zostaje mniej niż
         `dol` pikseli. Górny: pierwsza, do której zebrało się `gora`. */
      if (odDolu ? suma > cel : suma >= cel) return v;
    }
    return 255;
  };
  const lo = hist.map((h) => prog(h, dol, true)) as Trojka;
  const hi = hist.map((h) => prog(h, gora, false)) as Trojka;
  return { lo, hi };
}

/** Tablica przejścia jednego kanału: 256 wartości wejścia → wyjście. */
export function tablicaPoziomow(lo: number, hi: number): Uint8Array {
  const t = new Uint8Array(256);
  if (hi - lo < MIN_ZAKRESU) {
    for (let v = 0; v < 256; v++) t[v] = v;
    return t;
  }
  const czarny = Math.min(lo, MAKS_PRZESUNIECIA);
  const bialy = Math.max(hi, 255 - MAKS_PRZESUNIECIA);
  const skala = 255 / (bialy - czarny);
  for (let v = 0; v < 256; v++) t[v] = Math.max(0, Math.min(255, Math.round((v - czarny) * skala)));
  return t;
}

/**
 * Wyrównuje poziomy w miejscu, na tablicy RGBA. Alfa zostaje nietknięta.
 * Zwraca `false`, gdy nie było czego wyrównać.
 */
export function wyrownajPoziomy(dane: Tablica): boolean {
  const p = percentyleKanalow(dane);
  if (!p) return false;
  const t = [0, 1, 2].map((k) => tablicaPoziomow(p.lo[k], p.hi[k]));
  let zmiana = false;
  for (let i = 0; i + 3 < dane.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const v = t[k][dane[i + k]];
      if (v !== dane[i + k]) { dane[i + k] = v; zmiana = true; }
    }
  }
  return zmiana;
}

/* ── RAMKA TREŚCI I KWADRAT ─────────────────────────────────────────────── */

export interface Prostokat { x: number; y: number; szer: number; wys: number }

/**
 * Najmniejszy prostokąt obejmujący piksele o alfie ponad próg.
 * `null`, gdy po usunięciu tła nie zostało nic.
 */
export function ramkaAlfy(dane: Tablica, szer: number, wys: number, prog = PROG_ALFY): Prostokat | null {
  let x0 = szer, y0 = wys, x1 = -1, y1 = -1;
  for (let y = 0; y < wys; y++) {
    for (let x = 0; x < szer; x++) {
      if (dane[(y * szer + x) * 4 + 3] <= prog) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, szer: x1 - x0 + 1, wys: y1 - y0 + 1 };
}

/**
 * Gdzie postawić treść w kwadracie: bok kwadratu i prostokąt docelowy.
 *
 * Kwadrat, bo Allegro i karta Subiekta kadrują miniatury do kwadratu, a towar
 * z wysokiego zdjęcia traci wtedy górę i dół. Bok nie przekracza `maks`,
 * ale też nie rośnie ponad treść z marginesem: powiększenie nie dodaje
 * szczegółów, tylko rozmywa.
 */
export function kwadratWokol(szer: number, wys: number,
  { margines = MARGINES_KWADRATU, maks = MAKS_BOKU_GOTOWEGO } = {}): { bok: number } & Prostokat {
  const dluzszy = Math.max(szer, wys, 1);
  const pas = Math.round(dluzszy * margines);
  const naturalny = dluzszy + 2 * pas;
  const bok = Math.min(maks, naturalny);
  const skala = bok / naturalny;
  const dw = Math.max(1, Math.round(szer * skala));
  const dh = Math.max(1, Math.round(wys * skala));
  return { bok, x: Math.floor((bok - dw) / 2), y: Math.floor((bok - dh) / 2), szer: dw, wys: dh };
}

/** Wymiary po zmniejszeniu do `maks` na dłuższym boku. Nigdy nie powiększa. */
export function wymiaryWLimicie(szer: number, wys: number, maks: number): { szer: number; wys: number } {
  const dluzszy = Math.max(szer, wys);
  if (dluzszy <= maks) return { szer, wys };
  const s = maks / dluzszy;
  return { szer: Math.max(1, Math.round(szer * s)), wys: Math.max(1, Math.round(wys * s)) };
}

/* ── KADR ───────────────────────────────────────────────────────────────── */

/** Kadr w częściach obrazu (0–1), niezależny od rozmiaru, w jakim go narysowano. */
export type Kadr = Prostokat;

/** Kadr węższy niż ta część boku to przypadkowe kliknięcie, nie zaznaczenie. */
export const MIN_KADRU = 0.02;

export interface Punkt { x: number; y: number }

/** Prostokąt z dwóch rogów przeciągnięcia, przycięty do obrazu; `null`, gdy za mały. */
export function kadrZPrzeciagniecia(a: Punkt, b: Punkt): Kadr | null {
  const obetnij = (v: number) => Math.max(0, Math.min(1, v));
  const x0 = obetnij(Math.min(a.x, b.x)), x1 = obetnij(Math.max(a.x, b.x));
  const y0 = obetnij(Math.min(a.y, b.y)), y1 = obetnij(Math.max(a.y, b.y));
  if (x1 - x0 < MIN_KADRU || y1 - y0 < MIN_KADRU) return null;
  return { x: x0, y: y0, szer: x1 - x0, wys: y1 - y0 };
}

/** Kadr w pikselach obrazu, co najmniej jeden piksel, nigdy poza krawędzią. */
export function kadrWPikselach(k: Kadr, szer: number, wys: number): Prostokat {
  const x = Math.min(szer - 1, Math.max(0, Math.round(k.x * szer)));
  const y = Math.min(wys - 1, Math.max(0, Math.round(k.y * wys)));
  return {
    x, y,
    szer: Math.max(1, Math.min(szer - x, Math.round(k.szer * szer))),
    wys: Math.max(1, Math.min(wys - y, Math.round(k.wys * wys))),
  };
}

/* ── JAKOŚĆ PLIKU ───────────────────────────────────────────────────────── */

/** Bajty po zdekodowaniu base64, bez dekodowania. */
export function bajtyBase64(b64: string): number {
  const dopelnienie = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - dopelnienie;
}

/**
 * Koduje kolejno coraz niższą jakością, aż plik zmieści się w limicie.
 * `miesciSie: false` znaczy, że nawet najniższa jakość nie wystarczyła;
 * wynik jest wtedy ostatnią próbą, a decyzję podejmuje wołający.
 */
export async function zakodujWLimicie(koduj: (jakosc: number) => string | Promise<string>,
  limit: number, jakosci: readonly number[]): Promise<{ base64: string; jakosc: number; bajtow: number; miesciSie: boolean }> {
  let ostatni = { base64: "", jakosc: jakosci[0], bajtow: 0 };
  for (const jakosc of jakosci) {
    const base64 = await koduj(jakosc);
    const bajtow = bajtyBase64(base64);
    ostatni = { base64, jakosc, bajtow };
    if (bajtow <= limit) return { ...ostatni, miesciSie: true };
  }
  return { ...ostatni, miesciSie: false };
}

/**
 * Najlżejszy plik, który jeszcze dobrze wygląda: pierwsza jakość mieszcząca
 * się w `cel`. Gdy żadna się nie mieści, bierze ostatnią, czyli najlżejszą
 * próbę. `miesciSie: false` znaczy wtedy tylko, że ta przekracza twardy `limit`.
 */
export async function zakodujJakNajlzej(koduj: (jakosc: number) => string | Promise<string>,
  cel: number, limit: number, jakosci: readonly number[]):
  Promise<{ base64: string; jakosc: number; bajtow: number; miesciSie: boolean }> {
  const w = await zakodujWLimicie(koduj, cel, jakosci);
  return w.miesciSie ? w : { ...w, miesciSie: w.bajtow <= limit };
}

/* ── OBRÓT ──────────────────────────────────────────────────────────────── */

export type Obrot = 0 | 90 | 180 | 270;

/** Obrót o ćwierć w prawo (+1) albo w lewo (−1). */
export function obroc(o: Obrot, kierunek: 1 | -1): Obrot {
  return (((o + kierunek * 90) % 360) + 360) % 360 as Obrot;
}
