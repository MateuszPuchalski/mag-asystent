import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SzukajIKlawisze } from "./Klawisze";

/* ── Ctrl+K i lista skrótów pod `?` (23 września 2026) ───────────────────────
   Pilnujemy: Ctrl+K otwiera szukanie z każdego miejsca, także z pola; Enter
   na wyniku prowadzi na ekran sprawy; `?` w polu tekstowym jest znakiem,
   nie skrótem; sekcja bieżącego ekranu stoi na liście skrótów pierwsza po
   klawiszach „wszędzie"; i okno szukania wysyła wyłącznie GET. */

let zadania: string[] = [];
beforeEach(() => {
  zadania = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    zadania.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify({ trafienia: [
      { rodzaj: "zwrot", id: "12", tytul: "Zwrot ZW-1 chips20", dlaczego: "list przewozowy",
        cel: "/obsluga/zwroty/12", link: null },
      { rodzaj: "rozmowa", id: "41", tytul: "gdzie paczka", dlaczego: "numer zamówienia",
        cel: "/obsluga/skrzynka/41", link: null },
    ] }));
  }));
});
afterEach(() => vi.unstubAllGlobals());

function Adres() { return <p data-testid="adres">{useLocation().pathname}</p>; }

function pokaz(start = "/obsluga/zwroty") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[start]}>
    <SzukajIKlawisze /><input aria-label="notatka" />
    <Routes><Route path="*" element={<Adres />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
}

describe("szukanie Ctrl+K", () => {
  it("otwiera się z pola tekstowego, a strzałka i Enter prowadzą na ekran sprawy", async () => {
    pokaz();
    screen.getByLabelText("notatka").focus();
    await userEvent.keyboard("{Control>}k{/Control}");
    const okno = await screen.findByRole("dialog", { name: "Szukaj wszędzie" });
    await userEvent.type(within(okno).getByRole("combobox"), "RET998");
    expect(await within(okno).findByText("gdzie paczka")).toBeTruthy();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByTestId("adres").textContent).toBe("/obsluga/skrzynka/41");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(zadania.every((z) => z.startsWith("GET /api/obsluga/szukaj?q="))).toBe(true);
  });

  it("dwa znaki nie odpytują serwera", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Szukaj/ }));
    await userEvent.type(screen.getByRole("combobox"), "zw");
    await new Promise((r) => setTimeout(r, 300));
    expect(zadania).toEqual([]);
  });
});

describe("lista skrótów pod ?", () => {
  it("`?` otwiera listę, a sekcja bieżącego ekranu stoi zaraz po klawiszach ogólnych", async () => {
    pokaz("/obsluga/zwroty/5");
    await userEvent.keyboard("?");
    const okno = screen.getByRole("dialog", { name: "Skróty klawiszowe" });
    const sekcje = within(okno).getAllByRole("region").map((s) => s.getAttribute("aria-label"));
    expect(sekcje.slice(0, 3)).toEqual(["Wszędzie", "Każda kolejka", "Zwroty"]);
    expect(within(okno).getByText(/tu jesteś/)).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("`?` wpisany w polu jest znakiem, nie skrótem", async () => {
    pokaz();
    await userEvent.type(screen.getByLabelText("notatka"), "czy?");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
