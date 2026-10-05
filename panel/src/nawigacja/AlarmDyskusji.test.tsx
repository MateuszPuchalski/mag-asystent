import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LicznikAlarmuDyskusji, PasekAlarmuDyskusji } from "./AlarmDyskusji";

/* ── Pasek alarmu: dyskusja bez odpowiedzi ──────────────────────────────
   Pilnujemy trzech rzeczy: pasek woła dopiero po przekroczeniu progu, mówi
   ile i jak długo, i prowadzi do kolejki. Pasek tylko czyta.

   Reklamacje paska nie mają, decyzją właściciela. Alarm nosi tam czerwony
   licznik zakładki „Dyskusje", więc testy pilnują obu połówek naraz:
   pasek milknie wyłącznie na reklamacjach, a licznik woła wszędzie. */

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

function pokaz(adres = "/", element: React.ReactNode = <PasekAlarmuDyskusji />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={[adres]}>{element}</MemoryRouter></QueryClientProvider>);
}

const ALARM = { czekaNaNas: 3, alarm: { ile: 2, najstarszaGodzin: 50, progGodzin: 24 } };

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

  /* Odpowiedź na zdrowie przychodzi asynchronicznie, więc „nie ma paska"
     sprawdzamy dopiero po tym, jak licznik na tej samej stronie się pokazał.
     Inaczej test przeszedłby, zanim dane w ogóle dojechały. */
  it.each(["/obsluga/reklamacje", "/obsluga/reklamacje/5"])(
    "na reklamacjach (%s) paska nie ma — alarm niesie licznik zakładki", async (adres) => {
      zdrowie = { ...BAZA, dyskusje: ALARM };
      pokaz(adres, <><PasekAlarmuDyskusji /><LicznikAlarmuDyskusji /></>);
      await screen.findByLabelText(/2 dyskusje czekają/);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(zapisy).toEqual([]);
    });

  it("poza reklamacjami pasek dalej woła, np. na zwrotach", async () => {
    zdrowie = { ...BAZA, dyskusje: ALARM };
    pokaz("/obsluga/zwroty");
    expect(await screen.findByRole("alert", { name: "Dyskusje bez odpowiedzi" })).toBeInTheDocument();
  });

  it("adres tylko PODOBNY do reklamacji pasek zostawia", async () => {
    /* Warunek patrzy na cały człon ścieżki, nie na jej początek jako tekst. */
    zdrowie = { ...BAZA, dyskusje: ALARM };
    pokaz("/obsluga/reklamacjex");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("LicznikAlarmuDyskusji", () => {
  it("po progu pokazuje liczbę, a dymek mówi próg, najstarszą i ryzyko blokady", async () => {
    zdrowie = { ...BAZA, dyskusje: ALARM };
    pokaz("/obsluga/reklamacje/5", <LicznikAlarmuDyskusji />);
    const licznik = await screen.findByLabelText(/2 dyskusje czekają/);
    expect(licznik.textContent).toBe("2");
    const opis = licznik.getAttribute("aria-label") ?? "";
    expect(opis).toContain("na odpowiedź dłużej niż 24 godz.");
    expect(opis).toContain("najstarsza 50 godz.");
    expect(opis).toContain("Allegro może zablokować konto");
    expect(licznik.getAttribute("title")).toBe(opis);
    /* Czerwień, nie bursztyn: bursztyn liczy pracę, ten licznik — ryzyko. */
    expect(licznik).toHaveClass("bg-red-600", "text-white");
    expect(zapisy).toEqual([]);
  });

  it("bez alarmu licznika nie ma — ani zera, ani pustej plakietki", async () => {
    zdrowie = { ...BAZA, dyskusje: { czekaNaNas: 2, alarm: null } };
    pokaz("/obsluga/zwroty", <LicznikAlarmuDyskusji />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByLabelText(/dyskusj/)).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("stary serwer bez bloku dyskusji też nie daje licznika", async () => {
    zdrowie = BAZA;
    pokaz("/obsluga/zwroty", <LicznikAlarmuDyskusji />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByLabelText(/dyskusj/)).toBeNull();
  });
});
