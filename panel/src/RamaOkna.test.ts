import { describe, expect, it } from "vitest";

/* Źródło wchodzi przez `?raw`, nie przez `node:fs`: `tsconfig.json` zapisuje
   decyzję, że panel jest aplikacją przeglądarki i typy Node'a otwierałyby
   drogę do API, którego w kodzie ekranu być nie może. `?raw` daje surowy
   tekst, więc `main.tsx` NIE jest tutaj wykonywany. */
import tsx from "./main.tsx?raw";

/* ── Strażnik ramy okna (0.233.0) ────────────────────────────────────────────
   Zgłoszenie właściciela: „dlaczego mogę przesunąć w dół, panel miał się
   mieścić na jednej stronie". Rama z 0.165.0 stała na samym `lg:h-dvh`.
   Przeglądarka, która nie zna `dvh`, wyrzuca CAŁĄ deklarację, a `lg:min-h-0`
   skasowało już `min-h-screen` — ramie nie zostawał żaden limit wysokości
   i przewijał się cały dokument razem z nagłówkiem. Zmierzone: +182 px.

   TEN plik pilnuje wyłącznie tego, co widać w `main.tsx`. Niezmiennika CSS
   sprawdzić tu NIE MOŻNA i to nie jest przeoczenie: Vitest odcina potok CSS,
   więc `index.css?raw` zwraca pusty łańcuch. Wysokość ramy mierzy w prawdziwej
   przeglądarce `e2e/dym.spec.ts` — jsdom nie liczy układu, a `dvh` nie jest
   przełącznikiem, który dałoby się wyłączyć w teście.                       */
describe("Rama okna nie może stać na samym dvh", () => {
  const klasy = tsx.match(/className="rama-okna[^"]*"/)?.[0];

  it("wysokość bierze klasa `rama-okna`, nie `lg:h-dvh`", () => {
    /* Powrót do klasy Tailwinda cofnąłby usterkę: jedna klasa to jedna
       deklaracja, a tu potrzebne są dwie — zapas i ulepszenie.
       Szukamy w SAMYM `className`, nie w całym pliku, bo inaczej test
       wywraca się o własny komentarz obok, który tę klasę wymienia z nazwy. */
    expect(klasy).toBeDefined();
    expect(klasy).not.toContain("h-dvh");
  });

  it("reszta ramy zostaje: `overflow-hidden` i `min-h-screen`", () => {
    /* `overflow-hidden` jest powodem, dla którego rama w ogóle coś daje —
       bez niego kolumny wylewałyby się poza okno zamiast przewijać u siebie.
       `min-h-screen` trzyma tło poniżej `lg`, gdzie rama jest wyłączona
       świadomie (§10.5): widok wąski przewija się cały. */
    expect(klasy).toContain("lg:overflow-hidden");
    expect(klasy).toContain("min-h-screen");
  });

  it("nagłówek zawija się, zamiast chować przyciski poza kadrem", () => {
    /* Rama przycina nadmiar szerokości bez paska przewijania, więc poniżej
       ~1150 px zębatka i wylogowanie były nieklikalne. `flex-wrap` kosztuje
       drugi rząd i to jest cena świadoma. */
    expect(tsx).toMatch(/<div className="flex flex-wrap items-center gap-4 px-5 py-3">/);
  });
});
