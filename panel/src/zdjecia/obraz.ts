import {
  CEL_BAJTOW_GOTOWEGO, JAKOSCI_GOTOWEGO, JAKOSCI_WYSYLKI, LIMIT_BAJTOW, MAKS_BOKU_WYSYLKI, kadrWPikselach, kwadratWokol,
  ramkaAlfy, wymiaryWLimicie, wyrownajPoziomy, zakodujJakNajlzej, zakodujWLimicie, type Kadr, type Obrot,
} from "./obrobka";

/* ── RYSOWANIE NA PŁÓTNIE ──────────────────────────────────────────────────
   Cienka warstwa nad `obrobka.ts`: płótno, obrót, kodowanie JPEG. Rachunek
   mieszka tam i ma testy, a tu zostaje tylko to, czego jsdom nie narysuje.
   Ekran woła wyłącznie te funkcje, więc test ekranu podmienia ten moduł. */

/** Wczytane zdjęcie, już obrócone według EXIF-u i zmniejszone do limitu wysyłki. */
export interface Zrodlo { kanwa: HTMLCanvasElement; szer: number; wys: number }

/** Gotowy plik: base64 do wysyłki i adres `data:` do podglądu. */
export interface Plik { base64: string; adres: string; /** Bok gotowego kwadratu w pikselach. */ bok?: number }

const BRAK_PLOTNA = "Przeglądarka nie rysuje obrazów. Otwórz panel w Chrome albo w Edge.";

function plotno(szer: number, wys: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = szer;
  c.height = wys;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error(BRAK_PLOTNA);
  return [c, ctx];
}

const base64ZAdresu = (adres: string) => adres.slice(adres.indexOf(",") + 1);

/**
 * Plik z dysku, schowka albo upuszczony na ekran.
 *
 * `imageOrientation: "from-image"`, bo telefon zapisuje zdjęcie bokiem
 * i dopisuje obrót w EXIF-ie. Bez tego połowa zdjęć z telefonu leżałaby
 * na boku, a agent obracałby każde ręcznie.
 */
