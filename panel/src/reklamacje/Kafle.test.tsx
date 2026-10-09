import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StatystykiReklamacji } from "../api/typy";
import { Kafle } from "./Kafle";

/* ── Kafle w kolejce reklamacji ──────────────────────────────────────────────
   Cztery liczby dnia w siatce 2×2. Testy pilnują reguł, których nie widać okiem:

   1. BRAK DANYCH TO „—”, NIGDY ZERO. Zero przy awarii serwera agent czyta
      jako „nic nie czeka” i kończy pracę (`panel/CLAUDE.md`).
   2. TREND TYLKO PRAWDZIWY. `tydzienTemu: null` daje zdanie opisowe, a nie
      „+18 od zeszłego tygodnia” liczone od zera.
   3. KAFEL PRACY JEST FILTREM — klik przestawia kolejkę, a średni czas
      niczego nie udaje.
   4. WYBÓR TO CIEMNA RAMKA, nie bursztyn.                                   */

const STAT: StatystykiReklamacji = {
  doDecyzji: { teraz: 18, tydzienTemu: 12 },
  doOdpowiedzi: { teraz: 11, tydzienTemu: null },
  poTerminie: { teraz: 1, tydzienTemu: 3 },
  sredniDniDoWerdyktu: { teraz: 2.4, poprzednio: 3.3, okresDni: 30 },
};

const pokaz = (p: Partial<React.ComponentProps<typeof Kafle>> = {}) => {
  const onWybierz = vi.fn();
  render(<Kafle statystyki={STAT} wybrany="decyzja" onWybierz={onWybierz} {...p} />);
  return { onWybierz };
};

describe("Kafle reklamacji", () => {
  it("siatka 2×2 w kolejności z makiety: liczba, nazwa, podpis", () => {
    pokaz();
    const siatka = screen.getByRole("group", { name: "Reklamacje w liczbach" });
    expect(siatka.className).toMatch(/grid-cols-2/);
    expect(screen.getByRole("button", { name: /^18 Do decyzji/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^11 Do odpowiedzi/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^1 Po terminie/ })).toBeInTheDocument();
    expect(screen.getByText("Średni czas do werdyktu")).toBeInTheDocument();
    expect(screen.getByText("2,4 dnia")).toBeInTheDocument();
  });

  it("liczba stoi na nazwanym szczeblu drabiny, podpis drobnym pismem", () => {
    pokaz();
    expect(screen.getByText("18").className).toMatch(/text-naglowek/);
    expect(screen.getByText("+6 od zeszłego tygodnia").className).toMatch(/text-xs/);
  });

  it("trend tygodniowy mówi znak i liczbę, minus typograficzny", () => {
    pokaz();
    expect(screen.getByText("+6 od zeszłego tygodnia")).toBeInTheDocument();
    expect(screen.getByText("−2 od zeszłego tygodnia")).toBeInTheDocument();
  });

  it("bez stanu sprzed tygodnia NIE MA trendu, tylko zdanie, co liczba znaczy", () => {
    pokaz();
    expect(screen.getByText("klient napisał, czeka na nas")).toBeInTheDocument();
    expect(screen.queryByText(/\+11/)).not.toBeInTheDocument();
  });

  it("średni czas porównuje się z poprzednim okresem tej samej długości", () => {
    pokaz();
    expect(screen.getByText("−0,9 dnia od poprzednich 30 dni")).toBeInTheDocument();
  });

  it("średnia bez werdyktów w okresie to „—”, a nie zero dni", () => {
    pokaz({ statystyki: { ...STAT, sredniDniDoWerdyktu: { teraz: null, poprzednio: 2, okresDni: 30 } } });
    expect(screen.getByText("brak werdyktów w ostatnich 30 dni")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("po terminie z pracą świeci czerwienią, bez pracy — nie", () => {
    const { unmount } = render(<Kafle statystyki={STAT} wybrany={null} onWybierz={vi.fn()} />);
    expect(screen.getByText("1").className).toMatch(/text-ranga-zle/);
    unmount();
    pokaz({ statystyki: { ...STAT, poTerminie: { teraz: 0, tydzienTemu: 0 } } });
    expect(screen.getByText("0").className).not.toMatch(/text-ranga-zle/);
  });

  it("BRAK DANYCH: każdy kafel mówi „—” i „nie wiemy”, nigdy 0", () => {
    pokaz({ statystyki: undefined });
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.getAllByText("nie wiemy")).toHaveLength(4);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("kafel pracy jest filtrem: klik oddaje filtr, wybrany wciśnięty ciemną ramką", async () => {
    const { onWybierz } = pokaz();
    const decyzja = screen.getByRole("button", { name: /Do decyzji/ });
    expect(decyzja).toHaveAttribute("aria-pressed", "true");
    expect(decyzja.className).toMatch(/border-wertis-ink/);
    expect(decyzja.className).not.toMatch(/amber/);
    expect(screen.getByRole("button", { name: /Do odpowiedzi/ })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: /Do odpowiedzi/ }));
    expect(onWybierz).toHaveBeenCalledWith("odpowiedz");
    await userEvent.click(screen.getByRole("button", { name: /Po terminie/ }));
    expect(onWybierz).toHaveBeenCalledWith("po_terminie");
  });

  it("„Po terminie” wciska się sam, a „Do decyzji” wtedy NIE", () => {
    pokaz({ wybrany: "po_terminie" });
    expect(screen.getByRole("button", { name: /Po terminie/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Do decyzji/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("podpowiedź kafla zna klawisz skrótu jego kubełka", () => {
    pokaz();
    expect(screen.getByTitle("Pokaż w kolejce: Do decyzji (klawisz 1)")).toBeInTheDocument();
    expect(screen.getByTitle("Pokaż w kolejce: Do odpowiedzi (klawisz 2)")).toBeInTheDocument();
  });

  it("średni czas nie jest przyciskiem — nie obiecuje filtra, którego nie ma", () => {
    pokaz();
    expect(screen.queryByRole("button", { name: /Średni czas/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("kafle nie niosą synchronizacji — ta stoi przy tytule kolejki", () => {
    pokaz();
    expect(screen.queryByRole("button", { name: /synchronizuj/i })).not.toBeInTheDocument();
  });
});
