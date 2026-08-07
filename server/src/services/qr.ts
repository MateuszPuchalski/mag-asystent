/* ── Kod QR do parowania kolektora ──────────────────────────────────────────
   Adres serwera wpisywany z palca na ekranie kolektora był jedynym krokiem
   instalacji, którego NIE DA SIĘ zrobić skanerem — a skaner jest jedyną rzeczą,
   którą magazynier ma zawsze w ręce. Ten plik zamienia adres w kod QR, który
   kolektor czyta tak samo jak etykietę półki.

   NAPISANE OD ZERA, bez biblioteki, i to jest decyzja, nie ambicja. Serwer ma
   dziś dwie zależności (`fastify`, `mssql`) i stoi na maszynie księgowej
   z Subiektem, gdzie `npm ci` wykonuje się raz na wdrożenie i musi się udać.
   Generator QR to ~300 linii domkniętej matematyki bez wejścia z sieci —
   tańszej w utrzymaniu niż drzewo zależności, którego nikt tu nie przejrzy.

   ZAKRES JEST CELOWO WĄSKI: tryb bajtowy, korekcja poziomu M, wersje 1–6
   (do 106 bajtów). Adres `http://192.168.100.100:3001` to 27 znaków, więc
   zapas jest kilkukrotny, a wersje ≥ 7 wymagałyby jeszcze bloku informacji
   o wersji — kodu, którego nic by tu nigdy nie wykonało.

   Norma: ISO/IEC 18004.                                                      */

/* ── Ciało GF(256) ──────────────────────────────────────────────────────────
   Wielomian pierwotny 0x11D — ten i tylko ten jest w normie. Tablice
   wykładnika i logarytmu zamieniają mnożenie na dodawanie indeksów; `EXP` ma
   podwójną długość, żeby suma dwóch logarytmów (max 254+254) nie wymagała
   modulo przy każdym mnożeniu.                                               */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mnoz = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Wielomian generujący Reed-Solomona stopnia `stopien`: ∏(x − α^i). */
export function generator(stopien: number): Uint8Array {
  let g = Uint8Array.from([1]);
  for (let i = 0; i < stopien; i++) {
    const next = new Uint8Array(g.length + 1);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j]; // składnik ×x
      next[j + 1] ^= mnoz(g[j], EXP[i]); // składnik ×α^i
    }
    g = next;
  }
  return g;
}

/** Kody korekcji błędów dla jednego bloku danych (reszta z dzielenia przez g). */
export function rsKoduj(dane: Uint8Array, ileEc: number): Uint8Array {
  const g = generator(ileEc);
  const reszta = new Uint8Array(ileEc);
  for (const bajt of dane) {
    const wiodacy = bajt ^ reszta[0];
    reszta.copyWithin(0, 1);
    reszta[ileEc - 1] = 0;
    if (wiodacy !== 0) {
      for (let j = 0; j < ileEc; j++) reszta[j] ^= mnoz(g[j + 1], wiodacy);
    }
  }
  return reszta;
}

/* ── Tablice wersji (poziom korekcji M) ─────────────────────────────────────
   `bloki` to liczba kodów DANYCH w każdym bloku; długość tablicy = liczba
   bloków. `ecNaBlok` jest wspólne dla wszystkich bloków wersji.              */

interface Wersja {
  readonly ecNaBlok: number;
  readonly bloki: readonly number[];
  /** Środki wzorców wyrównania; puste dla wersji 1. */
  readonly wyrownanie: readonly number[];
}

const WERSJE: Readonly<Record<number, Wersja>> = {
  1: { ecNaBlok: 10, bloki: [16], wyrownanie: [] },
  2: { ecNaBlok: 16, bloki: [28], wyrownanie: [6, 18] },
  3: { ecNaBlok: 26, bloki: [44], wyrownanie: [6, 22] },
  4: { ecNaBlok: 18, bloki: [32, 32], wyrownanie: [6, 26] },
  5: { ecNaBlok: 24, bloki: [43, 43], wyrownanie: [6, 30] },
  6: { ecNaBlok: 16, bloki: [27, 27, 27, 27], wyrownanie: [6, 34] },
};

const NAJWYZSZA_WERSJA = 6;

/** Ile bajtów użytkownika mieści wersja: kody danych minus 12 bitów nagłówka. */
function pojemnosc(w: Wersja): number {
  const kodyDanych = w.bloki.reduce((a, b) => a + b, 0);
  return Math.floor((kodyDanych * 8 - 12) / 8);
}

const rozmiar = (wersja: number): number => 17 + 4 * wersja;

/* ── Kodowanie danych ───────────────────────────────────────────────────── */

