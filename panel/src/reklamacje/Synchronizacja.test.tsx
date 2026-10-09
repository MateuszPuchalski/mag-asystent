import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StanReklamacji } from "../api/typy";
import { PrzyciskSynchronizacji, StanSynchronizacji } from "./Synchronizacja";

/* ── Synchronizacja przy tytule kolejki ──────────────────────────────────────
   W ciszy godzina, w awarii stan czerwienią. Przycisk-ikona ma nazwę dla
   czytnika i działa wyłącznie na jawne kliknięcie.                         */

const STAN = {
  status: "current", alarm: false, ostatniaProba: null,
  ostatniaUdanaSynchronizacja: "2026-10-09T12:05:00.000Z", kodOstatniegoBledu: null,
  liczbaBledow: 0, opoznienieMs: 0, nastepnaProba: null, interwalMs: 180000,
  pozostaloDoPobrania: 0, dyskusjiPominietych: 0,
} as unknown as StanReklamacji;

describe("Synchronizacja reklamacji", () => {
  it("przycisk-ikona nazywa się „Synchronizuj z Allegro” i woła raz na klik", async () => {
    const onSynchronizuj = vi.fn();
    render(<PrzyciskSynchronizacji trwa={false} onSynchronizuj={onSynchronizuj} />);
    expect(onSynchronizuj).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Synchronizuj z Allegro" }));
    expect(onSynchronizuj).toHaveBeenCalledTimes(1);
  });

  it("w trakcie przycisk jest martwy, a ikona się kręci tylko bez ograniczenia ruchu", () => {
    render(<PrzyciskSynchronizacji trwa onSynchronizuj={vi.fn()} />);
    const b = screen.getByRole("button", { name: "Synchronizuj z Allegro" });
    expect(b).toBeDisabled();
    expect(b.querySelector("svg")!.getAttribute("class")).toMatch(/motion-safe:animate-spin/);
  });

  it("w ciszy drobne „Allegro: HH:MM”", () => {
    render(<StanSynchronizacji stan={STAN} blad="" />);
    expect(screen.getByText(/^Allegro: \d{2}:\d{2}$/).className).toMatch(/text-xs/);
  });

  it("zła synchronizacja mówi stan i kod czerwienią, a błąd przycisku stoi pod nim", () => {
    render(<StanSynchronizacji stan={{ ...STAN, status: "failed", kodOstatniegoBledu: 503 }}
      blad="Allegro odmówiło: limit" />);
    expect(screen.getByText("Synchronizacja Allegro: nie działa, kod 503").className).toMatch(/text-ranga-zle/);
    expect(screen.getByText("Allegro odmówiło: limit").className).toMatch(/text-ranga-zle/);
  });

  it("niekompletna lista woła pełnym zdaniem czerwienią", () => {
    render(<StanSynchronizacji stan={{ ...STAN, pozostaloDoPobrania: 12 }} blad="" />);
    expect(screen.getByText(/Ta kolejka nie jest kompletna: 12 spraw/).className).toMatch(/text-ranga-zle/);
  });

  it("bez stanu nie zgaduje godziny", () => {
    render(<StanSynchronizacji blad="" />);
    expect(screen.getByText("Allegro: stan nieznany")).toBeInTheDocument();
  });
});
