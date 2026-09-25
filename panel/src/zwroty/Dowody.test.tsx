import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dowody } from "./Dowody";
import type { PrzystanekDrogi, SprawaZakupu, WpisOsiZwrotu, Zwrot } from "../api/typy";

/* ── Kolumna dowodów po uproszczeniu (@wydanie) ──────────────────────────────
   Zgłoszenie agentów: „aplikacja przytłacza". Te testy pilnują, żeby to,
   co zeszło, nie wróciło przy następnej zmianie:

   1. JEDNA SEKCJA O ZAKUPIE. Sprawy, droga i wiadomości stały w trzech
      sekcjach, a dwie z nich rysowały drugi nagłówek nad własną listą.
   2. HALA BEZ NAGŁÓWKA. „Hala" stała nad jednym przyciskiem „Zleć hali".
   3. PRZEBIEG ZWINIĘTY. Całość jest jednym kliknięciem dalej, nie na stałe. */

const zwrot = (n: Partial<Zwrot> = {}): Zwrot => ({
  id: 1, externalId: "zw-1", numer: "REF-1", orderId: "ord-1",
  utworzono: "2026-08-25T09:00:00.000Z", paczkaAt: null, dostarczonoAt: null,
  przesylkaStatus: null, statusAllegro: null, rozliczonyAllegroAt: null, waybill: null,
  kubelek: "decyzja", sygnaly: [], terminAt: "2026-09-08T09:00:00.000Z",
  dniDoTerminu: 7, sumaPozycjiGrosze: 0, kwotaPelnaGrosze: null, waluta: "PLN",
  linkZwrotu: null, zamowienie: null,
  werdykt: null, werdyktPowod: null, kwotaGrosze: null, kwotaWariant: null,
  korektaNumer: null, korektaZrodlo: null, zrodlo: "allegro",
  notatka: null, notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false,
  kupujacyLogin: null, odbiorcaNazwa: null, przewoznik: null, rozmowy: [],
  faktura: { dokId: null, numer: null, typ: null, zrodlo: null, at: null, przez: null },
  rejectionCode: null, wersja: 1, pozycje: [],
  ...n,
});

const DROGA: PrzystanekDrogi[] = [
  { rodzaj: "rozmowa", id: 7, at: "2026-08-24T10:00:00.000Z", opis: "Kiedy zwrot?" },
  { rodzaj: "zwrot", id: 1, at: "2026-08-25T09:00:00.000Z", opis: "REF-1" },
];

const SPRAWA: SprawaZakupu = {
  id: 3, typ: "CLAIM", numer: "R-3", temat: "Pęknięta rączka", statusAllegro: null,
  decyzjaDo: null, otwartoAt: "2026-08-26T09:00:00.000Z", prowadzi: null, otwarta: true,
};

const pokaz = (opcje: Partial<React.ComponentProps<typeof Dowody>> = {}) =>
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <Dowody zwrot={zwrot()} {...opcje} />
  </MemoryRouter></QueryClientProvider>);

describe("Dowody zwrotu — jedna sekcja o zakupie", () => {
  it("droga i sprawy stoją pod JEDNYM nagłówkiem, bez drugiego nad listą", () => {
    pokaz({ droga: DROGA, sprawy: [SPRAWA] });
    expect(screen.getByRole("heading", { name: /Ten zakup u nas/ })).toBeInTheDocument();
    /* Nagłówki, które spoiwo rysuje samo, gdy rodzic nie da `wSekcji`. */
    expect(screen.queryByText("Sprawy tego zakupu")).toBeNull();
    expect(screen.queryByLabelText("Droga tego zakupu")).toBeNull();
    expect(screen.queryByText(/Wiadomości o tym zakupie/)).toBeNull();
    expect(screen.getByRole("link", { name: /pytanie/ }))
      .toHaveAttribute("href", "/obsluga/skrzynka/7");
    expect(screen.getByRole("link", { name: "Otwórz" }))
      .toHaveAttribute("href", "/obsluga/reklamacje/3");
  });

  it("same sprawy bez drogi dalej mają sekcję", () => {
    pokaz({ sprawy: [SPRAWA] });
    expect(screen.getByRole("heading", { name: /Ten zakup u nas/ })).toBeInTheDocument();
    expect(screen.getByText("Pęknięta rączka")).toBeInTheDocument();
  });

  it("zwrot bez rodzeństwa nie rysuje sekcji — droga z jednego punktu nie jest drogą", () => {
    pokaz({ droga: [DROGA[1]!] });
    expect(screen.queryByText(/Ten zakup u nas/)).toBeNull();
  });
});

describe("Dowody zwrotu — mniej nagłówków", () => {
  it("zlecenie hali to sam przycisk, bez nagłówka „Hala” nad nim", () => {
    pokaz();
    expect(screen.getByRole("button", { name: /Zleć hali/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hala" })).toBeNull();
  });

  it("przebieg stoi zwinięty do zdania, bez nagłówka nad nim", () => {
    const os: WpisOsiZwrotu[] = [{ id: 1, rodzaj: "werdykt", tresc: "Zwrot przyjęty",
      kiedy: "2026-09-01T10:00:00.000Z", kto: "Ala z biura", dane: null }];
    pokaz({ os });
    expect(screen.queryByRole("heading", { name: /Przebieg sprawy/ })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Przebieg sprawy" }))
      .toHaveTextContent(/Ostatnio: decyzja/);
    expect(screen.queryByText("Zwrot przyjęty")).toBeNull();
    expect(screen.getByRole("button", { name: "przebieg (1)" })).toBeInTheDocument();
  });
});
