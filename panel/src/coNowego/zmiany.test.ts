import { describe, expect, it } from "vitest";
import { doPokazania, najnowszeZmiany, starsza } from "./zmiany";

/* ── Wyciąg „co się zmieniło" (@wydanie) ────────────────────────────────────
   Pilnujemy trzech granic: bierzemy tylko wydania `minor`, tylko pogrubione
   otwarcia akapitów (nie punkty list), a porównanie wersji jest liczbowe.  */

const MD = `# Historia zmian

## 0.501.0 — 26 września 2026

**Cofnij po zakończeniu.** Pasek na osiem sekund.

- **Nie tytuł**: punkt listy.

**Znaczki klawiszy tylko wtedy, gdy działają:**

## 0.500.1 — 26 września 2026

**Instalator czeka na usługi.** Tego agent nie zobaczy.

## 0.500.0 — 25 września 2026

**Soczewki pytań.** Opis.

## 0.99.0 — 1 sierpnia 2026

**Stare.** Opis.
`;

describe("wyciąg historii zmian", () => {
  it("bierze wydania minor i pogrubione otwarcia akapitów, bez kropki na końcu", () => {
    expect(najnowszeZmiany(MD, 3)).toEqual([
      { wersja: "0.501.0", data: "26 września 2026",
        naglowki: ["Cofnij po zakończeniu", "Znaczki klawiszy tylko wtedy, gdy działają"] },
      { wersja: "0.500.0", data: "25 września 2026", naglowki: ["Soczewki pytań"] },
      { wersja: "0.99.0", data: "1 sierpnia 2026", naglowki: ["Stare"] },
    ]);
    expect(najnowszeZmiany(MD, 1).map((z) => z.wersja)).toEqual(["0.501.0"]);
  });

  it("porównuje wersje liczbowo, nie jako napisy", () => {
    expect(starsza("0.99.0", "0.100.0")).toBe(true);
    expect(starsza("0.100.0", "0.99.0")).toBe(false);
    expect(starsza("0.500.0", "0.500.0")).toBe(false);
  });

  it("pokazuje tylko nowsze niż zamknięte; bez pamięci — tylko najnowsze", () => {
    const z = najnowszeZmiany(MD, 3);
    expect(doPokazania(z, "0.500.0").map((w) => w.wersja)).toEqual(["0.501.0"]);
    expect(doPokazania(z, "0.501.0")).toEqual([]);
    expect(doPokazania(z, null).map((w) => w.wersja)).toEqual(["0.501.0"]);
  });
});
