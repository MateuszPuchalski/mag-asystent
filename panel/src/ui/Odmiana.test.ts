import { describe, expect, it } from "vitest";
import { ile, odmien } from "./index";

/* Źródła przez `?raw`, jak w pozostałych strażnikach. `ui/index.tsx` wykluczone:
   tam ta reguła MA stać. */
const ZRODLA = import.meta.glob(
  ["../**/*.tsx", "../**/*.ts", "!../**/*.test.tsx", "!../**/*.test.ts", "!../ui/index.tsx"],
  { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── TRZY FORMY, NIE DWIE (audyt zwrotów, 15 września 2026) ──────────────────
   Polszczyzna ma przy liczebniku trzy formy rzeczownika: „1 pozycja",
   „2 pozycje", „5 pozycji". Panel liczył dwie w OŚMIU miejscach, na czterech
   ekranach, i mylił się na dwa przeciwne sposoby:

     * forma dla 2–4 wszędzie      → „5 pozycje", „i 5 inne";
     * dopełniacz mnogi wszędzie   → „2 pasujących zwrotów", „2 zdjęć".

   Drugi błąd jest CZĘSTSZY, choć wygląda niewinniej: dwa i trzy zdarzają się
   na ekranie o wiele częściej niż pięć. Jedyna poprawna kopia reguły mieszkała
   jako prywatna funkcja w `ekrany/Wiedza.tsx` — i właśnie dlatego, że w
   ekranie, nikt jej nie znalazł przy ośmiu pozostałych miejscach.

   CO PILNUJE. Dwugałęziowy wybór formy rzeczownika nie odradza się TAM, GDZIE
   OBOK STOI LICZBA. Sama liczba jest tu warunkiem, nie ozdobą: bez liczebnika
   polski ma dwie formy i dwie wystarczą.

   CZEGO NIE PILNUJE. Nie wie, czy formy podano poprawne — `ile(n, "pies",
   "pies", "pies")` przejdzie. Nie rozpoznaje też czasowników: „ogląda"
   / „oglądają" (`skrzynka/Obecni.tsx`) ma dwie formy i tak ma zostać, więc
   wzorzec celuje wyłącznie w wyrażenia, przy których drukuje się licznik.

   ZWOLNIENIA SĄ JAWNE. Komentarz `odmiana: <powód>` w linii albo do sześciu
   linii nad nią, powód co najmniej trzy wyrazy — ten sam mechanizm i próg co
   `kontrast:`, `skala:`, `segment:`, `bursztyn:`, `pustka:`, `czas:`
   i `ergonomia:`.                                                           */

/** Powód zwolnienia — co najmniej trzy wyrazy po dwukropku. */
const ZWOLNIENIE = /odmiana:\s*\S+(?:\s+\S+){2,}/;

/** Kod bez komentarzy, z zachowanymi numerami linii — patrz `Kontrast.test.ts`. */
function bezKomentarzy(tekst: string): string {
  return tekst
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/** `X === 1 ? … : …` — X bywa `n`, `partia.length`, `c.brakuje.length`. */
const DWIE_FORMY = /([\w.]+)\s*===\s*1\s*\?/;

function znajdz(): string[] {
  const winne: string[] = [];
  for (const [plik, zrodlo] of Object.entries(ZRODLA)) {
    const linie = bezKomentarzy(zrodlo).split("\n");
    const surowe = zrodlo.split("\n");
    linie.forEach((l, i) => {
      const trafienie = DWIE_FORMY.exec(l);
      if (!trafienie) return;
      const licznik = trafienie[1];
      /* OKNO DWÓCH LINII, bo `${n}` i sam wybór formy bywają rozdzielone
         zawijaniem wiersza — tak stało w `skrzynka/Sprawa.tsx`. */
      const okno = linie.slice(i, i + 2).join(" ");
      /* Warunek: ta sama liczba jest DRUKOWANA obok. Bez niej dwie formy
         wystarczają i reguła nie ma o czym mówić. */
      if (!okno.includes(`{${licznik}}`)) return;
      /* Pomocnik już tu jest — wtedy ternarny wybór dotyczy czegoś innego niż
         forma przy liczebniku (np. całego zdania dla jedynki). */
      if (/\b(odmien|ile)\s*\(/.test(okno)) return;
      if (surowe.slice(Math.max(0, i - 6), i + 1).some((x) => ZWOLNIENIE.test(x))) return;
      winne.push(`${plik}:${i + 1} → ${l.trim().slice(0, 72)}`);
    });
  }
  return winne;
}

describe("Liczebnik dostaje trzy formy, nie dwie", () => {
  it("nikt nie wybiera formy rzeczownika dwiema gałęziami przy drukowanej liczbie", () => {
    expect(znajdz()).toEqual([]);
  });
});

describe("odmien", () => {
  it("jedynka bierze liczbę pojedynczą", () => {
    expect(odmien(1, "pozycja", "pozycje", "pozycji")).toBe("pozycja");
  });

  it("dwa, trzy i cztery biorą formę środkową — tę, którą panel gubił najczęściej", () => {
    for (const n of [2, 3, 4]) expect(odmien(n, "pozycja", "pozycje", "pozycji")).toBe("pozycje");
  });

  it("od pięciu w górę idzie dopełniacz", () => {
    for (const n of [0, 5, 6, 9, 10, 11]) {
      expect(odmien(n, "pozycja", "pozycje", "pozycji")).toBe("pozycji");
    }
  });

  it("nastki są wyjątkiem i tylko one", () => {
    /* To jest cała trudność tej reguły: 12, 13 i 14 kończą się cyfrą z zakresu
       2–4, a mimo to biorą dopełniacz. Reguła bez tego warunku daje „12
       pozycje" i wygląda przy tym na działającą. */
    for (const n of [12, 13, 14, 112, 213]) {
      expect(odmien(n, "pozycja", "pozycje", "pozycji")).toBe("pozycji");
    }
    for (const n of [22, 23, 24, 102, 1003]) {
      expect(odmien(n, "pozycja", "pozycje", "pozycji")).toBe("pozycje");
    }
  });

  it("liczba ujemna nie rozsypuje reguły", () => {
    /* `-2 % 10` daje w JS −2, więc bez wartości bezwzględnej wpadłoby to do
       dopełniacza. Ekran ujemnych liczników nie pokazuje — reguła języka nie
       ma jednak zależeć od tego, czy ktoś kiedyś nie policzy różnicy. */
    expect(odmien(-2, "pozycja", "pozycje", "pozycji")).toBe("pozycje");
    expect(odmien(-1, "pozycja", "pozycje", "pozycji")).toBe("pozycja");
  });

  it("`ile` stawia liczbę przed formą", () => {
    expect(ile(1, "zdjęcie", "zdjęcia", "zdjęć")).toBe("1 zdjęcie");
    expect(ile(3, "zdjęcie", "zdjęcia", "zdjęć")).toBe("3 zdjęcia");
    expect(ile(5, "zdjęcie", "zdjęcia", "zdjęć")).toBe("5 zdjęć");
  });
});
