import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AlarmDostaw } from "./AlarmDostaw";
import type { Wyjatek } from "../api/dostawy";
import { atrapaZapisow } from "../test/zapisy";

/* ── Alarm problemu w dostawie ──────────────────────────────────────────────
   Pilnujemy czterech rzeczy: stare wyjątki nie krzyczą na nowym stanowisku,
   nowy wyjątek zapala pas, otwarcie dostawy go gasi, a nic nie idzie
   na serwer. */

const KLUCZ = "wertis.alarm-dostaw.widziane";

const wyjatek = (id: number, dokId: number | null, doc = `FZ ${id}/2026`): Wyjatek => ({
  id, deliveryId: 1, lineId: 1, typ: "damaged", typLabel: "Uszkodzone w transporcie",
  qty: 1, symObcy: null, zamiastIlosc: null, qtyDok: 2, opis: null, hasPhoto: false,
  createdAt: "2026-11-20T09:15:00.000Z", createdBy: "Marek", resolvedAt: null,
  resolvedNote: null, resolvedBy: null, docNumber: doc, dokId, sym: "W01-0001",
  name: "Gaźnik", unit: "szt.",
});

let problemy: Wyjatek[] = [];
let stan: ReturnType<typeof atrapaZapisow>;

beforeEach(() => {
  localStorage.clear();
  problemy = [];
  stan = atrapaZapisow((url) => url === "/api/problems/unresolved" ? { problems: problemy } : undefined);
});
afterEach(() => vi.unstubAllGlobals());

function pokaz(adres = "/obsluga/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={[adres]}>
      <AlarmDostaw />
      <Routes>
        <Route path="/obsluga/" element={<p>start</p>} />
        <Route path="/obsluga/dostawy/:id" element={<p>dostawa</p>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);
  return qc;
}

describe("alarm problemu w dostawie", () => {
  it("pierwsze wejście stanowiska zapamiętuje stare wyjątki i milczy", async () => {
    problemy = [wyjatek(1, 10)];
    pokaz();
    await waitFor(() => expect(localStorage.getItem(KLUCZ)).toBe("[1]"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(stan.wyslane).toEqual([]);
  });

  it("nowy wyjątek zapala pas z dostawą i rodzajem problemu", async () => {
    localStorage.setItem(KLUCZ, "[1]");
    problemy = [wyjatek(1, 10), wyjatek(2, 20)];
    pokaz();
    const pas = await screen.findByRole("alert", { name: "Problem w dostawie" });
    expect(pas).toHaveTextContent("Hala zgłosiła problem w dostawie");
    expect(pas).toHaveTextContent("FZ 2/2026");
    expect(pas).toHaveTextContent("Uszkodzone w transporcie W01-0001");
    expect(pas).not.toHaveTextContent("FZ 1/2026");
    expect(stan.wyslane).toEqual([]);
    expect(stan.nieznane).toEqual([]);
  });

  it("klik w dostawę otwiera ją i gasi pas na tym stanowisku", async () => {
    localStorage.setItem(KLUCZ, "[]");
    problemy = [wyjatek(2, 20)];
    pokaz();
    await userEvent.click(await screen.findByRole("link", { name: "FZ 2/2026" }));
    expect(await screen.findByText("dostawa")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(JSON.parse(localStorage.getItem(KLUCZ)!)).toEqual([2]);
    expect(stan.wyslane).toEqual([]);
  });

  it("otwarta inna dostawa nie gasi cudzego alarmu", async () => {
    localStorage.setItem(KLUCZ, "[]");
    problemy = [wyjatek(2, 20)];
    pokaz("/obsluga/dostawy/99");
    expect(await screen.findByRole("alert")).toHaveTextContent("FZ 2/2026");
  });

  it("towar spoza dokumentu prowadzi pod adres „bez”", async () => {
    localStorage.setItem(KLUCZ, "[]");
    problemy = [{ ...wyjatek(3, null, null as unknown as string), docNumber: null }];
    pokaz();
    expect(await screen.findByRole("link", { name: "Towar spoza dokumentu" }))
      .toHaveAttribute("href", "/obsluga/dostawy/bez");
  });
});
