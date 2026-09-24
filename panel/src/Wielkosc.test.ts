import { describe, expect, it } from "vitest";

/* Same ŚCIEŻKI, bez treści — `?url` byłby tu zbędnym kosztem, a klucz słownika
   to wszystko, czego strażnik potrzebuje. Bez `node:fs` z tego samego powodu co
   w pozostałych strażnikach: panel jest aplikacją przeglądarki. */
const PLIKI = Object.keys(import.meta.glob(["./**/*.ts", "./**/*.tsx", "./**/*.css"]));

/* ── NAZWY RÓŻNE TYLKO WIELKOŚCIĄ LITER (0.482.12) ─────────────────────────────
   Blizna 0.481.0: `zwroty/SzybkiZwrot.tsx` (przycisk) stał obok
   `zwroty/szybkiZwrot.ts` (reguła). Na Linuksie, czyli w CI i w każdej sesji,
   to dwa pliki i wszystko było zielone. Na Windowsie w biurze to JEDEN plik:
   import bez rozszerzenia trafił w regułę, `tsc` odmówił, a instalator
   zatrzymał usługi przy aktualizacji.

   Porównanie idzie po ścieżce BEZ ostatniego rozszerzenia, bo tak rozwiązuje
   import — `./SzybkiZwrot` i `./szybkiZwrot` zderzają się mimo `.tsx` i `.ts`.
   Te same litery z innym rozszerzeniem (`Foo.ts` i `Foo.tsx`) to inny problem
   i nie Windowsa, więc tu nie liczą się jako zderzenie. */
describe("nazwy plików panelu", () => {
  it("żadne dwie ścieżki nie różnią się wyłącznie wielkością liter", () => {
    const rdzen = (p: string) => p.replace(/\.[^./]+$/, "");
    const wgKlucza = new Map<string, Set<string>>();
    for (const p of PLIKI) {
      const r = rdzen(p);
      const k = r.toLowerCase();
      wgKlucza.set(k, (wgKlucza.get(k) ?? new Set()).add(r));
    }
    const zderzenia = [...wgKlucza.values()].filter((s) => s.size > 1).map((s) => [...s]);
    expect(zderzenia).toEqual([]);
  });

  it("strażnik widzi pliki — pusta lista przepuściłaby wszystko", () => {
    expect(PLIKI.length).toBeGreaterThan(100);
    expect(PLIKI).toContain("./zwroty/SzybkiZwrot.tsx");
  });
});
