import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SiecPasowan } from "../api/typy";
import { Siec } from "./Siec";

/* ── Sieć pasowań: wgląd bez zapisu ──────────────────────────────────────────
   Po prawdziwym `fetch`, nie po zamockowanym hooku: „zero zapisu przy
   patrzeniu" liczy ŻĄDANIA, a hook podmieniony w teście niczego nie wysyła.
   Pilnujemy też, że zdanie połączenia przychodzi z serwera i że szukanie
   zawęża wyspy, zamiast gasić cały ekran.                                  */

const SIEC: SiecPasowan = {
  wezly: [
    { twId: 502, symbol: "W09-0211", nazwa: "Gaźnik GX160" },
    { twId: 811, symbol: "LC170430140-0001", nazwa: "Uszczelka gaźnika GX160" },
    { twId: 812, symbol: "W53-0202", nazwa: "Uszczelka między dystansem" },
    { twId: 503, symbol: "EX055", nazwa: "Gaźnik GX160" },
    { twId: 900, symbol: "MEM-1", nazwa: "Membrana Walbro" },
    { twId: 901, symbol: "WALBRO-7", nazwa: "Gaźnik Walbro" },
  ],
  krawedzie: [
    { z: 811, do: 502, rodzaj: "pasuje", polaryzacja: "pasuje", pasowanieId: 5, rola: "uszczelka", pewnosc: "potwierdzone",
      obustronnie: false, zdanie: "uszczelka LC170430140-0001 pasuje do W09-0211 — katalog dostawcy, 7.09.2026, A. Lewandowska" },
    { z: 812, do: 502, rodzaj: "nie_pasuje", polaryzacja: "nie_pasuje", pasowanieId: 6, rola: "uszczelka",
      pewnosc: "potwierdzone", obustronnie: false, zdanie: "uszczelka W53-0202 nie pasuje do W09-0211: inny wariant" },
    { z: 502, do: 503, rodzaj: "zamiennik", polaryzacja: null, pasowanieId: null, rola: null, pewnosc: "prawdopodobne",
      obustronnie: true, zdanie: "W09-0211 i EX055 podają się nawzajem jako zamienniki w opisach" },
    { z: 900, do: 901, rodzaj: "propozycja", polaryzacja: "pasuje", pasowanieId: 7, rola: "membrana", pewnosc: "prawdopodobne",
      obustronnie: false, zdanie: "membrany MEM-1 pasuje do WALBRO-7 — rozmowa, 8.09.2026, A. Lewandowska" },
  ],
};

let wyslane: string[] = [];
let dane: SiecPasowan = SIEC;

beforeEach(() => {
  wyslane = []; dane = SIEC;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    if (metoda !== "GET") wyslane.push(`${metoda} ${url}`);
    if (url === "/api/obsluga/wiedza/siec") return new Response(JSON.stringify(dane), { status: 200 });
    throw new Error(`nieoczekiwany adres w teście: ${metoda} ${url}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const pokaz = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Siec />
  </QueryClientProvider>);

describe("Sieć pasowań", () => {
  it("otwarcie niczego nie zapisuje i rysuje dwie wyspy", async () => {
    pokaz();
    await screen.findByRole("group", { name: "Wyspa W09-0211" });
    expect(screen.getByRole("group", { name: "Wyspa WALBRO-7" })).toBeInTheDocument();
    expect(screen.getByText(/3 pasowania · 6 kartotek · 2 wyspy/)).toBeInTheDocument();
    expect(wyslane).toEqual([]);
  });

  it("klik w węzeł pokazuje jego połączenia zdaniem z serwera; drugi klik chowa", async () => {
    const u = userEvent.setup();
    pokaz();
    const wyspa = await screen.findByRole("group", { name: "Wyspa W09-0211" });
    const gaznik = within(wyspa).getByRole("button", { name: /^W09-0211/ });
    await u.click(gaznik);
    const lista = screen.getByRole("region", { name: "Połączenia W09-0211" });
    expect(within(lista).getByText(/LC170430140-0001 pasuje do W09-0211/)).toBeInTheDocument();
    expect(within(lista).getByText(/W53-0202 nie pasuje do W09-0211/)).toBeInTheDocument();
    expect(within(lista).getByText(/podają się nawzajem/)).toBeInTheDocument();
    expect(gaznik).toHaveAttribute("aria-pressed", "true");
    await u.click(gaznik);
    expect(screen.queryByRole("region", { name: "Połączenia W09-0211" })).toBeNull();
    expect(wyslane).toEqual([]);
  });

  it("szukanie zawęża do wysp z trafieniem; bez zamienników EX055 znika z rysunku", async () => {
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("group", { name: "Wyspa W09-0211" });
    await u.type(screen.getByRole("textbox", { name: "Szukaj w sieci" }), "walbro");
    expect(screen.queryByRole("group", { name: "Wyspa W09-0211" })).toBeNull();
    expect(screen.getByRole("group", { name: "Wyspa WALBRO-7" })).toBeInTheDocument();
    await u.clear(screen.getByRole("textbox", { name: "Szukaj w sieci" }));
    expect(screen.getByRole("button", { name: /^EX055/ })).toBeInTheDocument();
    await u.click(screen.getByRole("checkbox", { name: "Zamienniki z opisów" }));
    expect(screen.queryByRole("button", { name: /^EX055/ })).toBeNull();
  });

  it("pusta baza mówi, skąd biorą się pasowania", async () => {
    dane = { wezly: [], krawedzie: [] };
    pokaz();
    await waitFor(() => expect(screen.getByText(/Nie ma jeszcze żadnego pasowania/)).toBeInTheDocument());
  });
});
