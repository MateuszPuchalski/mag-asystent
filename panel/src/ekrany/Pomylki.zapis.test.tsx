import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Pomylki } from "./Pomylki";
import { atrapaZapisow } from "../test/zapisy";
import { pomylka, odczytPomylek } from "../test/pomylki";

/* ── ZERO ZAPISU PRZY OTWARCIU POMYŁEK ──────────────────────────────────────
   Osobny plik, bo patrzy na sam `fetch`, gdzie zapisu nie da się ominąć.
   Wejście z `?id=` rozwija wiersz i czyta jego pozycje, ale niczego nie
   zapisuje — rozwinięcie to patrzenie, a zapis idzie dopiero na klik.
   Blok złapanych przy pakowaniu czyta lustro Sellasist i też nic nie pisze. */

afterEach(() => vi.unstubAllGlobals());

const otworz = (adres: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[adres]}>
    <Pomylki /></MemoryRouter></QueryClientProvider>);
};

it("otwarcie ekranu pomyłek nie wysyła ani jednego zapisu", async () => {
  const stan = atrapaZapisow(odczytPomylek([pomylka()]));
  otworz("/obsluga/pomylki");
  expect(await screen.findByText("jan_kowalski")).toBeInTheDocument();
  expect(await screen.findByRole("region", { name: "Złapane przy pakowaniu" })).toBeInTheDocument();
  expect(stan.nieznane).toEqual([]);
  expect(stan.wyslane).toEqual([]);
});

it("otwarcie z `?id=` rozwija wiersz i dalej nie wysyła zapisu", async () => {
  const stan = atrapaZapisow(odczytPomylek([pomylka()]));
  otworz("/obsluga/pomylki?id=7&miesiac=2026-10");
  expect(await screen.findByRole("group", { name: "Zbierał" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /Lampa LED 12V/ })).toBeInTheDocument();
  expect(stan.nieznane).toEqual([]);
  expect(stan.wyslane).toEqual([]);
});
