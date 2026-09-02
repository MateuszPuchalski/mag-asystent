import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { PokrycieSygnatur } from "./PokrycieSygnatur";
import type { PokrycieSygnatur as Pokrycie } from "../api/typy";

/* Karta ma mówić o ROBOCIE, nie o procentach: sygnatura bez kartoteki to
   jedno kliknięcie w Allegro albo jedna kartoteka w Subiekcie. */

const dane = (n: Partial<Pokrycie> = {}): Pokrycie => ({
  pozycji: 10, bezSygnatury: 3, trafia: 5, sygnatur: 6, pudla: [], zdublowane: [], ...n,
});

describe("PokrycieSygnatur", () => {
  it("liczy pozycje z sygnaturą jako różnicę, nie osobne pole", () => {
    render(<PokrycieSygnatur dane={dane()} />);
    expect(screen.getByText("z sygnaturą").previousSibling).toHaveTextContent("7");
    expect(screen.getByText("wiąże się samo").previousSibling).toHaveTextContent("5");
  });

  it("wypisuje sygnatury, które nie trafiają w kartotekę", () => {
    render(<PokrycieSygnatur dane={dane({
      pudla: [{ sygnatura: "W27-9999", nazwa: "Nóż do kosiarki", pozycji: 2, kartotek: 0 }],
    })} />);
    expect(screen.getByText("W27-9999")).toBeInTheDocument();
    expect(screen.getByText(/Takiego symbolu nie ma w Subiekcie/)).toBeInTheDocument();
  });

  it("symbol zdublowany ma WŁASNĄ sekcję — to inna naprawa niż literówka", () => {
    /* Pudło poprawia się w Allegro albo zakładając kartotekę; dubel — porządkiem
       w Subiekcie. Zlanie ich w jedną listę kazałoby zgadywać, co zrobić. */
    render(<PokrycieSygnatur dane={dane({
      zdublowane: [{ sygnatura: "DUBEL", nazwa: "Dwa razy ten sam symbol", pozycji: 1, kartotek: 2 }],
    })} />);
    expect(screen.getByText(/Dwie kartoteki o tym samym symbolu/)).toBeInTheDocument();
    expect(screen.queryByText(/Takiego symbolu nie ma/)).toBeNull();
  });

  it("puste listy nie zostawiają pustych nagłówków", () => {
    render(<PokrycieSygnatur dane={dane()} />);
    expect(screen.queryByText("Sygnatury bez kartoteki")).toBeNull();
    expect(screen.queryByText("Symbol zdublowany w Subiekcie")).toBeNull();
  });

  it("bez pobranych zamówień mówi, na co czeka", () => {
    render(<PokrycieSygnatur dane={dane({ pozycji: 0, bezSygnatury: 0, trafia: 0, sygnatur: 0 })} />);
    expect(screen.getByText(/Nie ma jeszcze pobranych zamówień/)).toBeInTheDocument();
  });
});
