import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WpisWzmianki } from "../api/typy";

/* ── Skrzynka wzmianek (0.160.0) ─────────────────────────────────────────────
   Wzmianka to prośba kolegi o zajęcie się czymś. Ekran pilnuje dwóch rzeczy:
   że nieodhaczone widać bez szukania, i że NIC ich nie kasuje samo — ani
   otwarcie listy, ani przejście do rozmowy. */

const wpis = (n: Partial<WpisWzmianki> = {}): WpisWzmianki => ({
  commentId: 7, conversationId: 4821, klient: "zielony_ogrod", autor: "A. Lewandowska",
  fragment: "@Bogdan zerkniesz na ten szarpak?", at: "2026-09-01T09:12:00.000Z",
  odhaczona: false, odhaczonaAt: null, ...n,
});

const odhacz = vi.fn();
let LISTA: WpisWzmianki[] = [];
/* `PRAWDZIWE` oddaje ekranowi prawdziwe haki nad atrapą `fetch`. Atrapa
   `useOdhaczWzmianke` łapie tylko kliknięcie — odhaczenie wysłane z efektu
   przy otwarciu poszłoby prawdziwą siecią i przeszło obok niej. */
let PRAWDZIWE = false;

vi.mock("../api/rozmowy", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/rozmowy")>("../api/rozmowy");
  return {
    ...rzeczywisty,
    useWzmianki: () => PRAWDZIWE ? rzeczywisty.useWzmianki() : ({
      data: { wzmianki: LISTA, nowe: LISTA.filter((w) => !w.odhaczona).length },
      isLoading: false, error: null,
    }),
    useOdhaczWzmianke: () => PRAWDZIWE ? rzeczywisty.useOdhaczWzmianke()
      : ({ mutate: odhacz, isPending: false }),
  };
});

const { Wzmianki } = await import("./Wzmianki");

const pokaz = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={["/obsluga/wzmianki"]}>
      <Routes>
        <Route path="/obsluga/wzmianki" element={<Wzmianki />} />
        <Route path="/obsluga/skrzynka/:id" element={<p>Rozmowa otwarta</p>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);

beforeEach(() => { PRAWDZIWE = false; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Skrzynka wzmianek", () => {
  it("otwarcie listy to sam odczyt — żadna wzmianka nie gaśnie od spojrzenia", async () => {
    /* Test niżej pilnuje kliknięcia w rozmowę, ale przez atrapę haka. Ten
       idzie przez sieć, więc łapie też zapis z efektu, którego żaden
       przycisk nie woła. */
    PRAWDZIWE = true;
    const zapisy: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const metoda = init?.method ?? "GET";
      if (metoda !== "GET") zapisy.push(`${metoda} ${url}`);
      if (metoda === "GET" && url === "/api/obsluga/wzmianki") {
        return new Response(JSON.stringify({ wzmianki: [wpis()], nowe: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "poza tym testem" }), { status: 404 });
    }));

    pokaz();
    await screen.findByText(/zerkniesz na ten szarpak/);
    expect(zapisy).toEqual([]);
  });

  it("niesie autora, klienta i fragment — czyli to, po czym poznać swoją sprawę", () => {
    LISTA = [wpis()];
    pokaz();
    expect(screen.getByText("A. Lewandowska")).toBeInTheDocument();
    expect(screen.getByText(/zielony_ogrod/)).toBeInTheDocument();
    expect(screen.getByText(/zerkniesz na ten szarpak/)).toBeInTheDocument();
    expect(screen.getByText(/1 do zajęcia się/)).toBeInTheDocument();
  });

  it("odhacza wyłącznie na kliknięcie, a przejście do rozmowy niczego nie kasuje", async () => {
    /* Reguła „zero zapisu przy patrzeniu" obowiązuje też tu. Wzmianka gasnąca
       od samego wejścia w rozmowę ginęłaby wtedy, gdy agent tylko sprawdza,
       czy sprawa jest jego. */
    LISTA = [wpis()];
    odhacz.mockClear();
    pokaz();

    await userEvent.click(screen.getByRole("button", { name: /OTWÓRZ ROZMOWĘ/ }));
    expect(screen.getByText("Rozmowa otwarta")).toBeInTheDocument();
    expect(odhacz).not.toHaveBeenCalled();
  });

  it("kliknięcie ODHACZ oddaje numer komentarza", async () => {
    LISTA = [wpis()];
    odhacz.mockClear();
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /ODHACZ/ }));
    expect(odhacz).toHaveBeenCalledWith({ commentId: 7 }, expect.anything());
  });

  it("odhaczone schodzą z oczu, ale zostają jako dowód pod przełącznikiem", async () => {
    LISTA = [wpis({ odhaczona: true, odhaczonaAt: "2026-09-01T10:00:00.000Z" })];
    pokaz();
    expect(screen.getByText(/Wszystko odhaczone/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: /Pokaż odhaczone/ }));
    expect(screen.getByText(/zerkniesz na ten szarpak/)).toBeInTheDocument();
    expect(screen.getByText(/^odhaczone /)).toBeInTheDocument();
    /* Odhaczonej nie da się odhaczyć drugi raz — przycisku po prostu nie ma. */
    expect(screen.queryByRole("button", { name: /ODHACZ/ })).toBeNull();
  });

  it("pusta skrzynka mówi wprost, że nikt nie prosił o pomoc", () => {
    LISTA = [];
    pokaz();
    expect(screen.getByText(/Nikt Cię jeszcze nie wzmiankował/)).toBeInTheDocument();
  });
});
