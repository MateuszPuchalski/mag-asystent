import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Czekanie, czekaKrotko, stopienCzekania } from "./Czekanie";

/* ── Czekanie kreskami (23 września 2026) ────────────────────────────────────
   Progi to pytanie „za co się wziąć": godzina, cztery, osiem. Test pilnuje
   progów i tego, że liczba zostaje przy kreskach — kreski bez liczby kazałyby
   zgadywać, gdzie przebiega granica. */
const G = 3_600_000;

describe("czekanie", () => {
  it("skraca do jednej jednostki", () => {
    expect(czekaKrotko(25 * 60_000)).toBe("25 min");
    expect(czekaKrotko(14 * G + 42 * 60_000)).toBe("14 g");
    expect(czekaKrotko(50 * G)).toBe("2 d");
  });

  it("kreski rosną na progach godzina, cztery, osiem", () => {
    expect(stopienCzekania(59 * 60_000).kreski).toBe(1);
    expect(stopienCzekania(1 * G).kreski).toBe(2);
    expect(stopienCzekania(4 * G).kreski).toBe(3);
    expect(stopienCzekania(8 * G).kreski).toBe(4);
  });

  it("liczba zostaje, a czytnik ekranu dostaje całe zdanie", () => {
    render(<Czekanie ms={14 * G} />);
    const znak = screen.getByTitle("czeka 14 g");
    expect(znak).toHaveTextContent("czeka 14 g");
    expect(znak.querySelectorAll("[aria-hidden='true']")).toHaveLength(4);
  });
});
