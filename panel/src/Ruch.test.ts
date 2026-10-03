import { describe, expect, it } from "vitest";

/* Źródła przez `?raw`, jak w pozostałych strażnikach. */
const ZRODLA = import.meta.glob(["./**/*.tsx", "./**/*.ts", "!./**/*.test.ts", "!./**/*.test.tsx"],
  { query: "?raw", eager: true, import: "default" }) as Record<string, string>;
const CSS = import.meta.glob(["./**/*.css"], { query: "?raw", eager: true, import: "default" }) as Record<string, string>;
const KONFIG = import.meta.glob(["../tailwind.config.js"], { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── RUCH POKAZUJE ZMIANĘ, KTÓRA UMYKA, I NICZEGO WIĘCEJ ─────────────────────
   Panel nie miał ani jednego `@keyframes` i ani jednej reguły dla osób, które
   wyłączyły animacje w systemie. Pierwszy ruch w skrzynce ustawia politykę dla
   całego panelu, więc zasada jest zapisana tutaj, zanim pojawi się drugi.

   TRZY REGUŁY:

     1. Animacja z konfiguracji Tailwinda (`animate-wiersz-nowy` i każda
        następna) stoi za `motion-safe:`. Użytkownik z wyłączonymi animacjami
        nie dostaje ruchu, a zmiana nadal musi dać się zauważyć innym
        sposobem (np. `motion-reduce:opacity-40` na ikonie odświeżania).
     2. Żadna animacja się nie zapętla i żadna nie trwa dłużej niż dwie
        sekundy. Pętla kradnie uwagę przez cały dzień pracy, a to dokładnie
        koszt, który ergonomia magazynu każe zdjąć (`docs/ergonomia-magazynu.md`).
     3. Klatki kluczowe żyją w jednym miejscu, `tailwind.config.js`. Własny
        `@keyframes` w CSS omijałby regułę 1 i 2.

   CZEGO REGUŁA 1 NIE DOTYKA: wbudowanych `animate-spin` i `animate-pulse`.
   Kręcąca się ikona i szkielet ładowania to informacja zwrotna o trwającej
   pracy, nie dekoracja, i stoją w kilku ekranach od dawna. Strażnik czyta
   wyłącznie animacje NAZWANE w konfiguracji, a nowy kod i tak dokłada przy
   wbudowanych `motion-safe:`.

   CZEGO NIE PILNUJE. Nie ocenia, czy ruch jest potrzebny, ani czy nie gra przy
   otwarciu ekranu. Pierwsze to decyzja projektowa, drugie pilnują testy
   `NoweKlucze.test.tsx` i `Kolejka.test.tsx`.

   ZWOLNIENIA SĄ JAWNE. Komentarz `ruch: <powód>` w linii albo do sześciu linii
   nad nią, powód co najmniej trzy wyrazy — ten sam mechanizm co `czas:`,
   `kontrast:`, `skala:` i `bursztyn:`. */

const ZWOLNIENIE = /ruch:\s*\S+(?:\s+\S+){2,}/;

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
      if (surowe.slice(Math.max(0, i - 6), i + 1).some((x) => ZWOLNIENIE.test(x))) return;
      winne.push(`${plik}:${i + 1} → ${l.trim().slice(0, 80)}`);
    });
  }
  return winne;
}

const konfig = Object.values(KONFIG)[0] ?? "";
const animacje = [...(konfig.match(/animation:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "")
  .matchAll(/"([\w-]+)":\s*"([^"]+)"/g)].map((m) => ({ nazwa: m[1], wartosc: m[2] }));

describe("Ruch w panelu", () => {
  it("konfiguracja Tailwinda niesie animacje, które ten strażnik czyta", () => {
    /* Bez tego pozostałe asercje przeszłyby na pustej liście. */
    expect(animacje.map((a) => a.nazwa)).toEqual(expect.arrayContaining(["wiersz-nowy", "wiadomosc-nowa"]));
  });

  it("każda animacja z konfiguracji stoi za `motion-safe:`", () => {
    /* Wzorzec budowany z nazw w konfiguracji: nowa animacja jest pilnowana od
       pierwszego dnia, bez dopisywania jej tutaj. Wbudowane — patrz nagłówek. */
    const nazwy = animacje.map((a) => a.nazwa).join("|");
    expect(znajdz(new RegExp(`(?<!motion-safe:)\\banimate-(?:${nazwy})\\b`))).toEqual([]);
  });

  it("żadna animacja się nie zapętla", () => {
    for (const a of animacje) {
      expect(a.wartosc, `${a.nazwa} jest pętlą`).not.toMatch(/infinite/);
      expect(a.wartosc, `${a.nazwa} nie podaje liczby powtórzeń`).toMatch(/\s\d+\s*$/);
    }
  });

  it("żadna animacja nie trwa dłużej niż dwie sekundy", () => {
    for (const a of animacje) {
      const czas = /(\d+(?:\.\d+)?)(ms|s)\b/.exec(a.wartosc);
      expect(czas, `${a.nazwa} nie podaje czasu`).not.toBeNull();
      const ms = Number(czas![1]) * (czas![2] === "s" ? 1000 : 1);
      expect(ms, `${a.nazwa} trwa ${ms} ms`).toBeLessThanOrEqual(2000);
    }
  });

  it("klatki kluczowe żyją w jednym miejscu, w konfiguracji Tailwinda", () => {
    const wCss = Object.entries(CSS).filter(([, c]) => /@keyframes/.test(c)).map(([p]) => p);
    expect(wCss).toEqual([]);
    expect(znajdz(/@keyframes/)).toEqual([]);
  });
});
