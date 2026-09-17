import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasekProgu } from "./Prog";
import type { ProgKolejki } from "../api/typy";

/* Pasek progu jest ZAPŁATĄ za narzędzie tępe. Próg daty nie pyta, czy sprawa
   jest skończona — pyta, kiedy wpłynęła. Te testy pilnują trzech rzeczy:
   że pasek milczy, gdy nie ma co powiedzieć; że czerwienieje WYŁĄCZNIE przy
   żywym obowiązku; i że przełącznik działa w obie strony. Zniknięcie z kolejki
   bez zdania byłoby gorsze od kolejki pokazującej za dużo.                   */

/* Próg w POŁUDNIE, nie o północy czasu lokalnego, i to jest świadome. Wartość
   wdrożeniowa to `2026-06-30T22:00:00Z`, czyli 1 lipca o północy w Warszawie —
   ale CI chodzi w UTC, gdzie ta sama chwila wypada 30 czerwca. Data wdrożeniowa
   w asercji sprawdzałaby strefę maszyny testowej, a nie pasek. */
const prog = (n: Partial<ProgKolejki> = {}): ProgKolejki => ({
  od: "2026-07-01T12:00:00Z", ukrytych: 212, ukrytychZTerminem: 0, zdjety: false, ...n,
});

describe("PasekProgu", () => {
  it("milczy, gdy progu nie ma", () => {
    const { container } = render(<PasekProgu prog={prog({ od: null })} onPrzelacz={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("milczy, gdy próg niczego nie schował", () => {
    /* Pasek ze zdaniem „starszych: 0" byłby samym szumem, a szum uczy biuro
       nie czytać pasków — także tego, który kiedyś będzie miał rację. */
    const { container } = render(<PasekProgu prog={prog({ ukrytych: 0 })} onPrzelacz={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("podaje datę progu i liczbę ukrytych", () => {
    render(<PasekProgu prog={prog()} onPrzelacz={() => {}} />);
    expect(screen.getByText(/1 lipca 2026/)).toBeInTheDocument();
    expect(screen.getByText("212")).toBeInTheDocument();
  });

  it("nie krzyczy przy zwykłym archiwum", () => {
    const { container } = render(<PasekProgu prog={prog()} onPrzelacz={() => {}} />);
    expect(container.querySelector(".bg-red-50")).toBeNull();
    expect(screen.queryByText(/termin decyzji/)).not.toBeInTheDocument();
  });

  it("krzyczy, gdy ukryta sprawa ma jeszcze termin decyzji", () => {
    /* To jest cały bezpiecznik tego progu. Zwykle ta liczba jest zerem — ale
       dzień, w którym nie jest, jest dokładnie tym dniem, dla którego liczymy. */
    const { container } = render(
      <PasekProgu prog={prog({ ukrytychZTerminem: 2 })} onPrzelacz={() => {}} />);
    expect(container.querySelector(".bg-red-50")).not.toBeNull();
    expect(screen.getByText(/2 sprawy sprzed progu ma jeszcze/)).toBeInTheDocument();
  });

  it("przełącznik działa w obie strony", async () => {
    const u = userEvent.setup();
    const zmien = vi.fn();
    const { rerender } = render(<PasekProgu prog={prog()} onPrzelacz={zmien} />);
    await u.click(screen.getByRole("button", { name: "pokaż starsze" }));
    expect(zmien).toHaveBeenCalledWith(true);

    /* Po zdjęciu progu pasek ZOSTAJE, choć ukrytych jest zero: bez niego nie
       byłoby drogi powrotnej i ekran milcząco pokazywałby całe archiwum. */
    rerender(<PasekProgu prog={prog({ zdjety: true, ukrytych: 0 })} onPrzelacz={zmien} />);
    await u.click(screen.getByRole("button", { name: "wróć do progu" }));
    expect(zmien).toHaveBeenLastCalledWith(false);
  });
});
