import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Szablon } from "../api/szablony";

const dodaj = vi.fn();
const zmien = vi.fn();
const archiwizuj = vi.fn();
const lista = vi.fn<() => { data?: { szablony: Szablon[] }; isLoading: boolean }>();

vi.mock("../api/szablony", () => ({
  useSzablony: () => lista(),
  useDodajSzablon: () => ({ mutate: dodaj, isPending: false }),
  useZmienSzablon: () => ({ mutate: zmien, isPending: false }),
  useArchiwizujSzablon: () => ({ mutate: archiwizuj, isPending: false }),
}));

const { Szablony } = await import("./Szablony");

/* ── Szablony odpowiedzi (0.399.0) ───────────────────────────────────────────
   Zgłoszenie właściciela: „dodaj ten szablon do szablonów odpowiedzi
   w skrzynce". Testy pilnują pięciu rzeczy, bo każda jest decyzją:

   1. WSTAWIA, NIE WYSYŁA. Treść ląduje w szkicu i dalej wymaga „Wyślij do
      klienta" — druga zasada nadrzędna projektu panelu.
   2. TREŚĆ IDZIE DOSŁOWNIE, bez podstawiania. Zła wartość w wiadomości
      wysłanej do klienta kosztuje więcej niż przepisanie numeru ręką.
   3. CUDZA ROZMOWA BLOKUJE WSTAWKĘ, tak samo jak pole szkicu — obietnica
      zapisu, którego serwer nie przyjmie, jest gorsza od braku przycisku.
   4. LIMIT ALLEGRO WIDAĆ PRZY PISANIU, nie po odmowie zapisu.
   5. ZDJĘCIE TO ARCHIWUM, nie kasowanie (§25a.5).                          */

const szablon = (n: Partial<Szablon> = {}): Szablon => ({
  id: 1, nazwa: "Wymiana przez paczkomat",
  tresc: "Dzień dobry,\nWykonamy wymianę przez paczkomat.",
  utworzono: "2026-09-18T10:00:00.000Z", utworzyl: "Właściciel",
  zmieniono: null, zmienil: null, ...n,
});

beforeEach(() => {
  dodaj.mockReset(); zmien.mockReset(); archiwizuj.mockReset();
  lista.mockReturnValue({ data: { szablony: [szablon()] }, isLoading: false });
});

describe("szablony odpowiedzi", () => {
  it("wstawia treść DOSŁOWNIE do szkicu, a nie wysyła jej", async () => {
    const onWstaw = vi.fn();
    render(<Szablony onWstaw={onWstaw} />);

    await userEvent.click(screen.getByRole("button", { name: /Szablony/ }));
    await userEvent.click(screen.getByRole("button", { name: /Wstaw do szkicu/ }));

    expect(onWstaw).toHaveBeenCalledWith("Dzień dobry,\nWykonamy wymianę przez paczkomat.");
  });

  it("po wstawieniu lista się ZAMYKA — agent wraca do pisania", async () => {
    render(<Szablony onWstaw={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Szablony/ }));
    await userEvent.click(screen.getByRole("button", { name: /Wstaw do szkicu/ }));
    expect(screen.queryByRole("button", { name: /Wstaw do szkicu/ })).toBeNull();
  });

  it("CUDZA ROZMOWA blokuje wstawkę, tak samo jak pole szkicu", async () => {
    render(<Szablony onWstaw={vi.fn()} wylaczone />);
    expect(screen.getByRole("button", { name: /Szablony/ })).toBeDisabled();
  });

  it("nowy szablon powstaje z nazwy i treści", async () => {
    render(<Szablony onWstaw={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Szablony/ }));
    await userEvent.click(screen.getByRole("button", { name: /Nowy/ }));

    await userEvent.type(screen.getByLabelText("Nazwa szablonu"), "Przeprosiny");
    await userEvent.type(screen.getByLabelText("Treść szablonu"), "Przepraszamy.");
    await userEvent.click(screen.getByRole("button", { name: /Zapisz szablon/ }));

    expect(dodaj).toHaveBeenCalledWith(
      { nazwa: "Przeprosiny", tresc: "Przepraszamy." }, expect.anything());
  });

  it("limit Allegro widać PRZY PISANIU, nie po odmowie zapisu", async () => {
    render(<Szablony onWstaw={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Szablony/ }));
    await userEvent.click(screen.getByRole("button", { name: /Nowy/ }));
    expect(screen.getByText("0 / 2000")).toBeInTheDocument();
  });

  it("pusty szablon nie da się zapisać", async () => {
    render(<Szablony onWstaw={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Szablony/ }));
    await userEvent.click(screen.getByRole("button", { name: /Nowy/ }));
    expect(screen.getByRole("button", { name: /Zapisz szablon/ })).toBeDisabled();
  });

  it("„zdejmij” ARCHIWIZUJE, nie kasuje", async () => {
    render(<Szablony onWstaw={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Szablony/ }));
    await userEvent.click(screen.getByRole("button", { name: "zdejmij" }));
    expect(archiwizuj).toHaveBeenCalledWith({ id: 1, archiwalny: true });
  });

  it("pusta lista mówi, co zrobić, zamiast milczeć", async () => {
    lista.mockReturnValue({ data: { szablony: [] }, isLoading: false });
    render(<Szablony onWstaw={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Szablony/ }));
    expect(screen.getByText(/Nie ma jeszcze żadnego szablonu/)).toBeInTheDocument();
  });
});
