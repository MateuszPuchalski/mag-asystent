import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import type { HistoriaKlienta } from "../api/typy";

/* ── Zakładka KLIENT (§10.1) ─────────────────────────────────────────────────
   Zakładka jest ODCZYTEM i te testy pilnują dwóch rzeczy, które o niej
   stanowią:

   1. MASZYNA NIESIE SWOJE ŹRÓDŁO. „NAC LS 46-450" bez rozmowy, w której to
      ustalono, jest twierdzeniem bez pokrycia — §4.3 żąda źródła przy każdym
      fakcie, a klik ma prowadzić tam, gdzie ono stoi.
   2. BRAK LOGINU TO NIE BRAK HISTORII. Wątek bez rozmówcy znaczy „nie wiemy,
      czyja to historia". Pokazanie wtedy pustej osi byłoby kłamstwem
      o kliencie, który kupuje u nas od lat.                                 */

const historia = vi.fn();
vi.mock("../api/rozmowy", () => ({ useHistoriaKlienta: (id: number | null) => historia(id) }));

const { Klient } = await import("./Klient");

const dane = (n: Partial<HistoriaKlienta> = {}): HistoriaKlienta =>
  ({ login: "zielony_ogrod", maszyny: [], wpisy: [], ...n });

const pokaz = (d: HistoriaKlienta, onOtworz = vi.fn()) => {
  historia.mockReturnValue({ data: d, isLoading: false, error: null });
  render(<MemoryRouter><Klient rozmowaId={4821} onOtworzRozmowe={onOtworz} /></MemoryRouter>);
  return onOtworz;
};

beforeEach(() => vi.clearAllMocks());

describe("zakładka klienta", () => {
  it("maszyna niesie rocznik, silnik i rozmowę, w której ją ustalono", async () => {
    const onOtworz = pokaz(dane({ maszyny: [{ marka: "NAC", nazwa: "LS 46-450", wariant: null,
      rocznik: "2019", silnik: "1P70FV", rozmowaId: 3140, at: "2024-06-14T09:30:00Z" }] }));

    expect(screen.getByText(/NAC LS 46-450/)).toBeInTheDocument();
    expect(screen.getByText("(2019)")).toBeInTheDocument();
    expect(screen.getByText("1P70FV")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /rozmowie #3140/ }));
    expect(onOtworz).toHaveBeenCalledWith(3140);
  });

  it("oś rozdziela zakup od rozmowy i prowadzi w dwa różne miejsca", async () => {
    const onOtworz = pokaz(dane({ wpisy: [
      { rodzaj: "zakup", at: "2024-06-14T12:00:00Z", tresc: "Szarpak SZR-148/82",
        zamowienieId: "2024/06/1183", link: "https://allegro.pl/zam/2024-06-1183", rozmowaId: null,
        sprawaId: null },
      { rodzaj: "rozmowa", at: "2024-06-14T09:00:00Z", tresc: "ustalono model kosiarki",
        zamowienieId: null, link: null, rozmowaId: 3140, sprawaId: null },
    ] }));

    /* Zakup wychodzi z aplikacji do panelu Allegro — to jedyne miejsce, gdzie
       stoi całe zamówienie. Rozmowa zostaje u nas. */
    const zamowienie = screen.getByRole("link", { name: /2024\/06\/1183/ });
    expect(zamowienie).toHaveAttribute("href", "https://allegro.pl/zam/2024-06-1183");
    expect(screen.getByText(/Szarpak SZR-148\/82/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /ustalono model kosiarki/ }));
    expect(onOtworz).toHaveBeenCalledWith(3140);
  });

  it("wątek bez loginu mówi, że nie wiemy — nie pokazuje pustej historii", () => {
    pokaz(dane({ login: null }));
    expect(screen.getByText(/nie niesie loginu kupującego/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Oś historii klienta")).not.toBeInTheDocument();
  });

  it("login nie stoi trzeci raz — profil klienta zostaje o klik", () => {
    /* Zeszło (@wydanie): w skrzynce login stoi w nagłówku rozmowy i przy
       wiadomościach, a kopiuje się go stamtąd. Odnośnik do profilu zostaje. */
    pokaz(dane());
    expect(screen.queryByText("zielony_ogrod")).toBeNull();
    expect(screen.getByRole("link", { name: "Profil klienta" }))
      .toHaveAttribute("href", "/obsluga/klient/zielony_ogrod");
  });

  it("klient znany, ale bez historii, dostaje zdanie zamiast pustki", () => {
    pokaz(dane());
    expect(screen.getByText(/Pierwszy kontakt/)).toBeInTheDocument();
  });

  it("zwrot, reklamacja i dyskusja stoją na osi i prowadzą do swoich kolejek", async () => {
    /* S2 spoiwa: zakładka obiecywała historię, a pokazywała jej połowę.
       Wiersz prowadzi na ekran właściwej kolejki, bo tam stoją bramki sprawy. */
    pokaz(dane({ wpisy: [
      { rodzaj: "zwrot", at: "2026-08-10T12:00:00Z", tresc: "Z-77",
        zamowienieId: "ord-1", link: null, rozmowaId: null, sprawaId: 11 },
      { rodzaj: "reklamacja", at: "2026-08-09T12:00:00Z", tresc: "Nie działa",
        zamowienieId: "ord-1", link: null, rozmowaId: null, sprawaId: 22 },
      { rodzaj: "dyskusja", at: "2026-08-08T12:00:00Z", tresc: "Gdzie paczka",
        zamowienieId: "ord-1", link: null, rozmowaId: null, sprawaId: 33 },
    ] }));

    expect(screen.getByRole("link", { name: /Z-77/ })).toHaveAttribute("href", "/obsluga/zwroty/11");
    expect(screen.getByRole("link", { name: /Nie działa/ }))
      .toHaveAttribute("href", "/obsluga/reklamacje/22");
    expect(screen.getByRole("link", { name: /Gdzie paczka/ }))
      .toHaveAttribute("href", "/obsluga/dyskusje/33");
  });
});
