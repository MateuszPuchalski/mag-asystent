import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { StanPasowaniaZSieci } from "../api/typy";
import { GODZINA_MS, PasowanieZSieci } from "./PasowanieZSieci";

/* ── Szukanie w sieci na żądanie ────────────────────────────────────────────
   Po prawdziwym `fetch`. Otwarcie to wyłącznie odczyt stanu. Wyłączony
   automat mówi, czego brakuje, i nie daje kliknąć. Od 0.528.0 jest JEDEN
   przycisk: godzina z „Zatrzymaj”, liczona w limicie ręcznym, nie nocnym. */

const STAN: StanPasowaniaZSieci = { niegotowy: null, naNoc: 10, sprawdzono: 10, doSprawdzenia: 40,
  reczne: { naGodzine: 60, wGodzinie: 5 }, ostatnie: [
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

describe("szukanie w sieci na żądanie", () => {
  it("otwarcie tylko czyta; limit to limit ręczny na godzinę, nie limit nocy", async () => {
    pokaz();
    /* Noc wyczerpana (10 z 10), a ręczne dalej może — to był cały powód zmiany. */
    const stanKarty = await screen.findByLabelText("Stan pasowania z sieci");
    expect(stanKarty).toHaveTextContent("w tej godzinie zostało 55 z 60");
    expect(stanKarty).not.toHaveTextContent(/sufit|wykorzystane/);
    expect(screen.getByRole("button", { name: /Szukaj w sieci/ })).toBeEnabled();
    expect(screen.getByLabelText("Ostatnio sprawdzone")).toHaveTextContent("naszego numeru nie ma na stronie: 1");
    expect(wyslane).toEqual([]);
  });

  it("jest jeden przycisk startu — nie trzeba wybierać trybu", async () => {
    pokaz();
    await screen.findByLabelText("Stan pasowania z sieci");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("wyłączony automat mówi, czego brakuje, i nie daje kliknąć", async () => {
    stan = { ...STAN, niegotowy: "Pasowanie z sieci jest wyłączone — włącza je PASOWANIE_Z_SIECI=1 w ustawieniach." };
    pokaz();
    expect(await screen.findByRole("note")).toHaveTextContent("PASOWANIE_Z_SIECI=1");
    expect(screen.getByRole("button", { name: /Szukaj w sieci/ })).toBeDisabled();
  });

  it("idzie kartoteka po kartotece, sumuje wynik i mówi, gdy zatrzymał go limit", async () => {
    wyniki = [...Array.from({ length: 5 }, () => ({ sprawdzono: 1, zaproponowano: 1 })), { sprawdzono: 0, zaproponowano: 0 }];
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Szukaj w sieci/ }));
    const koniec = await screen.findByLabelText("Koniec przebiegu");
    expect(koniec).toHaveTextContent("wyczerpał się limit (60 kartotek na godzinę)");
    /* Rada „podnieś ustawienie” odeszła razem z limitem nocy przy ręcznym szukaniu. */
    expect(koniec).not.toHaveTextContent("PASOWANIE_Z_SIECI_NA_NOC");
    expect(wyslane).toHaveLength(6);
    expect(new Set(wyslane)).toEqual(new Set(["/api/obsluga/wiedza/pasowanie-z-sieci/sprawdz"]));
    expect(screen.getByLabelText("Wynik pasowania z sieci")).toHaveTextContent("nowych propozycji: 5");
  });

  it("wynik mówi o pominiętych znaleziskach słowami agenta, nie „sitem”", async () => {
    wyniki = [{ sprawdzono: 1, zaproponowano: 0, odrzucono: { cytat_spoza_strony: 2 } }, { sprawdzono: 0, zaproponowano: 0 }];
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Szukaj w sieci/ }));
    const wynik = await screen.findByLabelText("Wynik pasowania z sieci");
    await waitFor(() => expect(wynik).toHaveTextContent("pominięte jako niepewne: cytatu nie ma na stronie: 2"));
    expect(wynik).not.toHaveTextContent(/sito/);
  });

  it("kończy się po godzinie, nawet gdy jest co sprawdzać", async () => {
    const start = 1_800_000_000_000;
    /* Zegar skacze za koniec godziny po drugim żądaniu — pętla pyta o czas
       przed każdą kartoteką, więc trzeciego żądania być nie może. */
    const zegar = vi.spyOn(Date, "now").mockImplementation(() => start + (wyslane.length >= 2 ? GODZINA_MS + 1 : 0));
    try {
      wyniki = Array.from({ length: 10 }, () => ({ sprawdzono: 1, zaproponowano: 1 }));
      pokaz();
      await userEvent.click(await screen.findByRole("button", { name: /Szukaj w sieci/ }));
      await waitFor(() => expect(screen.getByRole("button", { name: /Szukaj w sieci/ })).toBeEnabled());
      expect(wyslane).toHaveLength(2);
      expect(screen.queryByLabelText("Koniec przebiegu")).toBeNull();
    } finally {
      zegar.mockRestore();
    }
  });

  it("gdy nie ma czego sprawdzać, pętla staje po pierwszym pustym kroku", async () => {
    wyniki = [{ sprawdzono: 0, zaproponowano: 0 }];
    stan = { ...STAN, doSprawdzenia: 1 };
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Szukaj w sieci/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Szukaj w sieci/ })).toBeEnabled());
    expect(wyslane).toHaveLength(1);
  });
});

/* Błędy silników na karcie (@wydanie): „błędów: 3” bez słowa, co się stało,
   zostawiało właściciela ze zrzutem ekranu i bez przyczyny. */
describe("błąd przebiegu jest widoczny", () => {
  it("silnik z błędem stoi w „Ostatnio sprawdzone”, a wynik mówi, jaki to błąd", async () => {
    stan = { ...STAN, ostatnie: [
      { rodzaj: "silnik", symbol: "Briggs & Stratton Sprint", at: "2026-09-26T12:10:00.000Z", wynik: "blad",
        znalezisk: 0, zaproponowano: 0, odrzucone: {}, blad: "invalid_request_error 400: prompt is too long" },
      ...STAN.ostatnie] };
    /* Atrapa oddaje błąd w pierwszym kroku, pusty w drugim. */
    let krok = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return json(stan);
      krok += 1;
      return json({ wynik: { sprawdzono: 0, zaproponowano: 0, bledow: krok === 1 ? 1 : 0, odrzucono: {}, przerwane: null }, stan });
    }));
    pokaz();
    const lista = await screen.findByLabelText("Ostatnio sprawdzone");
    expect(lista).toHaveAttribute("open");
    expect(lista).toHaveTextContent("silnik Briggs & Stratton Sprint");
    await userEvent.click(screen.getByRole("button", { name: /Szukaj w sieci/ }));
    expect(await screen.findByLabelText("Ostatni błąd")).toHaveTextContent("prompt is too long");
  });
});
