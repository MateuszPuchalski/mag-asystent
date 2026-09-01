import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Kolejka, dniSlowo } from "./Kolejka";
import { Dowody } from "./Dowody";
import type { Zwrot } from "../api/typy";

/* Wiersz kolejki ma się czytać W BIEGU. Te testy pilnują trzech rzeczy,
   od których to zależy: pilność widać bez klikania, sygnał zapala się
   tylko wtedy, gdy naprawdę każe przeczytać, a ekran mówi wprost o tym,
   czego NIE wie i czego nie pobiera. */

const zwrot = (n: Partial<Zwrot> = {}): Zwrot => ({
  id: 1, externalId: "zw-1", numer: "REF-1", orderId: "ord-1",
  utworzono: "2026-08-25T09:00:00.000Z", paczkaAt: "2026-08-28T09:00:00.000Z",
  kubelek: "decyzja", sygnaly: [], terminAt: "2026-09-08T09:00:00.000Z",
  dniDoTerminu: 7, sumaPozycjiGrosze: 4999, waluta: "PLN",
  werdykt: null, kwotaGrosze: null, kwotaWariant: null, korektaNumer: null,
  rejectionCode: null, wersja: 1,
  pozycje: [{ id: 1, offerId: "111", nazwa: "Sekator NAC", ilosc: 1, cenaGrosze: 4999,
    waluta: "PLN", powod: "DONT_LIKE_IT", powodKomentarz: "za ciężki", ocena: null }],
  ...n,
});

describe("Kolejka zwrotów", () => {
  it("pusty kubełek mówi o sobie zamiast pokazywać pustą listę", () => {
    render(<Kolejka zwroty={[]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText(/Ten kubełek jest pusty/)).toBeInTheDocument();
  });

  it("wiersz niesie numer, towar, sztuki i kwotę — i ani jednej rzeczy więcej", () => {
    render(<Kolejka zwroty={[zwrot()]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("REF-1")).toBeInTheDocument();
    expect(screen.getByText(/Sekator NAC/)).toBeInTheDocument();
    expect(screen.getByText(/1 szt\./)).toBeInTheDocument();
    expect(screen.getByText("49,99 PLN")).toBeInTheDocument();
  });

  it("termin czyta się jako pilność, a po terminie liczy się dalej", () => {
    const { rerender } = render(
      <Kolejka zwroty={[zwrot({ dniDoTerminu: 7 })]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("7 dni")).toBeInTheDocument();
    rerender(<Kolejka zwroty={[zwrot({ dniDoTerminu: 0 })]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("dziś")).toBeInTheDocument();
    rerender(<Kolejka zwroty={[zwrot({ dniDoTerminu: -2 })]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("2 dni po")).toBeInTheDocument();
  });

  it("jeden dzień to dzień, a nie forma mnoga", () => {
    /* Ekran ma się czytać w biegu; zła forma zatrzymuje oko na pół sekundy. */
    expect(dniSlowo(1)).toBe("1 dzień");
    expect(dniSlowo(2)).toBe("2 dni");
    expect(dniSlowo(12)).toBe("12 dni");
    render(<Kolejka zwroty={[zwrot({ dniDoTerminu: 1 })]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("1 dzień")).toBeInTheDocument();
  });

  it("zwrot bez sygnałów nie żąda uwagi", () => {
    /* Kolor, który zapala się zawsze, uczy operatora go ignorować. */
    render(<Kolejka zwroty={[zwrot()]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.queryByText("termin")).not.toBeInTheDocument();
    expect(screen.queryByText("bez paczki")).not.toBeInTheDocument();
  });

  it("sygnały mają podpis, nie tylko barwę", () => {
    render(<Kolejka zwroty={[zwrot({ sygnaly: ["termin", "brak_dowodu"] })]}
      wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("termin")).toBeInTheDocument();
    expect(screen.getByText("bez paczki")).toBeInTheDocument();
  });

  it("wybrany wiersz jest wybrany także dla czytnika ekranu", () => {
    render(<Kolejka zwroty={[zwrot()]} wybrany={1} onWybierz={() => {}} />);
    expect(screen.getByRole("button", { current: true })).toBeInTheDocument();
  });

  it("kliknięcie oddaje identyfikator zwrotu", async () => {
    const wybierz = vi.fn();
    render(<Kolejka zwroty={[zwrot()]} wybrany={null} onWybierz={wybierz} />);
    await userEvent.click(screen.getByRole("button"));
    expect(wybierz).toHaveBeenCalledWith(1);
  });
});

describe("Dowody", () => {
  it("mówi wprost, czego nie wie i czego nie pobiera", () => {
    /* Dwa zdania, które muszą być na ekranie, a nie tylko w kodzie: kwota
       jest bez dostawy, a danych nadawcy nie pobieramy wcale. */
    render(<Dowody zwrot={zwrot()} />);
    expect(screen.getByText(/Bez kosztu dostawy/)).toBeInTheDocument();
    expect(screen.getByText(/Danych nadawcy i konta bankowego nie pobieramy/)).toBeInTheDocument();
  });

  it("brak paczki jest zdaniem, nie pustym polem", () => {
    render(<Dowody zwrot={zwrot({ paczkaAt: null })} />);
    expect(screen.getByText(/Towar jeszcze nie wrócił/)).toBeInTheDocument();
  });

  it("powód zwrotu tłumaczy się na polski, a komentarz klienta zostaje w cudzysłowie", () => {
    render(<Dowody zwrot={zwrot()} />);
    expect(screen.getByText(/nie spodobał się/)).toBeInTheDocument();
    expect(screen.getByText(/za ciężki/)).toBeInTheDocument();
  });

  it("zwrot bez pozycji mówi, że nie ma czego wycenić", () => {
    render(<Dowody zwrot={zwrot({ pozycje: [], sumaPozycjiGrosze: 0 })} />);
    expect(screen.getByText(/nie ma czego wycenić/)).toBeInTheDocument();
  });
});
