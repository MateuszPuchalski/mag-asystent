import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* ── Wyszukiwarka kartotek (0.203.0) ─────────────────────────────────────────
   To pole nie miało własnego testu, choć obsługuje pięć ekranów: dobór,
   kartotekę przy rozmowie, zlecenie pomiaru, sprawdzenie wiedzy i nową
   propozycję. Zdjęcie przy wyniku weszło tu raz dla wszystkich pięciu, więc
   i strażnik jest jeden.

   Pilnujemy dwóch rzeczy naraz, bo obie odpowiadają na to samo pytanie
   („który z tych wierszy to TA część"): wynik niesie obraz kartoteki,
   a wybrany towar zostaje z obrazem po kliknięciu.                          */

const api = vi.fn();
vi.mock("./api/klient", () => ({ api: (...a: unknown[]) => api(...a), token: () => "t" }));
vi.mock("./towar/useZdjecie", () => ({
  useZdjecie: (twId: number | null) => (twId == null ? null : `blob:${twId}`),
}));

const { Wyszukiwarka } = await import("./wyszukiwarka");

const WYNIKI = [
  { id: 14, sym: "FTC272", name: "Podkładka przekładni STIHL FS120", locs: ["A-01-2"] },
  { id: 15, sym: "FTC273", name: "Podkładka przekładni STIHL FS250", locs: [] },
];

describe("wyszukiwarka kartotek", () => {
  it("wynik niesie zdjęcie kartoteki, a wybrany towar zostaje z nim", async () => {
    api.mockResolvedValue({ results: WYNIKI, przyblizone: false });
    const onWybierz = vi.fn();
    const { rerender } = render(<Wyszukiwarka wybrany={null} onWybierz={onWybierz} />);

    await userEvent.type(screen.getByPlaceholderText(/Szukaj po symbolu/), "podkładka");
    /* Odpytanie idzie po pauzie w pisaniu — bez tego każda litera to jedno
       zapytanie do Subiekta. */
    const pierwszy = await screen.findByAltText("Podkładka przekładni STIHL FS120");
    expect(pierwszy).toBeInTheDocument();
    expect(screen.getByAltText("Podkładka przekładni STIHL FS250")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Podkładka przekładni STIHL FS120"));
    expect(onWybierz).toHaveBeenCalledWith(WYNIKI[0]);

    rerender(<Wyszukiwarka wybrany={WYNIKI[0]} onWybierz={onWybierz} />);
    expect(screen.getByAltText("Podkładka przekładni STIHL FS120")).toBeInTheDocument();
    expect(screen.getByText("FTC272")).toBeInTheDocument();
  });
});
