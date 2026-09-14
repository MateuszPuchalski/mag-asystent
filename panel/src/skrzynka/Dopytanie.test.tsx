import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dopytanie } from "./Dopytanie";
import type { WymianaCopilota } from "../api/typy";

/* ── Dopytanie Copilota (0.332.0) ────────────────────────────────────────────
   Jedna granica jest tu ważniejsza od wszystkich razem: ODPOWIEDŹ IDZIE DO
   AGENTA. Gdyby ekran dał przycisk „wstaw do szkicu", jedno kliknięcie
   omijałoby wszystkie sita, którymi szkic jest sprawdzany przed wysłaniem
   do klienta — a te sita są jedynym powodem, dla którego tamtemu tekstowi
   da się ufać. Dlatego pierwszy test pilnuje CZEGOŚ, CZEGO NIE MA.          */

const w = (n: Partial<WymianaCopilota> = {}): WymianaCopilota => ({
  id: 1, pytanie: "Czy ten nóż pasuje do 46 cm?",
  odpowiedz: "Fakty tego nie rozstrzygają. Rozstrzygnie zdjęcie tabliczki.",
  twierdzenia: [], model: "atrapa", at: "2026-09-14T10:00:00.000Z",
  przez: "A. Lewandowska", ...n,
});

const props = (n: Partial<Parameters<typeof Dopytanie>[0]> = {}) => ({
  wymiany: [] as WymianaCopilota[], wylaczony: false, blad: null,
  pracuje: false, onPytaj: vi.fn(), limitZnakow: 600, ...n,
});

describe("dopytanie Copilota", () => {
  test("odpowiedź NIE MA przycisku wstawiania — to jest granica, nie brak", () => {
    render(<Dopytanie {...props({ wymiany: [w()] })} />);
    for (const slowo of [/wstaw/i, /zastąp/i]) {
      expect(screen.queryByRole("button", { name: slowo })).toBeNull();
    }
  });

  test("ekran mówi wprost, kto czyta odpowiedź", () => {
    render(<Dopytanie {...props()} />);
    expect(screen.getByText(/odpowiedź czytasz Ty, nie klient/i)).toBeTruthy();
  });

  test("puste pytanie nie da się wysłać", () => {
    const p = props();
    render(<Dopytanie {...p} />);
    const przycisk = screen.getByRole("button", { name: /zapytaj/i });
    expect((przycisk as HTMLButtonElement).disabled).toBe(true);
  });

  test("pytanie leci po kliknięciu, a pole się czyści", () => {
    const p = props();
    render(<Dopytanie {...p} />);
    const pole = screen.getByLabelText(/pytanie do copilota/i);
    fireEvent.change(pole, { target: { value: "  Skąd to wiesz?  " } });
    fireEvent.click(screen.getByRole("button", { name: /zapytaj/i }));

    expect(p.onPytaj).toHaveBeenCalledWith("Skąd to wiesz?");
    expect((pole as HTMLTextAreaElement).value).toBe("");
  });

  test("pytanie dłuższe od limitu blokuje przycisk, zanim żądanie poleci", () => {
    const p = props({ limitZnakow: 10 });
    render(<Dopytanie {...p} />);
    fireEvent.change(screen.getByLabelText(/pytanie do copilota/i),
      { target: { value: "a".repeat(11) } });

    expect((screen.getByRole("button", { name: /zapytaj/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("11 / 10")).toBeTruthy();
  });

  test("licznik znaków milczy, dopóki daleko do limitu", () => {
    render(<Dopytanie {...props({ limitZnakow: 600 })} />);
    fireEvent.change(screen.getByLabelText(/pytanie do copilota/i), { target: { value: "krótko" } });
    /* Licznik stale widoczny uczy pisać krótko zamiast pisać jasno. */
    expect(screen.queryByText(/\/ 600/)).toBeNull();
  });

  test("wymiany stoją naprzemiennie, z podpisem pytającego", () => {
    render(<Dopytanie {...props({ wymiany: [w(), w({ id: 2, pytanie: "A wersja z rozrusznikiem?" })] })} />);
    expect(screen.getByText(/A\. Lewandowska: Czy ten nóż pasuje do 46 cm\?/)).toBeTruthy();
    expect(screen.getByText(/A\. Lewandowska: A wersja z rozrusznikiem\?/)).toBeTruthy();
  });

  test("cudza rozmowa gasi i pole, i przycisk", () => {
    render(<Dopytanie {...props({ wylaczony: true })} />);
    expect((screen.getByLabelText(/pytanie do copilota/i) as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /zapytaj/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("błąd z serwera stoi przy przycisku, nie w konsoli", () => {
    render(<Dopytanie {...props({ blad: "Ta rozmowa ma już 20 dopytań." })} />);
    expect(screen.getByText(/ma już 20 dopytań/)).toBeTruthy();
  });
});
