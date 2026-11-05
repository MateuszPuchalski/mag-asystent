import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { StatystykiReklamacji } from "../api/typy";
import { Kafle } from "./Kafle";

/* ── Reklamacje w liczbach (Analiza) ─────────────────────────────────────────
   Cztery liczby z trendem. Testy pilnują reguł, których nie widać okiem:

   1. BRAK DANYCH TO „—”, NIGDY ZERO. Zero przy awarii serwera agent czyta
      jako „nic nie czeka” i kończy pracę (`panel/CLAUDE.md`).
   2. TREND TYLKO PRAWDZIWY. `tydzienTemu: null` daje zdanie opisowe, a nie
      „+18 od zeszłego tygodnia” liczone od zera.
   3. TO WGLĄD, NIE FILTR. Żaden kafel nie jest przyciskiem: widok kolejki
      wybiera rząd kubełków nad listą (`Kubelki.tsx`).                      */

const STAT: StatystykiReklamacji = {
  doDecyzji: { teraz: 18, tydzienTemu: 12 },
  doOdpowiedzi: { teraz: 11, tydzienTemu: null },
  poTerminie: { teraz: 1, tydzienTemu: 3 },
  sredniDniDoWerdyktu: { teraz: 2.4, poprzednio: 3.3, okresDni: 30 },
};

const pokaz = (p: Partial<React.ComponentProps<typeof Kafle>> = {}) =>
  render(<Kafle statystyki={STAT} {...p} />);

describe("Kafle reklamacji", () => {
  it("siatka w kolejności z makiety: liczba, nazwa, podpis", () => {
    pokaz();
    const siatka = screen.getByRole("group", { name: "Reklamacje w liczbach" });
    expect(siatka.className).toMatch(/grid-cols-2/);
    expect(siatka).toHaveTextContent(/^18 Do decyzji .*11 Do odpowiedzi .*1 Po terminie/);
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
    const { unmount } = pokaz();
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

  it("żaden kafel nie jest przyciskiem — liczby to wgląd, nie filtr kolejki", () => {
    pokaz();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("kafle nie niosą synchronizacji — ta stoi przy tytule kolejki", () => {
    pokaz();
    expect(screen.queryByRole("button", { name: /synchronizuj/i })).not.toBeInTheDocument();
  });
});
