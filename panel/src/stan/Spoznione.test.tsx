import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlakietkaSpoznien } from "./Spoznione";

/* ── Plakietka spóźnień w nagłówku (0.446.0) ──────────────────────────────
   Gwarancje przeniesione z testu „spóźniona sprawa ma własną plakietkę
   i drogę do treści" (0.364.0) w dawnym `routes/biuro.test.ts`: okno stałe,
   droga do karty, zero znaczy brak plakietki. */

let adresy: string[] = [];
function pokaz(spoznionychRazem: number) {
  adresy = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    adresy.push(url);
    return new Response(JSON.stringify({ dni: 30, minSpraw: 5, spoznionychRazem, kanaly: [] }));
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><PlakietkaSpoznien /></MemoryRouter></QueryClientProvider>);
}
afterEach(() => vi.unstubAllGlobals());

describe("PlakietkaSpoznien", () => {
  it("liczy z okna stałego i prowadzi do karty wymiany", async () => {
    pokaz(3);
    const link = await screen.findByRole("link", { name: /3 spóźnione sprawy/ });
    expect(link.getAttribute("href")).toBe("/obsluga/stan?karta=wymiana");
    expect(adresy).toEqual(["/api/biuro/alarm-wymiany"]);
  });

  it("zero spóźnionych to brak plakietki", async () => {
    const { container } = pokaz(0);
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
  });
});
