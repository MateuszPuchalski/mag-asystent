import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PasekPolaczenia } from "./Polaczenie";
import { POLACZENIE_ZERWANE } from "../api/klient";
import { nowyKlientZapytan } from "../api/klient-zapytan";

/* ── Pasek braku połączenia (@wydanie) ────────────────────────────────────────
   Pilnujemy czterech rzeczy: pasek staje, gdy serwer nie odpowiada; staje od
   razu po błędzie DOWOLNEGO zapytania; znika po pierwszej udanej odpowiedzi;
   i nigdy niczego nie zapisuje. */

const ZDROWIE = {
  allegroInbox: { status: "current", alarm: false, ostatniaProba: null,
    ostatniaUdanaSynchronizacja: "2026-09-27T08:12:00.000Z", kodOstatniegoBledu: null,
    tekstOstatniegoBledu: null, liczbaBledow: 0, watkiZBledem: 0, opoznienieMs: null,
    nastepnaProba: null, interwalMs: 60000 },
};

let serwerZyje = true;
let zapisy: string[] = [];

beforeEach(() => {
  serwerZyje = true; zapisy = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "GET") zapisy.push(`${init?.method} ${url}`);
    if (!serwerZyje) throw new TypeError("Failed to fetch");
    if (url === "/api/health") return new Response(JSON.stringify(ZDROWIE));
    throw new Error(`nieoczekiwany adres w teście: ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pokaz(qc: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(<QueryClientProvider client={qc}><PasekPolaczenia /></QueryClientProvider>);
  return qc;
}

describe("pasek braku połączenia", () => {
  it("przy działającym serwerze nie ma paska", async () => {
    pokaz();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("serwer nie odpowiada → pasek mówi, że to brak połączenia, nie brak pracy", async () => {
    serwerZyje = false;
    /* Prawdziwy klient zapytań: ten sam, co w panelu, z tym samym zgłaszaniem. */
    const qc = nowyKlientZapytan();
    qc.setDefaultOptions({ queries: { retry: false } });
    pokaz(qc);
    const pasek = await screen.findByRole("alert");
    expect(pasek).toHaveTextContent("Brak połączenia z serwerem");
    expect(pasek).toHaveTextContent("to brak połączenia, nie brak pracy");
    expect(pasek).toHaveTextContent("Zapis teraz nie przejdzie");
    expect(zapisy).toEqual([]);
  });

  it("błąd połączenia w dowolnym zapytaniu zapala pasek od razu, bez czekania na takt", async () => {
    pokaz();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => { window.dispatchEvent(new Event(POLACZENIE_ZERWANE)); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Brak połączenia z serwerem");
  });

  it("pierwsza udana odpowiedź gasi pasek i odświeża wszystkie zapytania", async () => {
    serwerZyje = false;
    const qc = pokaz();
    await screen.findByRole("alert");
    const odswiez = vi.spyOn(qc, "invalidateQueries");
    serwerZyje = true;
    await userEvent.click(screen.getByRole("button", { name: /Ponów teraz/ }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(odswiez).toHaveBeenCalled();
    expect(zapisy).toEqual([]);
  });
});
