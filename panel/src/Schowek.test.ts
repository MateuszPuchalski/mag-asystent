import { describe, expect, it } from "vitest";

/* Źródła bez testów i bez `test/` (atrapy). `ui/kopiuj.ts` też odpada: to jedyne
   miejsce, w którym `navigator.clipboard` ma stać, więc odmawianie mu byłoby
   odmawianiem własnej reguły. Test niżej pilnuje, że wciąż tam stoi. */
const ZRODLA = import.meta.glob(
  ["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}", "!./test/**", "!./ui/kopiuj.ts"],
  { query: "?raw", eager: true, import: "default" }) as Record<string, string>;
const KOPIUJ = import.meta.glob("./ui/kopiuj.ts",
  { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── SCHOWEK TYLKO PRZEZ `kopiujDoSchowka` ───────────────────────────────────
   `navigator.clipboard` istnieje wyłącznie w bezpiecznym kontekście, a biuro
   pracuje pod `http://serwer:3001` i `http://mag.wertis.local:3001`. Tam obiekt
   jest `undefined`, łańcuch `?.` zwija się w całość i przycisk nie kopiuje
   niczego ani słowem o tym nie mówi. Pomocnik `ui/kopiuj.ts` to naprawia,
   ale tylko tam, gdzie ktoś go woła — a samego wywołania nic nie pilnowało.

   Strażnik odmawia każdego `navigator.clipboard` poza `ui/kopiuj.ts`: także
   w wersji z nawiasem (`navigator["clipboard"]`) i z rozpakowaniem
   (`const { clipboard } = navigator`). Komentarze nie liczą się do kodu.

   Zwolnienie to komentarz `schowek: <powód>` z co najmniej trzema wyrazami
   powodu, w tej linii albo w sześciu poprzednich — jak w strażnikach obok. */

const ZWOLNIENIE = /schowek:\s*\S+(?:\s+\S+){2,}/;

const WZORY = [
  /\bnavigator\s*(?:\?\.|\.)\s*clipboard\b/,
  /\bnavigator\s*(?:\?\.)?\s*\[\s*["'`]clipboard["'`]\s*\]/,
  /\{[^}]*\bclipboard\b[^}]*\}\s*=\s*(?:window\.)?navigator\b/,
];

/** Kod bez komentarzy, z zachowanymi numerami linii — patrz `Kontrast.test.ts`. */
function bezKomentarzy(tekst: string): string {
  return tekst
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

function winne(zrodla: Record<string, string>): string[] {
  const wynik: string[] = [];
  for (const [plik, zrodlo] of Object.entries(zrodla)) {
    const linie = bezKomentarzy(zrodlo).split("\n");
    const surowe = zrodlo.split("\n");
    linie.forEach((l, i) => {
      if (!WZORY.some((w) => w.test(l))) return;
      if (surowe.slice(Math.max(0, i - 6), i + 1).some((x) => ZWOLNIENIE.test(x))) return;
      wynik.push(`${plik}:${i + 1} → ${l.trim().slice(0, 72)}`);
    });
  }
  return wynik;
}

describe("Schowek", () => {
  it("żaden ekran nie woła `navigator.clipboard` poza `ui/kopiuj.ts`", () => {
    expect(winne(ZRODLA)).toEqual([]);
  });

  it("pomocnik wciąż tam stoi — strażnik bez celu byłby zielonym kwadratem", () => {
    const [zrodlo] = Object.values(KOPIUJ);
    expect(zrodlo).toMatch(/navigator\.clipboard/);
    expect(Object.keys(ZRODLA).length).toBeGreaterThan(50);
  });

  it("wykrywa wszystkie zapisy i honoruje zwolnienie z powodem", () => {
    const zle = [
      "void navigator.clipboard?.writeText(x);",
      "await navigator?.clipboard.writeText(x);",
      "navigator[\"clipboard\"].writeText(x);",
      "const { clipboard } = navigator;",
    ];
    for (const kod of zle) expect(winne({ "a.ts": kod }), kod).toHaveLength(1);
    /* Komentarz nie jest wywołaniem. */
    expect(winne({ "a.ts": "// navigator.clipboard tu nie woła nikt\n/* navigator.clipboard */" })).toEqual([]);
    /* Zwolnienie: powód ma co najmniej trzy wyrazy, inaczej nie działa. */
    expect(winne({ "a.ts": "// schowek: odczyt wklejenia, nie zapis\nawait navigator.clipboard.readText();" }))
      .toEqual([]);
    expect(winne({ "a.ts": "// schowek: bo tak\nawait navigator.clipboard.readText();" })).toHaveLength(1);
  });
});
