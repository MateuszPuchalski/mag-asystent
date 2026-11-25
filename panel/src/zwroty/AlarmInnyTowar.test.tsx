import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AlarmInnyTowar } from "./AlarmInnyTowar";
import type { ZwrotInnyTowar } from "./powodInnyTowar";
import { atrapaZapisow } from "../test/zapisy";

/* ── Alarm „inny towar" ─────────────────────────────────────────────────────
   Stare zwroty nie krzyczą na nowym stanowisku, nowy zapala pas z numerem
   i słowami klienta, otwarcie zwrotu go gasi, a nic nie idzie na serwer. */

const KLUCZ = "wertis.alarm-inny-towar.widziane";

const zwrot = (id: number): ZwrotInnyTowar => ({
  id, numer: `ZW/${id}`, utworzono: "2026-11-20T09:00:00.000Z",
  pozycje: ["Szarpak"], komentarz: "dostałem kosę",
});

let zwroty: ZwrotInnyTowar[] = [];
let stan: ReturnType<typeof atrapaZapisow>;

beforeEach(() => {
  localStorage.clear();
  zwroty = [];
  stan = atrapaZapisow((url) => url === "/api/obsluga/zwroty/alarm-inny-towar" ? { zwroty } : undefined);
});
afterEach(() => vi.unstubAllGlobals());

function pokaz(adres = "/obsluga/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={[adres]}>
      <AlarmInnyTowar />
      <Routes>
        <Route path="/obsluga/" element={<p>start</p>} />
        <Route path="/obsluga/zwroty/:id" element={<p>zwrot</p>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);
}

describe("alarm „inny towar”", () => {
  it("pierwsze wejście stanowiska zapamiętuje stare zwroty i milczy", async () => {
    zwroty = [zwrot(1)];
    pokaz();
    await waitFor(() => expect(localStorage.getItem(KLUCZ)).toBe("[1]"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(stan.wyslane).toEqual([]);
  });

  it("nowy zwrot zapala pas z numerem i słowami klienta", async () => {
    localStorage.setItem(KLUCZ, "[1]");
    zwroty = [zwrot(1), zwrot(2)];
    pokaz();
    const pas = await screen.findByRole("alert");
    expect(pas).toHaveTextContent("inny towar");
    expect(pas).toHaveTextContent("ZW/2");
    expect(pas).toHaveTextContent("dostałem kosę");
    expect(pas).not.toHaveTextContent("ZW/1");
  });

  it("otwarcie zwrotu gasi pas i zapamiętuje go na stanowisku", async () => {
    localStorage.setItem(KLUCZ, "[1]");
    zwroty = [zwrot(1), zwrot(2)];
    pokaz("/obsluga/zwroty/2");
    await waitFor(() => expect(localStorage.getItem(KLUCZ)).toBe("[1,2]"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(stan.wyslane).toEqual([]);
  });
});
