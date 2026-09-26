import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { StanPasowaniaZSieci } from "../api/typy";
import { GODZINA_MS, NA_KLIKNIECIE, PasowanieZSieci } from "./PasowanieZSieci";

/* ── Pasowanie z sieci uruchomione ręcznie (0.508.0) ────────────────────────
   Po prawdziwym `fetch`. Otwarcie to wyłącznie odczyt stanu. Wyłączony
   automat mówi, czego brakuje, i nie daje kliknąć. Włączony idzie kartoteka
   po kartotece, najwyżej NA_KLIKNIECIE razy, i staje, gdy nie ma co robić. */

const STAN: StanPasowaniaZSieci = { niegotowy: null, naNoc: 10, sprawdzono: 2, doSprawdzenia: 40, ostatnie: [
  { symbol: "GAZ-MS250", at: "2026-09-25T02:10:00.000Z", wynik: "ok", znalezisk: 3, zaproponowano: 2,
    odrzucone: { numer_spoza_strony: 1 }, blad: null },
] };

let stan: StanPasowaniaZSieci = STAN;
let wyslane: string[] = [];
let wyniki: Array<{ sprawdzono: number; zaproponowano: number; odrzucono?: Record<string, number> }> = [];

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
    return json({ wynik: { bledow: 0, odrzucono: {}, przerwane: null, ...w }, stan });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const pokaz = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PasowanieZSieci />
  </QueryClientProvider>);

describe("pasowanie z sieci na żądanie", () => {
  it("otwarcie tylko czyta: stan, limit i ostatnie przebiegi", async () => {
    pokaz();
    /* Głos agenta, nie księgi (0.510.0): ile jeszcze można, bez „sufitu". */
    const stanKarty = await screen.findByLabelText("Stan pasowania z sieci");
    expect(stanKarty).toHaveTextContent("w limicie zostało 8 z 10");
    expect(stanKarty).not.toHaveTextContent(/sufit|wykorzystane/);
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

  it("wynik mówi o pominiętych znaleziskach słowami agenta, nie „sitem”", async () => {
    wyniki = [{ sprawdzono: 1, zaproponowano: 0, odrzucono: { cytat_spoza_strony: 2 } }, { sprawdzono: 0, zaproponowano: 0 }];
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Sprawdź teraz/ }));
    const wynik = await screen.findByLabelText("Wynik pasowania z sieci");
    await waitFor(() => expect(wynik).toHaveTextContent("pominięte jako niepewne: cytatu nie ma na stronie: 2"));
    expect(wynik).not.toHaveTextContent(/sito/);
  });

  /* Tryb godzinny (0.527.0): ta sama pętla, koniec po czasie albo limicie. */
  it("„przez godzinę” idzie dalej niż trzy kartoteki i mówi, gdy zatrzymał go limit", async () => {
    wyniki = [...Array.from({ length: NA_KLIKNIECIE + 2 }, () => ({ sprawdzono: 1, zaproponowano: 1 })),
      { sprawdzono: 0, zaproponowano: 0 }];
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Sprawdzaj przez godzinę/ }));
    const koniec = await screen.findByLabelText("Koniec przebiegu");
    expect(koniec).toHaveTextContent("wyczerpał się limit");
    expect(koniec).toHaveTextContent("PASOWANIE_Z_SIECI_NA_NOC");
    expect(wyslane).toHaveLength(NA_KLIKNIECIE + 3);
    expect(screen.getByLabelText("Wynik pasowania z sieci")).toHaveTextContent(`propozycji w kolejce: ${NA_KLIKNIECIE + 2}`);
  });

  it("„przez godzinę” kończy się po godzinie, nawet gdy jest co sprawdzać", async () => {
    const start = 1_800_000_000_000;
    /* Zegar skacze za koniec godziny po drugim żądaniu — pętla pyta o czas
       przed każdą kartoteką, więc trzeciego żądania być nie może. */
    const zegar = vi.spyOn(Date, "now").mockImplementation(() => start + (wyslane.length >= 2 ? GODZINA_MS + 1 : 0));
    try {
      wyniki = Array.from({ length: 10 }, () => ({ sprawdzono: 1, zaproponowano: 1 }));
      pokaz();
      await userEvent.click(await screen.findByRole("button", { name: /Sprawdzaj przez godzinę/ }));
      await waitFor(() => expect(screen.getByRole("button", { name: /Sprawdzaj przez godzinę/ })).toBeEnabled());
      expect(wyslane).toHaveLength(2);
      expect(screen.queryByLabelText("Koniec przebiegu")).toBeNull();
    } finally {
      zegar.mockRestore();
    }
  });

  it("gdy nie ma czego sprawdzać, pętla staje po pierwszym pustym kroku", async () => {
    wyniki = [{ sprawdzono: 0, zaproponowano: 0 }];
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Sprawdź teraz/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Sprawdź teraz/ })).toBeEnabled());
    expect(wyslane).toHaveLength(1);
  });
});
