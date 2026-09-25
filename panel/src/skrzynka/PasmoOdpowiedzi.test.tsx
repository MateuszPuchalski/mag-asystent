import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { KartaTowaru, OsRozmowy } from "../api/typy";

/* ── Pasmo odpowiedzi (0.404.0) ──────────────────────────────────────────────
   Zgłoszenie właściciela ze zrzutem: „popraw skrzynkę odpowiadania pytań".
   Prawa kolumna niosła około czterdziestu faktów w jednej wadze, a trzy
   rozstrzygające — co zamówił, czym to jest, czy mamy — leżały wśród nich,
   przy czym stan i półka dopiero po sześciu sekcjach przewijania.

   Testy pilnują TEGO, co uzasadnia pasmo, a nie jego wyglądu:

   1. TRZY FAKTY BEZ PRZEWIJANIA I BEZ WYBORU ZAKŁADKI.
   2. BRAK WIEDZY TO NIE ZERO. Wiersz, którego nie ma z czego złożyć, nie
      staje wcale — pusta etykieta „Mamy" czytałaby się jak „nie mamy".
   3. PROPOZYCJA KARTOTEKI NIE JEST FAKTEM. Pasmo mówi tylko o kartotece
      potwierdzonej (§4.3, §11.3); niepewne dopasowanie zostaje propozycją
      z przyciskiem w sekcji niżej.
   4. WSTAWKA WSTAWIA TO SAMO, co przedtem przycisk pod tabelą Subiekta —
      czyli pola wybrane świadomie, bo szkic idzie DO KLIENTA.              */

const karta = vi.fn();
vi.mock("../api/rozmowy", () => ({
  useKartaTowaru: (twId: number | null) => karta(twId),
}));

const { PasmoOdpowiedzi, dopisekDostaw } = await import("./PasmoOdpowiedzi");

const PELNA: KartaTowaru = {
  id: 7701, sym: "MFG163856", name: "Zestaw prowadnica 16\" 3/8\" 1,3mm +2 łań.",
  ean: "5907580109688", unit: "szt.", locs: ["E06-02-01"],
  mag: { stan: 16, rez: 0, avail: 16 },
  magazyny: [],
};

const dane = (n: {
  pewnosc?: string; twId?: number | null; pozycje?: boolean; kupiono?: string | null;
} = {}): OsRozmowy => ({
  rozmowa: { id: 5 },
  os: [], szkic: null, ofertaWskazana: null, zwroty: [], sprawy: [], droga: [],
  kandydaciZamowien: [], dobor: {}, szkicCopilota: null,
  oferta: {
    externalId: "of-1", link: null, zrodlo: "zamowienie", pobrana: null,
    kartoteka: {
      pewnosc: n.pewnosc ?? "pamiec", twId: n.twId === undefined ? 7701 : n.twId,
      symbol: "MFG163856", zrodlo: "Wskazane", powod: null,
    },
  },
  zamowienie: n.pozycje === false ? null : {
    externalId: "zam-1", link: null,
    pobrane: {
      kupionoAt: n.kupiono === undefined ? "2026-09-17T06:28:00.000Z" : n.kupiono,
      pozycje: [{ offerId: "of-1", sku: "MFG163856", nazwa: "Prowadnica", ilosc: 3,
        cenaGrosze: 4500, waluta: "PLN" }],
    },
  },
} as unknown as OsRozmowy);

beforeEach(() => {
  karta.mockReset();
  karta.mockReturnValue({ isLoading: false, error: null, data: PELNA });
});

describe("Pasmo odpowiedzi nad zakładkami", () => {
  it("mówi, CO klient zamówił — ilość i sygnaturę z chwili zakupu", () => {
    render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.getByText("3 × MFG163856")).toBeInTheDocument();
    expect(screen.getByText(/17 września 2026/)).toBeInTheDocument();
  });

  it("mówi, CZYM to jest u nas — nazwą kartoteki, nie numerem oferty", () => {
    render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.getByText(/Zestaw prowadnica/)).toBeInTheDocument();
  });

  it("mówi, CZY mamy — stan i półkę, bez przewijania kolumny", () => {
    render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.getByText("16 szt.")).toBeInTheDocument();
    expect(screen.getByText(/E06-02-01/)).toBeInTheDocument();
  });

  it("BRAK NA STANIE mówi o sobie wprost — to zmienia treść odpowiedzi", () => {
    karta.mockReturnValue({ isLoading: false, error: null,
      data: { ...PELNA, mag: { stan: 0, rez: 0, avail: 0 } } });
    render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.getByText("brak na stanie")).toBeInTheDocument();
  });

  /* „Kiedy będzie" (0.502.0): przy braku — co zamówione i na kiedy, przy
     stanie — ile stoi w przyjęciach. W wierszu „Mamy", nie w czwartym. */
  it("przy braku mówi, co zamówione u dostawcy i na kiedy — w wierszu „Mamy”", () => {
    const zam = (termin: string | null, ilosc: number) => ({ dokId: 1, nrPelny: "ZD 1", dataWyst: "2026-09-20",
      termin, dostawca: "Rosa-Pol", ilosc, szacunek: false });
    karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA,
      mag: { stan: 0, rez: 0, avail: 0 }, zamowione: [zam("2026-10-01", 20), zam(null, 5)] } });
    render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.getByText(/zamówione 25 szt\. u Rosa-Pol, termin/)).toHaveTextContent("(2 zamówienia)");
    expect(dopisekDostaw({ ...PELNA, mag: { stan: 0, rez: 0, avail: 0 }, zamowione: [] }))
      .toBe("nic nie zamówione u dostawcy");
    expect(dopisekDostaw({ ...PELNA, mag: { stan: 0, rez: 0, avail: 0 } })).toBeNull();
  });

  it("przy stanie mówi, ile z niego stoi jeszcze w przyjęciach", () => {
    expect(dopisekDostaw({ ...PELNA, wDostawie: [{ dokId: 2, nrPelny: "FZ 9", dataWyst: "2026-09-24",
      ilosc: 4, dostawca: "X" }] })).toBe("w tym 4 szt. w przyjęciach, jeszcze nie na półce");
    expect(dopisekDostaw(PELNA)).toBeNull();
  });

  it("bez pobranej kartoteki NIE pisze pustego wiersza — brak wiedzy to nie zero", () => {
    karta.mockReturnValue({ isLoading: true, error: null, data: undefined });
    render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.queryByText("Mamy")).not.toBeInTheDocument();
    expect(screen.queryByText("To jest")).not.toBeInTheDocument();
    /* Zamówienie zostaje: ono nie zależy od Subiekta. */
    expect(screen.getByText("3 × MFG163856")).toBeInTheDocument();
  });

  it("PROPOZYCJI kartoteki nie podaje jako faktu — o kartotekę pyta dopiero pewność", () => {
    render(<PasmoOdpowiedzi dane={dane({ pewnosc: "sugestia" })} />);
    expect(karta).toHaveBeenCalledWith(null);
  });

  it("bez oferty i bez zamówienia nie rysuje się WCALE — pasek bez treści to koszt", () => {
    karta.mockReturnValue({ isLoading: false, error: null, data: undefined });
    const { container } = render(
      <PasmoOdpowiedzi dane={dane({ pozycje: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("nie ma wstawki do szkicu — odpowiedź układa Copilot z tych samych faktów", () => {
    /* Decyzja właściciela z 22 września 2026: wstawka dublowała treść szkicu,
       który czeka przy każdej wiadomości. Pasmo zostaje do SPRAWDZANIA. */
    render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.getByText("Mamy")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /wstaw do szkicu/ })).not.toBeInTheDocument();
  });
});
