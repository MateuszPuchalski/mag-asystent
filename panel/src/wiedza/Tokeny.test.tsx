import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TokenSilnika } from "../api/typy";

/* ── Tokeny silników w nazwach kartotek (0.239.0) ────────────────────────────
   Decyzja właściciela: jedno kliknięcie zatwierdza ZAZNACZONE, odznaczone
   idą do pominiętych. Pilnujemy, że lista startuje zaznaczona, odznaczenie
   dwóch kartotek wysyła je w `pomin`, a resztę w `zatwierdz`; że „Dodaj
   token" niesie słowo i model silnika; że „Usuń" oddaje samo ID.        */

const dodaj = vi.fn();
const rozstrzygnij = vi.fn();
const usun = vi.fn();
let TOKENY: TokenSilnika[] = [];
vi.mock("../api/wiedza", () => ({
  useTokenySilnikow: () => ({ data: { tokeny: TOKENY, nowychRazem: TOKENY.reduce((s, t) => s + t.nowych, 0) },
    isLoading: false, error: null }),
  useDodajToken: () => ({ mutate: dodaj, isPending: false }),
  useRozstrzygnijToken: () => ({ mutate: rozstrzygnij, isPending: false }),
  useUsunToken: () => ({ mutate: usun, isPending: false }),
  useModele: () => ({ data: { modele: [] } }),
}));

const { Tokeny } = await import("./Tokeny");

const HONDA = { id: 3, rodzaj: "silnik" as const, marka: "Honda", nazwa: "GX160", wariant: null, lata: null,
  klucz: "silnik|honda|gx160", etykieta: "silnik Honda GX160" };
const kartoteka = (twId: number, symbol: string, nazwa: string) =>
  ({ twId, symbol, nazwa, stan: "nowa" as const, zastosowanieId: null });

beforeEach(() => {
  dodaj.mockReset(); rozstrzygnij.mockReset(); usun.mockReset();
  TOKENY = [{
    id: 1, token: "GX160", silnik: HONDA, dodal: "A. Lewandowska", dodanoAt: "2026-09-09T07:00:00Z",
    nowych: 3, zatwierdzonych: 4, pominietych: 1,
    nowe: [kartoteka(502, "W09-0211", "Gaźnik do silników HONDA GX160"),
      kartoteka(811, "LC170430140-0001", "Uszczelka gaźnika GX160"),
      kartoteka(900, "X-1", "Naklejka GX160 ozdobna")],
  }];
});

describe("tokeny silników w nazwach kartotek", () => {
  it("lista startuje zaznaczona; odznaczone idą w `pomin`, reszta w `zatwierdz`", async () => {
    render(<Tokeny />);
    const wiersz = screen.getByLabelText("Token: GX160");
    expect(within(wiersz).getByText(/nowych 3 · zatwierdzonych 4 · pominiętych 1/)).toBeInTheDocument();
    await userEvent.click(within(wiersz).getByRole("button", { name: "Przejrzyj (3)" }));
    const pola = within(wiersz).getAllByRole("checkbox");
    expect(pola).toHaveLength(3);
    for (const p of pola) expect(p).toBeChecked();
    const przycisk = within(wiersz).getByRole("button", { name: "Zatwierdź zaznaczone (3)" });
    await userEvent.click(within(wiersz).getByLabelText("Pasuje: Naklejka GX160 ozdobna"));
    expect(within(wiersz).getByRole("button", { name: "Zatwierdź zaznaczone (2)" })).toBe(przycisk);
    expect(within(wiersz).getByText(/odznaczone \(1\) zostaną pominięte/)).toBeInTheDocument();
    await userEvent.click(przycisk);
    expect(rozstrzygnij).toHaveBeenCalledWith({ id: 1, zatwierdz: [502, 811], pomin: [900] }, expect.anything());
  });

  it("„Dodaj token” stoi zwinięty, bez słowa i silnika nie wysyła, a z nimi niesie komplet", async () => {
    render(<Tokeny />);
    expect(screen.queryByLabelText("Słowo w nazwie kartoteki")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dodaj token" }));
    const wyslij = screen.getByRole("button", { name: "Dodaj token" });
    expect(wyslij).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Słowo w nazwie kartoteki"), "GCV160");
    await userEvent.type(screen.getByLabelText("Marka"), "Honda");
    expect(wyslij).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Model"), "GCV160");
    await userEvent.click(wyslij);
    expect(dodaj).toHaveBeenCalledWith(
      { token: "GCV160", silnik: { rodzaj: "silnik", marka: "Honda", nazwa: "GCV160", wariant: null } }, expect.anything());
  });

  it("„Usuń” oddaje samo ID tokenu", async () => {
    render(<Tokeny />);
    await userEvent.click(screen.getByRole("button", { name: "Usuń" }));
    expect(usun).toHaveBeenCalledWith({ id: 1 }, expect.anything());
  });

  it("pusty słownik mówi, co zrobić, i nie pokazuje listy", () => {
    TOKENY = [];
    render(<Tokeny />);
    expect(screen.getByText(/Słownik jest pusty/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
