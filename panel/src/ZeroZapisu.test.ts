import { describe, expect, it } from "vitest";

/* Źródła przez `?raw`, jak w pozostałych strażnikach — panel jest aplikacją
   przeglądarki, więc żadnego `node:fs`. */
const MAIN = (import.meta.glob("./main.tsx", { query: "?raw", eager: true, import: "default" }) as
  Record<string, string>)["./main.tsx"];
const TESTY = import.meta.glob("./**/*.test.tsx",
  { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── KAŻDA TRASA MA STRAŻNIKA ZERA ZAPISU (@wydanie) ─────────────────────────
   Reguła „otwarcie ekranu niczego nie mutuje" miała strażnika w testach
   ekranów, ale tylko tam, gdzie autor pamiętał go dopisać. Zadania, Wiedza
   i Protokół chodziły bez niego, a CLAUDE.md twierdził, że pilnują go
   „testy ekranów". Ten plik zamienia obietnicę w mechanizm: czyta trasy
   z `main.tsx` i dla KAŻDEJ żąda testu, który liczy zapisy.

   CO UZNAJE ZA STRAŻNIKA. Plik testu obok ekranu (`Nazwa.test.tsx` albo
   `Nazwa.<cokolwiek>.test.tsx`), który:
     - widzi metodę żądania: `method ?? "GET"`, atrapę `atrapaZapisow`
       z `test/zapisy.ts` albo licznik `mutacje` na podmienionych hakach,
     - ma test, którego tytuł mówi o zapisie, mutacji albo otwarciu.

   CZEGO NIE PILNUJE. Nie sprawdza, czy test mierzy dobrze — tylko, że jest.
   Nie widzi tras dodanych poza `main.tsx`.

   ZWOLNIENIA SĄ JAWNE: mapa `ZWOLNIONE` niżej, każde z powodem. */
const ZWOLNIONE: Record<string, string> = {
  Rama: "rama wszystkich ekranów, nie ekran; jej nawigację liczą Klawisze.test.tsx i Wiecej.test.tsx",
};

/** Nazwa komponentu → ścieżka modułu, z importów `main.tsx`. */
function importy(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const m of MAIN.matchAll(/import \{([^}]+)\} from "(\.\/[^"]+)"/g)) {
    for (const nazwa of m[1].split(",").map((s) => s.trim()).filter(Boolean)) mapa.set(nazwa, m[2]);
  }
  return mapa;
}

/** Komponenty stojące w `element={<...}` tras, bez przekierowań. */
function ekranyTras(): string[] {
  const nazwy = [...MAIN.matchAll(/<Route\b[^>]*element=\{<([A-Z][A-Za-z]+)/g)].map((m) => m[1]);
  return [...new Set(nazwy)].filter((n) => n !== "Navigate");
}

const WIDZI_METODE = /method \?\? "GET"|atrapaZapisow|mutacje/;
const TYTUL_O_ZAPISIE = /\bit\(\s*["'`][^"'`]*(zapis|mutacj|otwarci)/i;

describe("strażnik zera zapisu", () => {
  it("czyta z main.tsx co najmniej kilkanaście tras — inaczej wzorzec przestał pasować", () => {
    expect(ekranyTras().length).toBeGreaterThanOrEqual(15);
  });

  it("każdy ekran z trasy ma test, który liczy zapisy przy otwarciu", () => {
    const mapa = importy();
    const bez: string[] = [];
    for (const ekran of ekranyTras()) {
      if (ZWOLNIONE[ekran]) continue;
      const modul = mapa.get(ekran);
      if (!modul) { bez.push(`${ekran}: brak importu w main.tsx`); continue; }
      const straznicy = Object.entries(TESTY).filter(([sciezka, zrodlo]) =>
        (sciezka === `${modul}.test.tsx` || sciezka.startsWith(`${modul}.`))
        && WIDZI_METODE.test(zrodlo) && TYTUL_O_ZAPISIE.test(zrodlo));
      if (straznicy.length === 0) bez.push(`${ekran} (${modul})`);
    }
    expect(bez, "ekrany bez testu zera zapisu — dopisz go albo zwolnienie z powodem").toEqual([]);
  });

  it("zwolnienie wskazuje ekran, który naprawdę stoi w trasach", () => {
    const trasy = new Set(ekranyTras());
    expect(Object.keys(ZWOLNIONE).filter((n) => !trasy.has(n))).toEqual([]);
  });
});
