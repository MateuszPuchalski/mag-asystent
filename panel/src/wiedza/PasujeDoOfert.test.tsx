import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SprawdzenieOfert, StanPasujeDo } from "../api/typy";
import { PasujeDoOfert } from "./PasujeDoOfert";

/* ── „Pasuje do" z ofert: zbiórka partiami i sprawdzenie ─────────────────────
   Po prawdziwym `fetch`. Otwarcie to wyłącznie odczyt stanu. Zbiórka idzie
   w kolejności lista → partie treści i kończy się, gdy nic nie zostało.
   Limit Allegro to przerwa, nie błąd. „Zatrzymaj" przerywa przed następnym
   żądaniem. Sprawdzenie pokazuje sprzeczność i brak z odnośnikiem do oferty. */

const STAN: StanPasujeDo = { ofert: 120, zKartoteka: 80, zTresca: 30, zListe: 22, pozycji: 410, doZebrania: 50, listaAt: null };
const SPRAWDZENIE: SprawdzenieOfert = { sprawdzonych: 30, bezTresci: 50, sprzecznych: 1, brakujacych: 1, oferty: [
  { konto: 1, ofertaId: "1001", nazwa: "Nóż do kosiarki Hecht", twId: 5, symbol: "NOZ-46", link: "https://allegro.pl/oferta/1001",
    pozycji: 12, sprzeczne: [{ pozycja: "Hecht 1803S", maszyna: "Hecht 1803S", powod: "niewłaściwy rozstaw", warunki: null,
      zrodlo: "nie pasuje do Hecht 1803S: niewłaściwy rozstaw — pomiar własny" }],
    brakujace: [{ maszyna: "Hecht 5484", warunki: "roczniki 2014–2018", zrodlo: "potwierdzone zastosowanie do Hecht 5484" }] }] };

let wyslane: Array<{ url: string; body: unknown }> = [];
let odczyty: string[] = [];
let odpowiedzi: Array<() => Response | Promise<Response>> = [];

const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });

beforeEach(() => {
  wyslane = []; odczyty = []; odpowiedzi = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      odczyty.push(url);
      if (url === "/api/obsluga/wiedza/pasuje-do") return json({ stan: STAN, sprawdzenie: SPRAWDZENIE });
      throw new Error(`nieoczekiwany odczyt: ${url}`);
    }
    wyslane.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const nastepna = odpowiedzi.shift();
    if (!nastepna) throw new Error(`nieoczekiwany zapis: ${url}`);
    return nastepna();
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const pokaz = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PasujeDoOfert />
  </QueryClientProvider>);

const PARTIA = { przejrzano: 10, pobrano: 10, numerow: 3, wpisanych: 7, wKolejce: 2, znanych: 4, sprzecznych: 1, pozostalo: 0, przerwano: null };

describe("„Pasuje do” z ofert Allegro", () => {
  it("otwarcie to wyłącznie odczyt; sprawdzenie pokazuje sprzeczność, brak i odnośnik do oferty", async () => {
    pokaz();
    const oferta = await screen.findByRole("listitem", { name: "Oferta 1001" });
    expect(wyslane).toEqual([]);
    expect(odczyty).toEqual(["/api/obsluga/wiedza/pasuje-do"]);
    expect(screen.getByLabelText("Stan zbiórki")).toHaveTextContent("do zebrania: 50");
    expect(oferta).toHaveTextContent("Lista wymienia „Hecht 1803S”, a wiedza: Hecht 1803S — niewłaściwy rozstaw");
    expect(oferta).toHaveTextContent("Brakuje na liście: Hecht 5484 (tylko: roczniki 2014–2018)");
    expect(within(oferta).getByRole("link", { name: /Nóż do kosiarki Hecht/ })).toHaveAttribute("href", "https://allegro.pl/oferta/1001");
    expect(screen.getByLabelText("Sprawdzenie ofert")).toHaveTextContent("bez pobranej treści: 50");
  });

  it("zbiórka: lista ofert, potem partie treści — i koniec, gdy nic nie zostało", async () => {
    odpowiedzi = [() => json({ zapisano: 120, nastepny: null, razem: 120 }), () => json(PARTIA)];
    const u = userEvent.setup();
    pokaz();
    await u.click(await screen.findByRole("button", { name: /Zbierz z wszystkich ofert/ }));
    expect(await screen.findByText(/Gotowe\. Przejrzano 10 ofert\./)).toBeInTheDocument();
    expect(wyslane.map((w) => [w.url, w.body])).toEqual([
      ["/api/obsluga/wiedza/pasuje-do/lista", { offset: 0 }], ["/api/obsluga/wiedza/pasuje-do/zbierz", null]]);
    expect(screen.getByLabelText("Wynik zbiórki")).toHaveTextContent("zastosowań zapisanych od razu: 7");
    expect(screen.getByLabelText("Wynik zbiórki")).toHaveTextContent("do kolejki „Z opisów i ofert”: 2");
    expect(screen.getByLabelText("Wynik zbiórki")).toHaveTextContent("pominiętych, bo wiedza mówi „nie pasuje”: 1");
  });

  it("limit Allegro to przerwa, nie błąd — po niej zbiórka idzie dalej", async () => {
    odpowiedzi = [() => json({ zapisano: 1, nastepny: null, razem: 1 }),
      () => json({ error: "Allegro prosi o przerwę", poIluMs: 20 }, 429), () => json(PARTIA)];
    const u = userEvent.setup();
    pokaz();
    await u.click(await screen.findByRole("button", { name: /Zbierz z wszystkich ofert/ }));
    expect(await screen.findByText(/Gotowe\./)).toBeInTheDocument();
    expect(wyslane.map((w) => w.url)).toEqual(["/api/obsluga/wiedza/pasuje-do/lista",
      "/api/obsluga/wiedza/pasuje-do/zbierz", "/api/obsluga/wiedza/pasuje-do/zbierz"]);
    expect(screen.queryByText(/Allegro prosi o przerwę$/)).toBeNull();
  });

  it("„Zatrzymaj” przerywa przed następnym żądaniem", async () => {
    let pusc: () => void = () => {};
    odpowiedzi = [() => new Promise<Response>((r) => { pusc = () => r(json({ zapisano: 1000, nastepny: 1000, razem: 5000 })); })];
    const u = userEvent.setup();
    pokaz();
    await u.click(await screen.findByRole("button", { name: /Zbierz z wszystkich ofert/ }));
    await u.click(screen.getByRole("button", { name: /Zatrzymaj/ }));
    pusc();
    expect(await screen.findByText(/Zatrzymano\./)).toBeInTheDocument();
    await waitFor(() => expect(wyslane.map((w) => w.url)).toEqual(["/api/obsluga/wiedza/pasuje-do/lista"]));
  });
});
