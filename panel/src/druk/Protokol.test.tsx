import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Protokol } from "./Protokol";
import { atrapaZapisow } from "../test/zapisy";

/* ── ZERO ZAPISU PRZY OTWARCIU PROTOKOŁU (@wydanie) ──────────────────────────
   Protokół to osobna trasa panelu (`/obsluga/druk/protokol/:dokId`), a do tego
   wydania nie miał testu wcale. Strona do druku otwiera się też sama z linku,
   więc zapis przy otwarciu poszedłby przy każdym podglądzie wydruku. */

afterEach(() => vi.unstubAllGlobals());

it("otwarcie protokołu nie wysyła ani jednego zapisu", async () => {
  const stan = atrapaZapisow((url) => {
    if (url === "/api/biuro/dokument/77") return { dokId: 77, nrPelny: "FZ 77/2026", dostawca: "GEKO",
      dataWyst: "2026-09-20", deliveryId: null, pozycje: [] };
    if (url === "/api/biuro/firma") return { dane: { nazwa: "WERTIS", nip: "", adres: "", miejscowosc: "",
      osoba: "", telefon: "" }, zmieniono: null };
    return undefined;
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/obsluga/druk/protokol/77"]}>
    <Routes><Route path="/obsluga/druk/protokol/:dokId" element={<Protokol />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText(/nikt nie rozkładał/)).toBeInTheDocument();
  expect(stan.nieznane).toEqual([]);
  expect(stan.wyslane).toEqual([]);
});
