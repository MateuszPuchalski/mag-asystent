/* ── Logo dostawcy: dowolny obraz → mały PNG przycięty do treści (0.444.0) ──
   Przeniesione z `naPng` w `biuro.html` (0.87.0) razem z uzasadnieniami.

   PRZYCIĘCIE JEST TU NAJWAŻNIEJSZE i powstało ze zgłoszenia „logo za małe na
   liście dostaw". Do 0.87.0 każde logo stało wyśrodkowane w KWADRACIE, a
   logotypy to szerokie paski z nazwą firmy — więc dwie trzecie obrazu było
   przezroczystym powietrzem. Kolektor skalował slot do wysokości kwadratu,
   razem z tym powietrzem, i poszerzanie slotu nic nie dawało.

   TŁA NIE WYPEŁNIAMY. Logo bywa przezroczyste, a biały prostokąt pod nim
   wyglądałby na kolektorze jak naklejka na jasnym wierszu.

   Rachunek (ramka, zmniejszanie) stoi w czystych funkcjach z testem; płótno
   i `Image` zostają w jednej funkcji na końcu, bo jsdom ich nie ma. */

/** Dłuższy bok zapisanego logo. 128 px rozciągnięte na 80 dp przy gęstości ×3 było rozmyte. */
export const LOGO_BOK = 256;
/** Bok roboczy przed przycięciem — tyle wystarcza, żeby znaleźć granice logo. */
export const LOGO_BOK_ROBOCZY = 512;
/** Piksel o przezroczystości do tej wartości (0–255) uznajemy za pusty. */
export const LOGO_PROG_ALFA = 8;
/* Ile znaków może mieć `data:`-URL, żeby po dekodowaniu zmieścić się w limicie
   serwera (128 kB, `MAX_BAJTOW` w services/logo-dostawcy.ts). Base64 puchnie
   o jedną trzecią, a margines bierze się z nagłówka `data:image/png;base64,`. */
export const LOGO_MAX_ZNAKOW = Math.floor(120 * 1024 * 4 / 3);

export interface Ramka { x: number; y: number; w: number; h: number }

/**
 * Prostokąt zajęty przez widoczne piksele; `null`, gdy obraz jest cały pusty.
 *
 * Przy `null` zapisujemy obraz w całości: pusty plik jest tym, co człowiek
 * wybrał, i lepiej, żeby to zobaczył, niż żeby aplikacja po cichu zapisała
 * jeden przezroczysty piksel.
 */
export function ramkaWidoczna(dane: ArrayLike<number>, szer: number, wys: number, prog = LOGO_PROG_ALFA): Ramka | null {
  let x1 = szer, y1 = wys, x2 = -1, y2 = -1;
  for (let y = 0; y < wys; y++) {
    for (let x = 0; x < szer; x++) {
      if (dane[(y * szer + x) * 4 + 3] <= prog) continue;
      if (x < x1) x1 = x;
      if (x > x2) x2 = x;
      if (y < y1) y1 = y;
      if (y > y2) y2 = y;
    }
  }
  if (x2 < 0) return null;
  return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
}

/**
 * Koduje w coraz mniejszym boku, aż wynik zmieści się w limicie.
 *
 * Logotyp to zwykle płaska grafika i waży kilka kB. Bywa jednak wgrywane
 * zdjęcie szyldu, a takie 256 px potrafi przekroczyć limit serwera. Odmowa
 * „wgraj przez panel" byłaby wtedy ślepym zaułkiem — panel WŁAŚNIE to zrobił.
 * Poniżej 64 px nie schodzimy: taki obraz nie jest już logo, a serwer powie
 * wtedy wprost, że plik jest za duży.
 */
export function zmniejszajAzZmiesci(koduj: (bok: number) => string, max = LOGO_MAX_ZNAKOW,
  start = LOGO_BOK, dno = 64): string {
  let bok = start;
  let wynik = koduj(bok);
  while (wynik.length > max && bok > dno) {
    bok = Math.round(bok / 2);
    wynik = koduj(bok);
  }
  return wynik;
}

/** Wymiary po wpisaniu `w×h` w bok `bok` (nigdy nie powiększa, nigdy zero). */
export function wBoku(w: number, h: number, bok: number): { w: number; h: number } {
  const skala = Math.min(1, bok / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * skala)), h: Math.max(1, Math.round(h * skala)) };
}

function wczytaj(plik: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(plik);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("To nie jest obraz, który przeglądarka umie otworzyć"));
    };
    img.src = url;
  });
}

/** Dowolny obraz (PNG, JPG, WEBP, SVG) → `data:image/png;base64,…` gotowy do wysłania. */
export async function naPng(plik: Blob): Promise<string> {
  const img = await wczytaj(plik);
  /* SVG bez atrybutów width/height zgłasza wymiar 0 i narysowałby się jako
     nic. Wtedy przyjmujemy bok roboczy — lepiej logo lekko rozciągnięte niż
     pusty obrazek bez śladu, dlaczego jest pusty. */
  const w = img.naturalWidth || LOGO_BOK_ROBOCZY;
  const h = img.naturalHeight || LOGO_BOK_ROBOCZY;
  /* Najpierw kopia robocza, dopiero z niej czytamy piksele: plik z aparatu
     ma 4000 px boku, a `getImageData` na nim to 64 MB przepisane po nic. */
  const r = wBoku(w, h, LOGO_BOK_ROBOCZY);
  const robocze = document.createElement("canvas");
  robocze.width = r.w;
  robocze.height = r.h;
  const ctx = robocze.getContext("2d");
  if (!ctx) throw new Error("Przeglądarka nie dała płótna do przerobienia obrazu");
  ctx.drawImage(img, 0, 0, r.w, r.h);

  let ramka: Ramka | null = null;
  try {
    ramka = ramkaWidoczna(ctx.getImageData(0, 0, r.w, r.h).data, r.w, r.h);
  } catch { /* obraz z innego źródła — czytać pikseli nie wolno, zapisujemy całość */ }
  const k = ramka ?? { x: 0, y: 0, w: r.w, h: r.h };

  return zmniejszajAzZmiesci((bok) => {
    const d = wBoku(k.w, k.h, bok);
    const c = document.createElement("canvas");
    c.width = d.w;
    c.height = d.h;
    c.getContext("2d")!.drawImage(robocze, k.x, k.y, k.w, k.h, 0, 0, d.w, d.h);
    return c.toDataURL("image/png");
  });
}
