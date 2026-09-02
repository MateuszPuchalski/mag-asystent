import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { OfertaRozmowy } from "./OfertaRozmowy";
import type { OfertaRozmowy as Dane } from "../api/typy";

const dane = (pobrana: Dane["pobrana"]): Dane => ({
  externalId: "12096815384",
  link: "https://allegro.pl/oferta/12096815384",
  pobrana,
});

describe("blok oferty przy rozmowie", () => {
  it("pokazuje tytuł, SKU i cenę, gdy snapshot jest", () => {
    render(<OfertaRozmowy oferta={dane({
      nazwa: "NÓŻ DO KOSIARKI STIGA 43cm 46S CASTELGARDEN NG464",
      sku: "NOZ-STIGA-43", cenaGrosze: 4890, waluta: "PLN", status: "ACTIVE",
      syncedAt: "2026-09-02T14:50:00Z",
    })} />);
    expect(screen.getByText(/NÓŻ DO KOSIARKI STIGA 43cm/)).toBeInTheDocument();
    expect(screen.getByText("NOZ-STIGA-43")).toBeInTheDocument();
    expect(screen.getByText(/48,90/)).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  /* Numer jest ZAWSZE, bo mamy go z wiadomości — czekamy tylko na tytuł. */
  it("bez snapshotu mówi WPROST, że tytuł dopiero przyjedzie", () => {
    render(<OfertaRozmowy oferta={dane(null)} />);
    expect(screen.getByText("12096815384")).toBeInTheDocument();
    expect(screen.getByText(/Tytułu oferty jeszcze nie pobrano/)).toBeInTheDocument();
  });

  it("prowadzi do oferty publicznej, nie do panelu sprzedawcy", () => {
    render(<OfertaRozmowy oferta={dane(null)} />);
    expect(screen.getByRole("link", { name: /Otwórz w Allegro/ }))
      .toHaveAttribute("href", "https://allegro.pl/oferta/12096815384");
  });

  /* Cena bywa nieznana (oferta w formacie licytacji bez „kup teraz"), a wtedy
     blok pokazuje sam tytuł zamiast zera złotych. */
  it("bez ceny pokazuje sam tytuł", () => {
    render(<OfertaRozmowy oferta={dane({
      nazwa: "Szarpak", sku: null, cenaGrosze: null, waluta: null, status: null,
      syncedAt: "2026-09-02T14:50:00Z",
    })} />);
    expect(screen.getByText("Szarpak")).toBeInTheDocument();
    expect(screen.queryByText(/zł/)).not.toBeInTheDocument();
  });
});
