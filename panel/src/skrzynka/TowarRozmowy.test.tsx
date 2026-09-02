import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import type { DopasowanieKartoteki, OfertaRozmowy } from "../api/typy";

const karta = vi.fn();
vi.mock("../api/rozmowy", () => ({
  useKartaTowaru: (twId: number | null) => karta(twId),
  useWskazKartoteke: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock("../towar/Zdjecie", () => ({ Zdjecie: () => <div data-testid="zdjecie" /> }));
vi.mock("../towar/Powiekszenie", () => ({ Powiekszenie: () => null }));

const { TowarRozmowy } = await import("./TowarRozmowy");

const oferta = (kartoteka: DopasowanieKartoteki): OfertaRozmowy => ({
  externalId: "12096815384", link: null, pobrana: null, kartoteka,
});

const PUSTA = { data: undefined, isLoading: false, error: null };

describe("towar przy rozmowie", () => {
  it("brak kartoteki niesie POWÓD, nie samo „bez kartoteki”", () => {
    karta.mockReturnValue(PUSTA);
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "brak", twId: null, symbol: null,
      zrodlo: "Oferty jeszcze nie pobrano z Allegro", powod: "oferta_niepobrana",
    })} />);
    expect(screen.getByText(/Oferty jeszcze nie pobrano/)).toBeInTheDocument();
    /* Bez kartoteki nie pytamy Subiekta — nie ma o co. */
    expect(karta).toHaveBeenCalledWith(null);
  });

  it("propozycja z SKU czeka na zatwierdzenie i mówi, skąd się wzięła", () => {
    karta.mockReturnValue(PUSTA);
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "sku", twId: 7701, symbol: "NOZ-STIGA-43",
      zrodlo: 'SKU oferty „NOZ-STIGA-43"', powod: null,
    })} />);
    expect(screen.getByRole("button", { name: /Zatwierdź/ })).toBeInTheDocument();
    expect(screen.getByText(/SKU oferty/)).toBeInTheDocument();
    /* Propozycja to jeszcze nie fakt — stanu magazynowego nie pobieramy. */
    expect(karta).toHaveBeenCalledWith(null);
  });

  it("potwierdzona kartoteka pokazuje stan, dostępny i półkę", () => {
    karta.mockReturnValue({
      isLoading: false, error: null,
      data: {
        id: 7701, sym: "NOZ-STIGA-43", name: "Nóż do kosiarki 43 cm", ean: "5901234567890",
        unit: "szt.", locs: ["R12-B3"],
        mag: { stan: 7, rez: 2, avail: 5 }, magazyny: [],
      },
    });
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "pamiec", twId: 7701, symbol: "NOZ-STIGA-43",
      zrodlo: "Wskazane wcześniej przez: A. Lewandowska", powod: null,
    })} />);
    expect(karta).toHaveBeenCalledWith(7701);
    expect(screen.getByText("Nóż do kosiarki 43 cm")).toBeInTheDocument();
    expect(screen.getByText("R12-B3")).toBeInTheDocument();
    expect(screen.getByText("5 szt.")).toBeInTheDocument();
    /* Wskazanie człowieka jest podpisane człowiekiem (§4.3). */
    expect(screen.getByText(/A\. Lewandowska/)).toBeInTheDocument();
  });

  it("każdy fakt magazynowy jest podpisany źródłem", () => {
    karta.mockReturnValue(PUSTA);
    render(<TowarRozmowy rozmowaId={1} oferta={oferta({
      pewnosc: "brak", twId: null, symbol: null, zrodlo: "Oferta bez SKU", powod: "oferta_bez_sku",
    })} />);
    expect(screen.getByText(/Subiekt GT/)).toBeInTheDocument();
  });
});
