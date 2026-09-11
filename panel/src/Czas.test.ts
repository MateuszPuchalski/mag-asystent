import { describe, expect, it } from "vitest";
import { czas, godzina } from "./ui";

/* Źródła przez `?raw`, jak w pozostałych strażnikach — `tsconfig.json` zapisuje,
   że panel jest aplikacją przeglądarki, więc żadnego `node:fs`. `ui/index.tsx`
   wykluczone: tam formatery MAJĄ mieszkać. */
const ZRODLA = import.meta.glob(["./**/*.tsx", "./**/*.ts", "!./**/*.test.ts", "!./**/*.test.tsx",
  "!./ui/index.tsx"], { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── CZAS MA JEDNO ŹRÓDŁO I NIE MA SEKUND (0.272.0) ────────────────────────────
   Ustalenie 13 z audytu. `czas()` oddawał „10.09.2026, 14:23:05" we wszystkich
   52 wywołaniach. Sekunda nie rozstrzyga w tym panelu niczego — ani kiedy
   klient napisał, ani kiedy przebiegła synchronizacja.

   Kod wiedział o tym przed audytem i radził sobie najgorszym możliwym
   sposobem: TRZY miejsca robiły `czas(...).slice(-8, -3)`, czyli wycinek
   liczony od KOŃCA sformatowanego napisu. To jest zakład o długość daty,
   a nie odczyt godziny — i przegrywał dokładnie w chwili, w której `czas()`
   przestaje dawać sekundy. Na „10.09.2026, 14:23" ten sam wycinek daje
   „6, 14". Dlatego obie zmiany musiały wejść jednym wydaniem.

   CO PILNUJE — dwie rzeczy:

     1. Nikt nie kroi wyniku `czas()` nożyczkami. Godziny pyta się `godzina()`.
     2. Formatowanie daty nie powstaje poza `ui/index.tsx`. Żadnego surowego
        `toLocaleString`, `toLocaleTimeString` ani `toLocaleDateString`
        w ekranach — bo tak właśnie zaczyna się drugi format w panelu.

   CZEGO NIE PILNUJE. Nie sprawdza PROMIENI (ustalenie 11). Reguła „promień
   kafelka = promień bieżni minus jej wypełnienie" wymaga znajomości rodzica
   i dziecka, a strażnik czyta tekst linia po linii. Dwa miejsca, których
   dotyczy, mają uzasadnienie w komentarzu przy sobie i tyle.

   ZWOLNIENIA SĄ JAWNE. Komentarz `czas: <powód>` w linii albo do sześciu linii
   nad nią, powód co najmniej trzy wyrazy — ten sam mechanizm i próg co
   `kontrast:`, `skala:`, `segment:`, `bursztyn:`, `pustka:` i `ergonomia:`. */

/** Powód zwolnienia — co najmniej trzy wyrazy po dwukropku. */
const ZWOLNIENIE = /czas:\s*\S+(?:\s+\S+){2,}/;

/** Kod bez komentarzy, z zachowanymi numerami linii — patrz `Kontrast.test.ts`. */
function bezKomentarzy(tekst: string): string {
  return tekst
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

function znajdz(wzorzec: RegExp): string[] {
  const winne: string[] = [];
  for (const [plik, zrodlo] of Object.entries(ZRODLA)) {
    const linie = bezKomentarzy(zrodlo).split("\n");
    const surowe = zrodlo.split("\n");
    linie.forEach((l, i) => {
      if (!wzorzec.test(l)) return;
      /* Zwolnienie stoi w komentarzu, więc szukamy go w tekście ORYGINALNYM. */
      if (surowe.slice(Math.max(0, i - 6), i + 1).some((x) => ZWOLNIENIE.test(x))) return;
      winne.push(`${plik}:${i + 1} → ${l.trim().slice(0, 72)}`);
    });
  }
  return winne;
}

describe("Czas ma jedno źródło", () => {
  it("nikt nie kroi wyniku `czas()` nożyczkami", () => {
    /* `czas(x).slice(...)` to zakład o długość sformatowanej daty. Godziny
       pyta się `godzina()`, a nie wycina jej z końca napisu. */
    expect(znajdz(/czas\([^)]*\)\s*\.\s*slice\(/)).toEqual([]);
  });

  it("formatowanie daty nie powstaje poza `ui/index.tsx`", () => {
    /* Tak zaczyna się drugi format w panelu: ktoś potrzebuje samej daty,
       pisze `toLocaleDateString` na miejscu i od tej pory są dwa. */
    expect(znajdz(/\.toLocale(String|TimeString|DateString)\(/)).toEqual([]);
  });
});

describe("czas() i godzina(): co dokładnie oddają", () => {
  const KIEDY = "2026-09-10T14:23:05Z";

  it("`czas()` nie oddaje sekund", () => {
    /* Asercja na KSZTAŁT, nie na dosłowny napis: strefa czasu biegacza testów
       nie jest strefą biura, więc godzina bywa inna. Chodzi o to, że po
       godzinie i minucie NIE MA trzeciej liczby. */
    expect(czas(KIEDY)).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
    expect(czas(KIEDY)).not.toMatch(/:\d{2}:\d{2}/);
  });

  it("`godzina()` oddaje samą godzinę i minutę", () => {
    expect(godzina(KIEDY)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("brak wartości to myślnik, nie pusty napis", () => {
    /* Trzy miejsca miały `czas(x).slice(-8, -3) || "—"`, bo wycinek z myślnika
       dawał pusty napis. Fallback mieszkał w wywołującym; teraz mieszka
       w funkcji i nie da się go zgubić. */
    for (const brak of [null, undefined, ""]) {
      expect(czas(brak)).toBe("—");
      expect(godzina(brak)).toBe("—");
    }
  });
});
