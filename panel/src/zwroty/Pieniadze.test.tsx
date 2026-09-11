import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pieniadze } from "./Pieniadze";
import type { StanZwrotuPieniedzy } from "../api/typy";

/* ── Pieniądze przy zwrocie (§25a, 0.190.0) ──────────────────────────────────
   Ten ekran jako pierwszy w panelu rusza cudze pieniądze, więc testy pilnują
   nie wyglądu, tylko czterech rzeczy: że przeszkoda MÓWI, czego brakuje; że
   przycisk nie stoi tam, gdzie serwer i tak odmówi; że odmowa bez powodu nie
   wychodzi; i że po zapłacie nie ma czym kliknąć drugi raz.                 */

const stan = (n: Partial<StanZwrotuPieniedzy> = {}): StanZwrotuPieniedzy => ({
  moznaZwrocic: true, moznaOdmowic: true, powod: null,
  kwotaGrosze: 6498, waluta: "PLN", oddane: null, odmowa: null,
  przelew: null, moznaZapisacPrzelew: false, powodPrzelewu: null, ...n,
});

const ekran = (n: Partial<Parameters<typeof Pieniadze>[0]> = {}) =>
  render(<Pieniadze stan={stan()} trwa={false} blad=""
    onZwroc={vi.fn()} onOdmow={vi.fn()} {...n} />);

