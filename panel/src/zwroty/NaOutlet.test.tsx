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

  it("mówi wprost, że przenosi i wystawia MM człowiek — już zwinięta", () => {
    /* Bez tego zdania lista wyglądałaby jak kolejka czekająca na papier,
       który nigdy nie przyjdzie — magazyn outletowy obsługuje dziś ręka.
       Zdanie stoi w zwiniętym wierszu, bo tam się patrzy najczęściej. */
    stan.pozycje = [POZYCJA()];
    render(<NaOutlet />);
    expect(screen.getByLabelText("Na regał outletowy")).toHaveTextContent(
      /przenosi i wystawia MM człowiek/);
  });

  it("stoi jednym wierszem z liczbą, a pozycje pokazuje dopiero kliknięcie", async () => {
    /* Zwinięta (0.525.0), jak pasek uwag obok: regał obsługuje się raz na
       jakiś czas, więc pełna lista nie ma stać nad kolejką na stałe. */
    stan.pozycje = [POZYCJA(), POZYCJA({ pozycjaId: 8, symbol: "SEK-02" })];
    render(<NaOutlet />);
    const wiersz = screen.getByRole("button", { name: /Na regał outletowy 2/ });
    expect(wiersz).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Stoi na regale" })).not.toBeInTheDocument();

    await userEvent.click(wiersz);

    expect(wiersz).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button", { name: "Stoi na regale" })).toHaveLength(2);
  });

  it("niesie potrącenie, bo to jest liczba, o którą przedmiot potaniał", async () => {
    stan.pozycje = [POZYCJA()];
    render(<NaOutlet />);
    await userEvent.click(screen.getByRole("button", { name: /Na regał outletowy/ }));
    expect(screen.getByText(/potrącono/)).toHaveTextContent("15,00");
  });

  it("domyka pozycję jednym kliknięciem", async () => {
    stan.pozycje = [POZYCJA(), POZYCJA({ pozycjaId: 8, symbol: "SEK-02" })];
    render(<NaOutlet />);
    await userEvent.click(screen.getByRole("button", { name: /Na regał outletowy/ }));

    await userEvent.click(screen.getAllByRole("button", { name: "Stoi na regale" })[1]);

    expect(przeniesiono).toHaveBeenCalledWith({ pozycjaId: 8 });
  });
});
