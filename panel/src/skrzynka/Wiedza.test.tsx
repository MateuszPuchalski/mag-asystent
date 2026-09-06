import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* ── Zakładka WIEDZA (§14.3) ─────────────────────────────────────────────────
   Dowody i pomiary przyjechały tu z „Doboru" razem z tymi testami. Pilnujemy
   trzech rzeczy, na których zakładka stoi:

   1. KLAUZULA jest na ekranie, nie w dokumencie. §14.3 mówi, że twierdzenie
      bez źródła jest przypuszczeniem — zdanie ma stać tam, gdzie agent pisze.
   2. Brak wpisu w bazie wiedzy MÓWI o sobie, zamiast pokazywać pustkę.
   3. Pomiar z hali NIE JEST jeszcze wiedzą i ekran to nazywa („niezatwierdzone
      jako wiedza"), a propozycja idzie wyłącznie na kliknięcie (§13.4).      */

const wiedza = vi.fn();
const pomiar = { mutate: vi.fn(), isPending: false, error: null as unknown };
vi.mock("../api/rozmowy", () => ({
  useWiedzaDoboru: (id: number | null) => wiedza(id),
  usePomiarDoWiedzy: () => pomiar,
}));

const { Wiedza } = await import("./Wiedza");

const pokaz = (p: { twId?: number | null; maMaszyne?: boolean } = {}) =>
  render(<Wiedza rozmowaId={4821} twId={p.twId ?? 14} maMaszyne={p.maMaszyne ?? false} />);

const ZASTOSOWANIE = {
  id: 3, twId: 14, symbol: "FTC272", polaryzacja: "pasuje", powodNegatywny: null, zdaniePowodu: null,
  model: { id: 1, rodzaj: "maszyna", marka: "STIHL", nazwa: "FS250", wariant: null, lata: null,
    klucz: "maszyna|stihlfs250", etykieta: "STIHL FS250" },
  stan: "zatwierdzone", zrodlo: "dobor", komentarz: null, conversationId: 4821, zastepujeId: null,
  zaproponowal: "A. Lewandowska", zaproponowanoAt: "2026-09-02T08:00:00Z", rozstrzygnal: "O. Nowak",
  rozstrzygnietoAt: "2026-09-02T09:00:00Z", powodRozstrzygniecia: null, pewnosc: "potwierdzone",
  zdanieZrodla: "potwierdzone zastosowanie do STIHL FS250 — katalog dostawcy, 2.09.2026, A. Lewandowska",
  dowody: [{ id: 9, rodzaj: "katalog_dostawcy", nazwaRodzaju: "katalog dostawcy",
    tresc: "Katalog 2024, s. 12", link: null, zadanieId: null, conversationId: null,
    autor: "A. Lewandowska", at: "2026-09-02T08:00:00Z" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  wiedza.mockReturnValue({ data: { zastosowanie: null, pomiary: [] }, isLoading: false, error: null });
});

describe("zakładka wiedzy", () => {
  it("klauzula o źródle stoi na ekranie, nie w dokumencie", () => {
    pokaz();
    expect(screen.getByText(/Każde twierdzenie techniczne w szkicu wskazuje/)).toBeInTheDocument();
    expect(screen.getByText(/Bez źródła treść jest przypuszczeniem/)).toBeInTheDocument();
  });

  it("bez wpisu w bazie wiedzy mówi, że dobór to przypuszczenie; z wpisem pokazuje dowody", () => {
    const { rerender } = pokaz();
    expect(screen.getByText(/Brak wpisu w bazie wiedzy/)).toBeInTheDocument();

    wiedza.mockReturnValue({ isLoading: false, error: null,
      data: { pomiary: [], zastosowanie: ZASTOSOWANIE } });
    rerender(<Wiedza rozmowaId={4821} twId={14} maMaszyne={false} />);
    expect(screen.getByLabelText("Dowody zastosowania")).toBeInTheDocument();
    expect(screen.getByText("Katalog 2024, s. 12")).toBeInTheDocument();
    expect(screen.getByText(/zatwierdził O\. Nowak/)).toBeInTheDocument();
  });

  it("pomiar z hali proponuje się jako dowód dopiero z marką i modelem — i tylko na kliknięcie", async () => {
    const pomiary = [{ zadanieId: 312, tytul: "Zmierz rozstaw", wynik: "rozstaw 148 mm",
      wykonanoAt: "2026-09-01T09:00:00Z", wykonanoPrzez: "M. Kowal", twId: 14, symbol: "FTC272",
      zaproponowano: false }];
    wiedza.mockReturnValue({ data: { zastosowanie: null, pomiary }, isLoading: false, error: null });
    const { rerender } = pokaz({ maMaszyne: false });

    /* Makieta nazywa ten stan wprost — bez tego zdania pomiar wygląda jak
       dowód, którym nie jest. */
    expect(screen.getByText("niezatwierdzone jako wiedza")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Zaproponuj jako dowód/ })).toBeDisabled();
    expect(screen.getByText(/najpierw marka i model/)).toBeInTheDocument();
    expect(pomiar.mutate).not.toHaveBeenCalled();

    rerender(<Wiedza rozmowaId={4821} twId={14} maMaszyne />);
    await userEvent.selectOptions(screen.getByLabelText("Wynik pomiaru: Zmierz rozstaw"), "nie_pasuje");
    await userEvent.click(screen.getByRole("button", { name: /Zaproponuj jako dowód/ }));
    expect(pomiar.mutate).toHaveBeenCalledWith(
      { id: 4821, zadanieId: 312, twId: 14, polaryzacja: "nie_pasuje", powodNegatywny: "niewlasciwy_rozstaw" });

    wiedza.mockReturnValue({ isLoading: false, error: null,
      data: { zastosowanie: null, pomiary: [{ ...pomiary[0], zaproponowano: true }] } });
    rerender(<Wiedza rozmowaId={4821} twId={14} maMaszyne />);
    expect(screen.getByText(/w kolejce wiedzy/)).toBeInTheDocument();
    expect(screen.queryByText("niezatwierdzone jako wiedza")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zaproponuj jako dowód/ })).not.toBeInTheDocument();
  });

  it("pomiar bez własnej kartoteki bierze tę wybraną w doborze", async () => {
    /* Zadanie bywa zlecone bez kartoteki (agent nie wiedział jeszcze, czego
       szuka). Dowód musi się na czymś zawiesić, więc schodzi na wybór doboru —
       inaczej propozycja poszłaby bez towaru i serwer by ją odrzucił. */
    wiedza.mockReturnValue({ isLoading: false, error: null, data: { zastosowanie: null, pomiary: [
      { zadanieId: 400, tytul: "Zmierz gwint", wynik: "M8", wykonanoAt: "2026-09-01T09:00:00Z",
        wykonanoPrzez: "M. Kowal", twId: null, symbol: null, zaproponowano: false }] } });
    pokaz({ twId: 99, maMaszyne: true });

    await userEvent.click(screen.getByRole("button", { name: /Zaproponuj jako dowód/ }));
    expect(pomiar.mutate).toHaveBeenCalledWith(
      { id: 4821, zadanieId: 400, twId: 99, polaryzacja: "pasuje", powodNegatywny: null });
  });
});
