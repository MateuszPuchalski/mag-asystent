import { describe, expect, it } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { PomiarCopilota } from "./PomiarCopilota";
import type { PomiarCopilota as Pomiar } from "../api/typy";

/* ── Pomiar Copilota (uproszczony 0.519.0) ──────────────────────────────────
   Na wierzchu zostaje to, na czym zapada decyzja o modelu: wywołania,
   nieudane i rachunek. Tokeny i prefiks instrukcji to głos programisty —
   nie wracają na ekran. Objaw ciszy cache zostaje, tylko w szczegółach.    */

const dane = (n: Partial<Pomiar> = {}): Pomiar => ({
  wywolan: 20, bledow: 1,
  tokeny: { wej: 16000, wyj: 900, cacheZapis: 0, cacheOdczyt: 0 },
  kosztUsd: 0.5, udzialCache: 0,
  klasyfikacja: {
    taksonomia: "v3", decyzji: 20, wgZrodla: { MODEL: 15, ALLEGRO_MAPPING: 4, FALLBACK: 1 },
    wgStatusu: { FAILED: 1 }, wymagaCzlowieka: 2, oznaczonych: 10, nieoznaczonych: 10,
    poprawionych: 3, mapowanie: null,
    wgKategorii: [{ kategoria: "PRODUCT_COMPATIBILITY", przewidzianych: 8,
      precyzja: { k: 6, n: 8, p: 0.75, dolna: 0.41, gorna: 0.93 }, czulosc: null }],
  },
  wgZadania: [],
  szkice: {
    ile: 0, odrzuconych: 0, daneZaproponowane: 0, daneWpisane: 0, daneOdrzucone: 0,
    pasowaniaRozpoznane: 0, pasowaniaZaproponowane: 0, pasowaniaOdrzucone: 0,
    pasowaniaZatwierdzonePrzezBiuro: 0, wyslanychBezZmian: 0, wyslanychPoprawionych: 0,
  },
  ...n,
});

describe("PomiarCopilota", () => {
  it("na wierzchu wywołania, nieudane i rachunek; bez tokenów i prefiksu", () => {
    render(<PomiarCopilota dane={dane()} />);
    expect(screen.getByText("wywołań")).toBeInTheDocument();
    expect(screen.getByText(/Rachunek/).textContent).toContain("2.00 zł");
    expect(screen.queryByText(/tokenów|tokeny liczone|prefiks/)).toBeNull();
  });

  it("decyzje i tabela precyzji leżą w zwiniętych szczegółach", () => {
    render(<PomiarCopilota dane={dane()} />);
    const szczegoly = screen.getByText("Szczegóły").closest("details")!;
    expect(szczegoly.open).toBe(false);
    expect(szczegoly).toContainElement(screen.getByLabelText("Decyzje klasyfikatora"));
    expect(szczegoly).toContainElement(screen.getByText("Dobór"));
    expect(screen.getByText("6 z 8 · 75 % (41–93 %)")).toBeInTheDocument();
  });

  /* Szkice przed pracą (26 września 2026): własny wiersz, bo poranek ma
     własny limit, a zlany z dniem nie powiedziałby, ile kosztuje. */
  it("szkice przed pracą mają własny wiersz z rachunkiem; bez wywołań wiersza nie ma", () => {
    const { unmount } = render(<PomiarCopilota dane={dane()} />);
    expect(screen.queryByLabelText("Szkice przed pracą")).toBeNull();
    unmount();
    render(<PomiarCopilota dane={dane({ wgZadania: [
      { zadanie: "szkic", wywolan: 30, bledow: 0, kosztUsd: 3 },
      { zadanie: "szkic_przed_praca", wywolan: 12, bledow: 1, kosztUsd: 1.2 },
      { zadanie: "klasyfikacja_przed_praca", wywolan: 14, bledow: 0, kosztUsd: 0.05 },
    ] })} />);
    const w = screen.getByLabelText("Szkice przed pracą");
    expect(w.textContent).toContain("12 szkiców i 14 rozpoznań");
    expect(w.textContent).toContain("1.25 USD (5.00 zł)");
    expect(within(w).getByText("1")).toHaveClass("text-ranga-uwaga");
    /* Wiersz dnia liczy tylko swoje zadanie — poranek nie wlicza się dwa razy. */
    expect(screen.getByLabelText("Szkice odpowiedzi").textContent).toContain("30 wywołań");
  });

  it("cisza cache przy wywołaniach zostaje objawem — tonem, bez wykładu", () => {
    render(<PomiarCopilota dane={dane()} />);
    expect(screen.getByText("0 %")).toHaveClass("text-ranga-uwaga");
  });
});
