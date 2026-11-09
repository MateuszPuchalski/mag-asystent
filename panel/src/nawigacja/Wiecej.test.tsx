import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Wiecej } from "./Wiecej";
import { WskaznikSynchronizacji } from "./Synchronizacja";
import { godzina } from "../ui";
import tsx from "../main.tsx?raw";

/* ── Nagłówek w jednym rzędzie ─────────────────────────────────────────────
   Pilnujemy: wgląd, ustawienia i wyjście są w menu „Więcej" jeden klik dalej;
   menu zamyka Esc, klik obok i przejście na ekran; przycisk świeci, gdy
   bieżący ekran leży w menu; otwarcie niczego nie zapisuje. Wskaźnik
   synchronizacji w spokoju pokazuje godzinę, a w alarmie słowo „Stanęła". */

const UDANA = "2026-09-27T08:12:00.000Z";
let wyslane: string[] = [];
let alarm = false;
let udana: string | null = UDANA;
let rola = "biuro";

beforeEach(() => {
  wyslane = []; alarm = false; udana = UDANA; rola = "biuro";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "GET") wyslane.push(`${init?.method} ${url}`);
    if (url === "/api/auth/me") return new Response(JSON.stringify({ user: { userId: 1, name: "Ola", role: rola } }));
    if (url === "/api/obsluga/zgloszenia?status=nowe") {
      if (rola !== "admin") return new Response(JSON.stringify({ error: "Tylko właściciel" }), { status: 403 });
      return new Response(JSON.stringify({ zgloszenia: [],
        liczniki: { nowe: 3, przyjete: 0, zrobione: 0, odrzucone: 0 } }));
    }
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
  return { wyloguj, qc, przycisk: screen.getByRole("button", { name: /^Więcej/ }) };
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
    /* Liczba błędów stoi w menu, nie na pasku — jeden klik dalej. */
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

  it("właściciel widzi zgłoszenia pracowników z licznikiem nowych, bez zapisu przy otwarciu", async () => {
    rola = "admin";
    const { przycisk } = pokaz("/obsluga/zgloszenia");
    expect(przycisk.className).toContain("bg-wertis-amber");
    await userEvent.click(przycisk);
    const link = await screen.findByRole("link", { name: /Zgłoszenia pracowników/ });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(await within(link).findByLabelText("nowe zgłoszenia: 3")).toBeTruthy();
    expect(wyslane).toEqual([]);
  });

  it("biuro nie widzi pozycji zgłoszeń i nie pyta o ich listę", async () => {
    const { przycisk, qc } = pokaz();
    await userEvent.click(przycisk);
    await screen.findByRole("link", { name: /Ustawienia/ });
    /* Rola przychodzi z serwera chwilę po otwarciu. Czekamy, aż ODPOWIEDŹ
       stanie w pamięci zapytań, a nie samo wywołanie: przed nią każdy kod
       ukrywa pozycję i test przeszedłby nawet przy złej bramce roli. */
    await vi.waitFor(() => expect(qc.getQueryCache().getAll()
      .some((q) => JSON.stringify(q.state.data ?? null).includes('"role":"biuro"'))).toBe(true));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("link", { name: /Zgłoszenia pracowników/ })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).startsWith("/api/obsluga/zgloszenia"))).toBe(false);
  });

  it("przy awarii listy licznik zgłoszeń mówi „—”, a nie gaśnie jak przy zerze", async () => {
    rola = "admin";
    const zwykly = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => String(url).startsWith("/api/obsluga/zgloszenia")
      ? new Response(JSON.stringify({ error: "awaria" }), { status: 500 }) : zwykly(url, init));
    await userEvent.click(pokaz().przycisk);
    const link = await screen.findByRole("link", { name: /Zgłoszenia pracowników/ });
    expect(await within(link).findByLabelText(/nie wiadomo/)).toBeTruthy();
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
    /* Zielone „—" obiecywałoby działanie, którego nie było. */
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
    const bieznia = tsx.slice(tsx.indexOf('<nav id="pasek-zakladki"'), tsx.indexOf("</nav>"));
    expect(bieznia).toContain('className="flex min-h-0 flex-1 flex-col');
    expect(bieznia).not.toContain("shrink-0 rounded-lg");
    expect(bieznia).toContain('<span className={zwiniety ? "sr-only" : "max-[899px]:sr-only"}>{z.etykieta}</span>');
    expect(bieznia).toContain("title={z.etykieta}");
  });

  it("za kreską stoi praca na kartotece: Dostawy, po nich Zdjęcia, a na końcu Wymiary", () => {
    const zakladki = tsx.slice(tsx.indexOf("const ZAKLADKI"), tsx.indexOf("\n];", tsx.indexOf("const ZAKLADKI")));
    expect(zakladki.match(/\{ do: "/g)).toHaveLength(9);
    expect(zakladki).toMatch(/do: "\/obsluga\/dostawy".*kreska: true/);
    expect(zakladki.indexOf('"/obsluga/zdjecia"')).toBeGreaterThan(zakladki.indexOf('"/obsluga/dostawy"'));
    expect(zakladki).toMatch(/do: "\/obsluga\/zdjecia".*kreska: false/);
    expect(zakladki.indexOf('"/obsluga/wymiary"')).toBeGreaterThan(zakladki.indexOf('"/obsluga/zdjecia"'));
    expect(zakladki).toMatch(/do: "\/obsluga\/wymiary".*kreska: false/);
  });
});
