import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Potracenie, naGrosze } from "./Potracenie";
import type { PozycjaZwrotu } from "../api/typy";

/* ── Potrącenie za utratę wartości (0.170.0) ─────────────────────────────────
   Do 0.169.0 kwota była binarna per pozycja: cała cena albo nic. Te testy
   pilnują dwóch rzeczy naraz — że da się oddać mniej, i że nie da się oddać
   liczby bez uzasadnienia ani większej niż wart jest towar. */

const POZYCJA = (n: Partial<PozycjaZwrotu> = {}): PozycjaZwrotu => ({
  id: 11, offerId: "of-1", nazwa: "Szarpak", ilosc: 2, cenaGrosze: 5000,
  waluta: "PLN", powod: null, powodKomentarz: null, ocena: null, url: null,
  twId: null, twSymbol: null, twZrodlo: null, sku: null, ean: null,
  potracenieGrosze: null, potraceniePowod: null, propozycja: null,
  rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
    prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null },
  ...n,
});

const pokaz = (p: PozycjaZwrotu, onZapisz = vi.fn()) => {
  render(<Potracenie p={p} trwa={false} blad="" onZapisz={onZapisz} />);
  return onZapisz;
};

describe("Potrącenie za utratę wartości", () => {
  it("„30,00\" i „30\" znaczą to samo, a bzdura nie znaczy nic", () => {
    /* Operator wpisuje kwotę tak, jak mu wygodnie — przecinkiem albo kropką. */
    expect(naGrosze("30,00")).toBe(3000);
    expect(naGrosze("30.5")).toBe(3050);
    expect(naGrosze("30")).toBe(3000);
    expect(naGrosze(" 7,99 ")).toBe(799);
    expect(naGrosze("")).toBeNull();
    expect(naGrosze("-5")).toBeNull();
    expect(naGrosze("dużo")).toBeNull();
  });

  it("formularz otwiera się DOPIERO na żądanie", () => {
    /* Typowy zwrot wraca w porządku; pole pod każdą pozycją byłoby ścianą
       pytań o wyjątek — ta sama zasada co przy ręcznym wskazaniu kartoteki. */
    pokaz(POZYCJA());
    expect(screen.queryByLabelText(/^Potrącenie:/)).toBeNull();
    expect(screen.getByRole("button", { name: /oddaj mniej za ten towar/ }))
      .toBeInTheDocument();
  });

  it("zapis wymaga i kwoty, i powodu", async () => {
    /* Powód pilnuje POLE, nie dopiero serwer: odmowa po kliknięciu uczy, że
       przycisk bywa zepsuty, a tu po prostu brakuje zdania dla klienta. */
    const onZapisz = pokaz(POZYCJA());
    await userEvent.click(screen.getByRole("button", { name: /oddaj mniej/ }));

    const zapisz = screen.getByRole("button", { name: /Zapisz potrącenie/ });
    expect(zapisz).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^Potrącenie:/), "30");
    expect(zapisz).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^Powód potrącenia:/), "ślady użycia");
    expect(zapisz).toBeEnabled();

    await userEvent.click(zapisz);
    expect(onZapisz).toHaveBeenCalledWith(3000, "ślady użycia");
  });

  it("więcej niż wart jest towar ekran zatrzymuje u siebie", async () => {
    /* Sto złotych to dwie sztuki po pięćdziesiąt — powyżej klient dopłacałby
       nam za własny zwrot. */
    const onZapisz = pokaz(POZYCJA());
    await userEvent.click(screen.getByRole("button", { name: /oddaj mniej/ }));
    await userEvent.type(screen.getByLabelText(/^Potrącenie:/), "100,01");
    await userEvent.type(screen.getByLabelText(/^Powód/), "powód");

    expect(screen.getByText(/klient dopłacałby nam za zwrot/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Zapisz potrącenie/ })).toBeDisabled();
    expect(onZapisz).not.toHaveBeenCalled();
  });

  it("zapisane potrącenie pokazuje kwotę, powód i to, co naprawdę wyjdzie", () => {
    pokaz(POZYCJA({ potracenieGrosze: 3000, potraceniePowod: "ślady użycia na ostrzu" }));
    expect(screen.getByText(/Potrącenie −30,00 PLN/)).toBeInTheDocument();
    expect(screen.getByText(/do oddania 70,00 PLN/)).toBeInTheDocument();
    expect(screen.getByText(/ślady użycia na ostrzu/)).toBeInTheDocument();
  });

  it("potrącenie da się cofnąć jednym kliknięciem", async () => {
    /* Cofnięcie zamiast potwierdzenia — §25a.5. */
    const onZapisz = pokaz(POZYCJA({ potracenieGrosze: 3000, potraceniePowod: "wada" }));
    await userEvent.click(screen.getByRole("button", { name: /cofnij potrącenie/ }));
    expect(onZapisz).toHaveBeenCalledWith(null, "");
  });

  it("odmowa serwera ląduje przy polu, nie w konsoli", () => {
    render(<Potracenie p={POZYCJA({ potracenieGrosze: 500, potraceniePowod: "x" })}
      trwa={false} blad="Zwrot zmienił się w innej karcie" onZapisz={vi.fn()} />);
    expect(screen.getByText(/zmienił się w innej karcie/)).toBeInTheDocument();
  });
});
