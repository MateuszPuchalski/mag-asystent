import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import type { HistoriaKlienta, SprawaKlienta } from "../api/typy";

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

const { Klient, WidokHistorii } = await import("./Klient");

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

  it("wątek bez loginu i tak pokazuje sprawę kupującego z zamówienia rozmowy", () => {
    /* S6, 0.535.0: sprawa budzi się z rozmowy dowiązanej numerem zamówienia
       i do niej odsyła — więc ta rozmowa pokazuje sprawę, choć historii nie
       zna. Login linijki to login SPRAWY, bo historia go nie ma. */
    pokaz(dane({ login: null, sprawa: {
      id: 7, login: "Kupujacy55", wersja: 1, stan: "w_toku", krok: "czekamy na zwrot",
      krokDo: "2026-09-28T06:00:00Z", dzis: false, poTerminie: false, prowadzi: "Ola", prowadziId: 1,
      zakonczonoAt: null, zakonczyl: null, odcisk: "{}", nowe: [] } }));
    expect(screen.getByText(/nie niesie loginu kupującego/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sprawa klienta: czekamy na zwrot/ }))
      .toHaveAttribute("href", "/obsluga/klient/Kupujacy55");
    expect(screen.queryByLabelText("Oś historii klienta")).not.toBeInTheDocument();
  });

  it("login nie stoi trzeci raz — profil klienta zostaje o klik", () => {
    /* Zeszło (0.513.0): w skrzynce login stoi w nagłówku rozmowy i przy
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

  it("historia przy źródle niesie sprawę klienta i prowadzi do profilu", () => {
    /* S6, 0.535.0: wiązanie w obie strony. Profil prowadzi do rozmowy, więc
       rozmowa mówi, że klienta ktoś prowadzi i na co czeka — inaczej drugi
       agent odpisałby klientowi, nie wiedząc o kroku kolegi. */
    const sprawa: SprawaKlienta = {
      id: 5, login: "zielony_ogrod", wersja: 2, stan: "w_toku", krok: "czekamy na zwrot",
      krokDo: "2026-09-25T06:00:00Z", dzis: false, poTerminie: true, prowadzi: "Bartek", prowadziId: 2,
      zakonczonoAt: null, zakonczyl: null, odcisk: "{}",
      nowe: [{ rodzaj: "rozmowa", tekst: "Klient napisał 26.09 14:10", at: null, cel: "/obsluga/skrzynka/41" }],
    };
    pokaz(dane({ sprawa }));
    const linia = screen.getByRole("link", { name: /Sprawa klienta: czekamy na zwrot/ });
    expect(linia).toHaveAttribute("href", "/obsluga/klient/zielony_ogrod");
    expect(linia).toHaveTextContent("prowadzi Bartek");
    expect(linia).toHaveTextContent("Klient napisał 26.09 14:10");
    expect(screen.getByText("po terminie").className).toContain("text-ranga-zle");
  });

  it("bez sprawy i na samym profilu linijki sprawy nie ma", () => {
    pokaz(dane({ sprawa: null }));
    expect(screen.queryByRole("link", { name: /Sprawa klienta/ })).toBeNull();

    /* Profil ma własną kartę sprawy — druga, w historii, mówiłaby to samo. */
    render(<MemoryRouter><WidokHistorii tutaj="tym profilem" bezProfilu onOtworzRozmowe={vi.fn()}
      historia={{ login: "zielony_ogrod", maszyny: [], wpisy: [], sprawa: {
        id: 5, login: "zielony_ogrod", wersja: 2, stan: "zakonczona", krok: "dosłać",
        krokDo: "2026-09-25T06:00:00Z", dzis: false, poTerminie: false, prowadzi: "Bartek", prowadziId: 2,
        zakonczonoAt: "2026-09-24T12:00:00Z", zakonczyl: "Bartek", odcisk: "{}", nowe: [] } }} />
    </MemoryRouter>);
    expect(screen.queryByText(/Sprawa klienta/)).toBeNull();
  });
});
