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
  kwotaGrosze: 6498, waluta: "PLN", oddane: null, odmowa: null, ...n,
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
});
