import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfilKlienta } from "./ProfilKlienta";
import type { ProfilKlienta as Profil } from "../api/spoiwo";

/* ── PROFIL KLIENTA (24 września 2026) ───────────────────────────────────────
   Pilnujemy: otwarcie niczego nie zapisuje; sygnał „źle" prowadzi do sprawy;
   zamówienie rozwija się do pozycji; notatka zapisuje się na kliknięcie,
   a cofnięcie idzie bez ciała (reguła klienta HTTP); nieznany login to
   zdanie, nie pusty profil. */

const PROFIL: Profil = {
  login: "Chrzanowski1234",
  liczby: { zamowien: 2, wydanoGrosze: 15000, waluta: "PLN", zwrotow: 1, reklamacji: 1, dyskusji: 0,
    rozmow: 1, pierwszyZakup: "2026-08-15T10:00:00Z", ostatniZakup: "2026-09-19T10:00:00Z" },
  sygnaly: [{ ton: "zle", tekst: "Otwarta reklamacja, termin 30.09.2026", cel: "/obsluga/reklamacje/3" }],
  otwarte: [{ rodzaj: "rozmowa", id: 41, opis: "Czy pasuje?", od: "2026-09-23T10:00:00Z",
    stan: "czeka na nas", cel: "/obsluga/skrzynka/41" }],
  zamowienia: [{ id: "z-1", kupionoAt: "2026-09-19T10:00:00Z", status: "READY_FOR_PROCESSING",
    sumaGrosze: 5000, waluta: "PLN", przesylka: "w drodze do klienta", link: "https://allegro.pl/z-1",
    pozycje: [{ nazwa: "Nóż kosiarki HECHT 1803S", ilosc: 1, cenaGrosze: 5000 }] }],
  maszyny: [], os: [], notatka: { tresc: "Prosi o fakturę", at: "2026-09-20T10:00:00Z", przez: "Ola", cofalna: true },
};

let zadania: Array<{ metoda: string; url: string; body: string | null }> = [];
let odpowiedz404 = false;
beforeEach(() => {
  zadania = []; odpowiedz404 = false;
  localStorage.setItem("wertis-panel-token", "t");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    zadania.push({ metoda: init?.method ?? "GET", url, body: (init?.body as string) ?? null });
    if (odpowiedz404) return new Response(JSON.stringify({ error: "Nie znamy klienta o takim loginie" }), { status: 404 });
    if ((init?.method ?? "GET") !== "GET") return new Response(JSON.stringify({ ok: true }));
    return new Response(JSON.stringify(PROFIL));
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pokaz(login = "chrzanowski1234") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/obsluga/klient/${login}`]}>
    <Routes><Route path="/obsluga/klient/:login" element={<ProfilKlienta />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
}

describe("PROFIL KLIENTA", () => {
  it("otwarcie niczego nie zapisuje i pokazuje całego klienta", async () => {
    pokaz();
    expect(await screen.findByText("Chrzanowski1234")).toBeTruthy();
    expect(zadania.every((z) => z.metoda === "GET")).toBe(true);
    expect(zadania[0].url).toBe("/api/obsluga/klient/chrzanowski1234");
    expect(screen.getByRole("link", { name: /Otwarta reklamacja/ })).toHaveAttribute("href", "/obsluga/reklamacje/3");
    expect(within(screen.getByRole("region", { name: "Otwarte sprawy" })).getByText("czeka na nas")).toBeTruthy();
  });

  it("zamówienie rozwija się do pozycji i linku do Allegro", async () => {
    pokaz();
    const z = await screen.findByRole("button", { name: /Nóż kosiarki HECHT 1803S/ });
    await userEvent.click(z);
    expect(screen.getByText("1×")).toBeTruthy();
    expect(screen.getByRole("link", { name: /zamówienie z-1 w Allegro/ })).toBeTruthy();
  });

  it("notatka zapisuje się na kliknięcie, a cofnięcie idzie bez ciała", async () => {
    pokaz();
    const pole = await screen.findByLabelText("Notatka o kliencie", { selector: "textarea" });
    expect(screen.getByRole("button", { name: "ZAPISZ" })).toBeDisabled();
    await userEvent.clear(pole);
    await userEvent.type(pole, "Prosi o fakturę na firmę");
    await userEvent.click(screen.getByRole("button", { name: "ZAPISZ" }));
    const zapis = zadania.find((z) => z.metoda === "POST" && z.url.endsWith("/notatka"));
    expect(JSON.parse(zapis!.body!)).toEqual({ tresc: "Prosi o fakturę na firmę" });
    await userEvent.click(screen.getByRole("button", { name: "Cofnij" }));
    const cofniecie = zadania.find((z) => z.url.endsWith("/notatka/cofnij"));
    expect(cofniecie?.body).toBeNull();
  });

  it("nieznany login mówi to zdaniem", async () => {
    odpowiedz404 = true;
    pokaz("nikt");
    expect(await screen.findByText(/Nie znamy klienta/)).toBeTruthy();
  });
});