class BuforBitow {
  readonly bity: number[] = [];

  dopisz(wartosc: number, ile: number): void {
    for (let i = ile - 1; i >= 0; i--) this.bity.push((wartosc >>> i) & 1);
  }
}

/**
 * Tekst → kody danych z wypełnieniem, dla najmniejszej wersji, która go mieści.
 *
 * Tryb bajtowy z UTF-8: adres serwera bywa zapisany samym ASCII, ale nazwa
 * magazynu w tym samym kodzie już nie — a tryb bajtowy nic nie kosztuje wobec
 * alfanumerycznego przy tej długości.
 */
export function kodujDane(tekst: string): { wersja: number; kody: Uint8Array } {
  const bajty = new TextEncoder().encode(tekst);

  const wersja = Number(
    Object.keys(WERSJE).find((v) => pojemnosc(WERSJE[Number(v)]) >= bajty.length)
  );
  if (!wersja) {
    throw new Error(
      `Tekst ma ${bajty.length} bajtów — ponad ${pojemnosc(WERSJE[NAJWYZSZA_WERSJA])} ` +
        `mieszczące się w kodzie QR wersji ${NAJWYZSZA_WERSJA}`
    );
  }

  const w = WERSJE[wersja];
  const kodyDanych = w.bloki.reduce((a, b) => a + b, 0);
  const buf = new BuforBitow();
  buf.dopisz(0b0100, 4); // tryb bajtowy
  buf.dopisz(bajty.length, 8); // licznik znaków — 8 bitów dla wersji 1–9
  for (const b of bajty) buf.dopisz(b, 8);

  // terminator (do 4 bitów) i dopełnienie do pełnego bajtu
  const wolne = kodyDanych * 8 - buf.bity.length;
  buf.dopisz(0, Math.min(4, wolne));
  while (buf.bity.length % 8 !== 0) buf.bity.push(0);

  const kody = new Uint8Array(kodyDanych);
  for (let i = 0; i < buf.bity.length; i += 8) {
    let bajt = 0;
    for (let j = 0; j < 8; j++) bajt = (bajt << 1) | buf.bity[i + j];
    kody[i / 8] = bajt;
  }
  // wypełniacze normy, naprzemiennie, aż do końca obszaru danych
  for (let i = buf.bity.length / 8, k = 0; i < kodyDanych; i++, k++) {
    kody[i] = k % 2 === 0 ? 0xec : 0x11;
  }

  return { wersja, kody };
}

/**
 * Podział na bloki, korekcja błędów i PRZEPLOT.
 *
 * Przeplot jest tym, co czyni korekcję cokolwiek wartą: bez niego plama na
 * etykiecie zabija jeden blok w całości, a z nim rozkłada się po wszystkich
 * blokach po kawałku, czyli w zasięgu korekcji każdego z nich.
 */
export function przeplot(kody: Uint8Array, wersja: number): Uint8Array {
  const w = WERSJE[wersja];
  const bloki: Uint8Array[] = [];
  const ecBloki: Uint8Array[] = [];

  let od = 0;
  for (const ile of w.bloki) {
    const blok = kody.subarray(od, od + ile);
    od += ile;
    bloki.push(blok);
    ecBloki.push(rsKoduj(blok, w.ecNaBlok));
  }

  const wynik: number[] = [];
  const najdluzszy = Math.max(...w.bloki);
  for (let i = 0; i < najdluzszy; i++) {
    for (const b of bloki) if (i < b.length) wynik.push(b[i]);
  }
  for (let i = 0; i < w.ecNaBlok; i++) {
    for (const e of ecBloki) wynik.push(e[i]);
  }
  return Uint8Array.from(wynik);
}

/* ── Macierz ────────────────────────────────────────────────────────────── */

/** Moduł: 1 = ciemny, 0 = jasny. `funkcyjne` chroni wzorce przed maską. */
interface Macierz {
  readonly n: number;
  readonly modul: Uint8Array;
  readonly funkcyjne: Uint8Array;
}

const idx = (m: Macierz, r: number, c: number): number => r * m.n + c;

function ustaw(m: Macierz, r: number, c: number, ciemny: boolean, funkcyjny = true): void {
  if (r < 0 || c < 0 || r >= m.n || c >= m.n) return;
  m.modul[idx(m, r, c)] = ciemny ? 1 : 0;
  if (funkcyjny) m.funkcyjne[idx(m, r, c)] = 1;
}

