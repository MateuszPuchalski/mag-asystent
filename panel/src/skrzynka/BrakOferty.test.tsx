import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrakOferty } from "./BrakOferty";

describe("BrakOferty", () => {
  it("mówi o braku wprost, zamiast go ukrywać", () => {
    render(<BrakOferty zapisuje={false} blad="" onWskaz={() => {}} onDopytaj={() => {}} />);
    expect(screen.getByText("Brak powiązania z ofertą")).toBeInTheDocument();
    /* Zdanie mówi o KLIENCIE, nie o ekranie (0.506.0) — agent ma wiedzieć,
       czego brakuje, a nie jak ekran został zaprojektowany. Od @wydanie
       stoi w dymku: tytuł i dwie czynności mówią już to samo. */
    expect(screen.getByTitle("Nie wiadomo, o który towar pyta klient.")).toBeInTheDocument();
    expect(screen.queryByText(/Nie wiadomo, o który towar/)).toBeNull();
    expect(screen.queryByText(/Ekran mówi/)).toBeNull();
  });

  /* ── Jedna linijka (@wydanie, wariant C) ─────────────────────────────────
     Decyzja właściciela z 28 września 2026: brak i obie czynności w JEDNYM
     rzędzie, który zawija się tylko przy braku miejsca. jsdom nie mierzy
     pikseli, więc pilnujemy struktury: tytuł i przyciski mają wspólny rząd,
     a rząd zawija się, zamiast wymuszać drugą linię. */
  it("brak i obie czynności stoją w jednym rzędzie", () => {
    render(<BrakOferty zapisuje={false} blad="" onWskaz={() => {}} onDopytaj={() => {}} />);
    const rzad = screen.getByText("Brak powiązania z ofertą").closest("p")!.parentElement!;
    expect(rzad.className).toMatch(/\bflex\b/);
    expect(rzad.className).toMatch(/\bflex-wrap\b/);
    expect(rzad).toContainElement(screen.getByRole("button", { name: "Wskaż ofertę" }));
    expect(rzad).toContainElement(screen.getByRole("button", { name: "Dopytaj o numer" }));
    /* Żadnego drugiego rzędu przed rozwinięciem: pole numeru czeka na klik. */
    expect(screen.queryByLabelText("Numer oferty Allegro")).toBeNull();
  });

  it("„Dopytaj o numer” robi to, co dawne „Dopytaj klienta o numer oferty”", async () => {
    const dopytaj = vi.fn();
    render(<BrakOferty zapisuje={false} blad="" onWskaz={() => {}} onDopytaj={dopytaj} />);
    await userEvent.click(screen.getByRole("button", { name: "Dopytaj o numer" }));
    expect(dopytaj).toHaveBeenCalledOnce();
  });

  it("ręczne wskazanie oddaje numer i zapowiada, że to wybór agenta", async () => {
    const wskaz = vi.fn();
    render(<BrakOferty zapisuje={false} blad="" onWskaz={wskaz} onDopytaj={() => {}} />);
    const przycisk = screen.getByRole("button", { name: "Wskaż ofertę" });
    expect(przycisk).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(przycisk);
    expect(przycisk).toHaveAttribute("aria-expanded", "true");
    await userEvent.type(screen.getByLabelText("Numer oferty Allegro"), "14892374512");
    expect(screen.getByText(/Twój wybór, nie fakt z Allegro/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ZAPISZ" }));
    expect(wskaz).toHaveBeenCalledWith("14892374512");
  });

  it("pusty numer nie przechodzi", async () => {
    render(<BrakOferty zapisuje={false} blad="" onWskaz={() => {}} onDopytaj={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Wskaż ofertę" }));
    expect(screen.getByRole("button", { name: "ZAPISZ" })).toBeDisabled();
  });
});
