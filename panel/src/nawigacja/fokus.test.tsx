import { beforeEach, describe, expect, it } from "vitest";
import React, { useEffect, useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { klawiszZajety, useOkno, useSkrotyDzialaja } from "./fokus";

/* ── Podpowiedź klawisza tylko wtedy, gdy klawisz działa (0.500.0) ────────
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

/* ── Okna dialogowe: fokus wchodzi, zostaje i wraca (@wydanie) ─────────────
   Strona niżej ma nasłuch skrótów na `window`, jak kolejki panelu. Pyta
   o `klawiszZajety`, więc pod oknem modalnym ma milczeć. */

let skroty: string[] = [];
beforeEach(() => { skroty = []; });

function Okno({ modalne = true, onZamknij, etykieta, children }: {
  modalne?: boolean; onZamknij?: () => void; etykieta: string; children?: React.ReactNode;
}) {
  const okno = useOkno<HTMLDivElement>({ modalne, onZamknij });
  return <div role="dialog" {...okno} aria-label={etykieta}>{children}</div>;
}

function Strona({ modalne = true }: { modalne?: boolean }) {
  const [pierwsze, setPierwsze] = useState(false);
  const [drugie, setDrugie] = useState(false);
  const dziala = useSkrotyDzialaja();
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (!klawiszZajety(e.target)) skroty.push(e.key); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  return <div>
    <button type="button" onClick={() => setPierwsze(true)}>otwórz</button>
    <button type="button">obok</button>
    {dziala && <kbd>J</kbd>}
    {pierwsze && <Okno modalne={modalne} etykieta="pierwsze" onZamknij={() => setPierwsze(false)}>
      <button type="button" onClick={() => setDrugie(true)}>głębiej</button>
      <button type="button">środek</button>
      {drugie && <Okno etykieta="drugie" onZamknij={() => setDrugie(false)}>
        <button type="button" data-fokus-startowy>w drugim</button>
      </Okno>}
    </Okno>}
  </div>;
}

describe("okna dialogowe", () => {
  it("fokus wchodzi do okna, a po Escape wraca do przycisku, który je otworzył", async () => {
    render(<Strona />);
    const otworz = screen.getByRole("button", { name: "otwórz" });
    await userEvent.click(otworz);
    const okno = screen.getByRole("dialog", { name: "pierwsze" });
    expect(okno).toHaveAttribute("aria-modal", "true");
    /* Samo okno, nie pierwszy przycisk: Enter z rozpędu niczego nie naciśnie. */
    expect(document.activeElement).toBe(okno);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(otworz);
  });

  it("Tab i Shift+Tab krążą w oknie modalnym, nie wychodzą na stronę", async () => {
    render(<Strona />);
    await userEvent.click(screen.getByRole("button", { name: "otwórz" }));
    /* Tożsamość elementu, nie tekst: `body` też „zawiera” napis przycisku. */
    const glebiej = screen.getByRole("button", { name: "głębiej" });
    const srodek = screen.getByRole("button", { name: "środek" });
    await userEvent.tab();
    expect(document.activeElement).toBe(glebiej);
    await userEvent.tab();
    expect(document.activeElement).toBe(srodek);
    await userEvent.tab();
    expect(document.activeElement).toBe(glebiej);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(srodek);
  });

  it("Escape zamyka tylko górne okno; fokus wraca piętro niżej", async () => {
    render(<Strona />);
    await userEvent.click(screen.getByRole("button", { name: "otwórz" }));
    const glebiej = screen.getByRole("button", { name: "głębiej" });
    await userEvent.click(glebiej);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "w drugim" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "drugie" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "pierwsze" })).toBeInTheDocument();
    expect(document.activeElement).toBe(glebiej);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pod oknem modalnym skróty strony i ich znaczki milkną, po zamknięciu wracają", async () => {
    render(<Strona />);
    await userEvent.click(screen.getByRole("button", { name: "otwórz" }));
    expect(screen.queryByText("J")).toBeNull();
    await userEvent.keyboard("j");
    expect(skroty).toEqual([]);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("J")).toBeInTheDocument();
    await userEvent.keyboard("j");
    expect(skroty).toEqual(["j"]);
  });

  it("okno niemodalne przyjmuje fokus, ale nie wycisza strony i nie więzi tabulatora", async () => {
    render(<Strona modalne={false} />);
    await userEvent.click(screen.getByRole("button", { name: "otwórz" }));
    const okno = screen.getByRole("dialog", { name: "pierwsze" });
    expect(okno).not.toHaveAttribute("aria-modal");
    expect(document.activeElement).toBe(okno);
    await userEvent.keyboard("j");
    expect(skroty).toEqual(["j"]);
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(okno.contains(document.activeElement)).toBe(false);
  });

  it("fokus nie wraca, gdy agent przy oknie niemodalnym wybrał już inne miejsce", async () => {
    render(<Strona modalne={false} />);
    await userEvent.click(screen.getByRole("button", { name: "otwórz" }));
    const obok = screen.getByRole("button", { name: "obok" });
    await userEvent.click(obok);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(obok);
  });

  it("okno z polem `autoFocus` oddaje fokus polu, z którego przyszło (Ctrl+K w trakcie pisania)", async () => {
    /* Wyzwalacz czytany przy rysowaniu: pole z `autoFocus` bierze fokus,
       zanim ruszy jakikolwiek efekt. `StrictMode`, bo panel w nim stoi,
       a udawane odmontowanie oddawało fokus wyzwalaczowi i pole w oknie
       go traciło — zmierzone w Chromium na serwerze deweloperskim. */
    function Pisanie() {
      const [szukam, setSzukam] = useState(false);
      return <div>
        <textarea aria-label="odpowiedź" onKeyDown={(e) => { if (e.key === "F2") setSzukam(true); }} />
        {szukam && <Okno etykieta="szukaj" onZamknij={() => setSzukam(false)}>
          <input aria-label="fraza" autoFocus />
        </Okno>}
      </div>;
    }
    render(<React.StrictMode><Pisanie /></React.StrictMode>);
    const pole = screen.getByLabelText("odpowiedź");
    await userEvent.click(pole);
    await userEvent.keyboard("{F2}");
    expect(document.activeElement).toBe(screen.getByLabelText("fraza"));
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(pole);
  });
});
