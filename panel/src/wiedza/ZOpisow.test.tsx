import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ModelZOpisu } from "../api/typy";

/* ── „Z opisów" (E3) ─────────────────────────────────────────────────────────
   Decyzja właściciela: automat nie proponuje z opisu. Pilnujemy, że
   „Zaproponuj" stoi bez marki i modelu, a po ich wpisaniu wysyła ID wiersza
   z modelem; „Odrzuć" wysyła samo ID.                                      */

const przerob = vi.fn();
const odrzuc = vi.fn();
const WIERSZE: ModelZOpisu[] = [
  { id: 7, twId: 14, symbol: "FTC272", nazwa: "Podkładka przekładni", tekst: "FS200 FS250", stan: "nowy",
    zastosowanieId: null, rozstrzygnal: null, rozstrzygnietoAt: null, at: "2026-09-01T07:00:00Z" },
];
vi.mock("../api/wiedza", () => ({
  useModeleZOpisow: () => ({ data: { wiersze: WIERSZE, liczba: 1 }, isLoading: false, error: null }),
  usePrzerobModelZOpisu: () => ({ mutate: przerob, isPending: false }),
  useOdrzucModelZOpisu: () => ({ mutate: odrzuc, isPending: false }),
  useModele: () => ({ data: { modele: [] } }),
}));

const { ZOpisow } = await import("./ZOpisow");

describe("sekcje Modele: z opisów", () => {
  it("Zaproponuj stoi bez marki i modelu, a z nimi wysyła wiersz z modelem", async () => {
    render(<ZOpisow />);
    expect(screen.getByText("FTC272")).toBeInTheDocument();
    expect(screen.getByText("Modele: FS200 FS250")).toBeInTheDocument();
    const zaproponuj = screen.getByRole("button", { name: "Zaproponuj" });
    expect(zaproponuj).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Marka"), "STIHL");
    expect(zaproponuj).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Model"), "FS 250");
    expect(zaproponuj).toBeEnabled();
    await userEvent.click(zaproponuj);
    expect(przerob).toHaveBeenCalledWith(
      { id: 7, model: { rodzaj: "maszyna", marka: "STIHL", nazwa: "FS 250", wariant: null } }, expect.anything());
  });

  it("Odrzuć oddaje samo ID wiersza", async () => {
    render(<ZOpisow />);
    await userEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    expect(odrzuc).toHaveBeenCalledWith({ id: 7 }, expect.anything());
  });
});
