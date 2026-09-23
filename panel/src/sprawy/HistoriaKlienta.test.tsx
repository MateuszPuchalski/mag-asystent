import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrzyciskHistorii } from "./HistoriaKlienta";

/* ── Historia klienta ze sprawy (23 września 2026) ───────────────────────────
   Trzy gwarancje. Sama sprawa na ekranie NIE pobiera historii — liczniki
   żądań ekranów zostają, jakie były. Klik pobiera ją adresem właściwym dla
   rodzaju sprawy. Esc zamyka szufladę. */

let adresy: string[] = [];
beforeEach(() => {
  adresy = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    adresy.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify({
      login: "chips20", maszyny: [],
      wpisy: [{ rodzaj: "rozmowa", at: "2026-09-02T10:00:00Z", tresc: "gdzie paczka", zamowienieId: null,
        link: null, rozmowaId: 41, sprawaId: null }],
    }));
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pokaz(rodzaj: "zwrot" | "sprawa") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>
    <PrzyciskHistorii rodzaj={rodzaj} id={7} tutaj="tym zwrotem" /></MemoryRouter></QueryClientProvider>);
}

describe("przycisk historii klienta", () => {
  it("nic nie pobiera, dopóki agent nie kliknie", () => {
    pokaz("zwrot");
    expect(adresy).toEqual([]);
  });

  it("klik pobiera historię zwrotu, a Esc zamyka szufladę", async () => {
    pokaz("zwrot");
    await userEvent.click(screen.getByRole("button", { name: /Historia/ }));
    expect(await screen.findByText("gdzie paczka")).toBeTruthy();
    expect(adresy).toEqual(["GET /api/obsluga/zwroty/7/klient"]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reklamacja i dyskusja pytają jedną trasą spraw", async () => {
    pokaz("sprawa");
    await userEvent.click(screen.getByRole("button", { name: /Historia/ }));
    await screen.findByText("gdzie paczka");
    expect(adresy).toEqual(["GET /api/obsluga/sprawy/7/klient"]);
  });
});
