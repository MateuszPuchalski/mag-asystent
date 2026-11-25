import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PomylonyTowar } from "./PomylonyTowar";
import type { PozycjaZwrotu } from "../api/typy";

/* ── Pomylony towar w kartonie ──────────────────────────────────────────────
   Znacznik ma być widoczny, ale zaznaczenie nie może kosztować pisania:
   opis jest dobrowolny, a pole otwiera się dopiero na żądanie.            */

const POZYCJA = (n: Partial<PozycjaZwrotu> = {}): PozycjaZwrotu => ({
  id: 11, zrodlo: "allegro", offerId: "of-1", ofertaZamowienia: null, ofertaZdjecie: "nieznane" as const,
  nazwa: "Szarpak", ilosc: 1, cenaGrosze: 4999, waluta: "PLN", powod: null, powodKomentarz: null,
  ocena: null, wKoszyku: false, iloscZwrocona: null, url: null, twId: null, twSymbol: null,
  twZrodlo: null, sku: null, ean: null, potracenieGrosze: null, potraceniePowod: null,
  propozycja: null,
  rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
    prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null },
  ...n,
});

const pokaz = (p: PozycjaZwrotu, edytowalny = true, onZapisz = vi.fn()) => ({
  onZapisz,
  ...render(<PomylonyTowar p={p} trwa={false} edytowalny={edytowalny} onZapisz={onZapisz} />),
});

describe("Pomylony towar", () => {
  it("zaznaczenie bez opisu to jeden klik w link i jeden w przycisk", async () => {
    const { onZapisz } = pokaz(POZYCJA());
    await userEvent.click(screen.getByRole("button", { name: /to nie ten towar/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Zaznacz$/ }));
    expect(onZapisz).toHaveBeenCalledWith(true, "");
  });

  it("opis idzie razem z zaznaczeniem, Enter zatwierdza", async () => {
    const { onZapisz } = pokaz(POZYCJA());
    await userEvent.click(screen.getByRole("button", { name: /to nie ten towar/i }));
    await userEvent.type(screen.getByLabelText(/Co przyjechało/), "kosa zamiast podkaszarki{Enter}");
    expect(onZapisz).toHaveBeenCalledWith(true, "kosa zamiast podkaszarki");
  });

  it("zaznaczona pomyłka jest ostrzeżeniem z opisem i drogą powrotną", async () => {
    const { onZapisz } = pokaz(POZYCJA({ pomylonyTowar: true, pomylonyOpis: "inny kolor" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Pomylony towar/);
    expect(screen.getByText("inny kolor")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /cofnij/i }));
    expect(onZapisz).toHaveBeenCalledWith(false, "");
  });

  it("ocena „na stan” przy pomylonym towarze dostaje ostrzeżenie", () => {
    pokaz(POZYCJA({ pomylonyTowar: true, ocena: "stan" }));
    expect(screen.getByText(/nie jest zamówiony towar/)).toBeInTheDocument();
  });

  it("zwrot z korektą nie obiecuje ruchu, którego serwer nie przyjmie", () => {
    const { container } = pokaz(POZYCJA(), false);
    expect(container).toBeEmptyDOMElement();
    pokaz(POZYCJA({ pomylonyTowar: true }), false);
    expect(screen.queryByRole("button", { name: /cofnij/i })).toBeNull();
  });
});
