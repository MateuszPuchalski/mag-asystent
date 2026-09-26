import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { Eskalacja } from "./Eskalacja";

/* ── Miara eskalacji (S5 spoiwa) ────────────────────────────────────────────
   Testy pilnują dwóch rzeczy: że udział zawsze stoi przy swojej PODSTAWIE
   (50% z dwóch spraw to co innego niż 50% z dwustu) i że miesiąc bez rozmów
   mówi „—", zamiast udawać zero procent.                                    */

describe("karta eskalacji", () => {
  it("pokazuje udział razem z podstawą, z której go policzono", () => {
    render(<Eskalacja miesiace={[{ miesiac: "2026-09", zRozmowa: 40, eskalowane: 10 }]} />);

    expect(screen.getByText("2026-09")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    /* Rama wspólna z resztą analizy (@wydanie): tytuł jest nagłówkiem karty wglądu. */
    expect(screen.getByRole("heading", { name: "Eskalacja po rozmowie" })).toBeInTheDocument();
  });

  it("miesiąc bez rozmów nie udaje zera procent", () => {
    render(<Eskalacja miesiace={[{ miesiac: "2026-08", zRozmowa: 0, eskalowane: 0 }]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("brak danych mówi, czego brakuje, zamiast rysować pustą tabelę", () => {
    render(<Eskalacja miesiace={[]} />);
    expect(screen.getByText(/nie ma z czego liczyć/)).toBeInTheDocument();
  });
});
