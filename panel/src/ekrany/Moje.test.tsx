import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MojaSprawa } from "../api/typy";

/* ── Jedno „Moje" ponad kolejkami (S4 spoiwa) ───────────────────────────────
   Ekran jest ODCZYTEM z trzech kolejek i testy pilnują trzech rzeczy:

   1. SPRAWA Z TERMINEM STOI NAD RESZTĄ — kolejność bierze zegar, a zegar ma
      wyłącznie część spraw (blizna 0.121.0: jeden zegar nazwany drugim).
   2. WIERSZ PROWADZI DO WŁAŚCIWEJ KOLEJKI, bo tam stoją bramki sprawy.
   3. NIE MA TU ANI JEDNEGO PRZYCISKU PRACY. Ekran roboczy nad kolejkami
      byłby nakładką ze wspólnym statusem — kształtem z blizny 0.140.0.     */

const moje = vi.fn();
/* `PRAWDZIWE` przełącza ekran na prawdziwy hak nad atrapą `fetch`. Atrapa
   haka nie widzi sieci, więc zapisu dołożonego przy otwarciu nie złapałaby
   nigdy — a tego pilnował dawniej licznik po źródle `biuro.html`. */
let PRAWDZIWE = false;
vi.mock("../api/rozmowy", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/rozmowy")>("../api/rozmowy");
  return { ...rzeczywisty, useMojeSprawy: () => (PRAWDZIWE ? rzeczywisty.useMojeSprawy() : moje()) };
});

const { Moje } = await import("./Moje");

const sprawa = (n: Partial<MojaSprawa> = {}): MojaSprawa => ({
  kolejka: "reklamacja", id: 7, opis: "Nie działa",
  at: "2026-09-10T08:00:00Z", terminDo: null, ...n,
});

beforeEach(() => { moje.mockReset(); PRAWDZIWE = false; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Ekran Moje", () => {
  it("otwarcie to sam odczyt — ekran nad kolejkami niczego nie przypisuje ani nie gasi", async () => {
    /* „Moje" zbiera sprawy z trzech kolejek. Kusi, żeby przy okazji odhaczyć
       „widziane" albo odświeżyć terminy — i to byłby zapis przy patrzeniu,
       tylko w trzech kolejkach naraz. */
    PRAWDZIWE = true;
    const zapisy: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const metoda = init?.method ?? "GET";
      if (metoda !== "GET") zapisy.push(`${metoda} ${url}`);
      if (metoda === "GET" && url === "/api/obsluga/moje") {
        return new Response(JSON.stringify({ sprawy: [sprawa()] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "poza tym testem" }), { status: 404 });
    }));

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Moje /></MemoryRouter></QueryClientProvider>);
    await screen.findByText("Nie działa");
    expect(zapisy).toEqual([]);
  });

  it("składa trzy kolejki w jedną listę i prowadzi do właściwej", () => {
    moje.mockReturnValue({ data: { sprawy: [
      sprawa({ kolejka: "reklamacja", id: 7 }),
      sprawa({ kolejka: "dyskusja", id: 9, opis: "Gdzie paczka" }),
      sprawa({ kolejka: "rozmowa", id: 11, opis: "Czy pasuje" }),
    ] }, isLoading: false });

    render(<MemoryRouter><Moje /></MemoryRouter>);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href")))
      .toEqual(["/obsluga/reklamacje/7", "/obsluga/dyskusje/9", "/obsluga/skrzynka/11"]);
  });

  it("sprawa z terminem mówi o nim wprost, reszta mówi o ostatnim ruchu", () => {
    moje.mockReturnValue({ data: { sprawy: [
      sprawa({ id: 7, terminDo: "2026-09-20T00:00:00Z" }),
      sprawa({ kolejka: "dyskusja", id: 9, terminDo: null }),
    ] }, isLoading: false });

    render(<MemoryRouter><Moje /></MemoryRouter>);
    expect(screen.getAllByText(/^termin /).length).toBe(1);
    expect(screen.getAllByText(/^ostatni ruch /).length).toBe(1);
    expect(screen.getByText(/1 z terminem/)).toBeInTheDocument();
  });

  it("nic nie prowadzę to zdanie, nie pusty ekran", () => {
    moje.mockReturnValue({ data: { sprawy: [] }, isLoading: false });

    render(<MemoryRouter><Moje /></MemoryRouter>);
    expect(screen.getByText(/Nic nie prowadzisz/)).toBeInTheDocument();
  });

  it("nie ma tu ani jednego przycisku pracy — to odczyt, nie piąta kolejka", () => {
    moje.mockReturnValue({ data: { sprawy: [sprawa()] }, isLoading: false });

    render(<MemoryRouter><Moje /></MemoryRouter>);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
