import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

vi.mock("../api/wiedza", () => ({ useModele: () => ({ data: undefined }) }));
const { PolaModelu } = await import("./PolaModelu");

/* ── Pola modelu: wiersz zwarty NIE MOŻE chować pól ──────────────────────────
   Blizna: `sr-only` stało na `<label>`, który obejmuje też input. W trybie
   zwartym znikał więc cały wiersz — cztery pola zwężone do 26 px, nie do
   trafienia myszą. Testy jednostkowe tego nie widziały, bo w jsdomie klasa nie
   ma szerokości; złapało to dopiero sprawdzenie w przeglądarce. Ten test
   pilnuje KSZTAŁTU: chowany jest napis, nie pole.                          */

const dane = { rodzaj: "silnik" as const, marka: "", nazwa: "", wariant: "" };

describe("PolaModelu", () => {
  it("w trybie zwartym chowa się NAPIS, a nie pole razem z nim", () => {
    render(<PolaModelu dane={dane} onZmiana={vi.fn()} zwarte />);
    for (const nazwa of ["Marka", "Model", "Wariant"]) {
      const etykieta = screen.getByLabelText(nazwa).closest("label")!;
      expect(etykieta).not.toHaveClass("sr-only");
      expect(etykieta.querySelector(".sr-only")?.textContent).toBe(nazwa);
    }
  });

  it("poza trybem zwartym napis jest widoczny", () => {
    render(<PolaModelu dane={dane} onZmiana={vi.fn()} />);
    expect(screen.getByText("Marka")).not.toHaveClass("sr-only");
  });

  it("zablokowany rodzaj nie pozwala dopisać maszyny tam, gdzie idą silniki", () => {
    render(<PolaModelu dane={dane} onZmiana={vi.fn()} zwarte rodzajStaly />);
    expect(screen.getByLabelText("Rodzaj urządzenia")).toBeDisabled();
  });
});
