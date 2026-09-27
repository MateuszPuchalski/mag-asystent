import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Wiedza } from "./Wiedza";
import { atrapaZapisow } from "../test/zapisy";

/* ── ZERO ZAPISU PRZY OTWARCIU WIEDZY (@wydanie) ─────────────────────────────
   Osobny plik z tego samego powodu co `Zadania.zapis.test.tsx`:
   `Wiedza.test.tsx` podmienia moduł `../api/wiedza` dla całego pliku,
   więc zapisu wołanego z pominięciem haka by nie zobaczył. */

afterEach(() => vi.unstubAllGlobals());

it("otwarcie ekranu wiedzy nie wysyła ani jednego zapisu", async () => {
  const stan = atrapaZapisow((url) => {
    if (url === "/api/obsluga/wiedza/kolejka") return { propozycje: [], liczba: 0, pasowania: [],
      pasowanDoRozstrzygniecia: 0, zamiennosciOem: [], zamiennosciOemDoRozstrzygniecia: 0,
      wykazy: [], zSieci: [], zSilnikow: [] };
    if (url === "/api/obsluga/wiedza/z-opisow") return { wiersze: [], liczba: 0 };
    if (url === "/api/obsluga/wiedza/tokeny") return { tokeny: [], nowychRazem: 0 };
    if (url === "/api/obsluga/wiedza/silniki") return { propozycje: [], doRozstrzygniecia: 0,
      luki: [], lukiRazem: 0, zatwierdzone: [], aliasy: [] };
    if (url === "/api/obsluga/wiedza/pasowanie-z-sieci") return { niegotowy: null, naNoc: 10,
      sprawdzono: 0, doSprawdzenia: 0, reczne: { naGodzine: 60, wGodzinie: 0 }, ostatnie: [] };
    return undefined;
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/obsluga/wiedza"]}>
    <Wiedza /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findAllByText(/propozycj/i)).not.toHaveLength(0);
  expect(stan.nieznane).toEqual([]);
  expect(stan.wyslane).toEqual([]);
});
