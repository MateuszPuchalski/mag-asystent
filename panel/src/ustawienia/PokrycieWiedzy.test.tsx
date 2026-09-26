import { describe, expect, it } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PokrycieWiedzy } from "./PokrycieWiedzy";
import type { PokrycieWiedzy as Pokrycie } from "../api/typy";

/* ── Pokrycie wiedzy (zwinięte 0.519.0) ─────────────────────────────────────
   Siedemnaście kafelków zeszło do jednego rzędu na wierzchu. Testy pilnują,
   że zwinięcie niczego nie chowa w ciszy: kolejka dla człowieka woła przy
   przełączniku, a awaria pełnego tekstu stoi na wierzchu.                   */

const dane = (n: Partial<Pokrycie> = {}): Pokrycie => ({
  kartotek: 900, zOpisem: 600, zIdentyfikatorem: 300, identyfikatorow: 450,
  identyfikatorowRecznych: 40, identyfikatorowZOfert: 25,
  modeleZOpisu: { nowych: 0, przerobionych: 10, odrzuconych: 2 },
  zastosowania: { zatwierdzonych: 80, negatywnych: 3, propozycji: 5 },
  tokeny: { tokenow: 12, nowych: 0, zatwierdzonych: 7 },
  wymiary: { kartotek: 200, wymiarow: 260 },
  fts: { dostepne: true, wpisow: 900 },
  ...n,
});

describe("PokrycieWiedzy", () => {
  it("na wierzchu jeden rząd, reszta pod zwiniętymi szczegółami", async () => {
    render(<PokrycieWiedzy dane={dane()} />);
    expect(screen.getByText("odzyskanych z ofert")).toBeInTheDocument();
    const szczegoly = screen.getByText("Szczegóły").closest("details")!;
    expect(szczegoly.open).toBe(false);
    expect(szczegoly).toContainElement(screen.getByText("tekstów do przerobienia"));
    expect(szczegoly).toContainElement(screen.getByText("wymiarów"));
    await userEvent.click(screen.getByText("Szczegóły"));
    expect(szczegoly.open).toBe(true);
    expect(screen.getByText(/obejmuje/).textContent).toContain("900");
  });

  it("kolejka na decyzję człowieka woła przy przełączniku, nie tylko w środku", () => {
    render(<PokrycieWiedzy dane={dane({
      modeleZOpisu: { nowych: 4, przerobionych: 0, odrzuconych: 0 },
      tokeny: { tokenow: 1, nowych: 2, zatwierdzonych: 0 },
    })} />);
    expect(screen.getByText(/do decyzji: 4 tekstów i 2 kartotek/)).toBeInTheDocument();
  });

  it("bez kolejki przełącznik nie woła o nic", () => {
    render(<PokrycieWiedzy dane={dane()} />);
    expect(screen.queryByText(/do decyzji:/)).toBeNull();
  });

  it("awaria pełnego tekstu stoi na wierzchu i mówi po ludzku", () => {
    render(<PokrycieWiedzy dane={dane({ fts: { dostepne: false, wpisow: 0 } })} />);
    const zdanie = screen.getByText(/pełnym tekstem nie działa/);
    expect(zdanie.closest("details")).toBeNull();
    expect(screen.queryByText(/FTS5|SQLite/)).toBeNull();
  });
});
