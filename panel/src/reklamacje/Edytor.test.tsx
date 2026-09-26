import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { Edytor, LIMIT_ZNAKOW } = await import("./Edytor");

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

const przycisk = () => screen.getByRole("button", { name: /Wyślij|Wysyłam/ });

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

  it("licznika NIE MA daleko od sufitu, staje dopiero przy progu", () => {
    /* Od @wydanie licznik milczy zupełnie, jak w skrzynce od 0.506.0. Szary
       „100 znaków" przy każdej odpowiedzi był tłem, którego nikt nie czytał —
       liczba zmienia decyzję dopiero 500 znaków przed sufitem Allegro. */
    const { rerender } = render(<Edytor {...props({ tresc: "x".repeat(100) })} />);
    expect(screen.queryByText(/\/ 20000/)).not.toBeInTheDocument();
    rerender(<Edytor {...props({ tresc: "x".repeat(LIMIT_ZNAKOW - 10) })} />);
    expect(screen.getByText(`${LIMIT_ZNAKOW - 10} / ${LIMIT_ZNAKOW}`)).toHaveClass("text-ranga-uwaga");
    rerender(<Edytor {...props({ tresc: "x".repeat(LIMIT_ZNAKOW + 3) })} />);
    expect(screen.getByText(/o 3 za dużo/)).toHaveClass("text-ranga-zle");
  });

  it("kliknięcie woła wysyłkę RAZ, a w trakcie przycisk jest martwy", async () => {
    const onWyslij = vi.fn();
    const { rerender } = render(<Edytor {...props({ tresc: "Wysyłam nowy nóż", onWyslij })} />);
    await userEvent.click(przycisk());
    expect(onWyslij).toHaveBeenCalledTimes(1);
    rerender(<Edytor {...props({ tresc: "Wysyłam nowy nóż", onWyslij, wysyla: true })} />);
    expect(screen.getByRole("button", { name: /Wysyłam/ })).toBeDisabled();
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

  it("spinacz i lista plików są TYM SAMYM komponentem co w skrzynce (0.274.0)", async () => {
    /* Decyzja właściciela z 0.246.0 o wspólnym załączniku dotyczyła strony
       przychodzącej; ta sama racja obowiązuje po drugiej stronie. Ta sama
       czynność ma wyglądać i zachowywać się identycznie na obu ekranach. */
    const onDodajZalacznik = vi.fn();
    const onUsunZalacznik = vi.fn();
    render(<Edytor {...props({
      zalaczniki: [{ id: 4, allegroId: "att-1", nazwa: "nowy-noz.jpg",
        typ: "image/jpeg", rozmiar: 2048, dodal: "Ala" }],
      onDodajZalacznik, onUsunZalacznik,
    })} />);

    expect(screen.getByText("nowy-noz.jpg")).toBeInTheDocument();
    expect(screen.getByLabelText("Wybierz plik do odpowiedzi")).toBeInTheDocument();
  });

  it("bez obsługi plików edytor NIE pokazuje spinacza — obietnica bez pokrycia", () => {
    /* Ten sam wzorzec co przy zamkniętej rozmowie: czego nie da się zrobić,
       tego nie ma na ekranie. */
    render(<Edytor {...props()} />);
    expect(screen.queryByLabelText("Wybierz plik do odpowiedzi")).not.toBeInTheDocument();
  });
});

/* ── Szablonów nie ma (22 września 2026) ─────────────────────────────────────
   Decyzja właściciela: szablony odeszły z całego panelu, razem z trasami
   i tabelą. Test pilnuje, żeby przycisk nie wrócił przy scalaniu. */
describe("Edytor reklamacji bez szablonów", () => {
  it("przy polu odpowiedzi nie ma przycisku szablonów", () => {
    render(<Edytor tresc="" wysyla={false} blad="" czatAktywny
      onZmiana={vi.fn()} onWyslij={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Szablony/ })).not.toBeInTheDocument();
  });
  it("Ctrl+Enter wysyła jak przycisk — i jak on milczy przy pustej treści (23 września 2026)", async () => {
    const pelny = props({ tresc: "Dobrze" });
    const { rerender } = render(<Edytor {...pelny} />);
    screen.getByLabelText("Odpowiedź w sprawie").focus();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(pelny.onWyslij).toHaveBeenCalledTimes(1);
    const pusty = props({ tresc: "  " });
    rerender(<Edytor {...pusty} />);
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(pusty.onWyslij).not.toHaveBeenCalled();
  });
});
