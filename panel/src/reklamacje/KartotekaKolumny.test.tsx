import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Reklamacja, SzczegolReklamacji } from "../api/typy";

/* ── Jedna kartoteka na całą sprawę ──────────────────────────────────────────
   Sprawa, której oferta trafiła w kartotekę SAMĄ sygnaturą, nie ma `r.twId`
   — ten niesie tylko paragon i wskazanie człowieka. Wiersz towaru brał wtedy
   symbol z dopasowania po SKU, a triaż, kafel i przekrój patrzyły na
   `r.twId`. Na ekranie: symbol obok „Mamy: nie wiadomo · sprawa bez
   kartoteki", bez naszego zakupu i z martwym przyciskiem przekroju.

   Po przebudowie kartoteka występuje w TRZECH miejscach: symbol z przekrojem
   w głowicy, kafel pod „Wysłaliśmy" w kolumnie dowodów i fakty po prawej.
   Testy rysują wszystkie trzy naraz i pilnują, że KAŻDE bierze tę samą
   kartotekę, że paragon dalej bije sygnaturę i że symbol zdublowany zostaje
   brakiem. Zlecenia hali na reklamacji nie ma, więc nikt nie pyta o nią
   kartoteki. */

const karta = vi.fn();
vi.mock("../api/rozmowy", () => ({ useKartaTowaru: (twId: number | null) => karta(twId) }));

/* Kafel i zlecenie hali podmieniamy na rejestratory propsów: pytamy, KTÓRĄ
   kartotekę dostały, a nie jak rysują zdjęcie i formularz. */
const kafel = vi.fn();
vi.mock("../towar/Kafel", async (oryginal) => ({
  ...(await oryginal<typeof import("../towar/Kafel")>()),
  Kafel: (p: { twId: number | null; symbol?: string | null }) => { kafel(p.twId, p.symbol ?? null); return null; },
}));
const zlecHali = vi.fn();
vi.mock("../sprawy/ZlecHali", () => ({
  ZlecHali: (p: { twId?: number | null }) => { zlecHali(p.twId ?? null); return null; },
}));

const { Glowica } = await import("./Glowica");
const { KolumnaDowodow } = await import("./KolumnaDowodow");
const { SzufladaTowaru } = await import("../towar/Szuflada");

const TW_SKU = 42;
const SYMBOL = "14-25001";

const KARTA = {
  id: TW_SKU, sym: SYMBOL, name: "NÓŻ do kosiarki 46 cm", unit: "szt.",
  locs: ["D02-01-04"], mag: { stan: 7, rez: 0, avail: 7 }, magazyny: [],
  ceny: [
    { poziom: 0, nazwa: "", nettoGrosze: 1864, bruttoGrosze: 0, waluta: "PLN" },
    { poziom: 1, nazwa: "Detaliczna", nettoGrosze: 2423, bruttoGrosze: 2980, waluta: "PLN" },
  ],
};

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 5, externalId: "i-5", numer: "2862647/2026", orderId: "ord-5", offerId: "of-1",
  kupujacyLogin: "ekk69", prawo: "COMPLAINT", powodTyp: null, powodOpis: null,
  temat: null, opis: null, oczekiwanie: "EXCHANGE", oczekiwanaKwotaGrosze: null,
  waluta: "PLN", statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: null, dniDoTerminu: null,
  poTerminie: false, zwrotWymagany: false, czatAktywny: true, wiadomosciIle: 2,
  czatUrwany: false, ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-12T10:11:00.000Z",
  kupionoAt: null, kupionoZrodlo: null, dniOdZakupu: null,
  prowadzi: null, prowadziId: null, prowadziAt: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, notatka: null,
  wersja: 1, kubelek: "decyzja", sygnaly: [], link: null, linkZamowienia: null,
  linkOferty: null, ofertaNazwa: "NÓŻ do kosiarki 46 cm", ofertaZdjecie: "brak",
  twId: null, twSymbol: null, twZParagonu: false, ...n,
} as unknown as Reklamacja);

const PO_SKU: SzczegolReklamacji["kartoteka"] = {
  pewnosc: "sku", twId: TW_SKU, symbol: SYMBOL, zrodlo: `SKU oferty „${SYMBOL}"`, powod: null,
};

