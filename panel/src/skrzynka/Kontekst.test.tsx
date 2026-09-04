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
vi.mock("./Dobor", () => ({
  Dobor: () => <div data-testid="dobor">blok doboru</div>,
}));

const { Kontekst } = await import("./Kontekst");

const dane = (n: Partial<OsRozmowy> = {}): OsRozmowy => ({
  rozmowa: {
    id: 4821, klient: "Kupujący 44300444", ostatniaWiadomosc: "", ostatniaWiadomoscAt: "",
    ostatniaOdKlienta: true, nieprzeczytana: false, wlascicielId: null, wlasciciel: null,
    wersja: 1, status: "open", odlozoneDo: null, poTerminie: false, oglada: null,
    priorytet: "normalny", czekaOdMs: null, nowychOdOdpowiedzi: 0, zadanieWToku: false, dobor: "not_started",
    kopilot: null,
  },
  os: [], szkic: null, ofertaWskazana: null, sprawa: null, zamowienie: null,
  dobor: { status: "not_started", wersja: 1, brakuje: null, wybrany: null, updatedBy: null, updatedAt: null,
    dane: { marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null, silnik: null,
      oem: null, nazwaCzesci: null, parametry: {} } },
  oferta: { externalId: "12096815384", link: null, pobrana: null,
    kartoteka: { pewnosc: "brak", twId: null, symbol: null, zrodlo: "—", powod: null } },
  ...n,
});

describe("kolumna kontekstu", () => {
  /* ── Umowa 0.198.0 ─────────────────────────────────────────────────────────
     Oferta i kartoteka stoją RAZEM, bez klikania. Zrzut z pracy pokazał
     zakładkę „Oferta" na jedenaście linijek w kolumnie na osiemset pikseli,
     a zdjęcie, stan i parametry towaru leżały schowane obok. Klient pytał
     wtedy o wymiar gwintu; parametr stał w niewidocznej zakładce.

     Test sprawdza WIDOCZNOŚĆ NARAZ, nie liczbę zakładek: gdyby ktoś rozbił
     to z powrotem na dwie karty, oba `getByTestId` nie mogłyby przejść. */
  it("oferta i towar widać naraz, bez klikania w zakładkę", () => {
    render(<Kontekst dane={dane()} onWstawDoSzkicu={() => {}} onZlecPomiar={() => {}} />);
    expect(screen.getByTestId("oferta")).toBeInTheDocument();
    expect(screen.getByTestId("towar")).toBeInTheDocument();
  });

  /* Zamówienie stoi POD ofertą w tej samej zakładce: oba mówią „czego dotyczy
     rozmowa", tylko jedno przed zakupem, a drugie po. */
  it("zamówienie jedzie razem z ofertą, nie osobną zakładką", () => {
    render(<Kontekst dane={dane({
      zamowienie: { externalId: "zam-77", link: null, pobrane: null },
    })} onWstawDoSzkicu={() => {}} onZlecPomiar={() => {}} />);
    expect(screen.getByTestId("zamowienie")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zamówienie" })).not.toBeInTheDocument();
  });

  it("bez oferty kolumna mówi, czego brakuje, zamiast milczeć", () => {
    render(<Kontekst dane={dane({ oferta: null })} onWstawDoSzkicu={() => {}} onZlecPomiar={() => {}} />);
    expect(screen.getByText(/nie jest powiązana z ofertą/)).toBeInTheDocument();
    /* Drugie zdanie mówi osobno o kartotece, bo to osobny brak: numer oferty
       bywa, a przypisania do Subiekta nie ma. */
    expect(screen.getByText(/nie ma z czego wywieść kartoteki/)).toBeInTheDocument();
    expect(screen.queryByTestId("towar")).not.toBeInTheDocument();
  });

  /* Pięciu zakładek z makiety NIE ma: „Klient" i „Wiedza" nie mają dziś skąd
     wziąć danych, a zakładka mówiąca zawsze „wkrótce" uczy nie klikać. Od
     0.198.0 nie ma też osobnej „Oferty" ani „Towaru" — zeszły się w jedną. */
  it("ma dokładnie dwie zakładki, a dobór działa nawet bez oferty", async () => {
    render(<Kontekst dane={dane({ oferta: null })} onWstawDoSzkicu={() => {}} onZlecPomiar={() => {}} />);
    for (const nazwa of ["Klient", "Wiedza", "Oferta", "Towar"]) {
      expect(screen.queryByRole("button", { name: nazwa })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Oferta i towar" })).toBeInTheDocument();
    /* Bez oferty dobór ISTNIEJE: klient bywa bez numeru oferty, a maszynę
       i część wpisuje agent. */
    await userEvent.click(screen.getByRole("button", { name: "Dobór" }));
    expect(screen.getByTestId("dobor")).toBeInTheDocument();
  });

  /* „Dobór" zostaje OSOBNO i to jest decyzja, nie przeoczenie: to nie karta
     faktów, tylko robota z własnymi krokami i przyciskami zmieniającymi stan
     rozmowy. Doklejona pod kartotekę zepchnęłaby stan magazynowy z ekranu. */
  it("dobór zostaje osobną zakładką — nie doklejamy go pod towar", () => {
    render(<Kontekst dane={dane()} onWstawDoSzkicu={() => {}} onZlecPomiar={() => {}} />);
    expect(screen.queryByTestId("dobor")).not.toBeInTheDocument();
  });
});
