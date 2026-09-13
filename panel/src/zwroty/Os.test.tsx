import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WpisOsiZwrotu } from "../api/typy";
import { Os } from "./Os";

/* ── Oś zwrotu (0.285.0) ─────────────────────────────────────────────────────
   Serwer oddawał ją przy szczególe sprawy od 0.156.0, panel miał na nią nawet
   typ — i nikt jej nie rysował. Biuro patrzące na zamknięty zwrot nie widziało
   ani kto go przyjął, ani za co poszła kwota, ani czy towar wrócił na półkę.

   Trzy rzeczy warte testu:

   1. KOLEJNOŚĆ Z SERWERA. Panel nie sortuje po swojemu — dwie definicje tego
      samego porządku rozjechałyby się przy pierwszej zmianie jednej z nich.
   2. RODZAJ NIEZNANY NIE ZNIKA. Starszy wpis albo nowy serwis mają pokazać
      swoją treść; milczenie byłoby gorsze niż wiersz bez koloru.
   3. PUSTA OŚ NIE RYSUJE RAMKI. Zwrot świeżo zaciągnięty z Allegro nie ma
      jeszcze żadnej decyzji, a pas szarości mówiłby, że czegoś brakuje.     */

const wpis = (n: Partial<WpisOsiZwrotu> = {}): WpisOsiZwrotu => ({
  id: 1, rodzaj: "werdykt", tresc: "Zwrot przyjęty",
  kiedy: "2026-09-01T10:00:00.000Z", kto: "Ala z biura", dane: null, ...n,
});

describe("Oś zwrotu", () => {
  it("wypisuje wpisy w kolejności, którą podał serwer", () => {
    render(<Os wpisy={[
      wpis({ id: 1, tresc: "Zwrot przyjęty" }),
      wpis({ id: 2, rodzaj: "kwota", tresc: "Do oddania 49.99 (pełna)" }),
      wpis({ id: 3, rodzaj: "rozlozenie", tresc: "Odłożony na A01-02-03, kosz Z-7" }),
    ]} />);
    const wiersze = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(wiersze[0]).toContain("Zwrot przyjęty");
    expect(wiersze[1]).toContain("Do oddania");
    expect(wiersze[2]).toContain("A01-02-03");
  });

  it("autor i godzina stoją przy wpisie", () => {
    /* Pytanie „kto to zrobił" zadaje się patrząc na wpis, nie szukając
       autora w osobnej sekcji. */
    render(<Os wpisy={[wpis({ kto: "Ala z biura" })]} />);
    expect(screen.getByText(/Ala z biura/)).toBeInTheDocument();
  });

  it("numer korekty ZNALEZIONY przez automat jest podpisany", () => {
    /* Fakt z danych nie ma udawać czyjejś decyzji (§4.3) — i odwrotnie. */
    render(<Os wpisy={[wpis({
      rodzaj: "korekta", tresc: "Korekta KFS 12/2026", kto: "automat korekt",
      dane: { numer: "KFS 12/2026", zrodlo: "subiekt" },
    })]} />);
    expect(screen.getByText(/znaleziona w Subiekcie/)).toBeInTheDocument();
  });

  it("nieznany rodzaj pokazuje SWOJĄ treść zamiast znikać", () => {
    render(<Os wpisy={[wpis({ rodzaj: "cos_nowego", tresc: "Zdarzenie z przyszłości" })]} />);
    expect(screen.getByText("Zdarzenie z przyszłości")).toBeInTheDocument();
    expect(screen.getByText("cos_nowego")).toBeInTheDocument();
  });

  it("pusta oś nie rysuje niczego", () => {
    const { container } = render(<Os wpisy={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
