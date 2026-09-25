import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KartaKolektorow } from "./Kolektory";

/* ── Zgubiony kolektor w panelu ────────────────────────────────────────
   1. Otwarcie karty to same odczyty — nikt nie dzwoni przez to, że patrzy.
   2. ZADZWOŃ i PRZESTAŃ idą bez ciała (reguła klienta HTTP).
   3. Karta mówi, czy kolektor słyszy: uśpiony, wylogowany i dzwoniący to
      trzy różne zdania, bo szukający inaczej wtedy postępuje.
   4. Wylogowanego nie da się wezwać — i tak by nie zapytał. */

let wyslane: string[] = [];
let kolektory: unknown[] = [];

const ZA_MINUTE = () => new Date(Date.now() + 4 * 60_000).toISOString();

beforeEach(() => {
  wyslane = [];
  kolektory = [
    { deviceId: "kol-a3f9", etykieta: "#A3F9", osoba: "Jan", zalogowany: true,
      ostatnioWidziany: "2026-09-23T08:00:00.000Z", slucha: true, wezwanie: null },
    { deviceId: "kol-0007", etykieta: "#0007", osoba: "Piotr", zalogowany: true,
      ostatnioWidziany: "2026-09-23T06:00:00.000Z", slucha: false, wezwanie: null },
    { deviceId: "kol-bb01", etykieta: "#BB01", osoba: "Ewa", zalogowany: false,
      ostatnioWidziany: "2026-09-22T15:00:00.000Z", slucha: false, wezwanie: null },
    { deviceId: "kol-cc02", etykieta: "#CC02", osoba: "Ola", zalogowany: true,
      ostatnioWidziany: "2026-09-23T08:01:00.000Z", slucha: true,
      wezwanie: { przez: "Anna", od: new Date().toISOString(), doKiedy: ZA_MINUTE(), odebrane: true } },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    const odp = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (metoda !== "GET") {
      const typ = (init?.headers as Record<string, string> | undefined)?.["content-type"];
      wyslane.push(`${metoda} ${url}${init?.body !== undefined ? ` ${init.body}` : ""}${typ ? ` [${typ}]` : ""}`);
      return odp({ ok: true });
    }
    if (url === "/api/kolektory") return odp({ kolektory, ten: null });
    throw new Error(`nieoczekiwany adres w teście: ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><KartaKolektorow /></QueryClientProvider>);
}

const wiersz = (etykieta: string) => screen.getByText(etykieta).closest("tr") as HTMLElement;

describe("Zgubiony kolektor", () => {
  it("otwarcie to same odczyty", async () => {
    pokaz();
    await screen.findByText("#A3F9");
    expect(wyslane).toEqual([]);
  });

  it("stan kolektora zdaniem: słucha, uśpiony, wylogowany, dzwoni", async () => {
    pokaz();
    await screen.findByText("#A3F9");
    expect(within(wiersz("#A3F9")).getByText(/Słucha — zadzwoni od razu/)).toBeInTheDocument();
    expect(within(wiersz("#0007")).getByText(/uśpiony albo bez baterii/)).toBeInTheDocument();
    expect(within(wiersz("#BB01")).getByText(/Wylogowany — nie zadzwoni/)).toBeInTheDocument();
    expect(within(wiersz("#CC02")).getByText(/Dzwoni · wezwał\(a\) Anna/)).toBeInTheDocument();
  });

  it("ZADZWOŃ i PRZESTAŃ idą bez ciała i bez typu treści", async () => {
    pokaz();
    await screen.findByText("#A3F9");
    await userEvent.click(within(wiersz("#A3F9")).getByRole("button", { name: "Zadzwoń na kolektor #A3F9" }));
    await waitFor(() => expect(wyslane).toEqual(["POST /api/kolektory/kol-a3f9/wezwij"]));
    await userEvent.click(within(wiersz("#CC02")).getByRole("button", { name: "Przestań" }));
    await waitFor(() => expect(wyslane).toEqual([
      "POST /api/kolektory/kol-a3f9/wezwij",
      "POST /api/kolektory/kol-cc02/odwolaj",
    ]));
  });

  it("wylogowanego kolektora nie da się wezwać", async () => {
    pokaz();
    await screen.findByText("#BB01");
    expect(within(wiersz("#BB01")).getByRole("button", { name: /Zadzwoń/ })).toBeDisabled();
  });

  it("Zadzwoń nie jest głównym przyciskiem w każdym wierszu", async () => {
    /* Główny przycisk w każdym wierszu to kilka głównych akcji naraz, a po
       ten sięga się rzadko — dlatego drugorzędny (@wydanie). */
    pokaz();
    await screen.findByText("#A3F9");
    const zadzwon = within(wiersz("#A3F9")).getByRole("button", { name: "Zadzwoń na kolektor #A3F9" });
    expect(zadzwon).toHaveClass("btn-secondary");
    expect(zadzwon).not.toHaveClass("btn-primary");
  });
});
