import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Skan } from "./Skan";
import type { WynikSkanu } from "../api/zwroty";

/* Pole skanu mówi, CZEGO szukało. Przy czytniku „nie znalazłem" bez tej
   informacji wygląda identycznie jak zepsuty czytnik — a operator stoi wtedy
   z paczką i nie wie, czy skanować jeszcze raz, czy szukać ręcznie. */

const ETYKIETA = "600000367616070023174201";

const pokaz = (wynik: WynikSkanu | null, n: Partial<React.ComponentProps<typeof Skan>> = {}) => {
  const p = {
    wynik, kod: ETYKIETA, szuka: false, dociaga: false, blad: "",
    onKod: vi.fn(), onSzukaj: vi.fn(), onDociagnij: vi.fn(), onWybierz: vi.fn(), ...n,
  };
  render(<Skan {...p} />);
  return p;
};

describe("Pole skanu etykiety", () => {
  it("nieznany kod pokazuje SIEBIE i drogę wyjścia", async () => {
    const p = pokaz({ trafienie: null, zwrotId: null, zwroty: [] });
    /* Kod na ekranie, bo naklejka bywa pomięta i skan urwany w połowie. */
    expect(screen.getByText(ETYKIETA)).toBeInTheDocument();
    expect(screen.getByText(/Szukałem po numerze listu/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Poszukaj w Allegro/ }));
    expect(p.onDociagnij).toHaveBeenCalledWith(ETYKIETA);
  });

  it("dwa trafienia każą wybrać, zamiast otwierać pierwsze z brzegu", async () => {
    /* Przy zwrocie pomyłka znaczy cudzego klienta i cudze pieniądze. */
    const p = pokaz({
      trafienie: "wiele", zwrotId: null,
      zwroty: [{ id: 7, numer: "1111/Z04A", externalId: "a" },
        { id: 9, numer: null, externalId: "b-uuid" }],
    });
    expect(screen.getByText(/pasuje do 2 zwrotów/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1111/Z04A" }));
    expect(p.onWybierz).toHaveBeenCalledWith(7);
    /* Zwrot bez numeru referencyjnego pokazuje identyfikator, a nie pustkę. */
    expect(screen.getByRole("button", { name: "b-uuid" })).toBeInTheDocument();
  });

  it("trafienie nie zostawia po sobie żadnego komunikatu", () => {
    /* Zwrot już się otworzył — pasek z informacją byłby śmieciem na ekranie. */
    pokaz({ trafienie: "waybill", zwrotId: 4, zwroty: [] });
    expect(screen.queryByText(/Nie znam kodu/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pasuje do/)).not.toBeInTheDocument();
  });

  it("bez czytnika da się wpisać numer i zatwierdzić Enterem", async () => {
    const p = pokaz(null);
    const pole = screen.getByPlaceholderText(/Zeskanuj etykietę/);
    await userEvent.type(pole, "1234/Z04A{Enter}");
    expect(p.onSzukaj).toHaveBeenCalledWith("1234/Z04A");
  });

  it("puste pole nie strzela do serwera", async () => {
    const p = pokaz(null);
    await userEvent.type(screen.getByPlaceholderText(/Zeskanuj etykietę/), "   {Enter}");
    expect(p.onSzukaj).not.toHaveBeenCalled();
  });

  it("odmowa serwera ląduje przy polu, a nie w konsoli", () => {
    pokaz(null, { blad: "Konto Allegro nie jest sparowane" });
    expect(screen.getByText(/nie jest sparowane/)).toBeInTheDocument();
  });
});
