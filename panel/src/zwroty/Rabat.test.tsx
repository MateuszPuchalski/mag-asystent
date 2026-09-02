import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Rabat } from "./Rabat";
import type { StanRabatu } from "../api/typy";

/* ── Rabat transakcyjny przy pozycji (0.164.0) ───────────────────────────────
   Ekran ma odpowiedzieć na jedno pytanie: czy przy TEJ pozycji trzeba jeszcze
   coś kliknąć. Do tego wydania odpowiedź brzmiała „nie wiadomo, sprawdź
   w panelu Allegro" — i dlatego sprawdzało się przy każdym zwrocie.        */

const stan = (n: Partial<StanRabatu> = {}): StanRabatu => ({
  stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
  prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null, ...n,
});

const pasek = (r: StanRabatu, h: Partial<Parameters<typeof Rabat>[0]> = {}) =>
  render(<Rabat rabat={r} trwa={false} blad="" onZglos={vi.fn()} {...h} />);

describe("Rabat transakcyjny", () => {
  it("brak wniosku daje przycisk — to jedyny stan, w którym jest co zrobić", async () => {
    const onZglos = vi.fn();
    pasek(stan(), { onZglos });
    expect(screen.getByText(/brak wniosku/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /ZGŁOŚ RABAT/ }));
    expect(onZglos).toHaveBeenCalled();
  });

  it("przyznany pokazuje kwotę prowizji i NIE daje przycisku", () => {
    /* Drugi wniosek na tę samą pozycję byłby osobnym zgłoszeniem — końcówka
       Allegro nie ma idempotencji, więc przycisk musi zniknąć, a nie tylko
       zostać odrzucony po kliknięciu. */
    pasek(stan({ stan: "przyznany", wniosekId: "rc-1", prowizjaGrosze: 615, waluta: "PLN" }));
    expect(screen.getByText(/przyznany/)).toBeInTheDocument();
    expect(screen.getByText(/6,15/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ZGŁOŚ RABAT/ })).toBeNull();
  });

  it("czekający i odrzucony to dwa różne zdania, bo każą co innego zrobić", () => {
    const { rerender } = render(<Rabat rabat={stan({ stan: "zlozony", wniosekId: "rc-2" })}
      trwa={false} blad="" onZglos={vi.fn()} />);
    expect(screen.getByText(/czeka na decyzję/)).toBeInTheDocument();

    rerender(<Rabat rabat={stan({ stan: "odrzucony", wniosekId: "rc-2" })}
      trwa={false} blad="" onZglos={vi.fn()} />);
    expect(screen.getByText(/odrzucony/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ZGŁOŚ RABAT/ })).toBeNull();
  });

  it("wniosek złożony przez automat Allegro jest podpisany", () => {
    /* 40 wniosków na 100 zakłada Allegro samo. Bez tego podpisu wyglądałyby
       na czyjąś pracę, a to właśnie ta różnica mówi, ile pracy zostaje. */
    pasek(stan({ stan: "przyznany", typ: "AUTOMATIC", prowizjaGrosze: 100, waluta: "PLN" }));
    expect(screen.getByText(/automat Allegro/)).toBeInTheDocument();
  });

  it("brak dopasowania mówi POWÓD zamiast milczeć", () => {
    pasek(stan({ stan: "nie_wiadomo", lineItemId: null,
      powod: "Allegro nie podało numeru zamówienia dla tego zwrotu" }));
    expect(screen.getByText(/nie podało numeru zamówienia/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ZGŁOŚ RABAT/ })).toBeNull();
  });

  it("odmowa serwera ląduje przy pozycji, nie w ogólnym pasku ekranu", () => {
    pasek(stan(), { blad: "Wniosek o rabat już istnieje (rc-1), status: przyznany." });
    expect(screen.getByText(/już istnieje/)).toBeInTheDocument();
  });
});
