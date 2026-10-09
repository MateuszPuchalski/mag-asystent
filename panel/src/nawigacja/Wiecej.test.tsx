import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Wiecej } from "./Wiecej";
import { WskaznikSynchronizacji } from "./Synchronizacja";
import { godzina } from "../ui";
import tsx from "../main.tsx?raw";

/* ── Nagłówek w jednym rzędzie (0.538.0) ───────────────────────────────────
   Pilnujemy: wgląd, ustawienia i wyjście są w menu „Więcej" jeden klik dalej;
   menu zamyka Esc, klik obok i przejście na ekran; przycisk świeci, gdy
   bieżący ekran leży w menu; otwarcie niczego nie zapisuje. Wskaźnik
   synchronizacji w spokoju pokazuje godzinę, a w alarmie słowo „Stanęła". */

const UDANA = "2026-09-27T08:12:00.000Z";
let wyslane: string[] = [];
let alarm = false;
let udana: string | null = UDANA;

beforeEach(() => {
  wyslane = []; alarm = false; udana = UDANA;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "GET") wyslane.push(`${init?.method} ${url}`);
    if (url === "/api/health") return new Response(JSON.stringify({
      allegroInbox: { status: alarm ? "stale" : "current", alarm, ostatniaProba: null,
        ostatniaUdanaSynchronizacja: udana, kodOstatniegoBledu: null, tekstOstatniegoBledu: null,
        liczbaBledow: 2, watkiZBledem: 0, opoznienieMs: null, nastepnaProba: null, interwalMs: 60000 } }));
    throw new Error(`nieoczekiwany adres w teście: ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function Adres() { return <p data-testid="adres">{useLocation().pathname}</p>; }

function pokaz(start = "/obsluga/skrzynka", wyloguj = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[start]}>
    <Wiecej wyloguj={wyloguj} /><WskaznikSynchronizacji /><p>obok</p>
    <Routes><Route path="*" element={<Adres />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
  return { wyloguj, przycisk: screen.getByRole("button", { name: /^Więcej/ }) };
}

describe("menu „Więcej” w nagłówku", () => {
  it("niesie wgląd, ustawienia i wyjście, a otwarcie niczego nie zapisuje", async () => {
    const { przycisk } = pokaz();
    expect(screen.queryByRole("group", { name: "Więcej" })).toBeNull();
    await userEvent.click(przycisk);
    const menu = screen.getByRole("group", { name: "Więcej" });
    for (const nazwa of [/Stan systemu/, /Dziennik/, /Analiza/, /Ustawienia/]) {
      expect(within(menu).getByRole("link", { name: nazwa })).toBeTruthy();
    }
    expect(within(menu).getByRole("button", { name: "Wyloguj" })).toBeTruthy();
    /* Liczba błędów zeszła z paska do menu — ma być jeden klik dalej. */
    expect(await within(menu).findByText(/2 błędów/)).toBeTruthy();
    expect(wyslane).toEqual([]);
  });

  it("zamyka się Esc, klikiem obok i przejściem na ekran", async () => {
    const { przycisk } = pokaz();
    await userEvent.click(przycisk);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Więcej" })).toBeNull();

    await userEvent.click(przycisk);
    await userEvent.click(screen.getByText("obok"));
    expect(screen.queryByRole("group", { name: "Więcej" })).toBeNull();

    await userEvent.click(przycisk);
    await userEvent.click(screen.getByRole("link", { name: /Dziennik/ }));
    expect(screen.getByTestId("adres").textContent).toBe("/obsluga/dziennik");
    expect(screen.queryByRole("group", { name: "Więcej" })).toBeNull();
  });

  it("Wyloguj woła wyjście i zamyka menu", async () => {
    const { przycisk, wyloguj } = pokaz();
    await userEvent.click(przycisk);
    await userEvent.click(screen.getByRole("button", { name: "Wyloguj" }));
    expect(wyloguj).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group", { name: "Więcej" })).toBeNull();
  });

  it("przycisk świeci bursztynem, gdy bieżący ekran leży w menu", () => {
    /* Bez tego agent w dzienniku widzi pasek bez zaznaczonej zakładki. */
    expect(pokaz("/obsluga/dziennik").przycisk.className).toContain("bg-wertis-amber");
  });

  it("na ekranie pracy przycisk nie świeci", () => {
    expect(pokaz("/obsluga/skrzynka").przycisk.className).not.toContain("bg-wertis-amber");
  });

  it("bieżący ekran jest zaznaczony w menu", async () => {
    const { przycisk } = pokaz("/obsluga/ustawienia");
    await userEvent.click(przycisk);
    expect(screen.getByRole("link", { name: "Ustawienia" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /Dziennik/ }).getAttribute("aria-current")).toBeNull();
  });
});

describe("wskaźnik synchronizacji", () => {
  it("w spokoju pokazuje samą godzinę, a pełne zdanie trzyma w dymku", async () => {
    pokaz();
    const wskaznik = await screen.findByRole("status");
    expect(wskaznik.textContent).toBe(godzina(UDANA));
    expect(wskaznik.getAttribute("title")).toBe(`Synchronizacja ${godzina(UDANA)} · 2 błędów`);
  });

  it("przed pierwszą synchronizacją kropka nie jest zielona, a dymek mówi dlaczego", async () => {
    /* Zielone „—" obiecywało działanie, którego nie było (0.546.0). */
    udana = null;
    pokaz();
    const wskaznik = await screen.findByRole("status");
    expect(wskaznik.getAttribute("title")).toBe("Synchronizacja jeszcze się nie odbyła");
    expect(wskaznik.querySelector(".bg-emerald-400")).toBeNull();
    expect(wskaznik.querySelector(".bg-slate-500")).not.toBeNull();
  });

  it("w alarmie mówi słowem „Stanęła”, nie samym kolorem kropki", async () => {
    alarm = true;
    pokaz();
    const wskaznik = await screen.findByRole("status");
    expect(wskaznik.textContent).toBe(`Stanęła ${godzina(UDANA)}`);
  });
});

describe("boczny pasek menu", () => {
  it("nie ma drugiego rzędu ani osobnego paska wglądu", () => {
    expect(tsx).not.toContain('aria-label="Magazyn i wgląd"');
    expect(tsx).not.toContain("px-5 pb-3");
    expect(tsx).toContain("<Wiecej wyloguj={wyloguj} />");
  });

  it("przy powiększeniu 200% zakładki nie wychodzą za kadr", () => {
    /* Poziomy rząd zakładek z `shrink-0` był przy 640 px CSS szerszy od okna.
       jsdom nie liczy układu, więc strażnik pilnuje obu przyczyn: lista może
       się zwęzić i przewinąć, a nazwa zakładki chowa się poniżej 900 px,
       zostając dla czytnika ekranu. */
    const bieznia = tsx.slice(tsx.indexOf('<nav aria-label="Praca"'), tsx.indexOf("</nav>"));
    expect(bieznia).toContain('className="flex min-h-0 flex-1 flex-col');
    expect(bieznia).not.toContain("shrink-0 rounded-lg");
    expect(bieznia).toContain('<span className="max-[899px]:sr-only">{z.etykieta}</span>');
    expect(bieznia).toContain("title={z.etykieta}");
  });

  it("Dostawy są siódmą, ostatnią zakładką pracy, za kreską", () => {
    const zakladki = tsx.slice(tsx.indexOf("const ZAKLADKI"), tsx.indexOf("\n];", tsx.indexOf("const ZAKLADKI")));
    expect(zakladki.match(/\{ do: "/g)).toHaveLength(7);
    expect(zakladki).toMatch(/do: "\/obsluga\/dostawy".*kreska: true/);
  });
});
