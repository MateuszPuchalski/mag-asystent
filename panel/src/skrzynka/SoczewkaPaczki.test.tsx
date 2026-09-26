import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Kategoria, OsRozmowy } from "../api/typy";
import { Kontekst } from "./Kontekst";

/* ── ZERO ZAPISU PRZY PATRZENIU, NA PRAWDZIWYCH HAKACH (0.531.0) ───────────
   Soczewka paczki stoi przy najczęstszym pytaniu skrzynki i trzyma przycisk,
   który pyta Allegro. Testy obok podmieniają hak, więc nie widzą sieci. Ten
   plik stawia całą kolumnę kontekstu na prawdziwym kliencie zapytań i liczy
   żądania: przy otwarciu wyłącznie GET, a POST sprawdzenia dopiero po
   kliknięciu — i bez ciała, bo pusty JSON to `FST_ERR_CTP_EMPTY_JSON_BODY`. */

let zadania: Array<{ metoda: string; url: string; body: unknown; typ: string | null }> = [];

beforeEach(() => {
  zadania = [];
  localStorage.setItem("wertis-panel-token", "t");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const naglowki = new Headers(init?.headers);
    zadania.push({ metoda: init?.method ?? "GET", url, body: init?.body ?? null,
      typ: naglowki.get("content-type") });
    if (url.endsWith("/klient")) return new Response(JSON.stringify({ login: "k", wpisy: [], maszyny: [] }));
    if (url.endsWith("/dobor/wiedza")) {
      return new Response(JSON.stringify({ zastosowanie: null, zabudowa: null, pasowanie: null,
        silniki: [], silnikZPola: null, pomiary: [] }));
    }
    if (url.endsWith("/przesylka")) {
      return new Response(JSON.stringify({ waybill: "X1", przewoznik: "DPD", status: "IN_TRANSIT",
        dostarczonoAt: null, sprawdzonoAt: new Date().toISOString() }));
    }
    return new Response(JSON.stringify({}));
  }));
});
afterEach(() => vi.unstubAllGlobals());

const dane = (kategoria: Kategoria): OsRozmowy => ({
  rozmowa: {
    id: 51, klient: "k", ostatniaWiadomosc: "", ostatniaWiadomoscAt: "", ostatniaOdKlienta: true,
    nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1, status: "open", odlozoneDo: null,
    poTerminie: false, podziekowal: false, oglada: null, priorytet: "normalny", czekaOdMs: null,
    reklamacyjna: false, nowychOdOdpowiedzi: 0, zadanieWToku: false, dobor: "not_started",
    kopilot: { kategoria, dodatkowe: [], zrodlo: "MODEL", status: "SUCCESS", nieaktualna: false,
      kategoriaCzlowieka: null } as never,
  },
  os: [], szkic: null, ofertaWskazana: null, zwroty: [], sprawy: [], droga: [], szkicCopilota: null,
  kandydaciZamowien: [], oferta: null,
  zamowienie: { externalId: "z-51", link: null, pobrane: null, przesylka: {
    waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null } },
  dobor: { status: "not_started", wersja: 1, brakuje: null, wybrany: null, updatedBy: null, updatedAt: null,
    dane: { marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null, silnik: null,
      oem: null, nazwaCzesci: null, parametry: {} } },
} as unknown as OsRozmowy);

function pokaz(kategoria: Kategoria) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>
    <Kontekst dane={dane(kategoria)} onWstawDoSzkicu={() => {}} onZlecPomiar={() => {}}
      onOtworzRozmowe={() => {}} />
  </MemoryRouter></QueryClientProvider>);
}

describe("soczewka paczki na prawdziwych hakach", () => {
  it("otwarcie kolumny przy każdej kategorii dostawy wysyła wyłącznie GET", async () => {
    for (const k of ["ORDER_STATUS", "DELIVERY_DELAY", "DELIVERY_LOST", "DELIVERY_DAMAGED"] as const) {
      const { unmount } = pokaz(k);
      expect(await screen.findByRole("button", { name: "Sprawdź paczkę" })).toBeInTheDocument();
      /* Linijka „Nowy klient" przychodzi z odczytu — czekamy na nią, żeby
         policzyć żądania już po tym, jak kolumna dociągnęła swoje. */
      expect(await screen.findByText(/Nowy klient/)).toBeInTheDocument();
      unmount();
    }
    expect(zadania.length).toBeGreaterThan(0);
    expect(zadania.filter((z) => z.metoda !== "GET")).toEqual([]);
  });

  it("kliknięcie „Sprawdź paczkę” to jeden POST bez ciała i bez typu treści", async () => {
    pokaz("DELIVERY_DELAY");
    await userEvent.click(await screen.findByRole("button", { name: "Sprawdź paczkę" }));
    await vi.waitFor(() => expect(zadania.some((z) => z.metoda === "POST")).toBe(true));
    const zapisy = zadania.filter((z) => z.metoda !== "GET");
    expect(zapisy).toHaveLength(1);
    expect(zapisy[0]).toMatchObject({ metoda: "POST", url: "/api/conversations/51/przesylka", body: null, typ: null });
  });
});
