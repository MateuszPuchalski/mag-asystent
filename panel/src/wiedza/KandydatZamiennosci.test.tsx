import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { KandydatZamiennosci as Kandydat } from "../api/typy";

/* ── Kandydat na zamienność przez wspólny numer oryginału ────────────────────
   Karta ma nieść to, po czym się rozstrzyga — pełne nazwy obu kartotek
   i wspólne numery z ich liczbą — a odrzucenie bez powodu nie ma prawa
   z niej wyjść, jak przy pasowaniu.                                       */

vi.mock("../towar/Kafel", () => ({ Kafel: () => <span /> }));
const { KandydatZamiennosci } = await import("./KandydatZamiennosci");

const NOZE: Kandydat = {
  a: { twId: 1, symbol: "14-11013", nazwa: "Nóż do traktorka CASTELGARDEN 62cm - lewy" },
  b: { twId: 2, symbol: "14-11022", nazwa: "Nóż do traktorka CASTELGARDEN 62cm - lewy mielący" },
  numery: ["1136-1032-01", "61517020110", "82004342/0"],
};

describe("Kandydat na zamienność", () => {
  it("pokazuje obie pełne nazwy i wspólne numery z ich liczbą", () => {
    render(<KandydatZamiennosci k={NOZE} trwa={false} onDecyzja={vi.fn()} />);
    expect(screen.getByRole("article", { name: "Zamienność: 14-11013 ⟷ 14-11022" })).toBeInTheDocument();
    /* Po nazwie się tu rozstrzyga: „lewy" przy „lewy mielący". */
    expect(screen.getByText("Nóż do traktorka CASTELGARDEN 62cm - lewy mielący")).toBeInTheDocument();
    expect(screen.getByText("3 wspólne numery oryginału:")).toBeInTheDocument();
    expect(screen.getByText("61517020110")).toBeInTheDocument();
  });

  it("„Zamienne” oddaje zatwierdzenie bez powodu", async () => {
    const onDecyzja = vi.fn();
    render(<KandydatZamiennosci k={NOZE} trwa={false} onDecyzja={onDecyzja} />);
    await userEvent.click(screen.getByRole("button", { name: "Zamienne" }));
    expect(onDecyzja).toHaveBeenCalledWith("zatwierdz", null);
  });

  it("odrzucenie nie wychodzi bez powodu, z powodem niesie go dalej", async () => {
    const onDecyzja = vi.fn();
    render(<KandydatZamiennosci k={NOZE} trwa={false} onDecyzja={onDecyzja} />);
    await userEvent.click(screen.getByRole("button", { name: "Nie są zamienne" }));
    const odrzuc = screen.getByRole("button", { name: "Odrzuć" });
    expect(odrzuc).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Powód odrzucenia" }), "  lewy zwykły i lewy mielący ");
    await userEvent.click(odrzuc);
    expect(onDecyzja).toHaveBeenCalledWith("odrzuc", "lewy zwykły i lewy mielący");
  });

  it("pięć i więcej wspólnych numerów stoi w dopełniaczu", () => {
    render(<KandydatZamiennosci k={{ ...NOZE, numery: ["1", "2", "3", "4", "5"].map((n) => `6151702011${n}`) }}
      trwa={false} onDecyzja={vi.fn()} />);
    expect(screen.getByText("5 wspólnych numerów oryginału:")).toBeInTheDocument();
  });

  it("jeden wspólny numer ma liczbę pojedynczą", () => {
    render(<KandydatZamiennosci k={{ ...NOZE, numery: ["532 17 50-64"] }} trwa={false} onDecyzja={vi.fn()} />);
    expect(screen.getByText("Wspólny numer oryginału:")).toBeInTheDocument();
  });
});
