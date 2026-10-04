import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Zwrot } from "../api/typy";
import { SzybkiZwrot } from "./SzybkiZwrot";

/* ── Przycisk szybkiej ścieżki a jej przeszkoda ─────────────────────────────
   Reguła „kiedy wolno" stoi w `regulaSzybkiej.ts` i ma własne testy. Tu
   pilnujemy WYGLĄDU decyzji: gotowa ścieżka to przycisk z kwotą, zablokowana
   to jedna linia z powodem. Wyłączony przycisk nie jest drogą, a zajmował
   około 85 px nad jedyną realną akcją.                                      */

const zwrot = (n: Partial<Zwrot> = {}): Zwrot => ({
  id: 1, werdykt: null, waluta: "PLN",
  pozycje: [{ id: 1, cenaGrosze: 4999, ilosc: 1, ocena: null }],
  ...n,
} as unknown as Zwrot);

const pokaz = (stan: Parameters<typeof SzybkiZwrot>[0]["stan"], p: { trwa?: boolean; blad?: string; onStart?: () => void } = {}) =>
  render(<SzybkiZwrot zwrot={zwrot()} stan={stan} trwa={p.trwa ?? false}
    blad={p.blad ?? ""} onStart={p.onStart ?? (() => {})} />);

describe("SzybkiZwrot", () => {
  it("gotowa ścieżka to aktywny przycisk z kwotą i skrótem", async () => {
    const start = vi.fn();
    pokaz({ pokaz: true, przeszkoda: null }, { onStart: start });
    const przycisk = screen.getByRole("button", { name: /Wszystko OK/ });
    expect(przycisk).toBeEnabled();
    expect(przycisk).toHaveTextContent("49,99");
    expect(przycisk).toHaveTextContent("W");
    await userEvent.click(przycisk);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("w trakcie ciągu przycisk jest wyłączony, żeby nie puścić go drugi raz", () => {
    pokaz({ pokaz: true, przeszkoda: null }, { trwa: true });
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("zablokowana ścieżka to jedna linia z powodem, bez przycisku", () => {
    const { container } = pokaz({ pokaz: true, przeszkoda: "Brak odnośnika do zwrotu w Allegro — oddaj pieniądze ręcznie." });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Brak odnośnika do zwrotu w Allegro/)).toBeInTheDocument();
    expect(container.querySelector("[data-szybka-zablokowana]")).not.toBeNull();
    /* Kwoty nie ma: przy zablokowanej ścieżce nic się nie wypłaci. */
    expect(container).not.toHaveTextContent("49,99");
  });

  it("błąd z przerwanego ciągu zostaje widoczny także przy zablokowanej ścieżce", () => {
    /* Po częściowym zapisie reguła potrafi przejść w „zablokowane" (np. pozycja
       oceniona, a poza pudłem). Zdanie o tym, co się zatrzymało, nie ma prawa
       zniknąć razem z przyciskiem. */
    pokaz({ pokaz: true, przeszkoda: "Część pozycji ma inną ocenę niż „na stan” — dokończ ręcznie." },
      { blad: "Zatrzymałem się: Sekator nie weszła do pudła." });
    expect(screen.getByRole("alert")).toHaveTextContent("Zatrzymałem się: Sekator nie weszła do pudła.");
  });

  it("błąd przy gotowej ścieżce też jest widoczny", () => {
    pokaz({ pokaz: true, przeszkoda: null }, { blad: "Zwrot zmienił się w międzyczasie" });
    expect(screen.getByRole("alert")).toHaveTextContent("Zwrot zmienił się w międzyczasie");
  });

  it("poza zasięgiem ścieżki nie ma nic", () => {
    const { container } = pokaz({ pokaz: false });
    expect(container).toBeEmptyDOMElement();
  });
});
