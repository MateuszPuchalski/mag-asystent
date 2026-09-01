import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrakOferty } from "./BrakOferty";

describe("BrakOferty", () => {
  it("mówi o braku wprost, zamiast go ukrywać", () => {
    render(<BrakOferty zapisuje={false} blad="" onWskaz={() => {}} onDopytaj={() => {}} />);
    expect(screen.getByText(/Brak powiązania z ofertą/)).toBeInTheDocument();
    expect(screen.getByText(/zgadniętą z treści/)).toBeInTheDocument();
  });

  it("ręczne wskazanie oddaje numer i zapowiada, że to wybór agenta", async () => {
    const wskaz = vi.fn();
    render(<BrakOferty zapisuje={false} blad="" onWskaz={wskaz} onDopytaj={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Wskaż ofertę ręcznie" }));
    await userEvent.type(screen.getByLabelText("Numer oferty Allegro"), "14892374512");
    expect(screen.getByText(/Twój wybór, nie fakt z Allegro/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ZAPISZ" }));
    expect(wskaz).toHaveBeenCalledWith("14892374512");
  });

  it("pusty numer nie przechodzi", async () => {
    render(<BrakOferty zapisuje={false} blad="" onWskaz={() => {}} onDopytaj={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Wskaż ofertę ręcznie" }));
    expect(screen.getByRole("button", { name: "ZAPISZ" })).toBeDisabled();
  });
});
