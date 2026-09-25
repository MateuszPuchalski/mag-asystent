import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* ── Pasek „Nowe w panelu" (0.500.0) ───────────────────────────────────────
   Pilnujemy: pasek pokazuje nowsze niż zamknięte, „Rozumiem" zapamiętuje
   najnowsze i chowa pasek, a samo otwarcie niczego nie zapisuje — ani na
   serwerze, ani w przeglądarce.                                            */

vi.mock("virtual:wertis-zmiany", () => ({ default: { wersja: "0.501.0", zmiany: [
  { wersja: "0.501.0", data: "26 września 2026", naglowki: ["Cofnij po zakończeniu", "Znaczki klawiszy"] },
  { wersja: "0.500.0", data: "25 września 2026", naglowki: ["Soczewki pytań"] },
] } }));

const { CoNowego } = await import("./CoNowego");

beforeEach(() => localStorage.clear());

describe("pasek „Nowe w panelu”", () => {
  it("pokazuje wydania nowsze niż zamknięte i nie zapisuje nic przy otwarciu", () => {
    localStorage.setItem("wertis.coNowego.widziana", "0.499.0");
    const zapis = vi.spyOn(Storage.prototype, "setItem");
    render(<CoNowego />);
    expect(screen.getByText(/Cofnij po zakończeniu · Znaczki klawiszy/)).toBeInTheDocument();
    expect(screen.getByText(/Soczewki pytań/)).toBeInTheDocument();
    expect(zapis).not.toHaveBeenCalled();
    zapis.mockRestore();
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
