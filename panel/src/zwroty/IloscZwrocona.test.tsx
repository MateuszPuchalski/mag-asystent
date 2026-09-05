import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IloscZwrocona } from "./IloscZwrocona";
import type { PozycjaZwrotu } from "../api/typy";

/* ── Ile sztuk naprawdę wróciło (0.212.0) ───────────────────────────────────
   Klient zgłasza dwie, w kartonie przyjeżdża jedna. Liczy biuro — decyzja
   właściciela. Testy pilnują trzech rzeczy: pole nie zaśmieca typowego
   zwrotu, zapisana liczba jest widoczna wszędzie, a więcej niż zgłoszono
   odpada JESZCZE PRZED kliknięciem.                                        */

const POZYCJA = (n: Partial<PozycjaZwrotu> = {}): PozycjaZwrotu => ({
  id: 11, zrodlo: "allegro", offerId: "of-1", ofertaZamowienia: null, nazwa: "Szarpak", ilosc: 2, cenaGrosze: 4999,
  waluta: "PLN", powod: null, powodKomentarz: null, ocena: null, wKoszyku: false,
  iloscZwrocona: null, url: null, twId: null, twSymbol: null, twZrodlo: null, sku: null,
  ean: null, potracenieGrosze: null, potraceniePowod: null, propozycja: null,
  rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
    prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null },
  ...n,
});

const pokaz = (p: PozycjaZwrotu, onZapisz = vi.fn()) => ({
  onZapisz, ...render(<IloscZwrocona p={p} trwa={false} blad="" onZapisz={onZapisz} />),
});

describe("Ile sztuk wróciło", () => {
  it("przy JEDNEJ sztuce pola nie ma — od tego jest odznaczenie", () => {
    /* „Wróciło zero z jednej" znaczy to samo co odznaczenie pozycji, a dwie
       drogi do tej samej rzeczy kosztują namysł przy każdym wierszu. */
    expect(pokaz(POZYCJA({ ilosc: 1 })).container).toBeEmptyDOMElement();
  });

  it("pole otwiera się DOPIERO NA ŻĄDANIE — typowy zwrot wraca w komplecie", async () => {
    const { onZapisz } = pokaz(POZYCJA());
    expect(screen.queryByLabelText(/Ile sztuk wróciło/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /wróciło mniej/i }));
    await userEvent.type(screen.getByLabelText(/Ile sztuk wróciło/), "1");
    await userEvent.click(screen.getByRole("button", { name: /^Zapisz$/ }));
    expect(onZapisz).toHaveBeenCalledWith(1);
  });

  it("więcej niż zgłoszono odpada PRZED kliknięciem", async () => {
    /* Serwer i tak odmówi; ekran mówi to wcześniej, żeby nie kosztowało
       kliknięcia i odmowy. */
    pokaz(POZYCJA());
    await userEvent.click(screen.getByRole("button", { name: /wróciło mniej/i }));
    await userEvent.type(screen.getByLabelText(/Ile sztuk wróciło/), "5");
    expect(screen.getByText(/dopisz jako osobną pozycję/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Zapisz$/ })).toBeDisabled();
  });

  it("zapisany ROZJAZD widać jako fakt, z drogą powrotną", async () => {
    const { onZapisz } = pokaz(POZYCJA({ iloscZwrocona: 1 }));
    expect(screen.getByText(/Wróciło 1 z 2 szt\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /cofnij/i }));
    expect(onZapisz).toHaveBeenCalledWith(null);
  });

  it("zgodne ze zgłoszeniem mówi o sobie JEDNYM zdaniem, nie ramką", () => {
    /* Stan typowy — nie ma o czym rozmawiać, ale ślad po policzeniu zostaje. */
    pokaz(POZYCJA({ iloscZwrocona: 2 }));
    expect(screen.getByText(/Policzone — wróciło 2 z 2 szt\./)).toBeInTheDocument();
  });
});
