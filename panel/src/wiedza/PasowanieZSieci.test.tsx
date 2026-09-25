import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { StanPasowaniaZSieci } from "../api/typy";
import { NA_KLIKNIECIE, PasowanieZSieci } from "./PasowanieZSieci";

/* ── Pasowanie z sieci uruchomione ręcznie (@wydanie) ────────────────────────
   Po prawdziwym `fetch`. Otwarcie to wyłącznie odczyt stanu. Wyłączony
   automat mówi, czego brakuje, i nie daje kliknąć. Włączony idzie kartoteka
   po kartotece, najwyżej NA_KLIKNIECIE razy, i staje, gdy nie ma co robić. */

const STAN: StanPasowaniaZSieci = { niegotowy: null, naNoc: 10, sprawdzono: 2, doSprawdzenia: 40, ostatnie: [
  { symbol: "GAZ-MS250", at: "2026-09-25T02:10:00.000Z", wynik: "ok", znalezisk: 3, zaproponowano: 2,
    odrzucone: { numer_spoza_strony: 1 }, blad: null },
] };

let stan: StanPasowaniaZSieci = STAN;
let wyslane: string[] = [];
let wyniki: Array<{ sprawdzono: number; zaproponowano: number }> = [];

const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });

beforeEach(() => {
  stan = STAN; wyslane = []; wyniki = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      if (url === "/api/obsluga/wiedza/pasowanie-z-sieci") return json(stan);
      throw new Error(`nieoczekiwany odczyt: ${url}`);
    }
    wyslane.push(url);
    const w = wyniki.shift() ?? { sprawdzono: 0, zaproponowano: 0 };
    return json({ wynik: { ...w, bledow: 0, odrzucono: {}, przerwane: null }, stan });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const pokaz = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PasowanieZSieci />
  </QueryClientProvider>);

describe("pasowanie z sieci na żądanie", () => {
  it("otwarcie tylko czyta: stan, sufit i ostatnie przebiegi", async () => {
    pokaz();
    expect(await screen.findByLabelText("Stan pasowania z sieci")).toHaveTextContent("zostało 8");
    expect(screen.getByLabelText("Ostatnio sprawdzone")).toHaveTextContent("naszego numeru nie ma na stronie: 1");
    expect(wyslane).toEqual([]);
  });

  it("wyłączony automat mówi, czego brakuje, i nie daje kliknąć", async () => {
    stan = { ...STAN, niegotowy: "Pasowanie z sieci jest wyłączone — włącza je PASOWANIE_Z_SIECI=1 w ustawieniach." };
    pokaz();
    expect(await screen.findByRole("note")).toHaveTextContent("PASOWANIE_Z_SIECI=1");
    expect(screen.getByRole("button", { name: /Sprawdź teraz/ })).toBeDisabled();
  });

  it("kliknięcie idzie kartoteka po kartotece i sumuje wynik", async () => {
    wyniki = Array.from({ length: NA_KLIKNIECIE }, () => ({ sprawdzono: 1, zaproponowano: 2 }));
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Sprawdź teraz/ }));
    await waitFor(() => expect(wyslane).toHaveLength(NA_KLIKNIECIE));
    expect(new Set(wyslane)).toEqual(new Set(["/api/obsluga/wiedza/pasowanie-z-sieci/sprawdz"]));
    expect(await screen.findByLabelText("Wynik pasowania z sieci")).toHaveTextContent(`propozycji w kolejce: ${2 * NA_KLIKNIECIE}`);
  });

  it("gdy nie ma czego sprawdzać, pętla staje po pierwszym pustym kroku", async () => {
    wyniki = [{ sprawdzono: 0, zaproponowano: 0 }];
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Sprawdź teraz/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Sprawdź teraz/ })).toBeEnabled());
    expect(wyslane).toHaveLength(1);
  });
});
