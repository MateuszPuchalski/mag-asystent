import { describe, expect, test } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProcesCopilota } from "./ProcesCopilota";
import type { TwierdzenieCopilota } from "../api/typy";

/* ── Okno „Skąd to wiem" (0.253.0) ───────────────────────────────────────────
   Testy pilnują umowy, którą właściciel postawił, zdejmując zakaz wiedzy
   własnej: „pełna swoboda, ale niech przy tym załącza źródła".

   Z tej umowy wynikają trzy rzeczy sprawdzalne na ekranie. Twierdzenie ma
   widoczne ŹRÓDŁO. Twierdzenie spoza bazy samo otwiera okno, bo agent ma je
   przeczytać przed wysłaniem. Szkic w całości z bazy nie zabiera agentowi
   ani jednego ruchu.                                                        */

const t = (n: Partial<TwierdzenieCopilota> = {}): TwierdzenieCopilota => ({
  teza: "Gaźnik W09-0211 jest dziś na stanie",
  zrodlo: "fakty", odwolanie: "F1", pewnosc: "pewne", obnizona: false, ...n,
});

describe("okno procesu Copilota", () => {
  test("bez twierdzeń nie ma czego pokazywać — okno nie istnieje", () => {
    const { container } = render(<ProcesCopilota twierdzenia={[]} />);
    expect(container.firstChild).toBeNull();
  });

  test("szkic w całości z bazy zwija się i nie woła agenta plakietką", () => {
    render(<ProcesCopilota twierdzenia={[t(), t({ teza: "Pasuje do LC170430140-0001", odwolanie: "F3" })]} />);
    const przelacznik = screen.getByRole("button", { name: /Skąd to wiem/ });
    expect(przelacznik.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/do sprawdzenia/)).toBeNull();
  });

  test("jedno zdanie z wiedzy modelu otwiera okno i liczy, ile jest do sprawdzenia", () => {
    render(<ProcesCopilota twierdzenia={[
      t(),
      t({ teza: "Ten gaźnik zwykle ma gwint M10", zrodlo: "model", odwolanie: null, pewnosc: "niepewne" }),
    ]} />);
    expect(screen.getByRole("button", { name: /Skąd to wiem/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("1 do sprawdzenia")).toBeTruthy();
    expect(screen.getByText("z wiedzy modelu")).toBeTruthy();
    expect(screen.getByText("Ten gaźnik zwykle ma gwint M10")).toBeTruthy();
  });

  test("opis oferty jest osobnym źródłem, nie bazą — bo bywa starszy od towaru", () => {
    render(<ProcesCopilota twierdzenia={[
      t({ teza: "Średnica 46 mm", zrodlo: "oferta", odwolanie: "F4", pewnosc: "prawdopodobne" }),
    ]} />);
    expect(screen.getByText("z opisu oferty F4")).toBeTruthy();
    expect(screen.getByText("1 do sprawdzenia")).toBeTruthy();
  });

  test("obniżenie pewności widać, bo mówi coś o modelu, nie o części", () => {
    render(<ProcesCopilota twierdzenia={[
      t({ teza: "Pasuje do 340", zrodlo: "model", odwolanie: null, pewnosc: "niepewne", obnizona: true }),
    ]} />);
    expect(screen.getByText(/pewność obniżona przez serwer/)).toBeTruthy();
  });

  test("agent zwija okno jednym kliknięciem", () => {
    render(<ProcesCopilota twierdzenia={[t({ zrodlo: "model", odwolanie: null })]} />);
    const przelacznik = screen.getByRole("button", { name: /Skąd to wiem/ });
    fireEvent.click(przelacznik);
    expect(przelacznik.getAttribute("aria-expanded")).toBe("false");
  });
});
