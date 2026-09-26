import { describe, expect, it } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
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

  /* Czas czekania na Copilota (@wydanie): jedno zdanie o szkicu na wierzchu,
     tabela po zadaniu w szczegółach, nazwy zadań po ludzku. */
  it("podaje czas czekania: zdanie o szkicu na wierzchu, mediana i p90 zadań w szczegółach", () => {
    render(<PomiarCopilota dane={dane({ wgZadania: [
      { zadanie: "szkic", wywolan: 12, bledow: 0, kosztUsd: 0.3, medianaMs: 6_400, p90Ms: 14_000 },
      { zadanie: "klasyfikacja", wywolan: 8, bledow: 1, kosztUsd: 0.2, medianaMs: 900, p90Ms: 1_500 },
      { zadanie: "stare", wywolan: 2, bledow: 0, kosztUsd: 0, medianaMs: null, p90Ms: null },
    ] })} />);
    expect(screen.getByText(/Rachunek/).textContent).toContain("Na szkic czeka się zwykle 6,4 s, co dziesiąty dłużej niż 14,0 s.");
    const tabela = screen.getByLabelText("Czas czekania na Copilota");
    expect(screen.getByText("Szczegóły").closest("details")).toContainElement(tabela);
    expect(tabela.textContent).toContain("rozpoznanie kategorii");
    expect(tabela.textContent).toContain("0,9 s");
    expect(tabela.textContent).not.toContain("stare");
  });

  it("bez zmierzonego szkicu zdania o czekaniu nie ma", () => {
    render(<PomiarCopilota dane={dane()} />);
    expect(screen.getByText(/Rachunek/).textContent).not.toContain("czeka");
    expect(screen.queryByLabelText("Czas czekania na Copilota")).toBeNull();
  });

  it("cisza cache przy wywołaniach zostaje objawem — tonem, bez wykładu", () => {
    render(<PomiarCopilota dane={dane()} />);
    expect(screen.getByText("0 %")).toHaveClass("text-ranga-uwaga");
  });
});
