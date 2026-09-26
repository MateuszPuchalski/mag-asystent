import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Dyskusja, SzczegolDyskusji } from "../api/typy";
import { Fakty } from "./Fakty";

/* Zlecenie hali sięga po `useNoweZadanie` dopiero w otwartym formularzu, a ten
   plik pilnuje UKŁADU kolumny, nie zleceń — własne testy ma `sprawy/ZlecHali`. */
vi.mock("../api/rozmowy", () => ({
  useNoweZadanie: () => ({ mutate: () => {}, isPending: false }),
}));

/* ── Kolumna faktów o dyskusji uproszczona (0.520.0) ────────────────────────
   Zgłoszenie agentów: „aplikacja przytłacza". Każdy test pilnuje jednej rzeczy,
   która zeszła z wierzchu, i tego, że dalej jest najwyżej jedno kliknięcie
   dalej. Nic z tej kolumny nie zniknęło na dobre.                          */

const d = (n: Partial<Dyskusja> = {}): Dyskusja => ({
  id: 3, externalId: "d-3", orderId: "zam-3", kupujacyLogin: "kowalski",
  temat: "Przesyłka nie dotarła", opis: null,
  statusAllegro: "DISPUTE_ONGOING", czatAktywny: true, wiadomosciIle: 4, czatUrwany: false,
  ostatniaWiadomoscStatus: "BUYER_REPLIED", ostatniaWiadomoscAt: null,
  ruchNasz: true, czekaOdDni: 5, dlugoCzeka: true,
  otwartoAt: "2026-09-01T10:00:00.000Z", prowadzi: null, prowadziId: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, prowadziAt: null, notatka: null,
  zakonczenieStatus: null, zakonczenieAt: null, zakonczeniePrzez: null,
  wersja: 1, kubelek: "odpowiedz", sygnaly: [], linkZamowienia: null,
  ...n,
});

const szczegol = (n: Partial<SzczegolDyskusji> = {}, dn: Partial<Dyskusja> = {}): SzczegolDyskusji => ({
  dyskusja: d(dn), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [], droga: [],
  zamowienie: null, przesylka: null, ...n,
});

function pokaz(s: SzczegolDyskusji, onNotatka = vi.fn()) {
  return render(<MemoryRouter>
    <Fakty szczegol={s} trwa={false} bladZapisu="" onNotatka={onNotatka} />
  </MemoryRouter>);
}

/* Zwijki pamiętają wybór w przeglądarce — bez sprzątania jeden test
   otwierałby je następnemu. */
afterEach(() => { try { localStorage.clear(); } catch { /* prywatne okno */ } });

describe("Kolumna faktów o dyskusji", () => {
  it("„Sprawa” i „Stan” startują zwinięte, a podpis niesie czekanie", async () => {
    pokaz(szczegol());
    const stan = screen.getByRole("button", { name: /Stan/ });
    expect(stan).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Sprawa/ })).toHaveAttribute("aria-expanded", "false");
    /* Czekanie to jedyna miara pilności dyskusji — zwinięta zwijka jej nie chowa. */
    expect(stan).toHaveTextContent("czeka na nas 5 dni · 4 wiadomości");
    await userEvent.click(stan);
    expect(stan).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("5 dni")).toBeVisible();
  });

  it("czekanie nie niesie już dopisku o terminie Allegro", () => {
    pokaz(szczegol());
    expect(screen.queryByText(/terminu tu nie stawia/)).not.toBeInTheDocument();
  });

  it("status domyślny nie staje wierszem, odbiegający staje", () => {
    const { unmount } = pokaz(szczegol());
    expect(screen.queryByText("Status Allegro")).not.toBeInTheDocument();
    unmount();
    pokaz(szczegol({}, { statusAllegro: "DISPUTE_UNRESOLVED" }));
    expect(screen.getByText("DISPUTE_UNRESOLVED")).toBeInTheDocument();
    /* Status, który ma wołać o uwagę, stoi też w podpisie zwiniętej zwijki. */
    expect(screen.getByRole("button", { name: /Stan/ })).toHaveTextContent("DISPUTE_UNRESOLVED");
  });

  it("podpis stanu odmienia liczby i przy zamkniętej rozmowie nie mówi „ruch klienta”", () => {
    pokaz(szczegol({}, { czekaOdDni: null, ruchNasz: false, czatAktywny: false, wiadomosciIle: 1 }));
    const stan = screen.getByRole("button", { name: /Stan/ });
    expect(stan).toHaveTextContent("rozmowa zamknięta · 1 wiadomość");
    expect(stan).not.toHaveTextContent("ruch klienta");
  });

  it("zakup u nas to JEDNA sekcja z jednym nagłówkiem, bez osobnych zwrotów i rozmów", () => {
    pokaz(szczegol({
      droga: [
        { rodzaj: "rozmowa", id: 8, at: "2026-08-30T10:00:00.000Z", opis: "Pytanie o dostawę" },
        { rodzaj: "dyskusja", id: 3, at: "2026-09-01T10:00:00.000Z", opis: null },
        { rodzaj: "zwrot", id: 9, at: "2026-09-02T10:00:00.000Z", opis: "ZW-9" },
      ],
      sprawy: [{ id: 12, typ: "CLAIM", numer: "12/2026", temat: "Uszkodzony", statusAllegro: null,
        decyzjaDo: null, otwartoAt: "2026-09-03T10:00:00.000Z", prowadzi: null, otwarta: true }],
      rozmowy: [{ id: 8, temat: "Pytanie o dostawę", status: "OPEN", ostatniaAt: null }],
    }));
    const sekcja = screen.getByRole("heading", { name: "Ten zakup u nas" }).closest("section")!;
    /* Droga prowadzi do zwrotu i do rozmowy — tamte dwie listy były jej podzbiorem. */
    expect(within(sekcja).getByRole("link", { name: /zwrot/ })).toBeInTheDocument();
    expect(within(sekcja).getByRole("link", { name: /pytanie/ })).toBeInTheDocument();
    expect(within(sekcja).getByText("Uszkodzony")).toBeInTheDocument();
    for (const stary of ["Zwroty tego zamówienia", "Inne sprawy tego zakupu",
      "Droga tego zakupu", "Rozmowy o tym zakupie", "Sprawy tego zakupu"]) {
      expect(screen.queryByText(stary)).not.toBeInTheDocument();
    }
  });

  it("zlecenie hali stoi bez nagłówka nad jednym przyciskiem", () => {
    pokaz(szczegol());
    expect(screen.getByRole("button", { name: /Zleć hali/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hala" })).not.toBeInTheDocument();
  });

  it("„Zapisz notatkę” staje dopiero przy zmianie treści", async () => {
    const onNotatka = vi.fn();
    pokaz(szczegol(), onNotatka);
    expect(screen.queryByRole("button", { name: "Zapisz notatkę" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Notatka biura"), "ALG-1");
    await userEvent.click(screen.getByRole("button", { name: "Zapisz notatkę" }));
    expect(onNotatka).toHaveBeenCalledWith("ALG-1");
  });
});
