import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ZlecHali, jedynaKartoteka } from "./ZlecHali";

/* ── „Zleć hali" ze sprawy (0.502.0) ───────────────────────────────────────
   Pilnujemy: samo otwarcie niczego nie wysyła, zlecenie niesie źródło
   i numer sprawy, „Anuluj" nie zleca (przycisk bez typu w formularzu
   wysłałby go), a towar jedzie tylko przy jednej znanej kartotece.        */

let zadania: Array<{ metoda: string; cialo: Record<string, unknown> }> = [];
beforeEach(() => {
  zadania = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    zadania.push({ metoda: init?.method ?? "GET", cialo: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ zadanie: { id: 41 } }));
  }));
});
afterEach(() => vi.unstubAllGlobals());

const pokaz = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
  <ZlecHali zrodlo="zwrot" zrodloRef={7} tytul="Zwrot Z-7" twId={501} />
</MemoryRouter></QueryClientProvider>);

describe("Zleć hali", () => {
  it("otwarcie nie wysyła; zlecenie niesie źródło, numer sprawy i towar", async () => {
    pokaz();
    expect(zadania).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /Zleć hali/ }));
    await userEvent.type(screen.getByLabelText("Co ma zrobić hala"), "Zdjęcie pudełka z kosza");
    await userEvent.click(screen.getByRole("button", { name: "Zleć" }));
    expect(await screen.findByText(/Zlecono hali zadanie #41/)).toBeInTheDocument();
    expect(zadania).toHaveLength(1);
    expect(zadania[0].cialo).toMatchObject({ zrodlo: "zwrot", zrodloRef: "7", twId: 501,
      tytul: "Zwrot Z-7", instrukcja: "Zdjęcie pudełka z kosza", priorytet: "normalny" });
  });

  it("„Anuluj” zamyka formularz i niczego nie zleca", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Zleć hali/ }));
    await userEvent.type(screen.getByLabelText("Co ma zrobić hala"), "coś");
    await userEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(zadania).toEqual([]);
    expect(screen.getByRole("button", { name: /Zleć hali/ })).toBeInTheDocument();
  });

  it("towar tylko przy jednej znanej kartotece", () => {
    expect(jedynaKartoteka([5, 5, null])).toBe(5);
    expect(jedynaKartoteka([5, 6])).toBeNull();
    expect(jedynaKartoteka([null])).toBeNull();
  });
});
