import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dziennik } from "./Dziennik";
import type { WpisAudytu } from "../api/wglad";

/* ── DZIENNIK w panelu (0.440.0) ─────────────────────────────────────────
   Gwarancje przeniesione z DZIENNIKA w `biuro.html` i dwie nowe:

   1. ZERO ZAPISU PRZY PATRZENIU — otwarcie i filtrowanie to same odczyty.
   2. FILTR DZIAŁA BEZ „SZUKAJ" — zmiana pola sama zmienia zapytanie.
   3. OSOBA z listy kont; jej brak (403) nie wywraca dziennika.
   4. CSV idzie tym samym filtrem co tabela, z sesją w nagłówku.
   5. Doba filtra jest LOKALNA — szczegół w `dziennik/rodziny.test.ts`. */

const wpis = (id: number, o: Partial<WpisAudytu> = {}): WpisAudytu => ({
  id, typ: "putaway_line_done", czas: "2026-09-22T12:31:05.000Z", uzytkownik: "j.wrona", userRef: 3,
  device: "KOL-03", twId: 88, payload: '{"qty":6}', ...o,
});

let adresy: string[] = [];
let zapisy: string[] = [];
let bezKont = false;

beforeEach(() => {
  adresy = []; zapisy = []; bezKont = false;
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:csv";
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    if (metoda !== "GET") zapisy.push(`${metoda} ${url}`);
    adresy.push(url);
    if (url.startsWith("/api/events/csv")) {
      return { ok: true, status: 200, blob: async () => ({}), json: async () => ({}) } as unknown as Response;
    }
    if (url.startsWith("/api/events?")) {
      return new Response(JSON.stringify({
        wpisy: [wpis(2, { typ: "queue_failed", userRef: null, uzytkownik: "system", device: null, twId: null }), wpis(1)],
        razem: 214, typy: ["putaway_line_done", "queue_failed"],
      }), { status: 200 });
    }
    if (url === "/api/users") {
      return bezKont ? new Response(JSON.stringify({ error: "Brak uprawnień" }), { status: 403 })
        : new Response(JSON.stringify({ users: [{ userId: 3, name: "Jan Wrona", role: "magazynier" }] }), { status: 200 });
    }
    throw new Error(`nieoczekiwany adres w teście: ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Dziennik /></QueryClientProvider>);
}

const zapytaniaDziennika = () => adresy.filter((a) => a.startsWith("/api/events?"));

describe("Dziennik w panelu", () => {
  it("otwarcie to same odczyty — i tabela z licznikiem „pokazano N z M”", async () => {
    pokaz();
    await screen.findByText("queue_failed", { selector: "td span" });
    expect(screen.getByText(/pokazano/).textContent).toBe("pokazano 2 z 214 pasujących wpisów");
    expect(zapisy).toEqual([]);
  });

  it("rodzina zdarzenia barwi pastylkę, a konto systemowe dostaje „bez konta”", async () => {
    pokaz();
    const blad = await screen.findByText("queue_failed", { selector: "td span" });
    expect(blad.className).toContain("text-ranga-zle");
    expect(screen.getByText("putaway_line_done", { selector: "td span" }).className).toContain("text-ranga-uwaga");
    expect(within(blad.closest("tr")!).getByText("bez konta")).toBeTruthy();
  });

  it("zmiana filtra sama odpytuje serwer — bez przycisku SZUKAJ", async () => {
    pokaz();
    await screen.findByText("queue_failed", { selector: "td span" });
    expect(screen.queryByRole("button", { name: /szukaj/i })).toBeNull();
    await userEvent.type(screen.getByLabelText("Urządzenie"), "KOL-03");
    await waitFor(() => expect(zapytaniaDziennika().some((a) => a.includes("device=KOL-03"))).toBe(true));
    /* Ćwierć sekundy przerwy: jedno zapytanie na wpisany numer, nie sześć. */
    expect(zapytaniaDziennika().filter((a) => a.includes("device=K")).length).toBeLessThanOrEqual(2);
    expect(zapisy).toEqual([]);
  });

  it("osoba wybrana z listy kont trafia do zapytania jako userRef", async () => {
    pokaz();
    await screen.findByRole("option", { name: "Jan Wrona" });
    await userEvent.selectOptions(screen.getByLabelText("Osoba"), "3");
    await waitFor(() => expect(zapytaniaDziennika().some((a) => a.includes("userRef=3"))).toBe(true));
  });

  it("brak dostępu do listy kont nie wywraca dziennika", async () => {
    bezKont = true;
    pokaz();
    await screen.findByText("queue_failed", { selector: "td span" });
    expect(within(screen.getByLabelText("Osoba")).getAllByRole("option")).toHaveLength(1);
  });

  it("CSV idzie tym samym filtrem co tabela", async () => {
    pokaz();
    await screen.findByText("queue_failed", { selector: "td span" });
    await userEvent.selectOptions(screen.getByLabelText("Wierszy"), "500");
    await waitFor(() => expect(zapytaniaDziennika().some((a) => a.includes("limit=500"))).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(adresy.some((a) => a === "/api/events/csv?limit=500")).toBe(true));
    expect(zapisy).toEqual([]);
  });
});
