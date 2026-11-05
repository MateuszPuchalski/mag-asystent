import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Zgloszenia } from "./Zgloszenia";
import { atrapaZapisow } from "../test/zapisy";
import { _wyczyscPamiecZdjec } from "../towar/useZdjecie";
import type { Zgloszenie } from "../api/zgloszenia";

/* ── EKRAN ZGŁOSZEŃ WŁAŚCICIELA ─────────────────────────────────────────────
   Pilnujemy: otwarcie nie zapisuje, inna rola dostaje zdanie zamiast listy
   i nie pyta o nią serwera, a decyzja wysyła status z odpowiedzią. */

const LICZNIKI = { nowe: 1, przyjete: 2, zrobione: 5, odrzucone: 0 };

const zgloszenie = (z: Partial<Zgloszenie> = {}): Zgloszenie => ({
  id: 9, rodzaj: "blad", opis: "Drukarka etykiet milczy po wydruku MM.", ekran: "/obsluga/dostawy",
  zrodlo: "kolektor", wersja: "0.618.0", urzadzenie: "TC21-03", at: "2026-11-05T09:30:00.000Z",
  autor: "Janek", status: "nowe", odpowiedz: null, statusAt: null, statusPrzez: null,
  zdjecia: [{ id: 7 }], ...z,
});

let rola = "admin";
let wNowych: Zgloszenie[] = [];
const odczyt = (url: string) => {
  if (url === "/api/auth/me") return { user: { userId: 1, name: "Mateusz", role: rola } };
  if (url === "/api/obsluga/zgloszenia?status=nowe") return { zgloszenia: wNowych, liczniki: LICZNIKI };
  if (url === "/api/obsluga/zgloszenia?status=zrobione") return { zgloszenia: [], liczniki: LICZNIKI };
  /* Bajty obrazu udaje dowolne ciało; adres `blob:` daje zastępnik niżej. */
  if (url === "/api/obsluga/zgloszenia/9/zdjecie/7") return {};
  return undefined;
};

beforeEach(() => {
  rola = "admin";
  wNowych = [zgloszenie()];
  _wyczyscPamiecZdjec();
  /* `URL.createObjectURL` nie istnieje w jsdom — ten sam zastępnik co w dostawach. */
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:zgloszenie";
});
afterEach(() => vi.unstubAllGlobals());

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/obsluga/zgloszenia"]}>
    <Zgloszenia /></MemoryRouter></QueryClientProvider>);
}

describe("ekran zgłoszeń", () => {
  it("otwarcie ekranu zgłoszeń nie wysyła zapisu i pokazuje zgłoszenie ze wszystkim, co niesie", async () => {
    const stan = atrapaZapisow(odczyt);
    pokaz();
    const karta = await screen.findByRole("article", { name: /Nie działa · Janek/ });
    expect(within(karta).getByText("Drukarka etykiet milczy po wydruku MM.")).toBeTruthy();
    expect(within(karta).getByRole("link", { name: "/obsluga/dostawy" })).toBeTruthy();
    expect(within(karta).getByText("Kolektor TC21-03")).toBeTruthy();
    expect(within(karta).getByText("0.618.0")).toBeTruthy();
    expect(await within(karta).findByRole("img", { name: "Zdjęcie 1 ze zgłoszenia" })).toBeTruthy();
    /* Liczniki stoją przy pigułkach, więc właściciel widzi kubełki bez klikania. */
    expect(screen.getByRole("button", { name: "Zrobione 5" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Wszystkie 8" })).toBeTruthy();
    expect(stan.nieznane).toEqual([]);
    expect(stan.wyslane).toEqual([]);
  });

  it("zdjęcie powiększa się po kliknięciu i zamyka kolejnym", async () => {
    atrapaZapisow(odczyt);
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: "Powiększ zdjęcie 1" }));
    expect(screen.getByRole("dialog", { name: "Zdjęcie 1 — powiększenie" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Zamknij powiększenie" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("decyzja wysyła POST ze statusem i odpowiedzią dla autora", async () => {
    const stan = atrapaZapisow(odczyt, () => ({ status: 200, cialo: { zgloszenie: zgloszenie({ status: "przyjete" }) } }));
    pokaz();
    const karta = await screen.findByRole("article", { name: /Janek/ });
    /* Bieżącego statusu nie da się wybrać drugi raz. */
    expect(within(karta).queryByRole("button", { name: "Wróć do nowych" })).toBeNull();
    await userEvent.type(within(karta).getByLabelText(/Odpowiedź dla autora/), " Sprawdzę jutro rano. ");
    await userEvent.click(within(karta).getByRole("button", { name: "Przyjmij" }));
    await vi.waitFor(() => expect(stan.wyslane).toEqual(["POST /api/obsluga/zgloszenia/9/status"]));
    const wywolanie = vi.mocked(fetch).mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(String(wywolanie[1]!.body))).toEqual({ status: "przyjete", odpowiedz: "Sprawdzę jutro rano." });
  });

  it("decyzja bez odpowiedzi wysyła sam status", async () => {
    const stan = atrapaZapisow(odczyt);
    pokaz();
    const karta = await screen.findByRole("article", { name: /Janek/ });
    await userEvent.click(within(karta).getByRole("button", { name: "Odrzuć" }));
    await vi.waitFor(() => expect(stan.wyslane).toHaveLength(1));
    const wywolanie = vi.mocked(fetch).mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(String(wywolanie[1]!.body))).toEqual({ status: "odrzucone" });
  });

  it("skasowana odpowiedź jedzie pustym napisem, bo brak pola zostawia starą", async () => {
    wNowych = [zgloszenie({ odpowiedz: "Sprawdzę jutro." })];
    const stan = atrapaZapisow(odczyt);
    pokaz();
    const karta = await screen.findByRole("article", { name: /Janek/ });
    await userEvent.clear(within(karta).getByLabelText(/Odpowiedź dla autora/));
    await userEvent.click(within(karta).getByRole("button", { name: "Zapisz odpowiedź" }));
    await vi.waitFor(() => expect(stan.wyslane).toHaveLength(1));
    const wywolanie = vi.mocked(fetch).mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(String(wywolanie[1]!.body))).toEqual({ status: "nowe", odpowiedz: "" });
  });

  it("filtr pyta serwer o wybrany status, a pusty kubełek mówi zdaniem", async () => {
    atrapaZapisow(odczyt);
    pokaz();
    await screen.findByRole("article", { name: /Janek/ });
    await userEvent.click(screen.getByRole("button", { name: "Zrobione 5" }));
    expect(await screen.findByText("Brak zgłoszeń z tym statusem.")).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("inna rola dostaje zdanie zamiast listy, bez zapisu i bez pytania o listę", async () => {
    rola = "biuro";
    const stan = atrapaZapisow(odczyt);
    pokaz();
    expect(await screen.findByText(/Zgłoszenia czyta tylko właściciel/)).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).startsWith("/api/obsluga/zgloszenia"))).toBe(false);
    expect(stan.wyslane).toEqual([]);
  });
});