describe("Pieniądze przy zwrocie", () => {
  it("pokazuje kwotę i przycisk, gdy da się oddać", () => {
    ekran();
    expect(screen.getByText("64,98 PLN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ODDAJ PIENIĄDZE/ })).toBeInTheDocument();
  });

  /* Wyłączony przycisk bez powodu każe zgadywać, czego brakuje. */
  it("przeszkoda jest zdaniem, a przycisku oddania nie ma wcale", () => {
    ekran({ stan: stan({ moznaZwrocic: false, powod: "Najpierw zaznacz, co oddajemy." }) });
    expect(screen.getByText(/Najpierw zaznacz/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ODDAJ PIENIĄDZE/ })).toBeNull();
  });

  /* Pobranie: oddać przez Allegro się nie da, ale odmówić owszem — to dwie
     różne drogi, nie dwa warianty jednej. */
  it("przy pobraniu zostaje sama odmowa", () => {
    ekran({ stan: stan({ moznaZwrocic: false, powod: "Zamówienie za pobraniem — oddaj przelewem." }) });
    expect(screen.queryByRole("button", { name: /ODDAJ PIENIĄDZE/ })).toBeNull();
    expect(screen.getByRole("button", { name: /ODMÓW WYPŁATY/ })).toBeInTheDocument();
  });

  it("po oddaniu pokazuje numer z Allegro i nie oferuje drugiego kliknięcia", () => {
    ekran({ stan: stan({ moznaZwrocic: false,
      oddane: { id: "ref-9", status: "SUCCEEDED", kiedy: null, potwierdzone: true } }) });
    expect(screen.getByText("ref-9")).toBeInTheDocument();
    expect(screen.getByText(/Oddano/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ODDAJ PIENIĄDZE/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /ODMÓW WYPŁATY/ })).toBeNull();
  });

  it("przyjęte polecenie NIE UDAJE oddanych pieniędzy", () => {
    /* 0.209.0: do tego wydania stało tu „Oddano" od chwili, w której Allegro
       przyjęło polecenie. Przelew odrzucony godzinę później wyglądał na
       ekranie dokładnie tak samo jak udany. */
    ekran({ stan: stan({ moznaZwrocic: false,
      oddane: { id: "ref-9", status: "SUCCEEDED", kiedy: null, potwierdzone: false } }) });
    expect(screen.getByText(/jeszcze nie potwierdziło/)).toBeInTheDocument();
    expect(screen.queryByText(/Oddano/)).toBeNull();
  });

  it("odmowa z kodem wymagającym powodu nie wychodzi pusta", async () => {
    const onOdmow = vi.fn();
    ekran({ onOdmow });
    await userEvent.click(screen.getByRole("button", { name: /ODMÓW WYPŁATY/ }));
    /* Domyślny kod to REFUND_REJECTED — ten wymaga uzasadnienia. */
    expect(screen.getByRole("button", { name: /WYŚLIJ ODMOWĘ/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Uzasadnienie/), "Towar wrócił uszkodzony");
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ ODMOWĘ/ }));
    expect(onOdmow).toHaveBeenCalledWith("REFUND_REJECTED", "Towar wrócił uszkodzony");
  });

  it("kod bez wymogu powodu wychodzi bez uzasadnienia", async () => {
    const onOdmow = vi.fn();
    ekran({ onOdmow });
    await userEvent.click(screen.getByRole("button", { name: /ODMÓW WYPŁATY/ }));
    await userEvent.selectOptions(screen.getByLabelText("Kod odmowy"), "NO_RETURN_RIGHT");
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ ODMOWĘ/ }));
    expect(onOdmow).toHaveBeenCalledWith("NO_RETURN_RIGHT", null);
  });

  /* Powód czyta KLIENT w Allegro, nie zespół — ekran musi to mówić. */
  it("mówi wprost, że powód trafia do klienta", async () => {
    ekran();
    await userEvent.click(screen.getByRole("button", { name: /ODMÓW WYPŁATY/ }));
    expect(screen.getByText(/trafia do klienta w Allegro/)).toBeInTheDocument();
  });

  it("w trakcie żądania przycisk jest zablokowany", () => {
    ekran({ trwa: true });
    expect(screen.getByRole("button", { name: /ODDAJĘ…/ })).toBeDisabled();
  });

  /* ── Przelew oddany poza Allegro (0.269.0) ─────────────────────────────────
     Przy pobraniu to JEDYNY ślad po wypłacie, jaki może powstać. */
  it("przy pobraniu daje pole na numer przelewu i zapisuje ślad", async () => {
    const onPrzelew = vi.fn();
    ekran({
      stan: stan({
        moznaZwrocic: false, powod: "Zamówienie za pobraniem — oddaj przelewem.",
        moznaZapisacPrzelew: true,
      }),
      onPrzelew,
    });
    await userEvent.type(screen.getByLabelText("Numer przelewu"), "PRZ/2026/09/14");
    await userEvent.click(screen.getByRole("button", { name: /ZAPISZ PRZELEW/ }));
    expect(onPrzelew).toHaveBeenCalledWith("PRZ/2026/09/14");
  });

  /* Numer bywa znany dopiero z wyciągu — wymóg kazałby wpisać cokolwiek. */
  it("pusty numer nie blokuje zapisu, a idzie jako brak", async () => {
    const onPrzelew = vi.fn();
    ekran({ stan: stan({ moznaZwrocic: false, moznaZapisacPrzelew: true }), onPrzelew });
    await userEvent.click(screen.getByRole("button", { name: /ZAPISZ PRZELEW/ }));
    expect(onPrzelew).toHaveBeenCalledWith(null);
  });

  it("zapisany przelew widać z numerem i da się go cofnąć", async () => {
    const onCofnijPrzelew = vi.fn();
    ekran({
      stan: stan({
        moznaZwrocic: false, moznaZapisacPrzelew: false,
        przelew: { kiedy: "2026-09-14T10:00:00Z", przez: "Ala", referencja: "PRZ/1" },
      }),
      onCofnijPrzelew,
    });
    expect(screen.getByText(/Oddano przelewem/)).toBeInTheDocument();
    expect(screen.getByText("PRZ/1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ZAPISZ PRZELEW/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /cofnij/i }));
    expect(onCofnijPrzelew).toHaveBeenCalled();
  });

  /* Przy płatności online ten blok nie ma po co stać: pieniądze oddaje
     Allegro, a druga droga obok pierwszej kazałaby wybierać. */
  it("bez zgody serwera pola przelewu nie ma wcale", () => {
    ekran({ stan: stan({ moznaZapisacPrzelew: false }), onPrzelew: vi.fn() });
    expect(screen.queryByLabelText("Numer przelewu")).toBeNull();
  });
});
