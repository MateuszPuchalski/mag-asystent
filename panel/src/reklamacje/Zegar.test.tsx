import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasekZegara, wPilnosci } from "./Zegar";
import type { Reklamacja } from "../api/typy";

/* Pasek zegara ma odpowiadać na pytanie „ile mam dziś zdążyć". Te testy
   pilnują, żeby nie odpowiadał na żadne inne: żeby milczał przy samych zerach,
   żeby dał się kliknąć i odkliknąć, i żeby liczył WYŁĄCZNIE pracę — sprawa
   rozstrzygnięta ma termin w kolumnie, ale nie ma już decyzji do podjęcia.  */

const sprawa = (n: Partial<Reklamacja>) => ({
  kubelek: "decyzja", dniDoTerminu: 0, ...n,
} as Reklamacja);

describe("wPilnosci", () => {
  it("dzieli zegar na trzy rozłączne kubełki", () => {
    expect(wPilnosci(sprawa({ dniDoTerminu: -1 }), "poTerminie")).toBe(true);
    expect(wPilnosci(sprawa({ dniDoTerminu: 0 }), "dzis")).toBe(true);
    expect(wPilnosci(sprawa({ dniDoTerminu: 1 }), "jutro")).toBe(true);
    /* Zero to „dziś", nie „po terminie". Granica myli się tu łatwo, a pomyłka
       przeniosłaby sprawę, którą da się jeszcze zdążyć, do przepadłych. */
    expect(wPilnosci(sprawa({ dniDoTerminu: 0 }), "poTerminie")).toBe(false);
    expect(wPilnosci(sprawa({ dniDoTerminu: 2 }), "jutro")).toBe(false);
  });

  it("nie liczy spraw, przy których nie ma już decyzji", () => {
    for (const kubelek of ["zamknieta", "odpowiedz", "bez_ruchu"] as const) {
      expect(wPilnosci(sprawa({ kubelek, dniDoTerminu: 0 }), "dzis")).toBe(false);
    }
  });

  it("sprawa bez terminu nie wchodzi nigdzie", () => {
    /* Brak terminu znaczy „Allegro go nie podało". Wliczenie takiej sprawy do
       „po terminie" byłoby wymyśleniem zegara, którego nie ma. */
    expect(wPilnosci(sprawa({ dniDoTerminu: null }), "poTerminie")).toBe(false);
  });
});

describe("PasekZegara", () => {
  const terminy = { poTerminie: 2, dzis: 3, jutro: 1 };

  it("milczy, gdy nic nie pali się na żadnym froncie", () => {
    const { container } = render(<PasekZegara wybrana={null} onWybierz={() => {}}
      terminy={{ poTerminie: 0, dzis: 0, jutro: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("podaje trzy liczby", () => {
    render(<PasekZegara terminy={terminy} wybrana={null} onWybierz={() => {}} />);
    for (const etykieta of ["Po terminie", "Dziś", "Jutro"]) {
      expect(screen.getByRole("button", { name: new RegExp(etykieta) })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /Dziś\s*3/ })).toBeInTheDocument();
  });

  it("wybiera i ODWYBIERA tę samą pozycję", async () => {
    const u = userEvent.setup();
    const zmien = vi.fn();
    const { rerender } = render(
      <PasekZegara terminy={terminy} wybrana={null} onWybierz={zmien} />);
    await u.click(screen.getByRole("button", { name: /Dziś/ }));
    expect(zmien).toHaveBeenCalledWith("dzis");

    /* Zawężenie, nie kubełek: drugie kliknięcie w wybraną pozycję ma je zdjąć.
       `FiltrSegmentowy` oddaje zawsze klucz klikniętej pozycji, więc `null`
       wylicza wołający — i to jest dokładnie to, co tu sprawdzamy. */
    rerender(<PasekZegara terminy={terminy} wybrana="dzis" onWybierz={zmien} />);
    await u.click(screen.getByRole("button", { name: /Dziś/ }));
    expect(zmien).toHaveBeenLastCalledWith(null);
  });
});
