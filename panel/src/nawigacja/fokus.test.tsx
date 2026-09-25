import { describe, expect, it } from "vitest";
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { useSkrotyDzialaja } from "./fokus";

/* ── Podpowiedź klawisza tylko wtedy, gdy klawisz działa (@wydanie) ────────
   Znaczek jednoliterowego skrótu znika, gdy fokus wchodzi w pole pisania,
   i wraca, gdy z niego wychodzi — dokładnie tam, gdzie skrót milknie.     */

function Proba() {
  const dziala = useSkrotyDzialaja();
  return <div>
    <textarea aria-label="pole" />
    <button type="button">przycisk</button>
    {dziala && <kbd>E</kbd>}
  </div>;
}

describe("znaczki skrótów", () => {
  it("znikają w polu tekstowym i wracają po wyjściu z niego", () => {
    render(<Proba />);
    expect(screen.getByText("E")).toBeInTheDocument();
    act(() => { screen.getByLabelText("pole").focus(); });
    expect(screen.queryByText("E")).toBeNull();
    act(() => { screen.getByRole("button").focus(); });
    expect(screen.getByText("E")).toBeInTheDocument();
    act(() => { screen.getByLabelText("pole").focus(); });
    act(() => { screen.getByLabelText("pole").blur(); });
    expect(screen.getByText("E")).toBeInTheDocument();
  });
});
