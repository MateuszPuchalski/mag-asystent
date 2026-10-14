import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dowody } from "./Dowody";
import type { WpisOsiZwrotu, Zwrot } from "../api/typy";

/* ── Kolumna dowodów po uproszczeniu (0.518.0) ──────────────────────────────
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
  kupujacyLogin: null, odbiorcaNazwa: null, przewoznik: null, rozmowy: [], zamknietyRecznie: null,
  faktura: { dokId: null, numer: null, typ: null, zrodlo: null, at: null, przez: null },
  rejectionCode: null, wersja: 1, pozycje: [],
  ...n,
});

const pokaz = (opcje: Partial<React.ComponentProps<typeof Dowody>> = {}) =>
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <Dowody zwrot={zwrot()} {...opcje} />
  </MemoryRouter></QueryClientProvider>);

describe("Dowody zwrotu — zakup mówi pasek drogi", () => {
  it("kolumna nie ma sekcji „Ten zakup u nas” ani list przystanków i spraw", () => {
    pokaz({ zwrot: zwrot({ rozmowy: [{ id: 7, temat: "Kiedy zwrot?", status: "open",
      ostatniaAt: "2026-08-24T10:00:00.000Z" }] }) });
    expect(screen.queryByRole("heading", { name: /Ten zakup u nas/ })).toBeNull();
    expect(screen.queryByText("Sprawy tego zakupu")).toBeNull();
    expect(screen.queryByLabelText("Droga tego zakupu")).toBeNull();
    expect(screen.queryByRole("link", { name: /pytanie|Otwórz/ })).toBeNull();
  });

  it("numer zamówienia nie jest powtórzony w sekcji „Zamówienie”, gdy zamówienie jest pobrane", () => {
    pokaz({ zwrot: zwrot({ zamowienie: {
      externalId: "ord-1", link: "https://allegro.pl/moje-allegro/zam/ord-1", pozycje: [],
      kupionoAt: "2026-08-20T09:00:00.000Z", sumaGrosze: 1000, waluta: "PLN", platnoscTyp: "ONLINE",
      dostawaMetoda: null, dostawaGrosze: null, fakturaZadana: null } as never }) });
    expect(screen.queryByText("ord-1")).toBeNull();
    expect(screen.queryByRole("link", { name: /Otwórz w/ })).toBeNull();
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

/* ── Odmowa z Allegro jednym brzmieniem (0.536.1) ──────────────────────────
   Do tego wydania ta kolumna miała własną mapę kodów i pisała „wysłano nowy
   towar”, a sekcja pieniędzy obok — „Wysłaliśmy nowy towar”. Jeden kod ma
   jedno brzmienie: oba miejsca czytają `etykietaKodu` z `Pieniadze.tsx`. */
describe("Dowody zwrotu — rozstrzygnięte w Allegro", () => {
  it("kod odmowy brzmi tak samo jak w sekcji pieniędzy", () => {
    pokaz({ zwrot: zwrot({ rejectionCode: "NEW_ITEM_SENT" }) });
    expect(screen.getByRole("heading", { name: /Rozstrzygnięte w Allegro/ })).toBeInTheDocument();
    expect(screen.getByText("Wysłaliśmy nowy towar")).toBeInTheDocument();
    expect(screen.queryByText("wysłano nowy towar")).toBeNull();
  });

  it("kod, którego lista nie zna, zostaje surowy — Allegro może dołożyć nowy", () => {
    pokaz({ zwrot: zwrot({ rejectionCode: "NOWY_KOD_ALLEGRO" }) });
    expect(screen.getByText("NOWY_KOD_ALLEGRO")).toBeInTheDocument();
  });
});