export async function wczytajPlik(plik: Blob): Promise<Zrodlo> {
  let bitmapa: ImageBitmap;
  try {
    bitmapa = await createImageBitmap(plik, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Tego pliku nie da się odczytać jako zdjęcia. Panel przyjmuje JPEG i PNG — wybierz inny plik.");
  }
  const { szer, wys } = wymiaryWLimicie(bitmapa.width, bitmapa.height, MAKS_BOKU_WYSYLKI);
  const [kanwa, ctx] = plotno(szer, wys);
  ctx.drawImage(bitmapa, 0, 0, szer, wys);
  bitmapa.close();
  return { kanwa, szer, wys };
}

function obrocona(z: Zrodlo, obrot: Obrot): HTMLCanvasElement {
  if (obrot === 0) return z.kanwa;
  const wpoprzek = obrot % 180 !== 0;
  const [c, ctx] = plotno(wpoprzek ? z.wys : z.szer, wpoprzek ? z.szer : z.wys);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((obrot * Math.PI) / 180);
  ctx.drawImage(z.kanwa, -z.szer / 2, -z.wys / 2);
  return c;
}

function poziomy(ctx: CanvasRenderingContext2D, szer: number, wys: number): void {
  const d = ctx.getImageData(0, 0, szer, wys);
  if (wyrownajPoziomy(d.data)) ctx.putImageData(d, 0, 0);
}

/** Podgląd do kadrowania: cały obraz po obrocie i poziomach, mniejszy, bo tylko do oka. */
export function podgladEdycji(z: Zrodlo, obrot: Obrot, wyrownaj: boolean): { adres: string; szer: number; wys: number } {
  const r = obrocona(z, obrot);
  const { szer, wys } = wymiaryWLimicie(r.width, r.height, 800);
  const [c, ctx] = plotno(szer, wys);
  ctx.drawImage(r, 0, 0, szer, wys);
  if (wyrownaj) poziomy(ctx, szer, wys);
  return { adres: c.toDataURL("image/jpeg", 0.8), szer, wys };
}

/**
 * Zdjęcie do usuwania tła: obrót, kadr, poziomy, JPEG.
 * Poziomy liczą się z samego kadru, bo tło poza kadrem nie ma prawa ich przesuwać.
 */
export async function doWyslania(z: Zrodlo, obrot: Obrot, kadr: Kadr | null, wyrownaj: boolean): Promise<Plik> {
  const r = obrocona(z, obrot);
  const k = kadr ? kadrWPikselach(kadr, r.width, r.height) : { x: 0, y: 0, szer: r.width, wys: r.height };
  const [c, ctx] = plotno(k.szer, k.wys);
  ctx.drawImage(r, k.x, k.y, k.szer, k.wys, 0, 0, k.szer, k.wys);
  if (wyrownaj) poziomy(ctx, k.szer, k.wys);
  const w = await zakodujWLimicie((q) => base64ZAdresu(c.toDataURL("image/jpeg", q)), LIMIT_BAJTOW, JAKOSCI_WYSYLKI);
  if (!w.miesciSie) throw new Error("Zdjęcie jest za duże nawet po kompresji. Wykadruj sam towar i spróbuj jeszcze raz.");
  return { base64: w.base64, adres: `data:image/jpeg;base64,${w.base64}` };
}

async function bitmapaZBase64(base64: string, mime: string): Promise<ImageBitmap> {
  const bin = atob(base64);
  const bajty = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bajty[i] = bin.charCodeAt(i);
  return createImageBitmap(new Blob([bajty], { type: mime }));
}

/**
 * Gotowe zdjęcie: białe tło, przycięcie do towaru, kwadrat z marginesem, JPEG.
 *
 * Biel zamiast przezroczystości, bo gotowy plik jest JPEG-iem. JPEG
 * przezroczystości nie zna, a jest kilka razy mniejszy od PNG.
 * Przycięcie liczy alfę, więc JPEG bez wycięcia tła zostaje cały,
 * tylko wpisany w kwadrat.
 */
export async function zlozGotowy(base64: string, mime: string): Promise<Plik> {
  const b = await bitmapaZBase64(base64, mime);
  const [zr, zctx] = plotno(b.width, b.height);
  zctx.drawImage(b, 0, 0);
  b.close();
  const ramka = ramkaAlfy(zctx.getImageData(0, 0, zr.width, zr.height).data, zr.width, zr.height);
  if (!ramka) throw new Error("Po usunięciu tła nie został żaden towar. Wyłącz „Usuń tło” albo zrób zdjęcie na jednolitym tle.");
  const g = kwadratWokol(ramka.szer, ramka.wys);
  const [c, ctx] = plotno(g.bok, g.bok);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, g.bok, g.bok);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(zr, ramka.x, ramka.y, ramka.szer, ramka.wys, g.x, g.y, g.szer, g.wys);
  const w = await zakodujJakNajlzej((q) => base64ZAdresu(c.toDataURL("image/jpeg", q)),
    CEL_BAJTOW_GOTOWEGO, LIMIT_BAJTOW, JAKOSCI_GOTOWEGO);
  if (!w.miesciSie) throw new Error("Gotowe zdjęcie jest za duże nawet po kompresji. Wykadruj ciaśniej sam towar.");
  return { base64: w.base64, adres: `data:image/jpeg;base64,${w.base64}`, bok: g.bok };
}

/**
 * Wczytane zdjęcie jako PNG w base64, wejście dla `zlozGotowy` przy imporcie.
 * PNG, bo nie traci jakości po drodze i zachowuje alfę wyciętego tła.
 */
export function pngZrodla(z: Zrodlo): string {
  return base64ZAdresu(z.kanwa.toDataURL("image/png"));
}
