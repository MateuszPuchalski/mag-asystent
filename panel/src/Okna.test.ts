import { describe, expect, it } from "vitest";

const ZRODLA = import.meta.glob(["./**/*.tsx", "!./**/*.test.tsx"],
  { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── KAŻDE OKNO IDZIE PRZEZ `useOkno` (@wydanie) ──────────────────────────────
   Pomiar przed tym wydaniem: sześć okien z `role="dialog"` i dwie nakładki
   bez tej roli. Fokus wchodził tylko do szukania i nie wracał z żadnego.
   Skróty strony działały pod każdym, a w zwrotach `Z` pod historią klienta
   oddawało pieniądze (`ekrany/Zwroty.test.tsx`). Każde okno pilnowało
   Escape po swojemu, więc zasada żyła w ośmiu kopiach i w dwóch jej nie było.

   Strażnik pilnuje dwóch rzeczy. Element z `role="dialog"` rozkłada wynik
   haka (`{...okno}`, nazwa z konwencji). Nakładka `fixed inset-0` jest
   oknem albo je niesie w kilku liniach niżej. Zwolnienie to komentarz
   `okno: <powód>` z co najmniej trzema wyrazami, jak w strażnikach obok. */

const ZWOLNIENIE = /okno:\s*\S+(?:\s+\S+){2,}/;

/** Kod bez komentarzy, z zachowanymi numerami linii — patrz `Kontrast.test.ts`. */
function bezKomentarzy(tekst: string): string {
  return tekst
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

function winne(czy: (linie: string[], i: number) => boolean, wzor: RegExp): string[] {
  const wynik: string[] = [];
  for (const [plik, zrodlo] of Object.entries(ZRODLA)) {
    const linie = bezKomentarzy(zrodlo).split("\n");
    const surowe = zrodlo.split("\n");
    linie.forEach((l, i) => {
      if (!wzor.test(l) || czy(linie, i)) return;
      if (surowe.slice(Math.max(0, i - 6), i + 1).some((x) => ZWOLNIENIE.test(x))) return;
      wynik.push(`${plik}:${i + 1} → ${l.trim().slice(0, 72)}`);
    });
  }
  return wynik;
}

describe("Okna dialogowe", () => {
  it("każdy `role=\"dialog\"` rozkłada wynik `useOkno`", () => {
    /* Ta sama linia albo następna: długi znacznik łamie się po roli. */
    expect(winne((l, i) => /\{\.\.\.okno\}/.test(l[i] + (l[i + 1] ?? "")), /role="dialog"/)).toEqual([]);
  });

  it("każda nakładka `fixed inset-0` jest oknem albo je niesie", () => {
    /* Sześć linii w dół, bo między nakładką a oknem stoi czasem komentarz
       JSX, a komentarze są tu zamienione na puste linie. Dwie w górę, bo
       znacznik łamie się po roli, a klasy schodzą do następnej linii. */
    expect(winne((l, i) => l.slice(Math.max(0, i - 2), i + 7).some((x) => /role="dialog"/.test(x)),
      /\bfixed inset-0\b/)).toEqual([]);
  });

  it("hak jest w użyciu — strażnik bez celu byłby zielonym kwadratem", () => {
    const uzycia = Object.values(ZRODLA).filter((z) => /useOkno</.test(z)).length;
    expect(uzycia).toBeGreaterThanOrEqual(8);
  });
});
