import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Szablon } from "../api/szablony";

const dodaj = vi.fn();
const zmien = vi.fn();
const archiwizuj = vi.fn();
const lista = vi.fn<() => { data?: { szablony: Szablon[] }; isLoading: boolean }>();

const archiwum = vi.fn<(wlaczone: boolean) =>
  { data?: { szablony: Szablon[] }; isLoading: boolean }>(
  () => ({ data: { szablony: [] }, isLoading: false }));
vi.mock("../api/szablony", () => ({
  useSzablony: () => lista(),
  useDodajSzablon: () => ({ mutate: dodaj, isPending: false }),
  useZmienSzablon: () => ({ mutate: zmien, isPending: false }),
  useArchiwizujSzablon: () => ({ mutate: archiwizuj, isPending: false }),
  /* Archiwum (0.406.0): hak przyjmuje `wlaczone`, bo pyta serwer dopiero po
     otwarciu zakładki „Zdjęte". Atrapa oddaje to samo, co lista. */
  useArchiwumSzablonow: (wlaczone: boolean) => archiwum(wlaczone),
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
  archiwum.mockReset();
  archiwum.mockReturnValue({ data: { szablony: [] }, isLoading: false });
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

/* ── Droga powrotna z archiwum (0.406.0) ─────────────────────────────────────
   Przycisk „zdejmij" powoływał się w komentarzu na §25a.5 — cofnięcie zamiast
   potwierdzenia — a drogi powrotnej NIE BYŁO. Trasa archiwum i hak stały
   w kodzie od 0.399.0, nieużywane przez żaden ekran. Te testy pilnują, że
   zdjęcie da się odwrócić i że zdjęty szablon nie wraca do pracy po cichu. */
describe("Zdjęte szablony", () => {
  it("da się do nich zajrzeć, także gdy archiwum jest puste", async () => {
    render(<Szablony onWstaw={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Szablony/ }));
    await userEvent.click(screen.getByRole("button", { name: /Zdjęte/ }));
    expect(screen.getByText(/Nic nie jest zdjęte/)).toBeInTheDocument();
  });

  it("PRZYWRACA szablon tą samą mutacją, w drugą stronę", async () => {
    archiwum.mockReturnValue({
      data: { szablony: [szablon({ id: 9, nazwa: "Stary zwrot", tresc: "Treść." })] },
      isLoading: false,
    });
    render(<Szablony onWstaw={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Szablony/ }));
    await userEvent.click(screen.getByRole("button", { name: /Zdjęte/ }));
    await userEvent.click(screen.getByRole("button", { name: "przywróć" }));
    expect(archiwizuj).toHaveBeenCalledWith({ id: 9, archiwalny: false });
  });

  it("zdjętego NIE DA SIĘ wstawić do szkicu bez przywrócenia", async () => {
    archiwum.mockReturnValue({
      data: { szablony: [szablon({ id: 9, nazwa: "Stary zwrot", tresc: "Treść." })] },
      isLoading: false,
    });
    const onWstaw = vi.fn();
    render(<Szablony onWstaw={onWstaw} />);
    await userEvent.click(screen.getByRole("button", { name: /Szablony/ }));
    await userEvent.click(screen.getByRole("button", { name: /Zdjęte/ }));
    expect(screen.queryByRole("button", { name: /Wstaw do szkicu/ })).not.toBeInTheDocument();
  });

  it("pyta serwer DOPIERO po otwarciu archiwum — nie przy każdej rozmowie", async () => {
    render(<Szablony onWstaw={vi.fn()} />);
    expect(archiwum).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: /Szablony/ }));
    await userEvent.click(screen.getByRole("button", { name: /Zdjęte/ }));
    expect(archiwum).toHaveBeenLastCalledWith(true);
  });
});
