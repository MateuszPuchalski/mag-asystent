import { describe, expect, it } from "vitest";

/* Źródło wchodzi przez `?raw`, nie przez `node:fs`: `tsconfig.json` zapisuje
   decyzję, że panel jest aplikacją przeglądarki i typy Node'a otwierałyby
   drogę do API, którego w kodzie ekranu być nie może. `?raw` daje surowy
   tekst, więc `main.tsx` NIE jest tutaj wykonywany. */
import tsx from "./main.tsx?raw";

/* ── Strażnik ramy okna (0.233.0, przepisany w 0.236.0) ──────────────────────
   Rama przewróciła się DWA RAZY i oba razy przez jednostkę okna. Najpierw
   `lg:h-dvh` z 0.165.0: przeglądarka, która nie zna `dvh`, wyrzuca całą
   deklarację, a `lg:min-h-0` skasowało już `min-h-screen` — nie zostawał żaden
   limit. Potem zapas `100vh` z 0.233.0, który usterki nie zamknął: `vh` liczy
   okno UKŁADU, a ono bywa wyższe niż okno WIDOCZNE, więc strona dalej dawała
   się przesunąć o kilkadziesiąt pikseli.

   Od 0.236.0 rama nie używa żadnej jednostki okna: `position: fixed; inset: 0`.
   Ten plik pilnuje, żeby JSX nie wrócił do klasy Tailwinda z jednostką —
   niezmiennik pikselowy mierzy `e2e/dym.spec.ts` w prawdziwej przeglądarce,
   bo jsdom układu nie liczy.                                                */
describe("Rama okna nie może stać na jednostce okna", () => {
  const klasy = tsx.match(/className="rama-okna[^"]*"/)?.[0];

  it("wysokość bierze klasa `rama-okna`, a nie żadne `h-dvh` ani `h-screen`", () => {
    /* Jedna klasa Tailwinda to jedna deklaracja i zawsze jakaś jednostka.
       Szukamy w SAMYM `className`, nie w całym pliku, bo inaczej test wywraca
       się o własny komentarz obok, który te klasy wymienia z nazwy. */
    expect(klasy).toBeDefined();
    expect(klasy).not.toMatch(/h-dvh|h-screen(?!\b.*min)/);
    expect(klasy).not.toContain("lg:h-");
  });

  it("`lg:min-h-0` zostaje — bez niego `vh` wraca tylnymi drzwiami", () => {
    /* `min-h-screen` to `min-height: 100vh`. Gdyby nie było go czym skasować
       powyżej `lg`, rama przypięta przez `inset: 0` i tak rozepchnęłaby się do
       stu procent okna UKŁADU — czyli dokładnie do usterki, którą zamykamy. */
    expect(klasy).toContain("lg:min-h-0");
    expect(klasy).toContain("min-h-screen");
  });

  it("`lg:overflow-hidden` zostaje — to on daje ramie sens", () => {
    /* Bez przycięcia kolumny wylewałyby się poza okno zamiast przewijać
       u siebie, a rama byłaby samym pudełkiem bez skutku. */
    expect(klasy).toContain("lg:overflow-hidden");
  });

  it("pasek boczny nie obcina okienka „Więcej”, które z niego wystaje", () => {
    /* Okienko menu jest `absolute` i wychodzi poza pasek w prawo. Pasek z
       `overflow` przyciąłby je do własnej szerokości, więc przewija się
       wyłącznie lista zakładek, a sam `<aside>` overflow nie dostaje. */
    const pasek = tsx.match(/<aside[^>]*className="[^"]*"/)?.[0];
    expect(pasek).toBeDefined();
    expect(pasek).not.toMatch(/overflow/);
    expect(tsx).toMatch(/<nav aria-label="Praca" className="[^"]*overflow-y-auto/);
  });

  it("pasek boczny zwęża się do ikon, zamiast wypychać stronę w bok", () => {
    /* Przy powiększeniu 200% okno ma 640 px CSS; pasek o stałej szerokości
       zjadłby trzecią część pracy. Poniżej 900 px zostają ikony. */
    expect(tsx).toMatch(/<aside[^>]*max-\[899px\]:w-20/);
  });
});
