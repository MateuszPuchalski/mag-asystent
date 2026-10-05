import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { KartaTowaru, OsRozmowy } from "../api/typy";
import { BrakPolaczenia } from "../api/klient";

/* ── Pasmo odpowiedzi ────────────────────────────────────────────────────────
   Zgłoszenie właściciela ze zrzutem: „popraw skrzynkę odpowiadania pytań".
   Prawa kolumna niosła około czterdziestu faktów w jednej wadze, a trzy
   rozstrzygające — co zamówił, czym to jest, czy mamy — leżały wśród nich,
   przy czym stan i półka dopiero po sześciu sekcjach przewijania.

   Testy pilnują TEGO, co uzasadnia pasmo, a nie jego wyglądu:

   1. TRZY FAKTY BEZ PRZEWIJANIA I BEZ WYBORU ZAKŁADKI.
   2. BRAK WIEDZY TO NIE ZERO. Wiersz, którego nie ma z czego złożyć, nie
      staje wcale — pusta etykieta „Mamy" czytałaby się jak „nie mamy".
      Wiersz, który czeka na Subiekta, mówi „wczytuję…" i trzyma miejsce,
      żeby pasmo nie dorastało pod okiem agenta.
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
  bezOferty?: boolean; skuOferty?: string;
} = {}): OsRozmowy => ({
  rozmowa: { id: 5 },
  os: [], szkic: null, ofertaWskazana: null, zwroty: [], sprawy: [], droga: [],
  kandydaciZamowien: [], dobor: {}, szkicCopilota: null,
  oferta: n.bezOferty ? null : {
    externalId: "of-1", link: null, zrodlo: "zamowienie",
    pobrana: n.skuOferty ? { nazwa: "Prowadnica", sku: n.skuOferty, cenaGrosze: 4500, waluta: "PLN",
      status: "ACTIVE", syncedAt: "2026-09-17T06:28:00.000Z", zdjecie: "brak" } : null,
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
    /* Datę zakupu mówi krok „Złożone" w karcie i linia osi. Tu byłaby
       drugim domem tego samego faktu. */
    expect(screen.queryByText(/17 września 2026/)).toBeNull();
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

  it("symbol kartoteki staje tylko wtedy, gdy różni się od sygnatury zamówienia", () => {
    /* Ten sam symbol stał w „Zamówił" i w „To jest". Równy to powtórzenie;
       różny mówi, że oferta wskazuje inną kartotekę. */
    const { unmount } = render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.getAllByText(/MFG163856/)).toHaveLength(1);
    unmount();
    karta.mockReturnValue({ isLoading: false, error: null, data: { ...PELNA, sym: "MFG-INNY" } });
    render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.getByText(/MFG-INNY/)).toBeInTheDocument();
  });

  it("BRAK NA STANIE mówi o sobie wprost — to zmienia treść odpowiedzi", () => {
    karta.mockReturnValue({ isLoading: false, error: null,
      data: { ...PELNA, mag: { stan: 0, rez: 0, avail: 0 } } });
    render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.getByText("brak na stanie")).toBeInTheDocument();
  });

  /* „Kiedy będzie": przy braku — co zamówione i na kiedy, przy
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

  it("bez symbolu przy samej ofercie, gdy kartoteka ma jej SKU", () => {
    /* Bez zamówienia sygnaturę niesie oferta, a karta zakupu pokazuje ją
       nad osią. Ten sam symbol w „To jest" byłby drugim zapisem. */
    render(<PasmoOdpowiedzi dane={dane({ pozycje: false, skuOferty: "MFG163856" })} />);
    expect(screen.getByText(/Zestaw prowadnica/)).toBeInTheDocument();
    expect(screen.queryByText(/MFG163856/)).toBeNull();
  });

  it("w trakcie odczytu Subiekta wiersze stoją od razu z „wczytuję…” — pasmo nie dorasta", () => {
    /* Wiersze dochodziły po odczycie i spychały kolumnę o 45 px w chwili,
       w której agent ją czytał. Brak wiedzy dalej nie udaje zera: wartość
       mówi wprost, że jest w drodze. */
    karta.mockReturnValue({ isLoading: true, isError: false, error: null, data: undefined });
    render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.getByText("To jest")).toBeInTheDocument();
    expect(screen.getByText("Mamy")).toBeInTheDocument();
    expect(screen.getAllByText("wczytuję…")).toHaveLength(2);
    expect(screen.getByRole("complementary", { name: "Do tej odpowiedzi" })).toHaveAttribute("aria-busy", "true");
    /* Zamówienie zostaje: ono nie zależy od Subiekta. */
    expect(screen.getByText("3 × MFG163856")).toBeInTheDocument();
  });

  it("gdy odczyt kartoteki padł, mówi to wprost — „nie wiemy” zamiast zera", () => {
    karta.mockReturnValue({ isLoading: false, isError: true, error: new Error("Nie znaleziono towaru"), data: undefined });
    render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.getByText("odczyt kartoteki nie przeszedł")).toHaveClass("text-ranga-zle");
    expect(screen.getByText("nie wiemy")).toBeInTheDocument();
    expect(screen.queryByText("brak na stanie")).toBeNull();
  });

  /* Brak połączenia ogłasza pasek pod nagłówkiem. Pasmo nie podaje innej
     przyczyny: „Subiekt nie odpowiedział" kazało zgłaszać awarię, której nie było. */
  it("przy braku połączenia z serwerem nie obwinia Subiekta — samo „nie wiemy”", () => {
    karta.mockReturnValue({ isLoading: false, isError: true, error: new BrakPolaczenia(), data: undefined });
    render(<PasmoOdpowiedzi dane={dane()} />);
    expect(screen.getAllByText("nie wiemy")).toHaveLength(2);
    expect(screen.queryByText(/Subiekt|nie przeszedł/)).toBeNull();
  });

  it("PROPOZYCJI kartoteki nie podaje jako faktu — o kartotekę pyta dopiero pewność", () => {
    render(<PasmoOdpowiedzi dane={dane({ pewnosc: "sugestia" })} />);
    expect(karta).toHaveBeenCalledWith(null);
  });

  it("bez oferty i bez zamówienia nie rysuje się WCALE — pasek bez treści to koszt", () => {
    karta.mockReturnValue({ isLoading: false, error: null, data: undefined });
    const { container } = render(
      <PasmoOdpowiedzi dane={dane({ pozycje: false, bezOferty: true })} />);
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
