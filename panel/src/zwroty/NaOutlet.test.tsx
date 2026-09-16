import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NaOutlet } from "./NaOutlet";
import type { PozycjaNaOutlet } from "../api/typy";

/* ── Lista robocza outletu (0.375.0) ────────────────────────────────────────
   Ta lista jest warunkiem, pod którym weszła trzecia ocena. „Przecena" zeszła
   w 0.209.0, bo kończyła się znacznikiem w bazie — a znacznik bez czytelnika
   jest ślepym zaułkiem.

   Stąd dwie rzeczy warte testu. Lista ma MÓWIĆ, że dokumentu z naszej strony
   nie będzie, i ma dać się DOMKNĄĆ jednym kliknięciem. Pusta ma zniknąć: stały
   element mówiący „zero" łamie punkt 2 dekalogu.                             */

const stan: { pozycje: PozycjaNaOutlet[] } = { pozycje: [] };
const przeniesiono = vi.fn();

vi.mock("../api/zwroty", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useOutlet: () => ({ data: stan, error: null }),
  usePrzeniesionoNaOutlet: () => ({ mutate: przeniesiono, isPending: false, error: null }),
}));

const POZYCJA = (n: Partial<PozycjaNaOutlet> = {}): PozycjaNaOutlet => ({
  pozycjaId: 7, zwrotId: 3, numer: "Z-2026-9", nazwa: "Sekator ogrodowy",
  twId: 11, symbol: "SEK-01", ilosc: 1, potracenieGrosze: 1500,
  ocenionoAt: "2026-09-16T08:00:00Z", ...n,
});

beforeEach(() => {
  stan.pozycje = [];
  przeniesiono.mockClear();
});

describe("Lista robocza regału outletowego", () => {
  it("pusta NIE pokazuje się wcale", () => {
    const { container } = render(<NaOutlet />);
    expect(container).toBeEmptyDOMElement();
  });

  it("mówi wprost, że przenosi i wystawia MM człowiek", () => {
    /* Bez tego zdania lista wyglądałaby jak kolejka czekająca na papier,
       który nigdy nie przyjdzie — magazyn outletowy obsługuje dziś ręka. */
    stan.pozycje = [POZYCJA()];
    render(<NaOutlet />);
    expect(screen.getByLabelText("Na regał outletowy")).toHaveTextContent(
      /przenosi i wystawia MM człowiek/);
  });

  it("niesie potrącenie, bo to jest liczba, o którą przedmiot potaniał", () => {
    stan.pozycje = [POZYCJA()];
    render(<NaOutlet />);
    expect(screen.getByText(/potrącono/)).toHaveTextContent("15,00");
  });

  it("domyka pozycję jednym kliknięciem", async () => {
    stan.pozycje = [POZYCJA(), POZYCJA({ pozycjaId: 8, symbol: "SEK-02" })];
    render(<NaOutlet />);

    await userEvent.click(screen.getAllByRole("button", { name: "Stoi na regale" })[1]);

    expect(przeniesiono).toHaveBeenCalledWith({ pozycjaId: 8 });
  });
});
