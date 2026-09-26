import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* ── Pasek „Nowe w panelu" (0.500.0) ───────────────────────────────────────
   Pilnujemy: pasek pokazuje nowsze niż zamknięte (najnowsze od razu, resztę
   po „+N"), „Rozumiem" zapamiętuje najnowsze i chowa pasek, a samo otwarcie
   niczego nie zapisuje — ani na serwerze, ani w przeglądarce.              */

vi.mock("virtual:wertis-zmiany", () => ({ default: { wersja: "0.501.0", zmiany: [
  { wersja: "0.501.0", data: "26 września 2026", naglowki: ["Cofnij po zakończeniu", "Znaczki klawiszy"] },
  { wersja: "0.500.0", data: "25 września 2026", naglowki: ["Soczewki pytań"] },
] } }));

const { CoNowego } = await import("./CoNowego");

beforeEach(() => localStorage.clear());

describe("pasek „Nowe w panelu”", () => {
  it("pokazuje najnowsze wydanie, starsze za „+N”, i nie zapisuje nic przy otwarciu", async () => {
    localStorage.setItem("wertis.coNowego.widziana", "0.499.0");
    const zapis = vi.spyOn(Storage.prototype, "setItem");
    render(<CoNowego />);
    expect(screen.getByText(/Cofnij po zakończeniu · Znaczki klawiszy/)).toBeInTheDocument();
    /* Jeden wiersz naraz (@wydanie): starsze wydanie czeka za „+1". */
    expect(screen.queryByText(/Soczewki pytań/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^\+1/ }));
    expect(screen.getByText(/Soczewki pytań/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^\+1/ })).toBeNull();
    expect(zapis).not.toHaveBeenCalled();
    zapis.mockRestore();
  });

  it("jedno wydanie do pokazania nie dostaje „+N”", () => {
    localStorage.setItem("wertis.coNowego.widziana", "0.500.0");
    render(<CoNowego />);
    expect(screen.getByText(/Cofnij po zakończeniu/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^\+/ })).toBeNull();
  });

  it("„Rozumiem” zapamiętuje najnowsze i chowa pasek", async () => {
    localStorage.setItem("wertis.coNowego.widziana", "0.500.0");
    render(<CoNowego />);
    expect(screen.queryByText(/Soczewki pytań/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Rozumiem/ }));
    expect(localStorage.getItem("wertis.coNowego.widziana")).toBe("0.501.0");
    expect(screen.queryByRole("region", { name: "Nowe w panelu" })).toBeNull();
  });

  it("po zamknięciu bieżącego wydania nie ma czego pokazać", () => {
    localStorage.setItem("wertis.coNowego.widziana", "0.501.0");
    const { container } = render(<CoNowego />);
    expect(container).toBeEmptyDOMElement();
  });
});
