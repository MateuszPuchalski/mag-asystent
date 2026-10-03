import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PasekAlarmuDyskusji } from "./AlarmDyskusji";

/* ── Pasek alarmu: dyskusja bez odpowiedzi ──────────────────────────────
   Pilnujemy trzech rzeczy: pasek woła dopiero po przekroczeniu progu, mówi
   ile i jak długo, i prowadzi do kolejki. Pasek tylko czyta. */

const BAZA = {
  allegroInbox: { status: "current", alarm: false, ostatniaProba: null,
    ostatniaUdanaSynchronizacja: "2026-10-03T08:00:00.000Z", kodOstatniegoBledu: null,
    tekstOstatniegoBledu: null, liczbaBledow: 0, watkiZBledem: 0, opoznienieMs: null,
    nastepnaProba: null, interwalMs: 60000 },
};

let zdrowie: Record<string, unknown> = BAZA;
let zapisy: string[] = [];

beforeEach(() => {
  zapisy = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "GET") zapisy.push(`${init?.method} ${url}`);
    if (url === "/api/health") return new Response(JSON.stringify(zdrowie));
    throw new Error(`nieoczekiwany adres w teście: ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><PasekAlarmuDyskusji /></MemoryRouter></QueryClientProvider>);
}

describe("PasekAlarmuDyskusji", () => {
  it("milczy, gdy żadna dyskusja nie przekroczyła progu", async () => {
    zdrowie = { ...BAZA, dyskusje: { czekaNaNas: 2, alarm: null } };
    pokaz();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("milczy też ze starego serwera, który nie zna bloku dyskusji", async () => {
    zdrowie = BAZA;
    pokaz();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("woła po progu: ile czeka, od jak dawna i dokąd iść", async () => {
    zdrowie = { ...BAZA, dyskusje: { czekaNaNas: 3, alarm: { ile: 2, najstarszaGodzin: 50, progGodzin: 24 } } };
    pokaz();
    const pasek = await screen.findByRole("alert", { name: "Dyskusje bez odpowiedzi" });
    expect(pasek.textContent).toContain("2 dyskusje czekają na odpowiedź dłużej niż 24 godz.");
    expect(pasek.textContent).toContain("najstarsza 50 godz.");
    expect(screen.getByRole("link", { name: "Otwórz dyskusje" }).getAttribute("href")).toBe("/obsluga/dyskusje");
    expect(zapisy).toEqual([]);
  });

  it.each([[1, "1 dyskusja czeka"], [2, "2 dyskusje czekają"], [5, "5 dyskusji czeka"],
    [12, "12 dyskusji czeka"], [22, "22 dyskusje czekają"]])(
    "odmienia trzy formy: %i → „%s”", async (ile, oczekiwane) => {
      zdrowie = { ...BAZA, dyskusje: { czekaNaNas: ile, alarm: { ile, najstarszaGodzin: 30, progGodzin: 24 } } };
      pokaz();
      const pasek = await screen.findByRole("alert");
      expect(pasek.textContent).toContain(oczekiwane);
    });

  it("nie ma przycisku zamknięcia: alarm znika dopiero z odpowiedzią", async () => {
    zdrowie = { ...BAZA, dyskusje: { czekaNaNas: 1, alarm: { ile: 1, najstarszaGodzin: 30, progGodzin: 24 } } };
    pokaz();
    await screen.findByRole("alert");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
