import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Edytor, LIMIT_ZNAKOW } from "./Edytor";

/* ── Edytor odpowiedzi w reklamacji (0.224.0) ────────────────────────────────
   Cztery rzeczy warte testu, bo każdą z nich łatwo zepsuć poprawką wyglądu:

   1. PRZYCISK MARTWY PRZY PUSTYM POLU. Puste żądanie i tak wróciłoby z 400,
      tylko o jeden strzał do serwera i jedno zdanie błędu później.
   2. LIMIT BLOKUJE PRZED WYSŁANIEM. W skrzynce limit pilnuje wyłącznie
      serwer, więc agent dowiaduje się o przekroczeniu po kliknięciu — tutaj
      limit znamy ze specyfikacji (`MessageRequest.text`, maxLength 20000).
   3. LICZNIK MILCZY, DOPÓKI NIE MA CO POWIEDZIEĆ. Czerwony napis stojący
      cały czas przestaje być czytany — dekalog, punkt 5.
   4. PRZY ZAMKNIĘTEJ ROZMOWIE EDYTORA NIE MA W DRZEWIE. Nie „disabled":
      pole, w które wolno pisać, a którego nie da się wysłać, jest obietnicą
      bez pokrycia. Ten sam wzorzec co tryb komentarza w skrzynce.          */

const props = (n: Partial<React.ComponentProps<typeof Edytor>> = {}) => ({
  tresc: "", wysyla: false, blad: "", czatAktywny: true,
  onZmiana: vi.fn(), onWyslij: vi.fn(), ...n,
});

const przycisk = () => screen.getByRole("button", { name: /WYŚLIJ|WYSYŁAM/ });

describe("Edytor odpowiedzi w reklamacji", () => {
  it("przycisk jest martwy przy pustym polu i przy samych spacjach", () => {
    const { rerender } = render(<Edytor {...props()} />);
    expect(przycisk()).toBeDisabled();
    rerender(<Edytor {...props({ tresc: "   \n  " })} />);
    expect(przycisk()).toBeDisabled();
    rerender(<Edytor {...props({ tresc: "Dobrze" })} />);
    expect(przycisk()).toBeEnabled();
  });

  it("przekroczony limit BLOKUJE wysyłkę i mówi, o ile znaków za dużo", () => {
    render(<Edytor {...props({ tresc: "x".repeat(LIMIT_ZNAKOW + 7) })} />);
    expect(przycisk()).toBeDisabled();
    expect(screen.getByText(/o 7 za dużo/)).toBeInTheDocument();
  });

  it("licznik jest szary daleko od sufitu, a kolorowy dopiero przy progu", () => {
    /* Próg to 500 znaków przed limitem. Poniżej licznik ma być tłem, nie
       ostrzeżeniem — inaczej ostrzeżenie przestaje cokolwiek znaczyć. */
    const { rerender } = render(<Edytor {...props({ tresc: "x".repeat(100) })} />);
    expect(screen.getByText(/^100 znaków$/)).toHaveClass("text-slate-400");
    rerender(<Edytor {...props({ tresc: "x".repeat(LIMIT_ZNAKOW - 10) })} />);
    expect(screen.getByText(/znaków$/)).toHaveClass("text-ranga-uwaga");
  });

  it("kliknięcie woła wysyłkę RAZ, a w trakcie przycisk jest martwy", async () => {
    const onWyslij = vi.fn();
    const { rerender } = render(<Edytor {...props({ tresc: "Wysyłam nowy nóż", onWyslij })} />);
    await userEvent.click(przycisk());
    expect(onWyslij).toHaveBeenCalledTimes(1);
    rerender(<Edytor {...props({ tresc: "Wysyłam nowy nóż", onWyslij, wysyla: true })} />);
    expect(screen.getByRole("button", { name: /WYSYŁAM/ })).toBeDisabled();
  });

  it("przy zamkniętej rozmowie edytora NIE MA — nie jest wyłączony, nie ma go", () => {
    render(<Edytor {...props({ czatAktywny: false })} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/nowej wiadomości nie przyjmie/)).toBeInTheDocument();
  });

  it("edytor NIE odsyła już do Centrum Sprzedaży — werdykt wychodzi z panelu", () => {
    /* Do przyrostu trzeciego stało tu zdanie „Formalny werdykt wydaje się
       w Centrum Sprzedaży". Zdanie, które przestało być prawdą, jest gorsze
       od jego braku. */
    render(<Edytor {...props()} />);
    expect(screen.queryByText(/Centrum Sprzedaży/)).not.toBeInTheDocument();
  });

  it("błąd z serwera stoi PRZY POLU, a nie w rogu ekranu", () => {
    render(<Edytor {...props({ blad: "Allegro zamknęło rozmowę w tej sprawie" })} />);
    expect(screen.getByText(/Allegro zamknęło rozmowę/)).toBeInTheDocument();
  });
});
