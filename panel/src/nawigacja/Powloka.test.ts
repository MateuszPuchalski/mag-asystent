import { describe, expect, it } from "vitest";
/* Źródło przez `?raw`, jak w `RamaOkna.test.ts`: `main.tsx` montuje całą
   aplikację przy imporcie, więc czytamy tekst zamiast go wykonywać. */
import tsx from "../main.tsx?raw";
import zrodloSkrotow from "../sprawy/Skroty.tsx?raw";
import zrodloKlawiszy from "./Klawisze.tsx?raw";
import zrodloSzukania from "./Szukaj.tsx?raw";

/* ── Powłoka bez powtórzeń (0.515.0) ────────────────────────────────────────
   Pilnujemy uproszczeń nagłówka i klawiszy: podpis „Biuro" nie wraca,
   plakietka licznika ma jedną kopię, a znaczek klawisza i strażnik pola
   pisania mieszkają w jednym miejscu. */
describe("powłoka panelu", () => {
  it("nagłówek nie niesie podpisu „Biuro” obok logo", () => {
    expect(tsx).not.toMatch(/>Biuro</);
  });

  it("plakietka licznika zakładki stoi w kodzie raz", () => {
    expect(tsx.match(/rounded-full bg-wertis-amber/g)).toHaveLength(1);
  });

  it("znaczek klawisza i strażnik pola nie mają lokalnych kopii", () => {
    for (const zrodlo of [zrodloSkrotow, zrodloKlawiszy]) {
      expect(zrodlo).not.toMatch(/const Klawisz\b/);
      expect(zrodlo).toMatch(/import \{ Klawisz \} from "(\.\.\/nawigacja|\.)\/Klawisz"/);
    }
    expect(zrodloKlawiszy).not.toMatch(/const wPolu\b/);
  });

  it("okna szukania i skrótów mają własny kolor tekstu, nie biel nagłówka", () => {
    /* Oba okna rysują się wewnątrz `<header>` z `text-white`; bez jawnego
       koloru wpisana fraza i tytuł listy znikały na białym tle. */
    for (const [zrodlo, nazwa] of [[zrodloSzukania, "Szukaj wszędzie"], [zrodloKlawiszy, "Skróty klawiszowe"]]) {
      const okno = zrodlo.slice(zrodlo.indexOf(`aria-label="${nazwa}"`));
      expect(okno.match(/className="[^"]*"/)?.[0]).toContain("text-slate-900");
    }
  });
});
