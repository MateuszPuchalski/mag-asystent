import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ZamowienieRozmowy } from "./ZamowienieRozmowy";
import { brakPowiazania } from "./Rozmowa";
import type { WpisOsi, ZamowienieRozmowy as Dane } from "../api/typy";

/* Blok zamówienia nad osią (0.166.0). Trzy stany i każdy mówi co innego:
   numer z odnośnikiem, treść z pozycjami, albo zdanie, że treść dopiero
   przyjedzie — milczenie w tym miejscu wyglądałoby jak usterka. */
const dane = (n: Partial<Dane> = {}): Dane => ({
  externalId: "2f8c1a3e-9b7d-4c1e-8a2b-000000000001",
  link: "https://salescenter.allegro.com/orders/2f8c1a3e", pobrane: null, ...n,
});

describe("Zamówienie przy rozmowie", () => {
  it("przed dociągnięciem: numer, odnośnik i zdanie o synchronizacji, bez przycisku zapisu", () => {
    render(<ZamowienieRozmowy zamowienie={dane()} />);
    expect(screen.getByText("2f8c1a3e-9b7d-4c1e-8a2b-000000000001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Otwórz w Allegro/ }))
      .toHaveAttribute("href", "https://salescenter.allegro.com/orders/2f8c1a3e");
    expect(screen.getByText(/jeszcze nie pobrano/)).toBeInTheDocument();
    /* „Zero zapisu przy patrzeniu": ekran rozmowy nie dociąga niczego sam. */
    expect(screen.queryByRole("button", { name: /Dociągnij/ })).toBeNull();
  });

  it("po dociągnięciu: pozycje z nazwą, SKU i ceną oraz suma", () => {
    render(<ZamowienieRozmowy zamowienie={dane({ pobrane: {
      externalId: "2f8c1a3e-9b7d-4c1e-8a2b-000000000001", status: "READY_FOR_PROCESSING",
      kupujacyLogin: null, dostawaGrosze: 1499, dostawaMetoda: "Kurier InPost", platnoscTyp: null, platnoscAt: null, fakturaZadana: null,
      sumaGrosze: 6098, waluta: "PLN", kupionoAt: "2026-08-30T11:00:00Z", link: null,
      pozycje: [{ offerId: "17235726715", nazwa: "Szarpak do NAC LS 46-450", sku: "SZR-NAC-46",
        ilosc: 1, cenaGrosze: 4599, waluta: "PLN", zwracana: false, wracaIlosc: 0 }],
    } })} />);
    expect(screen.getByText("Szarpak do NAC LS 46-450")).toBeInTheDocument();
    expect(screen.getByText("SZR-NAC-46")).toBeInTheDocument();
    expect(screen.getByText(/1 × 45,99/)).toBeInTheDocument();
    expect(screen.getByText(/zapłacono 60,98/)).toBeInTheDocument();
    expect(screen.queryByText(/jeszcze nie pobrano/)).toBeNull();
  });
});

describe("brak powiązania z towarem", () => {
  const w = (n: Partial<WpisOsi>): WpisOsi => ({
    id: "msg-1", rodzaj: "wiadomosc", autor: "k", odKlienta: true, tresc: "?",
    at: "2026-09-01T10:00:00Z", ofertaId: null, ...n,
  });

  it("zamówienie liczy się jak powiązanie — blok „brak oferty” nie stoi", () => {
    /* Zamówienie nazywa towar dokładniej niż oferta. Pokazywanie obok niego
       „brak powiązania z ofertą" byłoby kłamstwem o ekranie. */
    expect(brakPowiazania([w({})])).toBe(true);
    expect(brakPowiazania([w({ zamowienieId: "zam-1" })])).toBe(false);
    expect(brakPowiazania([w({ ofertaId: "1" })])).toBe(false);
    expect(brakPowiazania([w({}), w({ id: "msg-2", odKlienta: false, zamowienieId: "zam-1" })])).toBe(false);
  });
});
