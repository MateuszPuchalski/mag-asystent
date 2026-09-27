import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Zadania } from "./Zadania";
import { atrapaZapisow } from "../test/zapisy";

/* ── ZERO ZAPISU PRZY OTWARCIU ZADAŃ (0.544.0) ──────────────────────────────
   Osobny plik, bo `Zadania.test.tsx` podmienia moduł `../api/rozmowy`,
   a podmiana obowiązuje cały plik. Tamte testy widzą więc tylko haki, które
   same podstawiły. Ten patrzy na `fetch`, gdzie zapisu nie da się ominąć. */

afterEach(() => vi.unstubAllGlobals());

it("otwarcie ekranu zadań nie wysyła ani jednego zapisu", async () => {
  const stan = atrapaZapisow((url) => {
    if (url === "/api/zadania-terenowe") return { zadania: [{
      id: 12, rodzaj: "pomiar", tytul: "Zmierz rozstaw otworów", instrukcja: "Od środka do środka.",
      kontekst: null, twId: null, symbol: null, nazwaTowaru: null, lokalizacja: null,
      priorytet: "normalny", status: "odeslane", utworzonoAt: "2026-09-15T08:00:00.000Z",
      utworzonoPrzez: "A. Lewandowska", przypisanoPrzez: null, wynik: null, wykonanoPrzez: null,
      odeslanoAt: "2026-09-15T09:30:00.000Z", odeslanoPrzez: "M. Kowal", powodKod: "brak_towaru",
      powod: "Półka pusta.", zleconeOdMs: 60_000, zalaczniki: [],
    }] };
    return undefined;
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/obsluga/zadania"]}>
    <Zadania /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText("Zmierz rozstaw otworów")).toBeInTheDocument();
  expect(stan.nieznane).toEqual([]);
  expect(stan.wyslane).toEqual([]);
});
