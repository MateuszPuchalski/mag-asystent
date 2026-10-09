import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StanReklamacji, StatystykiReklamacji } from "../api/typy";
import { Kafle } from "./Kafle";

/* ── Kafle nad kolumnami reklamacji ──────────────────────────────────────────
   Cztery liczby dnia. Testy pilnują trzech reguł, których nie widać okiem:

   1. BRAK DANYCH TO „—”, NIGDY ZERO. Zero przy awarii serwera agent czyta
      jako „nic nie czeka” i kończy pracę (`panel/CLAUDE.md`).
   2. TREND TYLKO PRAWDZIWY. `tydzienTemu: null` daje zdanie opisowe, a nie
      „+18 od zeszłego tygodnia” liczone od zera.
   3. KAFEL KUBEŁKA JEST FILTREM — klik przestawia kolejkę, kafel bez
      kubełka niczego nie udaje.                                           */

const STAT: StatystykiReklamacji = {
  doDecyzji: { teraz: 18, tydzienTemu: 12 },
  doOdpowiedzi: { teraz: 11, tydzienTemu: null },
  poTerminie: { teraz: 1, tydzienTemu: 3 },
  sredniDniDoWerdyktu: { teraz: 2.4, poprzednio: 3.3, okresDni: 30 },
};

const STAN = {
  status: "current", alarm: false, ostatniaProba: null,
  ostatniaUdanaSynchronizacja: "2026-10-09T12:05:00.000Z", kodOstatniegoBledu: null,
  liczbaBledow: 0, opoznienieMs: 0, nastepnaProba: null, interwalMs: 180000,
  pozostaloDoPobrania: 0, dyskusjiPominietych: 0,
} as unknown as StanReklamacji;

const pokaz = (p: Partial<React.ComponentProps<typeof Kafle>> = {}) => {
  const onKubelek = vi.fn();
  const onSynchronizuj = vi.fn();
  render(<Kafle statystyki={STAT} kubelek="decyzja" onKubelek={onKubelek} stan={STAN}
    trwaSync={false} bladSync="" onSynchronizuj={onSynchronizuj} {...p} />);
  return { onKubelek, onSynchronizuj };
};

describe("Kafle reklamacji", () => {
  it("cztery kafle w kolejności z makiety, z liczbą na wierzchu", () => {
    pokaz();
    expect(screen.getByRole("button", { name: /^Do decyzji\s*18/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Do odpowiedzi\s*11/ })).toBeInTheDocument();
    expect(screen.getByText("Po terminie")).toBeInTheDocument();
    expect(screen.getByText("Średni czas do werdyktu")).toBeInTheDocument();
    expect(screen.getByText("2,4 dnia")).toBeInTheDocument();
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
  });

  it("po terminie z pracą świeci czerwienią, bez pracy — nie", () => {
    const { unmount } = render(<Kafle statystyki={STAT} kubelek={null} onKubelek={vi.fn()} stan={STAN}
      trwaSync={false} bladSync="" onSynchronizuj={vi.fn()} />);
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

  it("kafel kubełka jest filtrem: klik przestawia kubełek, wybrany jest wciśnięty", async () => {
    const { onKubelek } = pokaz();
    expect(screen.getByRole("button", { name: /^Do decyzji/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Do odpowiedzi/ })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: /^Do odpowiedzi/ }));
    expect(onKubelek).toHaveBeenCalledWith("odpowiedz");
  });

  it("kafel bez kubełka nie jest przyciskiem — nie obiecuje filtra, którego nie ma", () => {
    pokaz();
    expect(screen.queryByRole("button", { name: /Po terminie/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Średni czas/ })).not.toBeInTheDocument();
  });

  it("stan synchronizacji z godziną i jeden przycisk „Synchronizuj” na jawne kliknięcie", async () => {
    const { onSynchronizuj } = pokaz();
    expect(screen.getByText(/^Allegro: zsynchronizowano \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(onSynchronizuj).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Synchronizuj" }));
    expect(onSynchronizuj).toHaveBeenCalledTimes(1);
  });

  it("zła synchronizacja mówi stan i kod czerwienią, a błąd przycisku stoi pod nim", () => {
    pokaz({ stan: { ...STAN, status: "failed", kodOstatniegoBledu: 503 }, bladSync: "Allegro odmówiło: limit" });
    expect(screen.getByText("Synchronizacja Allegro: nie działa, kod 503").className).toMatch(/text-ranga-zle/);
    expect(screen.getByText("Allegro odmówiło: limit")).toBeInTheDocument();
  });

  it("niekompletna lista woła pełnym zdaniem", () => {
    pokaz({ stan: { ...STAN, pozostaloDoPobrania: 12 } });
    expect(screen.getByText(/Ta kolejka nie jest kompletna: 12 spraw/)).toBeInTheDocument();
  });
});