/** Głowica z pasem faktów i kolumna dowodów jednej sprawy — tak jak stoją na ekranie. */
const rysuj = (r: Partial<Reklamacja>, kartoteka: SzczegolReklamacji["kartoteka"]) => {
  const szczegol = {
    reklamacja: rek(r), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [],
    droga: [], kartoteka, karta: null, przesylka: null, zamowienie: null,
    historia: { towar: null, klient: null },
  } as unknown as SzczegolReklamacji;
  /* Router, bo głowica prowadzi łączem na profil klienta. */
  return render(<MemoryRouter><SzufladaTowaru>
    <Glowica szczegol={szczegol} trwa={false} onProwadze={vi.fn()} />
    <KolumnaDowodow szczegol={szczegol} trwa={false} blad="" idZdjecia={(z) => `zdjecie-${z}`}
      onPokaz={vi.fn()} onDodaj={vi.fn()} onUsun={vi.fn()} />
  </SzufladaTowaru></MemoryRouter>);
};

beforeEach(() => {
  karta.mockReset();
  kafel.mockReset();
  zlecHali.mockReset();
  /* Karta odpowiada WYŁĄCZNIE na kartotekę z SKU. Pytanie o `null` albo
     o inną kartotekę zostaje bez danych, jak w panelu. */
  karta.mockImplementation((twId: number | null) => ({
    data: twId === TW_SKU ? KARTA : undefined, isLoading: false, error: null,
  }));
});

describe("Sprawa bez r.twId, z kartoteką po SKU oferty", () => {
  it("stan i cena zakupu idą z kartoteki SKU, a nie „nie wiadomo”", () => {
    rysuj({}, PO_SKU);
    expect(karta).toHaveBeenCalledWith(TW_SKU);
    expect(karta).not.toHaveBeenCalledWith(null);
    expect(screen.getByText("7 szt.")).toBeInTheDocument();
    expect(screen.getByText("Klient zapłacił").parentElement!.textContent)
      .toContain("nasz zakup 18,64 PLN netto");
    expect(screen.queryByText("nie wiadomo")).not.toBeInTheDocument();
    expect(screen.queryByText("stanu ani dostaw nie znamy")).not.toBeInTheDocument();
  });

  it("symbol w głowicy otwiera przekrój towaru — przycisk żyje", () => {
    rysuj({}, PO_SKU);
    expect(screen.getByRole("button", { name: SYMBOL }))
      .toHaveAttribute("title", expect.stringContaining("Przekrój towaru"));
  });

  it("kafel pod „Wysłaliśmy” dostaje tę samą kartotekę i ten sam symbol co głowica", () => {
    rysuj({}, PO_SKU);
    expect(kafel).toHaveBeenCalledWith(TW_SKU, SYMBOL);
    expect(kafel).not.toHaveBeenCalledWith(null, expect.anything());
  });

  it("sygnatura mówi, że stoi za nią SKU, a nie paragon ani człowiek", () => {
    rysuj({}, PO_SKU);
    expect(screen.getByText("z SKU oferty")).toBeInTheDocument();
    expect(screen.queryByText("z paragonu")).not.toBeInTheDocument();
    expect(screen.queryByText("z mapowania oferty")).not.toBeInTheDocument();
  });

  it("zlecenia hali na reklamacji nie ma — nikt nie pyta o nią kartoteki", () => {
    /* Decyzja właściciela: „Zleć hali" zeszło z ekranu reklamacji. Zostaje
       w zwrotach i dyskusjach, tutaj nie rysuje się w żadnej kolumnie. */
    rysuj({}, PO_SKU);
    expect(zlecHali).not.toHaveBeenCalled();
    expect(screen.queryByText(/Zleć hali/)).not.toBeInTheDocument();
  });
});

describe("Kolejność i granice", () => {
  it("paragon bije sygnaturę — klient reklamuje to, co dostał", () => {
    rysuj({ twId: 11, twSymbol: "14-31051", twZParagonu: true }, PO_SKU);
    expect(karta).toHaveBeenCalledWith(11);
    expect(karta).not.toHaveBeenCalledWith(TW_SKU);
    expect(kafel).toHaveBeenCalledWith(11, "14-31051");
    expect(screen.getByText("14-31051")).toBeInTheDocument();
    expect(screen.getByText("z paragonu")).toBeInTheDocument();
  });

  it("symbol zdublowany zostaje brakiem i mówi zdaniem, nie kodem", () => {
    const zdanie = `Symbol „${SYMBOL}" ma więcej niż jedną kartotekę — wskaż ją`;
    rysuj({}, { pewnosc: "niejednoznaczne", twId: null, symbol: null,
      zrodlo: zdanie, powod: "symbol_zdublowany" });
    expect(karta).toHaveBeenCalledWith(null);
    expect(screen.getByText("nie wiadomo")).toBeInTheDocument();
    expect(screen.getByText(zdanie)).toBeInTheDocument();
    expect(screen.queryByText("symbol_zdublowany")).not.toBeInTheDocument();
    /* Pusty kafel kartoteki czytałby się jak „u nas nie ma zdjęcia". */
    expect(kafel).not.toHaveBeenCalled();
  });
});
