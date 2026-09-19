import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Reklamacja, SzczegolReklamacji } from "../api/typy";

/* ── Triaż reklamacji: czy mamy i ile nas kosztuje (0.412.0) ─────────────────
   Zgłoszenie właściciela ze zrzutem: „potrzebujemy wyraźnej hierarchii, żeby
   podjąć decyzję o reklamacji". Kolumna dowodów niosła sześć równorzędnych
   poziomów cen (0.411.0) i ani jednej sztuki stanu — przy sprawie, w której
   klient żąda WYMIANY.

   Testy pilnują TEGO, co rozstrzyga decyzję, a nie wyglądu pasma:

   1. STAN JEST NA EKRANIE. Przy żądaniu wymiany to jest cała decyzja, a do
      tego wydania reklamacja nie miała tej liczby nigdzie — skrzynka ma ją
      od 0.404.0.
   2. CENA ZAKUPU TO POZIOM 0, nie „najtańszy wiersz z listy". Najtańszy
      cennik sprzedaży to nadal sprzedaż, a pomyłka w tę stronę każe odrzucić
      reklamację, którą opłacało się uznać.
   3. BRAK KARTOTEKI MÓWI O SOBIE WPROST — pusty slot po stanie czytałby się
      jak „nie mamy" (dekalog obsługi, punkt 10).
   4. NIC SIĘ NIE ODEJMUJE. Zapłacone jest brutto, zakup netto; różnica tych
      dwóch nie jest marżą, a stawki VAT ten ładunek nie niesie.            */

const karta = vi.fn();
vi.mock("../api/rozmowy", () => ({ useKartaTowaru: (twId: number | null) => karta(twId) }));

const { Dowody } = await import("./Dowody");

const CENY = [
  { poziom: 0, nazwa: "", nettoGrosze: 1864, bruttoGrosze: 0, waluta: "PLN" },
  { poziom: 1, nazwa: "Detaliczna", nettoGrosze: 2423, bruttoGrosze: 2980, waluta: "PLN" },
  { poziom: 2, nazwa: "Hurtowa", nettoGrosze: 1864, bruttoGrosze: 2293, waluta: "PLN" },
];

const KARTA = {
  id: 11, sym: "14-31051", name: "NÓŻ do kosiarki 46 cm", unit: "szt.",
  locs: ["D02-01-04"], mag: { stan: 7, rez: 0, avail: 7 }, magazyny: [], ceny: CENY,
};

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 5, externalId: "i-5", numer: "2862647/2026", orderId: "ord-5", offerId: "of-1",
  kupujacyLogin: "ekk69", prawo: "COMPLAINT", powodTyp: null, powodOpis: null,
  temat: null, opis: null, oczekiwanie: "EXCHANGE", oczekiwanaKwotaGrosze: null,
  waluta: "PLN", statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: null, dniDoTerminu: null,
  poTerminie: false, zwrotWymagany: false, czatAktywny: true, wiadomosciIle: 2,
  czatUrwany: false, ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-12T10:11:00.000Z", kupionoAt: null, kupionoZrodlo: null,
  prowadzi: null, prowadziId: null, prowadziAt: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, notatka: null,
  wersja: 1, kubelek: "decyzja", sygnaly: [], link: null, linkZamowienia: null,
  linkOferty: null, ofertaNazwa: "NÓŻ do kosiarki 46 cm", ofertaZdjecie: "brak",
  twId: 11, twSymbol: "14-31051", twZParagonu: true, ...n,
} as unknown as Reklamacja);

const props = (n: Partial<Reklamacja> = {}, zPozycja = true) => ({
  szczegol: {
    reklamacja: rek(n), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [],
    droga: [], kartoteka: null, karta: null, przesylka: null,
    zamowienie: zPozycja ? {
      sumaGrosze: 5990, dostawaGrosze: 1000, waluta: "PLN", dostawaMetoda: "DPD",
      kupionoAt: null,
      pozycje: [{ offerId: "of-1", sku: "14-31051", nazwa: "NÓŻ 46 cm", ilosc: 1,
        cenaGrosze: 4990, waluta: "PLN" }],
    } : null,
  } as unknown as SzczegolReklamacji,
  trwa: false, bladZapisu: "", onNotatka: vi.fn(),
});

beforeEach(() => {
  karta.mockReset();
  karta.mockReturnValue({ data: KARTA, isLoading: false, error: null });
});

describe("Triaż w kolumnie dowodów", () => {
  it("mówi, CZY MAMY — stan i półkę, bez otwierania czegokolwiek", () => {
    /* Żadnego kliknięcia przed tą asercją i to jest cały jej sens: przy
       żądaniu wymiany ta liczba rozstrzyga sprawę. */
    render(<Dowody {...props()} />);
    expect(screen.getByText("7 szt.")).toBeInTheDocument();
    expect(screen.getByText("D02-01-04")).toBeInTheDocument();
  });

  it("BRAK NA STANIE mówi o sobie wprost — to zmienia decyzję, nie tylko liczbę", () => {
    karta.mockReturnValue({ data: { ...KARTA, mag: { stan: 0, rez: 0, avail: 0 } },
      isLoading: false, error: null });
    render(<Dowody {...props()} />);
    expect(screen.getByText("brak na stanie")).toBeInTheDocument();
  });

  it("bez kartoteki mówi „nie wiadomo”, a nie zero — punkt 10 dekalogu", () => {
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(<Dowody {...props({ twId: null })} />);
    expect(screen.getByText("nie wiadomo")).toBeInTheDocument();
    expect(screen.getByText(/sprawa bez kartoteki/)).toBeInTheDocument();
  });

  it("KOSZT bierze z poziomu 0, bo to cena zakupu — nie z najtańszej sprzedaży", () => {
    /* Poziom 2 („Hurtowa") ma to samo netto co zakup, ale znaczy co innego.
       Bierzemy poziom 0, bo tak numeruje kolumny `tw_Cena`, a nie dlatego,
       że jakaś liczba wygląda na najniższą. */
    render(<Dowody {...props()} />);
    const kostka = screen.getByText("Nasz zakup").parentElement!;
    expect(kostka.textContent).toContain("18,64 PLN");
    expect(kostka.textContent).toContain("netto");
  });

  it("stawia obok kwotę Z PARAGONU i nie odejmuje jednej od drugiej", () => {
    /* Zapłacone jest brutto, zakup netto. Wyliczona z nich „marża" byłaby
       nieprawdą z dokładnością do stawki VAT, której ten ładunek nie niesie. */
    render(<Dowody {...props()} />);
    const kostka = screen.getByText("Klient zapłacił").parentElement!;
    expect(kostka.textContent).toContain("49,90 PLN");
    expect(screen.queryByText(/marż/i)).not.toBeInTheDocument();
  });

  it("poziom zakupu NIE wchodzi drugi raz do listy pozostałych cen", () => {
    render(<Dowody {...props()} />);
    expect(screen.getByText("Detaliczna")).toBeInTheDocument();
    expect(screen.getByText("Hurtowa")).toBeInTheDocument();
    expect(screen.queryByText("poziom 0")).not.toBeInTheDocument();
  });

  it("bez jednej i drugiej wiedzy nie rysuje się WCALE — pasek bez treści to koszt", () => {
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    const { container } = render(<Dowody {...props({ twId: 11 }, false)} />);
    expect(container.textContent).not.toContain("Nasz zakup");
    expect(container.textContent).not.toContain("Mamy");
  });
});
