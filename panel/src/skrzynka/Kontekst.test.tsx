import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OsRozmowy } from "../api/typy";

vi.mock("./TowarRozmowy", () => ({
  TowarRozmowy: () => <div data-testid="towar">blok towaru</div>,
}));
vi.mock("./OfertaRozmowy", () => ({
  OfertaRozmowy: () => <div data-testid="oferta">blok oferty</div>,
}));
vi.mock("./ZamowienieRozmowy", () => ({
  ZamowienieRozmowy: () => <div data-testid="zamowienie">blok zamówienia</div>,
}));

const { Kontekst } = await import("./Kontekst");

const dane = (n: Partial<OsRozmowy> = {}): OsRozmowy => ({
  rozmowa: {
    id: 4821, klient: "Kupujący 44300444", ostatniaWiadomosc: "", ostatniaWiadomoscAt: "",
    ostatniaOdKlienta: true, nieprzeczytana: false, wlascicielId: null, wlasciciel: null,
    wersja: 1, status: "open", odlozoneDo: null, poTerminie: false, oglada: null,
    priorytet: "normalny", czekaOdMs: null, nowychOdOdpowiedzi: 0, zadanieWToku: false,
  },
  os: [], szkic: null, ofertaWskazana: null, sprawa: null, zamowienie: null,
  oferta: { externalId: "12096815384", link: null, pobrana: null,
    kartoteka: { pewnosc: "brak", twId: null, symbol: null, zrodlo: "—", powod: null } },
  ...n,
});

describe("kolumna kontekstu", () => {
  it("otwiera się na ofercie i przełącza na towar", async () => {
    render(<Kontekst dane={dane()} />);
    expect(screen.getByTestId("oferta")).toBeInTheDocument();
    expect(screen.queryByTestId("towar")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Towar" }));
    expect(screen.getByTestId("towar")).toBeInTheDocument();
    expect(screen.queryByTestId("oferta")).not.toBeInTheDocument();
  });

  /* Zamówienie stoi POD ofertą w tej samej zakładce: oba mówią „czego dotyczy
     rozmowa", tylko jedno przed zakupem, a drugie po. */
  it("zamówienie jedzie razem z ofertą, nie osobną zakładką", () => {
    render(<Kontekst dane={dane({
      zamowienie: { externalId: "zam-77", link: null, pobrane: null },
    })} />);
    expect(screen.getByTestId("zamowienie")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zamówienie" })).not.toBeInTheDocument();
  });

  it("bez oferty obie zakładki mówią, czego brakuje, zamiast milczeć", async () => {
    render(<Kontekst dane={dane({ oferta: null })} />);
    expect(screen.getByText(/nie jest powiązana z ofertą/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Towar" }));
    expect(screen.getByText(/nie ma z czego wywieść kartoteki/)).toBeInTheDocument();
    expect(screen.queryByTestId("towar")).not.toBeInTheDocument();
  });

  /* Pięciu zakładek z makiety NIE ma: „Dobór", „Klient" i „Wiedza" nie mają
     dziś skąd wziąć danych, a zakładka mówiąca zawsze „wkrótce" uczy nie klikać. */
  it("ma dokładnie dwie zakładki", () => {
    render(<Kontekst dane={dane()} />);
    for (const nazwa of ["Dobór", "Klient", "Wiedza"]) {
      expect(screen.queryByRole("button", { name: nazwa })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Oferta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Towar" })).toBeInTheDocument();
  });
});
