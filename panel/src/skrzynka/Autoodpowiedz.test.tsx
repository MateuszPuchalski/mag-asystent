import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Os } from "./Os";
import type { WpisOsi } from "../api/typy";

/* ── Autoodpowiedź biura na osi (0.218.0) ────────────────────────────────────
   Skrzynka odbija każdy przychodzący list potwierdzeniem „Dziękujemy za
   kontakt": kilkanaście wierszy z godzinami pracy, po polsku i po angielsku,
   zero zdań o sprawie klienta. Właściciel: „zwijaj i oznaczaj".

   Testy pilnują trzech rzeczy, na których to stoi:
   1. ZWINIĘTE, ale OZNACZONE — agent ma wiedzieć, że coś tam jest.
   2. TREŚĆ DOSTĘPNA jednym kliknięciem, bo autoodpowiedź jest dowodem, że
      list dotarł, i przy sporze musi dać się przeczytać w panelu.
   3. PRAWDZIWA ODPOWIEDŹ SIĘ NIE ZWIJA — to jest cena pomyłki w tę stronę. */

const ODBICIE = "Dziękujemy za kontakt\n\nTa wiadomość jest generowana automatycznie…";

const wpis = (n: Partial<WpisOsi> = {}): WpisOsi => ({
  id: "msg-2", rodzaj: "wiadomosc", autor: "Biuro", odKlienta: false,
  tresc: ODBICIE, at: "2026-09-01T10:00:00Z", ofertaId: null, messageId: 2,
  automatyczna: true, ...n,
});

const os = (w: WpisOsi) => render(<Os wpisy={[w]} zrodloPomiaru={null} mozeZlecac={false}
  onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);

describe("Autoodpowiedź na osi rozmowy", () => {
  it("jest zwinięta i nazwana, a nie ukryta", () => {
    os(wpis());
    expect(screen.getByText("Autoodpowiedź biura")).toBeTruthy();
    expect(screen.queryByText(/generowana automatycznie/)).toBeNull();
  });

  it("treść jest jedno kliknięcie dalej i chowa się z powrotem", async () => {
    os(wpis());
    const przelacznik = screen.getByRole("button", { name: /pokaż treść/ });
    expect(przelacznik.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(przelacznik);
    expect(screen.getByText(/generowana automatycznie/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /zwiń/ }));
    expect(screen.queryByText(/generowana automatycznie/)).toBeNull();
  });

  it("odpowiedź agenta zostaje pełnym kafelkiem", () => {
    /* Bez flagi z serwera wpis idzie zwykłą gałęzią — zwinięcie prawdziwej
       odpowiedzi kosztowałoby więcej niż niezwinięcie jednego odbicia. */
    os(wpis({ automatyczna: false, tresc: "Szarpak SZR-148/82 pasuje." }));
    expect(screen.getByText("Szarpak SZR-148/82 pasuje.")).toBeTruthy();
    expect(screen.queryByText("Autoodpowiedź biura")).toBeNull();
    expect(screen.getByText("Odpowiedź firmy")).toBeTruthy();
  });
});
