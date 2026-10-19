import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ZlaPaczka } from "./ZlaPaczka";
import { atrapaZapisow } from "../test/zapisy";
import { pomylka } from "../test/pomylki";

/* „Zła paczka” wysyła konto kanału, gdy ekran je zna: numer zamówienia jest
   unikalny tylko na koncie, a pomyłka bez konta nie staje na drodze zakupu. */

afterEach(() => vi.unstubAllGlobals());

function Gdzie() { return <p>{useLocation().search}</p>; }

function pokaz(konto?: number | null) {
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/obsluga/zwroty/1"]}><Routes>
    <Route path="/obsluga/zwroty/1" element={<ZlaPaczka login="jan" zamowienie="ord-1" konto={konto} />} />
    <Route path="/obsluga/pomylki" element={<Gdzie />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

const ciala = () => (vi.mocked(fetch).mock.calls as Array<[string, RequestInit?]>)
  .filter(([, i]) => i?.method === "POST").map(([u, i]) => [u, JSON.parse(String(i!.body))]);

it("otwarcie niczego nie zapisuje, a klik wysyła login, zamówienie i konto", async () => {
  const stan = atrapaZapisow(() => undefined, () => ({ status: 201, cialo: { pomylka: pomylka({ id: 4 }) } }));
  pokaz(3);
  expect(stan.wyslane).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Zła paczka" }));
  expect(await screen.findByText("?id=4&miesiac=2026-10")).toBeInTheDocument();
  expect(ciala()).toEqual([["/api/pomylki", { login: "jan", zamowienie: "ord-1", konto: 3 }]]);
});

it("bez znanego konta pola nie ma w ciele — serwer dobiera je po zamówieniu", async () => {
  atrapaZapisow(() => undefined, () => ({ status: 201, cialo: { pomylka: pomylka({ id: 4 }) } }));
  pokaz(null);
  fireEvent.click(screen.getByRole("button", { name: "Zła paczka" }));
  await waitFor(() => expect(ciala()).toEqual([["/api/pomylki", { login: "jan", zamowienie: "ord-1" }]]));
});
