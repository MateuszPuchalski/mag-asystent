import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Cofniecie, OKNO_COFNIECIA_CZYNNOSCI_MS, type DoCofniecia } from "./Cofniecie";

/* ── „Cofnij" zamiast „czy na pewno" (0.500.0) ─────────────────────────────
   Pilnujemy trzech rzeczy: cofnięcie woła odwrotną czynność i zamyka pasek,
   pasek znika sam po oknie, a przerysowanie z tym samym wpisem nie odsuwa
   jego zniknięcia — inaczej odświeżana lista trzymałaby go bez końca.      */

afterEach(() => vi.useRealTimers());

const wpis = (cofnij = vi.fn()): DoCofniecia => ({ klucz: 1, opis: "Zakończono rozmowę z Jan", cofnij });

describe("pasek cofnięcia", () => {
  it("bez wpisu nie rysuje niczego", () => {
    const { container } = render(<Cofniecie wpis={null} onZamknij={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("„Cofnij” woła odwrotną czynność i zamyka pasek", () => {
    const cofnij = vi.fn();
    const zamknij = vi.fn();
    render(<Cofniecie wpis={wpis(cofnij)} onZamknij={zamknij} />);
    expect(screen.getByRole("status")).toHaveTextContent("Zakończono rozmowę z Jan");
    fireEvent.click(screen.getByRole("button", { name: /Cofnij/ }));
    expect(cofnij).toHaveBeenCalledOnce();
    expect(zamknij).toHaveBeenCalledOnce();
  });

  it("znika sam po oknie, a przerysowanie tego samego wpisu nie odsuwa zegara", () => {
    vi.useFakeTimers();
    const zamknij = vi.fn();
    const w = wpis();
    const { rerender } = render(<Cofniecie wpis={w} onZamknij={zamknij} />);
    act(() => { vi.advanceTimersByTime(OKNO_COFNIECIA_CZYNNOSCI_MS - 1000); });
    rerender(<Cofniecie wpis={{ ...w }} onZamknij={() => zamknij()} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(zamknij).toHaveBeenCalledOnce();
  });
});
