import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Decyzja, terminy } from "./Decyzja";
import type { Rozmowa, StatusRozmowy } from "../api/typy";

/* Pasek decyzji ma trzy ruchy i drogę powrotną z każdego z nich. Te testy
   pilnują, żeby powrót nie zniknął — bo to on zastępuje dialog „czy na pewno",
   a bez niego każda pomyłka wymaga wejścia do panelu Allegro. */

const TERAZ = new Date("2026-09-02T14:30:00.000Z");

const rozmowa = (n: Partial<Rozmowa> = {}): Rozmowa => ({
  id: 1, klient: "Kupujący", ostatniaWiadomosc: "…", ostatniaWiadomoscAt: "2026-09-02T08:00:00.000Z",
  nieprzeczytana: false, wlascicielId: 7, wlasciciel: "Ala", wersja: 3,
  status: "open" as StatusRozmowy, statusZapisany: "open" as StatusRozmowy,
  snoozeDo: null, wrocilaPoZamknieciu: false, oglada: null, ...n,
});

const pasek = (r: Rozmowa, onStatus = vi.fn(), onOdloz = vi.fn()) => {
  render(<Decyzja rozmowa={r} zajete={false} blad="" onOdloz={onOdloz} onStatus={onStatus}
    teraz={TERAZ} />);
  return { onStatus, onOdloz };
};

describe("Pasek decyzji o statusie", () => {
  it("rozmowa w toku ma trzy ruchy i żaden z nich nie pyta „czy na pewno\"", async () => {
    const { onStatus } = pasek(rozmowa());
    await userEvent.click(screen.getByRole("button", { name: /Załatwione/ }));
    expect(onStatus).toHaveBeenCalledWith("resolved");
    await userEvent.click(screen.getByRole("button", { name: /Spam/ }));
    expect(onStatus).toHaveBeenCalledWith("spam");
    expect(screen.getByRole("button", { name: /Odłóż/ })).toBeInTheDocument();
  });

  it("załatwiona rozmowa pokazuje POWRÓT zamiast tych samych trzech przycisków", async () => {
    const { onStatus } = pasek(rozmowa({ status: "resolved", statusZapisany: "resolved" }));
    expect(screen.queryByRole("button", { name: /Załatwione/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Wróć do pracy/ }));
    expect(onStatus).toHaveBeenCalledWith("open");
  });

  it("odłożenie daje trzy gotowe terminy zamiast kalendarza", async () => {
    const { onOdloz } = pasek(rozmowa());
    await userEvent.click(screen.getByRole("button", { name: /Odłóż/ }));
    await userEvent.click(screen.getByRole("button", { name: "za trzy dni" }));
    expect(onOdloz).toHaveBeenCalledWith(terminy(TERAZ)[1].iso);
  });

  it("terminy są rano i w przyszłości, a nie o godzinie kliknięcia", () => {
    /* „Za tydzień o 14:37" to termin wymyślony przez zegar, nie przez biuro.
       Rozmowa ma wrócić na początek dnia pracy. */
    for (const t of terminy(TERAZ)) {
      const d = new Date(t.iso);
      expect(d.getTime()).toBeGreaterThan(TERAZ.getTime());
      expect(d.getHours()).toBe(8);
    }
  });

  it("odłożona mówi, kiedy wraca, a po terminie — że już wróciła", () => {
    const { unmount } = render(<Decyzja rozmowa={rozmowa({
      status: "snoozed", statusZapisany: "snoozed", snoozeDo: "2026-09-05T06:00:00.000Z",
    })} zajete={false} blad="" onOdloz={vi.fn()} onStatus={vi.fn()} teraz={TERAZ} />);
    expect(screen.getByText(/wraca/)).toBeInTheDocument();
    unmount();

    /* W bazie dalej stoi `snoozed`, ale termin minął — ekran ma wytłumaczyć,
       skąd rozmowa wróciła do pracy, zamiast pokazać samo „w toku". */
    pasek(rozmowa({ status: "open", statusZapisany: "snoozed",
      snoozeDo: "2026-09-01T06:00:00.000Z" }));
    expect(screen.getByText(/termin odłożenia minął/)).toBeInTheDocument();
  });

  it("powrót klienta po zamknięciu widać na pasku", () => {
    pasek(rozmowa({ wrocilaPoZamknieciu: true }));
    expect(screen.getByText(/WRÓCIŁA PO ZAMKNIĘCIU/)).toBeInTheDocument();
  });

  it("odmowa serwera ląduje przy pasku, a nie w konsoli", () => {
    render(<Decyzja rozmowa={rozmowa()} zajete={false}
      blad="Rozmowa zmieniła się, zanim doszła zmiana statusu"
      onOdloz={vi.fn()} onStatus={vi.fn()} teraz={TERAZ} />);
    expect(screen.getByText(/Rozmowa zmieniła się/)).toBeInTheDocument();
  });

  it("kolega siedzący przy rozmowie jest widoczny, a ja sam — nie", () => {
    /* Uchwyt widać ZANIM padnie pierwsze słowo odpowiedzi. Dowiadywanie się
       o koledze dopiero przy wysyłce znaczy dwie napisane odpowiedzi. */
    const { unmount } = render(<Decyzja rozmowa={rozmowa({
      oglada: { userId: 9, name: "M. Wójcik" } })} zajete={false} blad=""
      onOdloz={vi.fn()} onStatus={vi.fn()} mojeId={7} teraz={TERAZ} />);
    expect(screen.getByText(/siedzi tu M. Wójcik/)).toBeInTheDocument();
    unmount();

    render(<Decyzja rozmowa={rozmowa({ oglada: { userId: 7, name: "Ja" } })} zajete={false}
      blad="" onOdloz={vi.fn()} onStatus={vi.fn()} mojeId={7} teraz={TERAZ} />);
    expect(screen.queryByText(/siedzi tu/)).not.toBeInTheDocument();
  });
});
