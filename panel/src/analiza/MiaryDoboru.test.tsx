import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { MiaryDoboru as Raport } from "../api/typy";
import { MiaryDoboru } from "./MiaryDoboru";

/* ── Karta miar doboru ───────────────────────────────────────────────────────
   Dane idą propsem, więc test nie podmienia żadnego haka. Pilnuje trzech
   decyzji: każdy udział stoi z podstawą `n`, zero zostaje wierszem tabeli,
   a puste okno jest jednym zdaniem zamiast tabeli zer. Osi osobowej nie ma. */

const dane = (n: Partial<Raport> = {}): Raport => ({
  dni: 30,
  wyniki: { czesc: 6, brak: 2, dopytac: 2, nie_dotyczy: 0 },
  podstawy: { numer: 3, wiedza: 2, podobne: 0, reczny: 1 },
  otwarte: 4,
  ...n,
});

describe("miary doboru", () => {
  it("odpowiedzi i podstawy stoją z liczbą, udziałem i podstawą n", () => {
    render(<MiaryDoboru dane={dane()} />);
    expect(screen.getByText("wyników doboru").previousSibling).toHaveTextContent("10");
    expect(screen.getByText("otwartych dziś").previousSibling).toHaveTextContent("4");
    const [odpowiedzi, podstawy] = screen.getAllByRole("table");
    expect(within(odpowiedzi).getByRole("columnheader", { name: "udział z 10" })).toBeInTheDocument();
    expect(within(odpowiedzi).getByRole("row", { name: /Wybrano część 6 60%/ })).toBeInTheDocument();
    expect(within(podstawy).getByRole("columnheader", { name: "udział z 6" })).toBeInTheDocument();
    expect(within(podstawy).getByRole("row", { name: /Wskazane przez klienta 3 50%/ })).toBeInTheDocument();
  });

  it("zero zostaje wierszem, nie znika", () => {
    render(<MiaryDoboru dane={dane()} />);
    expect(screen.getByRole("row", { name: /Nie dotyczy 0 0%/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Podobne po nazwie 0 0%/ })).toBeInTheDocument();
  });

  it("bez wybranej części udział podstaw to kreska, nie „0%”", () => {
    render(<MiaryDoboru dane={dane({ wyniki: { czesc: 0, brak: 1, dopytac: 0, nie_dotyczy: 0 },
      podstawy: { numer: 0, wiedza: 0, podobne: 0, reczny: 0 } })} />);
    const podstawy = screen.getAllByRole("table")[1];
    expect(within(podstawy).getByRole("row", { name: /Z bazy wiedzy 0 —/ })).toBeInTheDocument();
  });

  it("puste okno to jedno zdanie, a bez danych karty nie ma", () => {
    const { container, rerender } = render(<MiaryDoboru dane={dane({
      wyniki: { czesc: 0, brak: 0, dopytac: 0, nie_dotyczy: 0 },
      podstawy: { numer: 0, wiedza: 0, podobne: 0, reczny: 0 }, otwarte: 0 })} />);
    expect(screen.getByText(/Żadnego wyniku doboru w tym oknie/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    rerender(<MiaryDoboru dane={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("nie ma osi osobowej", () => {
    render(<MiaryDoboru dane={dane()} />);
    expect(screen.queryByRole("columnheader", { name: /kto|osoba/i })).toBeNull();
  });
});