function wzorceStale(m: Macierz, wersja: number): void {
  // trzy znaczniki pozycji wraz z separatorem — rysowane jako obszar 8×8
  for (const [r0, c0] of [
    [0, 0],
    [0, m.n - 7],
    [m.n - 7, 0],
  ]) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const odl = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        ustaw(m, r0 + dr, c0 + dc, odl !== 2 && odl <= 3);
      }
    }
  }

  // wzorce taktujące — naprzemienne linie w wierszu i kolumnie 6
  for (let i = 8; i < m.n - 8; i++) {
    ustaw(m, 6, i, i % 2 === 0);
    ustaw(m, i, 6, i % 2 === 0);
  }

  // wzorce wyrównania — pomijane tam, gdzie kolidują ze znacznikami pozycji
  const srodki = WERSJE[wersja].wyrownanie;
  for (const r of srodki) {
    for (const c of srodki) {
      const przyZnaczniku =
        (r === srodki[0] && c === srodki[0]) ||
        (r === srodki[0] && c === srodki[srodki.length - 1]) ||
        (r === srodki[srodki.length - 1] && c === srodki[0]);
      if (przyZnaczniku) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          ustaw(m, r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  /* Obszar informacji o formacie rezerwujemy TĄ SAMĄ funkcją, która go potem
     wypełni — wpisując na razie format maski 0. Wypisanie rezerwacji osobną
     pętlą po wierszu 8 i kolumnie 8 wyglądałoby prościej i byłoby błędem:
     pole (8,6) należy do wzorca taktującego, nie do formatu, więc taka pętla
     wygaszałaby moduł, na którym skaner ustawia siatkę. */
  informacjeOFormacieDoMacierzy(m, 0);
  ustaw(m, m.n - 8, 8, true); // moduł zawsze ciemny
}

/**
 * Informacja o formacie: poziom korekcji + maska, zabezpieczone BCH(15,5).
 *
 * Liczona, nie przepisana z tablicy — piętnaście ciągów bitów przepisanych
 * ręcznie to piętnaście okazji do literówki, której skaner nie wybaczy,
 * a której nie widać w żadnym teście poza porównaniem z tą samą tablicą.
 */
export function informacjaOFormacie(maska: number): number {
  const dane = (0b00 << 3) | maska; // 00 = poziom korekcji M
  let reszta = dane;
  for (let i = 0; i < 10; i++) reszta = (reszta << 1) ^ ((reszta >>> 9) * 0x537);
  return ((dane << 10) | (reszta & 0x3ff)) ^ 0x5412;
}

function informacjeOFormacieDoMacierzy(m: Macierz, maska: number): void {
  const bity = informacjaOFormacie(maska);
  const bit = (i: number): boolean => ((bity >>> i) & 1) === 1;

  // kopia przy lewym górnym znaczniku
  for (let i = 0; i <= 5; i++) ustaw(m, i, 8, bit(i));
  ustaw(m, 7, 8, bit(6));
  ustaw(m, 8, 8, bit(7));
  ustaw(m, 8, 7, bit(8));
  for (let i = 9; i < 15; i++) ustaw(m, 8, 14 - i, bit(i));

  // kopia rozdzielona między pozostałe dwa znaczniki
  for (let i = 0; i < 8; i++) ustaw(m, 8, m.n - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) ustaw(m, m.n - 15 + i, 8, bit(i));
}

/** Dane wężykiem: kolumny po dwie od prawej, na przemian w górę i w dół. */
function daneDoMacierzy(m: Macierz, dane: Uint8Array): void {
  let i = 0;
  for (let prawa = m.n - 1; prawa >= 1; prawa -= 2) {
    if (prawa === 6) prawa = 5; // kolumna taktująca nie niesie danych
    for (let pion = 0; pion < m.n; pion++) {
      for (let j = 0; j < 2; j++) {
        const c = prawa - j;
        const wGore = ((prawa + 1) & 2) === 0;
        const r = wGore ? m.n - 1 - pion : pion;
        if (m.funkcyjne[idx(m, r, c)] || i >= dane.length * 8) continue;
        m.modul[idx(m, r, c)] = (dane[i >>> 3] >>> (7 - (i & 7))) & 1;
        i++;
      }
    }
  }
}

const MASKI: ReadonlyArray<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function zastosujMaske(m: Macierz, maska: number): void {
  const f = MASKI[maska];
  for (let r = 0; r < m.n; r++) {
    for (let c = 0; c < m.n; c++) {
      if (m.funkcyjne[idx(m, r, c)]) continue;
      if (f(r, c)) m.modul[idx(m, r, c)] ^= 1;
    }
  }
}

/**
 * Kara za czytelność (reguły 1–4 normy).
 *
 * Maska nie jest ozdobą: bez niej dane potrafią ułożyć się w duże jednolite
 * pola albo w coś podobnego do znacznika pozycji, a skaner gubi wtedy siatkę.
 * Wybieramy tę z ośmiu, która wypada najlepiej.
 */
export function kara(m: Macierz): number {
  let suma = 0;
  const czy = (r: number, c: number): number => m.modul[idx(m, r, c)];

  // 1: serie pięciu i więcej modułów tego samego koloru
  for (let i = 0; i < m.n; i++) {
    for (const wiersz of [true, false]) {
      let seria = 1;
      for (let j = 1; j < m.n; j++) {
        const a = wiersz ? czy(i, j) : czy(j, i);
        const b = wiersz ? czy(i, j - 1) : czy(j - 1, i);
        if (a === b) {
          seria++;
          if (seria === 5) suma += 3;
          else if (seria > 5) suma += 1;
        } else seria = 1;
      }
    }
  }

  // 2: bloki 2×2 w jednym kolorze
  for (let r = 0; r < m.n - 1; r++) {
    for (let c = 0; c < m.n - 1; c++) {
      const v = czy(r, c);
      if (v === czy(r, c + 1) && v === czy(r + 1, c) && v === czy(r + 1, c + 1)) suma += 3;
    }
  }

  // 3: układ przypominający znacznik pozycji (1:1:3:1:1 z jasnym marginesem)
  const wzor = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const odwrotny = [...wzor].reverse();
  for (let r = 0; r < m.n; r++) {
    for (let c = 0; c + wzor.length <= m.n; c++) {
      const poziom = wzor.every((v, k) => czy(r, c + k) === v);
      const poziomOdwr = odwrotny.every((v, k) => czy(r, c + k) === v);
      if (poziom || poziomOdwr) suma += 40;
      const pion = wzor.every((v, k) => czy(c + k, r) === v);
      const pionOdwr = odwrotny.every((v, k) => czy(c + k, r) === v);
      if (pion || pionOdwr) suma += 40;
    }
  }

  // 4: odchylenie proporcji ciemnych modułów od połowy
  let ciemne = 0;
  for (let i = 0; i < m.modul.length; i++) ciemne += m.modul[i];
  const procent = (ciemne * 100) / (m.n * m.n);
  suma += Math.floor(Math.abs(procent - 50) / 5) * 10;

  return suma;
}

/** Tekst → siatka modułów (true = ciemny), z wybraną najlepszą maską. */
export function macierzQr(tekst: string): boolean[][] {
  const { wersja, kody } = kodujDane(tekst);
  const dane = przeplot(kody, wersja);
  const n = rozmiar(wersja);

  let najlepsza: Macierz | null = null;
  let najlepszaKara = Infinity;

  for (let maska = 0; maska < 8; maska++) {
    const m: Macierz = { n, modul: new Uint8Array(n * n), funkcyjne: new Uint8Array(n * n) };
    wzorceStale(m, wersja);
    daneDoMacierzy(m, dane);
    zastosujMaske(m, maska);
    informacjeOFormacieDoMacierzy(m, maska);
    const k = kara(m);
    if (k < najlepszaKara) {
      najlepszaKara = k;
      najlepsza = m;
    }
  }

  const m = najlepsza!;
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => m.modul[idx(m, r, c)] === 1)
  );
}

