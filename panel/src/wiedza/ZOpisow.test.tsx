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
const Z_OPISU: ModelZOpisu =
  { id: 7, twId: 14, symbol: "FTC272", nazwa: "Podkładka przekładni", tekst: "FS200 FS250", stan: "nowy",
    zastosowanieId: null, rozstrzygnal: null, rozstrzygnietoAt: null, at: "2026-09-01T07:00:00Z",
    zrodlo: "opis", ofertaId: null };
const WIERSZE: ModelZOpisu[] = [Z_OPISU];

/* Wiersz z NASZEJ oferty (0.264.0): ta sama kolejka i ta sama robota, ale
   człowiek ma poznać, na co patrzy — opis kartoteki pisał magazyn, listę
   zgodności sprzedawca w aukcji. Dokładany w SWOIM teście, nie do listy
   domyślnej: dwa wiersze naraz zrobiłyby z „Zaproponuj" zapytanie
   niejednoznaczne w testach, które o źródło nie pytają. */
const Z_OFERTY: ModelZOpisu = {
  id: 8, twId: 14, symbol: "FTC272", nazwa: "Podkładka przekładni", tekst: "STIHL FS250", stan: "nowy",
  zastosowanieId: null, rozstrzygnal: null, rozstrzygnietoAt: null, at: "2026-09-01T07:05:00Z",
  zrodlo: "oferta", ofertaId: "14023867457",
};
vi.mock("../api/wiedza", () => ({
  useModeleZOpisow: () => ({ data: { wiersze: WIERSZE, liczba: 1 }, isLoading: false, error: null }),
  usePrzerobModelZOpisu: () => ({ mutate: przerob, isPending: false }),
  useOdrzucModelZOpisu: () => ({ mutate: odrzuc, isPending: false }),
  useModele: () => ({ data: { modele: [] } }),
  /* Tokeny (0.239.0) mają własny test; tu sekcja ma tylko nie przeszkadzać. */
  useTokenySilnikow: () => ({ data: { tokeny: [], nowychRazem: 0 }, isLoading: false, error: null }),
  useDodajToken: () => ({ mutate: vi.fn(), isPending: false }),
  useRozstrzygnijToken: () => ({ mutate: vi.fn(), isPending: false }),
  useUsunToken: () => ({ mutate: vi.fn(), isPending: false }),
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

  it("wiersz z oferty mówi, SKĄD jest — inna waga świadectwa, inna decyzja", () => {
    /* Bez tego znacznika kolejka zrównywałaby opis magazynu z deklaracją
       sprzedawcy w aukcji, a człowiek rozstrzygający bywa przy nich innego
       zdania. Numer oferty stoi obok, bo „skąd to się wzięło" musi mieć
       odpowiedź, gdy pozycja okaże się błędna. */
    WIERSZE.length = 0;
    WIERSZE.push(Z_OFERTY);
    try {
      render(<ZOpisow />);
      expect(screen.getByText("Lista zgodności oferty: STIHL FS250")).toBeInTheDocument();
      expect(screen.getByText(/z naszej oferty Allegro 14023867457/)).toBeInTheDocument();
    } finally {
      WIERSZE.length = 0;
      WIERSZE.push(Z_OPISU);
    }
  });
});
