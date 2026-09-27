import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dostawy } from "./Dostawy";
import { Kosze } from "./Kosze";
import { Skrzynka } from "./Skrzynka";

/* ── BRAK POŁĄCZENIA TO NIE BRAK PRACY (0.546.0) ────────────────────────────
   Pomiar z zabitym serwerem: Dostawy mówiły „Nic nie czeka na biuro — hala
   rozkłada bez pytań" i liczniki „0" obok „Błąd 502". Agent brał awarię za
   koniec pracy. Tu każdy odczyt pada tak, jak pada przy restarcie serwera,
   a ekran ma powiedzieć, że nie wie — nie, że nic nie ma. */

let zapisy: string[] = [];

beforeEach(() => {
  zapisy = [];
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "GET") zapisy.push(`${init?.method} ${url}`);
    throw new TypeError("Failed to fetch");
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pokaz(ekran: React.ReactElement, adres: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[adres]}>{ekran}</MemoryRouter>
  </QueryClientProvider>);
}

/** Liczba przy etykiecie kubełka — zero przy braku danych to kłamstwo. */
const bezCyfr = (nazwa: RegExp) => {
  for (const el of screen.queryAllByRole("button", { name: nazwa })) expect(el.textContent).not.toMatch(/\d/);
};

describe("zerwane połączenie przy otwarciu ekranu", () => {
  it("Dostawy: błąd zamiast „nic nie czeka” i bez zer w licznikach", async () => {
    pokaz(<Dostawy />, "/obsluga/dostawy");
    expect(await screen.findByText("Brak połączenia z serwerem.")).toBeInTheDocument();
    expect(screen.queryByText(/Nic nie czeka na biuro/)).toBeNull();
    bezCyfr(/Do decyzji/);
    bezCyfr(/W toku/);
    expect(zapisy).toEqual([]);
  });

  it("Kosze: błąd zamiast „ten kubełek jest pusty” i bez zer w licznikach", async () => {
    pokaz(<Kosze />, "/obsluga/zwroty/kosze");
    expect(await screen.findByText("Brak połączenia z serwerem.")).toBeInTheDocument();
    expect(screen.queryByText(/kubełek jest pusty/)).toBeNull();
    bezCyfr(/W pracy/);
    expect(zapisy).toEqual([]);
  });

  it("Skrzynka: błąd zamiast „brak rozmów” i bez zer w kubełkach", async () => {
    pokaz(<Skrzynka />, "/obsluga/skrzynka");
    expect(await screen.findByText("Brak połączenia z serwerem.")).toBeInTheDocument();
    expect(screen.queryByText(/Brak rozmów w zsynchronizowanej skrzynce/)).toBeNull();
    bezCyfr(/Do odpowiedzi/);
    expect(zapisy).toEqual([]);
  });
});
