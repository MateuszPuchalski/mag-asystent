import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import type { OfertaRozmowy as Dane } from "../api/typy";

/* Zdjęcie oferty (0.213.0): pobranie idzie `fetch`em, a w jsdomie nie ma dokąd
   go wysłać. Atrapa mówi „obraz jest", więc widać, czy kafel w ogóle staje. */
vi.mock("../towar/useZdjecie", () => ({
  useZdjecie: () => null,
  useZdjecieOferty: (id: string | null | undefined) => (id ? `blob:${id}` : null),
}));

const { OfertaRozmowy } = await import("./OfertaRozmowy");

const BEZ_KARTOTEKI: Dane["kartoteka"] = {
  pewnosc: "brak", twId: null, symbol: null,
  zrodlo: "Oferty jeszcze nie pobrano z Allegro", powod: "oferta_niepobrana",
};

const dane = (pobrana: Dane["pobrana"], kartoteka = BEZ_KARTOTEKI): Dane => ({
  externalId: "12096815384",
  link: "https://allegro.pl/oferta/12096815384",
  pobrana,
  kartoteka,
});

describe("blok oferty przy rozmowie", () => {
  it("pokazuje tytuł, SKU i cenę, gdy snapshot jest", () => {
    render(<OfertaRozmowy oferta={dane({
      nazwa: "NÓŻ DO KOSIARKI STIGA 43cm 46S CASTELGARDEN NG464",
      sku: "NOZ-STIGA-43", cenaGrosze: 4890, waluta: "PLN", status: "ACTIVE",
      syncedAt: "2026-09-02T14:50:00Z", maZdjecie: false,
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
      syncedAt: "2026-09-02T14:50:00Z", maZdjecie: false,
    })} />);
    expect(screen.getByText("Szarpak")).toBeInTheDocument();
    expect(screen.queryByText(/zł/)).not.toBeInTheDocument();
  });
});

describe("zdjęcie listingowe oferty (0.213.0)", () => {
  const snapshot = (maZdjecie: boolean): Dane["pobrana"] => ({
    nazwa: "NÓŻ DO KOSIARKI STIGA 43cm", sku: "NOZ-STIGA-43", cenaGrosze: 4890,
    waluta: "PLN", status: "ACTIVE", syncedAt: "2026-09-02T14:50:00Z", maZdjecie,
  });

  it("pokazuje zdjęcie i PODPISUJE jego źródło", () => {
    render(<OfertaRozmowy oferta={dane(snapshot(true))} />);
    const obraz = screen.getByAltText("NÓŻ DO KOSIARKI STIGA 43cm");
    /* Adres jest NASZ. Gdyby panel dostał `https://a.allegroimg.com/…`, każde
       otwarcie skrzynki wyprowadzałoby przeglądarkę biura poza własną sieć —
       to jest ten sam zakaz, co przy awatarze rozmówcy, i on obowiązuje dalej. */
    expect(obraz.getAttribute("src")).not.toMatch(/allegroimg/);
    /* Źródła się nie mieszają (§4.3): blok towaru niżej pokazuje zdjęcie
       z Subiekta, więc to musi się przedstawić. */
    expect(screen.getByText(/Zdjęcie z oferty Allegro/)).toBeInTheDocument();
  });

  it("bez adresu w Allegro nie rezerwuje miejsca ani nie pyta trasy", () => {
    render(<OfertaRozmowy oferta={dane(snapshot(false))} />);
    expect(screen.queryByAltText("NÓŻ DO KOSIARKI STIGA 43cm")).not.toBeInTheDocument();
    expect(screen.queryByText(/Zdjęcie z oferty Allegro/)).not.toBeInTheDocument();
  });
});
