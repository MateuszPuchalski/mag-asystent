import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SKROTY, SzukajIKlawisze } from "./Klawisze";
import zrodloSzkicu from "../skrzynka/SzkicCopilota.tsx?raw";

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

describe("stan okna idzie za polem, nie za zapytaniem sprzed pauzy", () => {
  it("wyczyszczone pole nie pokazuje wyniku starej frazy (zrzut 24 września 2026)", async () => {
    pokaz();
    await userEvent.keyboard("{Control>}k{/Control}");
    const pole = screen.getByRole("combobox");
    await userEvent.type(pole, "RET998");
    await screen.findByText("gdzie paczka");
    await userEvent.clear(pole);
    expect(screen.getByText("Wpisz co najmniej trzy znaki.")).toBeTruthy();
    expect(screen.queryByText("gdzie paczka")).toBeNull();
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

describe("opis skrótu idzie za napisem przycisku", () => {
  it("E w skrzynce opisuje „Wstaw do odpowiedzi”, nie dawne „popraw” (0.515.0)", () => {
    /* Przycisk pod E od 0.500.0 nazywa skutek, a lista pod `?` dalej
       obiecywała poprawianie. Czytamy napis ze źródła karty, żeby kolejna
       zmiana napisu bez zmiany opisu wywróciła ten test. */
    expect(zrodloSzkicu).toContain('"Wstaw do odpowiedzi"');
    const skrzynka = SKROTY.find((s) => s.tytul === "Skrzynka")!;
    const opis = skrzynka.klawisze.find(([k]) => k === "E")?.[1];
    expect(opis).toMatch(/^wstaw .*do odpowiedzi$/);
    expect(opis).not.toMatch(/popraw/);
  });
});
