import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Odlozone, nastepnaRozmowa, type Odlozona } from "./Odlozone";

/* ── Dziesięć sekund na cofnięcie (23 września 2026) ─────────────────────────
   Komponent jest czysty; pilnujemy, że każdy stan daje właściwe wyjście:
   odliczanie ma „Cofnij", odmowa ma „Wróć do rozmowy", wysłane — samo
   zamknięcie. Pomylenie tych przycisków to wysyłka, której nie da się cofnąć. */

const o = (stan: Odlozona["stan"]): Odlozona => ({ klucz: 1, rozmowaId: 7, klient: "marc***1", stan });

describe("odłożona wysyłka", () => {
  it("odliczanie pokazuje sekundy i daje „Cofnij”", async () => {
    const onCofnij = vi.fn();
    render(<Odlozone lista={[o({ rodzaj: "czeka", doKiedy: Date.now() + 9_500 })]}
      onCofnij={onCofnij} onWroc={vi.fn()} onZamknij={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/wyjdzie za 10 s/);
    await userEvent.click(screen.getByRole("button", { name: "Cofnij" }));
    expect(onCofnij).toHaveBeenCalledWith(1);
  });

  it("odmowa serwera mówi dlaczego i prowadzi z powrotem do rozmowy", async () => {
    const onWroc = vi.fn();
    render(<Odlozone lista={[o({ rodzaj: "blad", komunikat: "klient dopisał w międzyczasie" })]}
      onCofnij={vi.fn()} onWroc={onWroc} onZamknij={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("klient dopisał w międzyczasie");
    expect(screen.queryByRole("button", { name: "Cofnij" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Wróć do rozmowy" }));
    expect(onWroc).toHaveBeenCalledWith(1);
  });

  it("po wysłaniu nie ma już czego cofać", () => {
    render(<Odlozone lista={[o({ rodzaj: "wyslana" })]}
      onCofnij={vi.fn()} onWroc={vi.fn()} onZamknij={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Wysłano do marc***1");
    expect(screen.queryByRole("button", { name: "Cofnij" })).toBeNull();
  });
});

describe("następna rozmowa po wysyłce", () => {
  it("bierze kolejną, przy ostatniej poprzednią, a spoza listy — żadną", () => {
    expect(nastepnaRozmowa([4, 7, 9], 7)).toBe(9);
    expect(nastepnaRozmowa([4, 7, 9], 9)).toBe(7);
    expect(nastepnaRozmowa([7], 7)).toBeNull();
    expect(nastepnaRozmowa([4, 9], 7)).toBeNull();
  });
});
