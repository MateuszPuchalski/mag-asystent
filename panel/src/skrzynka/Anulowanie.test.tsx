import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { KartaKontekstu } from "./KartaKontekstu";
import { zdaniePlatnosci } from "./Anulowanie";
import { stanZakupu } from "./zakup";
import type { OsRozmowy, Zamowienie } from "../api/typy";

/* ── Prośba o anulowanie w karcie zakupu ────────────────────────────────────
   Pilnujemy: przycisk do zamówienia stoi wyłącznie przy anulowaniu, także
   w karcie zwiniętej, zdanie o płatności mówi, czy oddać pieniądze, a samo
   pokazanie przycisku niczego nie zapisuje.                                */

const zamowienie = (n: Partial<Zamowienie> = {}): Zamowienie => ({
  externalId: "17147703077", status: "READY_FOR_PROCESSING", platnoscTyp: "ONLINE",
  platnoscAt: "2026-10-02T14:12:00.000Z", kupionoAt: "2026-10-02T14:10:00.000Z",
  sumaGrosze: 8999, waluta: "PLN", pozycje: [], ...n,
} as unknown as Zamowienie);

const dane = (kategoria: string | null, pobrane: Zamowienie | null = zamowienie()): OsRozmowy => ({
  rozmowa: { id: 10, kopilot: kategoria ? { kategoria } : null }, os: [], droga: [], oferta: null,
  zamowienie: { externalId: "17147703077", link: "https://allegro.example/zam", przesylka: null, pobrane },
} as unknown as OsRozmowy);

let zapisy: string[] = [];
beforeEach(() => {
  zapisy = [];
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    zapisy.push(`${init?.method ?? "GET"} ${url}`);
    return new Response("{}");
  }));
});
afterEach(() => vi.unstubAllGlobals());

const pokaz = (d: OsRozmowy) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><KartaKontekstu dane={d} /></MemoryRouter></QueryClientProvider>);

const przycisk = () => screen.queryByRole("link", { name: /Otwórz zamówienie do anulowania/ });

describe("Anulowanie w karcie zakupu", () => {
  it("przy prośbie o anulowanie stoi przycisk do zamówienia i zdanie o zwrocie pieniędzy", () => {
    pokaz(dane("CANCEL_ORDER"));
    expect(przycisk()).toHaveAttribute("href", "https://allegro.example/zam");
    expect(screen.getByRole("group", { name: "Prośba o anulowanie" }))
      .toHaveTextContent("Opłacone 02.10. Po anulowaniu oddaj pieniądze w Allegro.");
    expect(zapisy.filter((z) => !z.startsWith("GET"))).toEqual([]);
  });

  it("przy innej kategorii i bez rozpoznania przycisku nie ma", () => {
    pokaz(dane("ORDER_STATUS"));
    expect(przycisk()).toBeNull();
    pokaz(dane(null));
    expect(przycisk()).toBeNull();
  });

  it("karta zwinięta też pokazuje przycisk", () => {
    window.localStorage.setItem("wertis.skrzynka.karta.zwinieta", "1");
    pokaz(dane("CANCEL_ORDER"));
    expect(screen.getByRole("button", { name: /rozwiń/ })).toHaveAttribute("aria-expanded", "false");
    expect(przycisk()).not.toBeNull();
  });
});

describe("zdaniePlatnosci", () => {
  const zdanie = (z: Zamowienie | null) => zdaniePlatnosci(z, z ? stanZakupu(z, null) : null);

  it("opłacone każe oddać pieniądze", () => {
    expect(zdanie(zamowienie())).toEqual(
      { tekst: "Opłacone 02.10. Po anulowaniu oddaj pieniądze w Allegro.", ton: "zle" });
  });

  it("nieopłacone mówi, że zwrot nie będzie potrzebny", () => {
    expect(zdanie(zamowienie({ status: "BOUGHT", platnoscAt: null })).tekst)
      .toBe("Nieopłacone. Zwrot pieniędzy nie będzie potrzebny.");
  });

  it("za pobraniem przed doręczeniem nie ma czego oddawać", () => {
    expect(zdanie(zamowienie({ platnoscTyp: "CASH_ON_DELIVERY", platnoscAt: null })))
      .toEqual({ tekst: "Za pobraniem. Klient płaci przy odbiorze, więc przed doręczeniem nie ma czego oddawać.", ton: "ok" });
  });

  it("za pobraniem po doręczeniu nie udaje, że nic nie wpłynęło", () => {
    const z = zamowienie({ platnoscTyp: "CASH_ON_DELIVERY", platnoscAt: null });
    const s = stanZakupu(z, { waybill: "JJD1", dostarczonoAt: "2026-10-04T10:00:00.000Z",
      sprawdzonoAt: "2026-10-04T12:00:00.000Z" } as never);
    expect(zdaniePlatnosci(z, s).ton).toBe("zle");
    expect(zdaniePlatnosci(z, s).tekst).toMatch(/już doręczone/);
  });

  it("anulowane już zamówienie mówi to wprost", () => {
    expect(zdanie(zamowienie({ status: "CANCELLED" })).tekst).toBe("Zamówienie jest już anulowane w Allegro.");
  });

  it("bez treści zamówienia nie zgaduje płatności", () => {
    expect(zdanie(null)).toEqual(
      { tekst: "Treść zamówienia jeszcze nie pobrana. Płatność sprawdź w Allegro.", ton: "nic" });
  });
});
