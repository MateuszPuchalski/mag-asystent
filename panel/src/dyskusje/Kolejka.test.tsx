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
  ruchNasz: true, czekaOdDni: 5, czekaOdGodzin: 120, bezOdpowiedziOd: null, pilna: true, dlugoCzeka: true,
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
    expect(screen.getByTitle(/alarm/i)).toBeInTheDocument();
  });

  it("zegar liczy od pytania bez odpowiedzi, więc tytuł nie mówi o ostatniej wiadomości", () => {
    render(<Kolejka dyskusje={[d({ pilna: false })]} wybrana={null} onWybierz={vi.fn()} />);
    expect(screen.getByTitle(/pytania, na które nie odpowiedzieliśmy/i)).toBeInTheDocument();
    expect(screen.queryByTitle(/ostatniej wiadomości/i)).not.toBeInTheDocument();
  });

  it("poniżej doby wiersz pokazuje godziny, nie „dziś”", () => {
    render(<Kolejka dyskusje={[d({ czekaOdDni: 0, czekaOdGodzin: 7, pilna: false, dlugoCzeka: false })]}
      wybrana={null} onWybierz={vi.fn()} />);
    expect(screen.getByText("7 godz.")).toBeInTheDocument();
    expect(screen.queryByText("dziś")).not.toBeInTheDocument();
  });

  it("po progu alarmu znaczek jest czerwony, przed progiem szary", () => {
    const { rerender } = render(
      <Kolejka dyskusje={[d({ czekaOdDni: 1, czekaOdGodzin: 30, pilna: true })]} wybrana={null} onWybierz={vi.fn()} />);
    expect(screen.getByText("1 dzień").className).toContain("bg-red-100");
    rerender(<Kolejka dyskusje={[d({ czekaOdDni: 1, czekaOdGodzin: 30, pilna: false, dlugoCzeka: false })]}
      wybrana={null} onWybierz={vi.fn()} />);
    expect(screen.getByText("1 dzień").className).not.toContain("bg-red-100");
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
    rerender(<Kolejka dyskusje={[d({ czekaOdDni: 0, czekaOdGodzin: 0, pilna: false })]}
      wybrana={null} onWybierz={vi.fn()} />);
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
  it("wiersz niesie znacznik kolejki: Enter na wybranym idzie do pola odpowiedzi (0.549.0)", () => {
    /* Edytor skrzynki rozpoznaje wiersz po `data-wiersz-kolejki`. Bez znacznika
       Enter na wybranej sprawie nie prowadziłby do pisania. */
    render(<Kolejka dyskusje={[d()]} wybrana={1} onWybierz={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("data-wiersz-kolejki");
    expect(screen.getByRole("button")).toHaveAttribute("aria-current", "true");
  });
});

describe("Kolejka dyskusji: wiersz mówi każdą rzecz raz", () => {
  const wiersz = (n: Partial<Dyskusja>) => render(
    <Kolejka dyskusje={[d(n)]} wybrana={null} onWybierz={() => {}} />);

  it("czip „czeka na nas” nie stoi w kubełku „Do odpowiedzi”, bo to samo mówi kubełek", () => {
    wiersz({ kubelek: "odpowiedz", sygnaly: ["klient_czeka", "doradca"] });
    expect(screen.queryByText("czeka na nas")).not.toBeInTheDocument();
    /* Pozostałe sygnały zostają: filtr dotyczy jednego, nie wszystkich. */
    expect(screen.getByText("doradca")).toBeInTheDocument();
  });

  it("poza tym kubełkiem ten sam sygnał zostaje — nic go tam nie zastępuje", () => {
    wiersz({ kubelek: "zamknieta", sygnaly: ["klient_czeka"] });
    expect(screen.getByText("czeka na nas")).toBeInTheDocument();
  });

  it("wiersz bez tagów i sygnałów nie dokłada pustego rzędu czipów", () => {
    const { container } = wiersz({ kubelek: "odpowiedz", sygnaly: ["klient_czeka"], tagi: [] });
    expect(container.querySelector(".flex-wrap")).toBeNull();
  });

  it("UUID zamówienia skraca się do ośmiu znaków, a pełny numer jest w podpowiedzi", () => {
    wiersz({ orderId: "663f38f1-b98e-11f1-97b7-874d04101a2b" });
    expect(screen.getByText(/kowalski · zamówienie 663f38f1$/)).toBeInTheDocument();
    expect(screen.getByTitle("Zamówienie 663f38f1-b98e-11f1-97b7-874d04101a2b")).toBeInTheDocument();
  });

  it("numer, który nie jest UUID-em, zostaje w całości", () => {
    wiersz({ orderId: "17147703077" });
    expect(screen.getByText(/zamówienie 17147703077$/)).toBeInTheDocument();
  });
});
