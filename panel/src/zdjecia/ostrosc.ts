/* ── OSTROŚĆ ZDJĘCIA: RACHUNEK BEZ PŁÓTNA ──────────────────────────────────
   Miara do listy niewyraźnych zdjęć kartotek. Płótno tylko oddaje piksele
   (`obraz.ts`), a cały rachunek stoi tutaj, bo jsdom nie rysuje, a liczby
   trzeba sprawdzić testem.

   Miara to wariancja laplasjanu na szarości. Ostra krawędź daje duże skoki
   drugiej pochodnej, rozmyta — małe. Trzy decyzje, każda z powodem:

   1. Zdjęcie skalujemy tak, by DŁUŻSZY bok miał 400 px, w górę i w dół.
      Bez tego miara zależałaby od rozmiaru pliku. Małe zdjęcie powiększone
      wychodzi miękkie i słusznie, bo tak samo wygląda na karcie towaru.
   2. Liczymy tylko piksele przedmiotu: szarość poniżej 245 gdzieś w otoczeniu
      3×3. Białe tło ma laplasjan zero i zaniżałoby wynik zdjęciom, na których
      towar zajmuje mało kadru. Otoczenie łapie też brzeg przedmiotu, a tam
      ostrość widać najlepiej.
   3. Gdy przedmiotu jest mniej niż 5% kadru, miary nie ma (`null`). Kilka
      ciemnych pikseli na bieli nie mówi nic o ostrości, a liczba udawałaby
      wiedzę. */

/** Dłuższy bok obrazu, na którym liczymy ostrość. */
export const BOK_POMIARU = 400;

/** Szarość od tej wartości w górę uznajemy za białe tło. */
export const PROG_BIELI = 245;

/** Najmniejszy udział przedmiotu w kadrze, przy którym miara coś znaczy. */
export const MIN_PRZEDMIOTU = 0.05;

/** Wynik oceny: dłuższy bok w pikselach i ostrość albo `null`, gdy nie da się ocenić. */
export interface Ocena { bok: number; ostrosc: number | null }

/** Szarość z RGBA wagami luminancji (BT.601). Przezroczystość traktujemy jak biel, bo tak ją złoży `zlozGotowy`. */
export function szarosc(rgba: ArrayLike<number>, szer: number, wys: number): Float32Array {
  const g = new Float32Array(szer * wys);
  for (let i = 0; i < szer * wys; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const y = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    g[i] = y * a + 255 * (1 - a);
  }
  return g;
}

/** Wymiary po skalowaniu do `BOK_POMIARU` na dłuższym boku. */
export function wymiaryPomiaru(szer: number, wys: number, bok = BOK_POMIARU): { szer: number; wys: number } {
  const s = bok / Math.max(szer, wys);
  return { szer: Math.max(1, Math.round(szer * s)), wys: Math.max(1, Math.round(wys * s)) };
}

/**
 * Szarość przeskalowana do nowych wymiarów.
 *
 * W dół średnia z prostokąta źródła, bo próbkowanie co kilka pikseli
 * dodałoby schodki i zawyżyło ostrość dużym zdjęciom. W górę interpolacja
 * dwuliniowa, która miękko wypełnia brakujące piksele, jak przeglądarka.
 */
export function skaluj(g: Float32Array, szer: number, wys: number, nSzer: number, nWys: number): Float32Array {
  const w = new Float32Array(nSzer * nWys);
  const sx = szer / nSzer, sy = wys / nWys;
  if (sx >= 1 && sy >= 1) {
    for (let y = 0; y < nWys; y++) {
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(wys, Math.floor((y + 1) * sy)));
      for (let x = 0; x < nSzer; x++) {
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(szer, Math.floor((x + 1) * sx)));
        let suma = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) suma += g[yy * szer + xx];
        w[y * nSzer + x] = suma / ((y1 - y0) * (x1 - x0));
      }
    }
    return w;
  }
  for (let y = 0; y < nWys; y++) {
    const fy = Math.min(wys - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(wys - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < nSzer; x++) {
      const fx = Math.min(szer - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(szer - 1, x0 + 1), tx = fx - x0;
      const gora = g[y0 * szer + x0] * (1 - tx) + g[y0 * szer + x1] * tx;
      const dol = g[y1 * szer + x0] * (1 - tx) + g[y1 * szer + x1] * tx;
      w[y * nSzer + x] = gora * (1 - ty) + dol * ty;
    }
  }
  return w;
}

/**
 * Wariancja laplasjanu na pikselach przedmiotu; `null`, gdy przedmiotu
 * jest za mało. Brzeg obrazu pomijamy, bo laplasjan potrzebuje sąsiadów.
 */
export function wariancjaLaplasjanu(g: Float32Array, szer: number, wys: number): number | null {
  let n = 0, suma = 0, kwadraty = 0;
  const wnetrze = Math.max(0, szer - 2) * Math.max(0, wys - 2);
  for (let y = 1; y < wys - 1; y++) {
    for (let x = 1; x < szer - 1; x++) {
      const i = y * szer + x;
      let przedmiot = false;
      for (let dy = -1; dy <= 1 && !przedmiot; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (g[i + dy * szer + dx] < PROG_BIELI) { przedmiot = true; break; }
      }
      if (!przedmiot) continue;
      const l = g[i - 1] + g[i + 1] + g[i - szer] + g[i + szer] - 4 * g[i];
      n++; suma += l; kwadraty += l * l;
    }
  }
  if (wnetrze === 0 || n < wnetrze * MIN_PRZEDMIOTU) return null;
  const srednia = suma / n;
  return kwadraty / n - srednia * srednia;
}

/** Pełna ocena pikseli RGBA: bok przed skalowaniem i ostrość po skalowaniu do `BOK_POMIARU`. */
export function ocenPiksele(rgba: ArrayLike<number>, szer: number, wys: number): Ocena {
  const bok = Math.max(szer, wys);
  if (szer < 1 || wys < 1) return { bok, ostrosc: null };
  const cel = wymiaryPomiaru(szer, wys);
  const g = skaluj(szarosc(rgba, szer, wys), szer, wys, cel.szer, cel.wys);
  return { bok, ostrosc: wariancjaLaplasjanu(g, cel.szer, cel.wys) };
}

/**
 * Czy zdjęcie z oferty jest lepsze od tego w Subiekcie.
 *
 * Wystarczy jedno z dwóch: większy bok albo wyższa ostrość. Zdjęcie bez
 * miary ostrości nie wygrywa ostrością, bo nie wiemy, jakie jest.
 */
export function lepszeOd(przed: Ocena, po: Ocena): boolean {
  if (po.bok > przed.bok) return true;
  if (po.ostrosc === null) return false;
  return przed.ostrosc === null || po.ostrosc > przed.ostrosc;
}

/** Czy zdjęcie jest pod progiem: za mały bok albo za niska ostrość. Brak miary nie jest niską ostrością. */
export function podProgiem(o: Ocena, progBoku: number, progOstrosci: number): boolean {
  return o.bok < progBoku || (o.ostrosc !== null && o.ostrosc < progOstrosci);
}

/** Porządek listy od najgorszych: ostrość rosnąco, bez miary na końcu, potem mniejszy bok. */
export function odNajgorszych(a: Ocena, b: Ocena): number {
  if (a.ostrosc === null && b.ostrosc !== null) return 1;
  if (b.ostrosc === null && a.ostrosc !== null) return -1;
  if (a.ostrosc !== null && b.ostrosc !== null && a.ostrosc !== b.ostrosc) return a.ostrosc - b.ostrosc;
  return a.bok - b.bok;
}
