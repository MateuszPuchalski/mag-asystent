import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Dyskusja } from "../api/typy";
import { Kolejka, KUBELKI } from "./Kolejka";

/* ── Kolejka dyskusji (0.245.0) ──────────────────────────────────────────────
   Cztery rzeczy warte testu, bo każdą łatwo zepsuć poprawką wyglądu:

   1. „CZEKA N DNI" NIE NAZYWA SIĘ TERMINEM. Allegro dla dyskusji zegara nie
      oddaje; słowo „termin" na wierszu obiecywałoby zobowiązanie, którego nie
      ma — a blizna 0.121.0 to dokładnie taki zegar, liczony przez nas.
   2. LICZBA MILCZY, GDY RUCH NIE JEST NASZ. Przy sprawie, w której nie mamy
      nic do zrobienia, czytałaby się jak zaległość.
   3. ZDJĘCIA OFERTY NIE MA. `offer` jest przy dyskusji nieobecne w schemacie,
      więc kafel zastępczy byłby kolumną pustych prostokątów.
   4. PROŚBA O ZAKOŃCZENIE NIE UDAJE ZAMKNIĘCIA. Czip mówi „poproszono",
      bo dyskusję zamyka Allegro, nie nasze kliknięcie.                      */

const d = (n: Partial<Dyskusja> = {}): Dyskusja => ({
  id: 1, externalId: "d-1", orderId: "ZAM-1", kupujacyLogin: "kowalski",
  temat: "Przesyłka nie dotarła", opis: null,
  statusAllegro: "DISPUTE_ONGOING", czatAktywny: true, wiadomosciIle: 2, czatUrwany: false,
  ostatniaWiadomoscStatus: "BUYER_REPLIED", ostatniaWiadomoscAt: "2026-09-04T10:00:00.000Z",
  ruchNasz: true, czekaOdDni: 5, dlugoCzeka: true,
  otwartoAt: "2026-09-01T10:00:00.000Z", prowadzi: null, prowadziId: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, prowadziAt: null, notatka: null,
  zakonczenieStatus: null, zakonczenieAt: null, zakonczeniePrzez: null,
  wersja: 1, kubelek: "odpowiedz", sygnaly: ["klient_czeka"],
  linkZamowienia: "https://example.invalid/zam",
  ...n,
});

describe("Kolejka dyskusji", () => {
  it("czekanie jest CZEKANIEM, nie terminem", () => {
    render(<Kolejka dyskusje={[d()]} wybrana={null} onWybierz={vi.fn()} />);
    expect(screen.getByText("5 dni")).toBeInTheDocument();
    expect(screen.queryByText(/termin/i)).not.toBeInTheDocument();
    expect(screen.getByTitle(/od ostatniej wiadomości, która nie była nasza/i))
      .toBeInTheDocument();
  });

  it("liczba MILCZY, gdy ruch należy do klienta", () => {
    render(<Kolejka
      dyskusje={[d({ czekaOdDni: null, ruchNasz: false, kubelek: "klient", sygnaly: [] })]}
      wybrana={null} onWybierz={vi.fn()} />);
    expect(screen.queryByText(/dni$/)).not.toBeInTheDocument();
    expect(screen.queryByText("dziś")).not.toBeInTheDocument();
  });

  it("jeden dzień odmienia się inaczej niż dwa dni", () => {
    const { rerender } = render(
      <Kolejka dyskusje={[d({ czekaOdDni: 1 })]} wybrana={null} onWybierz={vi.fn()} />);
    expect(screen.getByText("1 dzień")).toBeInTheDocument();
    rerender(<Kolejka dyskusje={[d({ czekaOdDni: 2 })]} wybrana={null} onWybierz={vi.fn()} />);
    expect(screen.getByText("2 dni")).toBeInTheDocument();
    rerender(<Kolejka dyskusje={[d({ czekaOdDni: 0 })]} wybrana={null} onWybierz={vi.fn()} />);
    expect(screen.getByText("dziś")).toBeInTheDocument();
  });

  it("wiersz niesie TEMAT jako tożsamość sprawy, bez zdjęcia oferty", () => {
    render(<Kolejka dyskusje={[d()]} wybrana={null} onWybierz={vi.fn()} />);
    expect(screen.getByText("Przesyłka nie dotarła")).toBeInTheDocument();
    expect(screen.getByText(/kowalski · zamówienie ZAM-1/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("prośba o zakończenie mówi poproszono, a nie zamknięta", () => {
    render(<Kolejka
      dyskusje={[d({ zakonczenieStatus: "sent", zakonczeniePrzez: "Ala" })]}
      wybrana={null} onWybierz={vi.fn()} />);
    expect(screen.getByText("poproszono o zakończenie")).toBeInTheDocument();
    expect(screen.queryByText(/^zamknięta$/)).not.toBeInTheDocument();
  });

  it("kubełki mają trzy pozycje, więc klawisze 1–3 zachowują naturę", () => {
    expect(KUBELKI.map((k) => k.id)).toEqual(["odpowiedz", "klient", "zamknieta"]);
  });

  it("kliknięcie w wiersz wybiera sprawę", async () => {
    const onWybierz = vi.fn();
    render(<Kolejka dyskusje={[d({ id: 42 })]} wybrana={null} onWybierz={onWybierz} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onWybierz).toHaveBeenCalledWith(42);
  });

  it("pusty kubełek mówi to zdaniem, a nie pustką", () => {
    render(<Kolejka dyskusje={[]} wybrana={null} onWybierz={vi.fn()} />);
    expect(screen.getByText(/Ten kubełek jest pusty/)).toBeInTheDocument();
  });
});
