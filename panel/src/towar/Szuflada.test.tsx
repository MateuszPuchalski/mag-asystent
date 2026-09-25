import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { PrzyciskTowaru, SzufladaTowaru } from "./Szuflada";

/* ── Szuflada towaru — trzeci mostek (@wydanie) ─────────────────────────────
   Pilnujemy: bez dostawcy przycisk jest tekstem (testy komponentów i ekrany
   poza ramą), otwarcie czyta i niczego nie zapisuje, wiersze prowadzą do
   spraw i zamykają szufladę, a Escape ją zamyka.                          */

let zapisy: string[] = [];
beforeEach(() => {
  zapisy = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "GET") zapisy.push(url);
    if (url === "/api/products/501") return new Response(JSON.stringify({
      id: 501, sym: "14-25001", name: "Nóż do kosiarki MTD 46 cm", ean: null, unit: "szt.", locs: ["H01-02-03"],
      mag: { stan: 0, rez: 0, avail: 0 }, magazyny: [],
      zamowione: [{ dokId: 1, nrPelny: "ZD 1", dataWyst: "2026-09-20", termin: "2026-10-01", dostawca: "Rosa-Pol", ilosc: 20, szacunek: false }] }));
    if (url === "/api/obsluga/towar/501/przekroj") return new Response(JSON.stringify({
      twId: 501, oferty: [{ konto: 1, ofertaId: "of-1", nazwa: "Nóż" }],
      otwarteZwroty: [{ id: 7, numer: "Z-7", at: "2026-09-20T08:00:00Z", ilosc: 1 }],
      otwarteSprawy: [{ id: 9, typ: "CLAIM", numer: "12/2026", at: "2026-09-21T08:00:00Z" }],
      otwarteRozmowy: [],
      okno: { dni: 90, sprzedanych: 10, zwroconych: 3, reklamacji: 1, udzialZwrotow: 0.3 } }));
    if (url === "/api/obsluga/wiedza/towar/501") return new Response(JSON.stringify({
      potwierdzone: [{}, {}], negatywne: [], propozycje: [], pasowania: {}, zamiennosciOem: [] }));
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const pokaz = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
  <SzufladaTowaru><PrzyciskTowaru twId={501}>14-25001</PrzyciskTowaru></SzufladaTowaru>
</MemoryRouter></QueryClientProvider>);

describe("szuflada towaru", () => {
  it("bez dostawcy przycisk jest samym tekstem", () => {
    render(<PrzyciskTowaru twId={501}>14-25001</PrzyciskTowaru>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("14-25001")).toBeInTheDocument();
  });

  it("otwarcie pokazuje stan, dostawę, 90 dni i otwarte sprawy — bez zapisu", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: "14-25001" }));
    const s = await screen.findByRole("dialog", { name: /Towar/ });
    expect(await within(s).findByText("brak na stanie")).toBeInTheDocument();
    expect(within(s).getByText(/zamówione 20 szt\. u Rosa-Pol/)).toBeInTheDocument();
    expect(await within(s).findByText(/sprzedane 10 · zwrócone 3 \(30%\)/)).toBeInTheDocument();
    expect(within(s).getByRole("link", { name: /Z-7/ })).toHaveAttribute("href", "/obsluga/zwroty/7");
    expect(within(s).getByRole("link", { name: /reklamacja 12\/2026/ })).toHaveAttribute("href", "/obsluga/reklamacje/9");
    expect(await within(s).findByText(/2 potwierdzonych zastosowań/)).toBeInTheDocument();
    expect(zapisy).toEqual([]);
  });

  it("przejście do sprawy i Escape zamykają szufladę", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: "14-25001" }));
    const s = await screen.findByRole("dialog");
    await userEvent.click(await within(s).findByRole("link", { name: /Z-7/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "14-25001" }));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
