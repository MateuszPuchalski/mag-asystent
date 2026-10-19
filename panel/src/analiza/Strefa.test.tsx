import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Strefa } from "./Strefa";
import type { StanSellasist } from "../api/wglad";
import { atrapaZapisow } from "../test/zapisy";

/* ── Strefa złota ze zbiórkami z Sellasist ───────────────────────────────────
   Pilnujemy: otwarcie karty to same odczyty; z integracją stoi zdanie, że
   zbiórki płyną same, data ostatniego udanego przebiegu, błąd przebiegu
   i siedem dób w tabeli; bez integracji jedno zdanie o CSV i o kluczach
   w `wertis.env`, bez tabeli. */

const KANDYDACI = { okno: null, prog: 0, kandydaci: [], juzWStrefie: 0, bezReguly: 0 };
const WYLACZONY: StanSellasist = {
  wlaczony: false, ostatniaProbaAt: null, ostatniSukcesAt: null, blad: null, wKolejce: 0, dni: [],
};
const DNI = ["06", "07", "08", "09", "10", "11", "12"].map((d, i) =>
  ({ data: `2026-10-${d}`, zebranych: 10 + i, spakowanych: 9 + i }));
const WLACZONY: StanSellasist = {
  wlaczony: true, ostatniaProbaAt: "2026-10-12T10:05:00Z", ostatniSukcesAt: "2026-10-12T10:00:00Z",
  blad: "Sellasist odrzucił klucz API.", wKolejce: 3, dni: DNI,
};

function pokaz(stan: StanSellasist) {
  const zapisy = atrapaZapisow((url) => {
    if (url === "/api/biuro/sellasist/stan") return stan;
    if (url === "/api/biuro/zbiorki/kandydaci") return KANDYDACI;
    return undefined;
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><Strefa /></MemoryRouter></QueryClientProvider>);
  return zapisy;
}

afterEach(() => vi.unstubAllGlobals());

describe("Strefa złota: zbiórki z Sellasist", () => {
  it("otwarcie z integracją to same odczyty i pokazuje siedem dób", async () => {
    const zapisy = pokaz(WLACZONY);
    const blok = await screen.findByRole("region", { name: "Zbiórki z Sellasist" });
    expect(within(blok).getByText(/Zbiórki płyną same z Sellasist; CSV zostaje/)).toBeInTheDocument();
    expect(within(blok).getByText("Sellasist odrzucił klucz API.")).toBeInTheDocument();
    expect(within(blok).getByText(/czeka na szczegóły: 3/)).toBeInTheDocument();
    const wiersze = within(blok).getAllByRole("row");
    /* Nagłówek i siedem dób, od najstarszej — tak, jak oddaje serwer. */
    expect(wiersze).toHaveLength(8);
    expect(within(wiersze[1]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["06.10", "10", "9"]);
    expect(within(wiersze[7]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["12.10", "16", "15"]);
    expect(zapisy.wyslane).toEqual([]);
    expect(zapisy.nieznane).toEqual([]);
  });

  it("otwarcie bez integracji to jedno zdanie o CSV i kluczach, bez tabeli i bez zapisu", async () => {
    const zapisy = pokaz(WYLACZONY);
    expect(await screen.findByText(/Jedynym źródłem zbiórek jest wgrany CSV/)).toBeInTheDocument();
    expect(screen.getByText("SELLASIST_KONTO")).toBeInTheDocument();
    expect(screen.getByText("SELLASIST_API_KEY")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Zbiórki z Sellasist" })).toBeNull();
    /* Wgranie CSV zostaje — to jedyna droga, gdy automat nie stoi. */
    expect(screen.getByRole("button", { name: /Wgraj CSV zbiórek/ })).toBeInTheDocument();
    expect(zapisy.wyslane).toEqual([]);
    expect(zapisy.nieznane).toEqual([]);
  });
});