/**
 * Kod QR jako SVG.
 *
 * Cichy margines czterech modułów jest WYMAGANY przez normę i jest pierwszą
 * rzeczą, którą gubi się przy wklejaniu kodu na kolorowe tło — skaner nie
 * znajduje wtedy krawędzi i kod „nie działa" bez żadnego objawu.
 *
 * Jeden `<path>` zamiast tysiąca `<rect>`: strona parowania idzie do
 * przeglądarki biura i do wydruku, a różnica to ~40 kB na kodzie.
 */
export function qrSvg(tekst: string, opts: { margines?: number; opis?: string } = {}): string {
  const siatka = macierzQr(tekst);
  const margines = opts.margines ?? 4;
  const bok = siatka.length + margines * 2;

  const sciezka: string[] = [];
  for (let r = 0; r < siatka.length; r++) {
    for (let c = 0; c < siatka.length; c++) {
      if (siatka[r][c]) sciezka.push(`M${c + margines} ${r + margines}h1v1h-1z`);
    }
  }

  const opis = (opts.opis ?? `Kod QR: ${tekst}`).replace(/[<>&"]/g, "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bok} ${bok}" ` +
    `role="img" aria-label="${opis}" shape-rendering="crispEdges">` +
    `<rect width="${bok}" height="${bok}" fill="#fff"/>` +
    `<path d="${sciezka.join("")}" fill="#2A2A2C"/>` +
    `</svg>`
  );
}
