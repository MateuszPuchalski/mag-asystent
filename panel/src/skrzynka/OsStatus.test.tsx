import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Os } from "./Os";

/* Zmiana statusu na osi (§10.3, 0.158.0). Wpis odpowiada na pytanie, którego
   sama lista wiadomości nie tłumaczy: dlaczego sprawa uznana za rozwiązaną
   znów jest otwarta. Autorem bywa KLIENT, bo to jego wiadomość ją obudziła. */
describe("Zmiana statusu na osi rozmowy", () => {
  const wpis = (n: Record<string, unknown> = {}) => ({
    id: "status-9", rodzaj: "status" as const, autor: "Ala", odKlienta: false,
    tresc: "resolved → open", at: "2026-09-01T10:00:00Z", ofertaId: null, ...n,
  });

  it("niesie przejście i podpis tego, kto je wywołał", () => {
    render(<Os wpisy={[wpis({ autor: "klient" })]} zrodloPomiaru={null} mozeZlecac={false}
      onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);
    expect(screen.getByText(/resolved → open/)).toBeInTheDocument();
    expect(screen.getByText(/klient/)).toBeInTheDocument();
  });

  it("nie udaje wypowiedzi: bez zlecenia pomiaru i bez wstawiania do szkicu", () => {
    /* Kafelek z przyciskami kazałby czytać zmianę stanu jak czyjąś kwestię —
       a §10.3 żąda, żeby każdy rodzaj wpisu wyglądał inaczej. */
    render(<Os wpisy={[wpis()]} zrodloPomiaru={null} mozeZlecac
      onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/NOTATKA WEWNĘTRZNA/)).toBeNull();
  });
});
