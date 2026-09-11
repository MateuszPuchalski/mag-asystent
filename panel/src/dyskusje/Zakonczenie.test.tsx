import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Dyskusja } from "../api/typy";
import { Zakonczenie } from "./Zakonczenie";

/* ── Prośba o zakończenie dyskusji (0.245.0) ─────────────────────────────────
   Pięć rzeczy, z których każda jest obietnicą wobec kupującego:

   1. PRZYCISK NIE OBIECUJE ZAKOŃCZENIA. Allegro nazywa tę wartość
      `END_REQUEST` i nigdzie nie mówi, że dyskusja się od niej zamknie.
      Napis „ZAKOŃCZ" byłby zgadywaniem skutku — tym samym rodzajem, który
      do 0.155.0 trzymał w kodzie adres, jakiego Allegro nie ma.
   2. ZGODA JEST WARUNKIEM, nie ozdobą: prośby nie da się cofnąć.
   3. PUSTA TREŚĆ NIE WYCHODZI. Prośba o zamknięcie sprawy bez ani jednego
      zdania to zamknięcie drzwi bez słowa.
   4. PO PROŚBIE PRZYCISKU NIE MA WCALE — nie jest wyszarzony. Wyszarzony
      zaprasza do kliknięcia i odmawia.
   5. PRZY ZAMKNIĘTYM CZACIE PASKA NIE MA. Allegro nie przyjmie już niczego. */

const d = (n: Partial<Dyskusja> = {}): Dyskusja => ({
  id: 1, externalId: "d-1", orderId: "ZAM-1", kupujacyLogin: "kowalski",
  temat: "Przesyłka nie dotarła", opis: null,
  statusAllegro: "DISPUTE_ONGOING", czatAktywny: true, wiadomosciIle: 2, czatUrwany: false,
  ostatniaWiadomoscStatus: "BUYER_REPLIED", ostatniaWiadomoscAt: null,
  ruchNasz: true, czekaOdDni: 2, dlugoCzeka: false,
  otwartoAt: "2026-09-01T10:00:00.000Z", prowadzi: null, prowadziId: null, tagi: [], prowadziAt: null, notatka: null,
  zakonczenieStatus: null, zakonczenieAt: null, zakonczeniePrzez: null,
  wersja: 1, kubelek: "odpowiedz", sygnaly: [], linkZamowienia: null,
  ...n,
});

const props = (n: Partial<React.ComponentProps<typeof Zakonczenie>> = {}) => ({
  dyskusja: d(), wysyla: false, blad: "", onZakoncz: vi.fn(), ...n,
});

describe("Prośba o zakończenie dyskusji", () => {
  it("przycisk PROSI o zakończenie, a nie kończy", () => {
    render(<Zakonczenie {...props()} />);
    expect(screen.getByRole("button", { name: /POPROŚ O ZAKOŃCZENIE/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^ZAKOŃCZ$/ })).not.toBeInTheDocument();
  });

  it("bez zgody wysyłka jest martwa, ze zgodą ożywa", async () => {
    render(<Zakonczenie {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: /POPROŚ/ }));
    const wyslij = screen.getByRole("button", { name: /WYŚLIJ PROŚBĘ/ });
    expect(wyslij).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(wyslij).toBeEnabled();
  });

  it("zdanie zgody mówi, że to Allegro zamyka dyskusję", async () => {
    render(<Zakonczenie {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: /POPROŚ/ }));
    expect(screen.getByText(/nie da się jej cofnąć/)).toBeInTheDocument();
    expect(screen.getByText(/Dyskusję zamyka Allegro, nie to kliknięcie/)).toBeInTheDocument();
  });

  it("pusta treść blokuje wysyłkę mimo zgody", async () => {
    render(<Zakonczenie {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: /POPROŚ/ }));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.clear(screen.getByRole("textbox"));
    expect(screen.getByRole("button", { name: /WYŚLIJ PROŚBĘ/ })).toBeDisabled();
  });

  it("wysyła treść z pola, raz", async () => {
    const onZakoncz = vi.fn();
    render(<Zakonczenie {...props({ onZakoncz })} />);
    await userEvent.click(screen.getByRole("button", { name: /POPROŚ/ }));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ PROŚBĘ/ }));
    expect(onZakoncz).toHaveBeenCalledTimes(1);
    expect(String(onZakoncz.mock.calls[0][0])).toMatch(/proszę o zakończenie/i);
  });

  it("po wysłanej prośbie przycisku NIE MA, a pasek mówi, że zamyka Allegro", () => {
    render(<Zakonczenie {...props({
      dyskusja: d({ zakonczenieStatus: "sent", zakonczeniePrzez: "Ala" }) })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/Poproszono o zakończenie/)).toBeInTheDocument();
    expect(screen.getByText(/Dyskusję zamyka Allegro, nie my/)).toBeInTheDocument();
  });

  it("niepewny los mówi, czego NIE robić", () => {
    render(<Zakonczenie {...props({ dyskusja: d({ zakonczenieStatus: "send_uncertain" }) })} />);
    expect(screen.getByText(/Nie wysyłaj drugiej prośby/)).toBeInTheDocument();
  });

  it("przy zamkniętym czacie paska nie ma wcale", () => {
    const { container } = render(
      <Zakonczenie {...props({ dyskusja: d({ czatAktywny: false }) })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("błąd z serwera stoi PRZY formularzu, a nie w rogu ekranu", async () => {
    render(<Zakonczenie {...props({ blad: "Allegro zamknęło rozmowę w tej sprawie" })} />);
    await userEvent.click(screen.getByRole("button", { name: /POPROŚ/ }));
    expect(screen.getByText(/Allegro zamknęło rozmowę/)).toBeInTheDocument();
  });
});
