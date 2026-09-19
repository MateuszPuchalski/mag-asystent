import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Reklamacja, SzczegolReklamacji } from "../api/typy";

/* ── Cennik Subiekta przy reklamacji (0.411.0) ───────────────────────────────
   Zgłoszenie właściciela: „nadal nie widzę cen w reklamacjach", a zaraz potem
   powód: „są kluczowe do szybkiego oceniania, czy warto rozpatrywać
   reklamację".

   To drugie zdanie jest tu ważniejsze od pierwszego, bo rozstrzyga KSZTAŁT.
   Liczba używana do TRIAŻU nie może stać za kliknięciem — zwijka kosztowałaby
   ruch przy każdej sprawie, czyli przy tej czynności, którą ma przyspieszyć.
   Dlatego testy pilnują nie tego, ŻE ceny są, tylko że są BEZ OTWIERANIA.

   Drugi test pilnuje ciszy: sprawa bez potwierdzonej kartoteki nie dostaje
   pustej ramki po cenniku. Brak wiedzy nie jest informacją wartą miejsca
   w kolumnie, którą 0.403.0 odchudzało.                                     */

const karta = vi.fn();
vi.mock("../api/rozmowy", () => ({ useKartaTowaru: (twId: number | null) => karta(twId) }));

const { Dowody } = await import("./Dowody");

const CENY = [
  { poziom: 1, nazwa: "Detaliczna", nettoGrosze: 690, bruttoGrosze: 849, waluta: "PLN" },
  { poziom: 2, nazwa: "Hurtowa", nettoGrosze: 520, bruttoGrosze: 640, waluta: "PLN" },
];

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 5, externalId: "i-5", numer: "2046692/2026", orderId: null, offerId: "of-1",
  kupujacyLogin: "Snake631", prawo: "COMPLAINT", powodTyp: null, powodOpis: null,
  temat: null, opis: null, oczekiwanie: "EXCHANGE", oczekiwanaKwotaGrosze: null,
  waluta: "PLN", statusAllegro: "CLAIM_ACCEPTED", decyzjaDo: null, dniDoTerminu: null,
  poTerminie: false, zwrotWymagany: false, czatAktywny: true, wiadomosciIle: 11,
  czatUrwany: false, ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-07-16T10:11:00.000Z", kupionoAt: null, kupionoZrodlo: null,
  prowadzi: null, prowadziId: null, prowadziAt: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, notatka: null,
  wersja: 1, kubelek: "odpowiedz", sygnaly: [], link: null, linkZamowienia: null,
  linkOferty: null, ofertaNazwa: "NAPINACZ ŁAŃCUCHA", ofertaZdjecie: "brak",
  twId: 11, twSymbol: "W28-0806", twZParagonu: true, ...n,
} as unknown as Reklamacja);

const props = (r: Partial<Reklamacja> = {}) => ({
  szczegol: {
    reklamacja: rek(r), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [],
    droga: [], kartoteka: null, karta: null, zamowienie: null, przesylka: null,
  } as unknown as SzczegolReklamacji,
  trwa: false, bladZapisu: "", onNotatka: vi.fn(),
});

beforeEach(() => {
  karta.mockReset();
  karta.mockReturnValue({ data: { ceny: CENY }, isLoading: false, error: null });
});

describe("Cennik Subiekta w kolumnie dowodów", () => {
  it("stoi na wierzchu — BEZ otwierania zwijki, bo służy do triażu", () => {
    render(<Dowody {...props()} />);
    /* Żadnego kliknięcia przed tą asercją i to jest cały jej sens. */
    expect(screen.getByText("Detaliczna")).toBeInTheDocument();
    expect(screen.getByText("8,49 PLN")).toBeInTheDocument();
    expect(screen.getByText("Hurtowa")).toBeInTheDocument();
  });

  it("niesie WSZYSTKIE poziomy, nie jeden wybrany za właściciela", () => {
    /* Decyzja właściciela z 0.396.0: „wszystkie poziomy cen". Wybranie
       jednego za niego byłoby zgadywaniem, który cennik jest tym właściwym
       przy tej konkretnej reklamacji. */
    render(<Dowody {...props()} />);
    expect(screen.getAllByText(/PLN/).length).toBeGreaterThanOrEqual(4);
  });

  it("bez kartoteki MILCZY — pusta ramka to nie jest informacja", () => {
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(<Dowody {...props({ twId: null })} />);
    expect(screen.queryByText(/Ceny · Subiekt GT/)).not.toBeInTheDocument();
  });

  it("pyta o kartotekę POTWIERDZONĄ tej sprawy, a nie o cokolwiek", () => {
    render(<Dowody {...props()} />);
    expect(karta).toHaveBeenCalledWith(11);
  });
});
