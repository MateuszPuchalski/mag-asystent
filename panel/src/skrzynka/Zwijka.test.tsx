import React from "react";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Zwijka } from "./Zwijka";

/* ── Zwijany blok (0.342.0, pamięć od 0.389.0) ───────────────────────────────
   Testy pilnują trzech rzeczy, z których każda była powodem powstania:

   1. ZAMKNIĘTY NAPRAWDĘ CHOWA. Blok, który tylko udaje zwinięcie, nie oddaje
      ani piksela wysokości — a po to powstał.
   2. PAMIĘĆ JEST NAWYKIEM STANOWISKA. Agent, który zwija Copilota, pracuje bez
      niego; klikanie przy każdej sprawie byłoby optymalizacją dla użycia
      pierwszego, nie dziesięciotysięcznego (dekalog, punkt 3).
   3. PRYWATNE OKNO NIE MA PRAWA WYWRÓCIĆ EKRANU. `localStorage` rzuca tam
      przy odczycie i przy zapisie — ta sama pułapka co przy sicie „Moje".  */

const KLUCZ = "wertis.test.zwijka";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("Zwijka", () => {
  it("zamknięty blok CHOWA treść, otwarty ją pokazuje", async () => {
    render(<Zwijka tytul="Copilot"><p>wnętrze</p></Zwijka>);

    expect(screen.getByText("wnętrze")).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /Copilot/ }));
    expect(screen.getByText("wnętrze")).toBeVisible();
  });

  it("bez klucza wybór NIE przeżywa zamknięcia ekranu", async () => {
    const { unmount } = render(<Zwijka tytul="Copilot" domyslnieOtwarte><p>wnętrze</p></Zwijka>);
    await userEvent.click(screen.getByRole("button", { name: /Copilot/ }));
    unmount();

    render(<Zwijka tytul="Copilot" domyslnieOtwarte><p>wnętrze</p></Zwijka>);
    expect(screen.getByText("wnętrze")).toBeVisible();
  });

  it("z kluczem zwinięcie zostaje — także dla bloku domyślnie otwartego", async () => {
    const { unmount } = render(
      <Zwijka tytul="Copilot" domyslnieOtwarte pamietajJako={KLUCZ}><p>wnętrze</p></Zwijka>);
    await userEvent.click(screen.getByRole("button", { name: /Copilot/ }));
    unmount();

    render(<Zwijka tytul="Copilot" domyslnieOtwarte pamietajJako={KLUCZ}><p>wnętrze</p></Zwijka>);
    expect(screen.getByText("wnętrze")).not.toBeVisible();
  });

  it("zapamiętane ROZWINIĘCIE też wraca, nie tylko zwinięcie", async () => {
    const { unmount } = render(
      <Zwijka tytul="Copilot" pamietajJako={KLUCZ}><p>wnętrze</p></Zwijka>);
    await userEvent.click(screen.getByRole("button", { name: /Copilot/ }));
    unmount();

    render(<Zwijka tytul="Copilot" pamietajJako={KLUCZ}><p>wnętrze</p></Zwijka>);
    expect(screen.getByText("wnętrze")).toBeVisible();
  });

  it("prywatne okno nie wywraca bloku — zostaje wybór na jedno wejście", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("odmowa"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("odmowa"); });

    render(<Zwijka tytul="Copilot" domyslnieOtwarte pamietajJako={KLUCZ}><p>wnętrze</p></Zwijka>);
    expect(screen.getByText("wnętrze")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /Copilot/ }));
    expect(screen.getByText("wnętrze")).not.toBeVisible();
  });

  it("nagłówek mówi, co jest w środku, zanim blok się otworzy", () => {
    render(<Zwijka tytul="Copilot" podpis="usterka, oczekiwanie klienta"
      plakietka={<span>2 braki</span>}><p>wnętrze</p></Zwijka>);

    expect(screen.getByText("usterka, oczekiwanie klienta")).toBeInTheDocument();
    expect(screen.getByText("2 braki")).toBeInTheDocument();
  });
});
