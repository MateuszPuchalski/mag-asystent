import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  DopasowanieKartoteki, Reklamacja, StanPrzesylki, SzczegolReklamacji, Zamowienie,
} from "../api/typy";

/* ── Karta Produkt ───────────────────────────────────────────────────────────
   Fakty towaru, z których wydaje się werdykt, w karcie pod decyzją. Testy
   pilnują tego, co rozstrzyga decyzję, a nie wyglądu karty:

   1. JEDNA KARTOTEKA NA SPRAWĘ. Paragon bije sygnaturę, SKU i pamięć wskazań
      wchodzą, zgadywanie nie. Stan, półka i cennik pytają o tę samą kartę.
   2. BRAK KARTY TO BRAK WIERSZA, nie „0 szt.” — zero przy braku wiedzy kłamie.
   3. CENY BEZ KLIKANIA, bo służą do triażu; poziom 0 (zakup) poza osią.
   4. ZAMÓWIENIE, PACZKA I INNE SPRAWY ZAKUPU STOJĄ NA DRODZE SPRAWY, nie
      w karcie. Ich fakty i odnośniki pilnuje `DrogaSprawy.test.tsx`.  */

const karta = vi.fn();
vi.mock("../api/rozmowy", () => ({ useKartaTowaru: (twId: number | null) => karta(twId) }));
/* Cennik rysuje agent sąsiedniego pliku; tu pytamy, CO dostał. */
const ceny = vi.fn();
vi.mock("../skrzynka/OsCenKartoteki", () => ({
  CenyKartoteki: (p: { ceny: Array<{ nazwa: string }>; oferta: unknown; zakup: unknown }) => {
    ceny(p); return <ul aria-label="cennik">{p.ceny.map((c) => <li key={c.nazwa}>{c.nazwa}</li>)}</ul>;
  },
}));

const { Produkt, kartotekaSprawy } = await import("./Produkt");

const KARTA = {
  id: 11, sym: "14-31051", name: "NÓŻ do kosiarki 46 cm", unit: "szt.",
  locs: ["D02-01-04"], mag: { stan: 7, rez: 0, avail: 7 }, magazyny: [],
  ceny: [
    { poziom: 0, nazwa: "", nettoGrosze: 1864, bruttoGrosze: 0, waluta: "PLN" },
    { poziom: 1, nazwa: "Detaliczna", nettoGrosze: 2423, bruttoGrosze: 2980, waluta: "PLN" },
    { poziom: 2, nazwa: "Hurtowa", nettoGrosze: 1864, bruttoGrosze: 2293, waluta: "PLN" },
  ],
};

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 5, externalId: "i-5", numer: "2862647/2026", orderId: "ord-5", offerId: "of-1",
  kupujacyLogin: "ekk69", prawo: "COMPLAINT", powodTyp: "DEFECT_FOUND_DURING_USE", powodOpis: null,
  temat: null, opis: null, oczekiwanie: "EXCHANGE", oczekiwanaKwotaGrosze: null,
  waluta: "PLN", statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: null, dniDoTerminu: null,
  poTerminie: false, zwrotWymagany: false, czatAktywny: true, wiadomosciIle: 2,
  czatUrwany: false, ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-28T10:11:00.000Z",
  kupionoAt: "2026-09-18T10:00:00.000Z", kupionoZrodlo: "zamowienie", dniOdZakupu: 21,
  zgloszonoPoDniach: 10, ilosc: 1,
  prowadzi: null, prowadziId: null, prowadziAt: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, notatka: null,
  wersja: 1, kubelek: "decyzja", sygnaly: [], link: null, linkZamowienia: "https://allegro.pl/z/5",
  linkOferty: "https://allegro.pl/o/1", ofertaNazwa: "NÓŻ do kosiarki 46 cm", ofertaZdjecie: "brak",
  twId: 11, twSymbol: "14-31051", twZParagonu: true,
  cenaParagonuGrosze: 2799, ofertaCenaGrosze: 2980, ...n,
} as unknown as Reklamacja);

const ZAMOWIENIE = {
  externalId: "ord-5", status: "READY_FOR_PROCESSING", kupujacyLogin: "ekk69",
  dostawaGrosze: 0, dostawaMetoda: null, platnoscTyp: "ONLINE",
  platnoscAt: "2026-09-18T10:05:00.000Z", fakturaZadana: null, sumaGrosze: 2799, waluta: "PLN",
  kupionoAt: "2026-09-18T10:00:00.000Z", link: null, pozycje: [],
} as unknown as Zamowienie;

const szczegol = (n: Partial<SzczegolReklamacji> = {}, r: Partial<Reklamacja> = {}) => ({
  reklamacja: rek(r), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [],
  droga: [], kartoteka: null, karta: null, zamowienie: ZAMOWIENIE, przesylka: null,
  historia: { towar: null, klient: null }, ...n,
} as unknown as SzczegolReklamacji);

const przesylka = (n: Partial<StanPrzesylki> = {}): StanPrzesylki => ({
  waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null, ...n,
});

const dopasowanie = (pewnosc: string, twId: number | null): DopasowanieKartoteki =>
  ({ twId, symbol: "X", pewnosc, zrodlo: "zdanie serwera o braku" } as unknown as DopasowanieKartoteki);

beforeEach(() => {
  karta.mockReset();
  ceny.mockReset();
  karta.mockReturnValue({ data: KARTA, isLoading: false, error: null });
});

describe("Jedna kartoteka na całą sprawę", () => {
  const sprawa = (twId: number | null, k: DopasowanieKartoteki | null) =>
    ({ reklamacja: rek({ twId, twSymbol: twId ? "PARAGON" : null }), kartoteka: k });

  it("paragon albo mapowanie wygrywa z każdą kartoteką wywiedzioną", () => {
    expect(kartotekaSprawy(sprawa(11, dopasowanie("sku", 99))))
      .toEqual({ twId: 11, symbol: "PARAGON", zrodlo: "paragon" });
  });

  it("bez nich bierze kartotekę PEWNĄ — z pamięci wskazań albo jedynego trafienia po SKU", () => {
    expect(kartotekaSprawy(sprawa(null, dopasowanie("sku", 99)))).toEqual({ twId: 99, symbol: "X", zrodlo: "sku" });
    expect(kartotekaSprawy(sprawa(null, dopasowanie("pamiec", 98))))
      .toEqual({ twId: 98, symbol: "X", zrodlo: "mapowanie" });
  });

  it("trafienie niepewne nie wchodzi — zgadywanie to nie kartoteka", () => {
    const brak = { twId: null, symbol: null, zrodlo: null };
    expect(kartotekaSprawy(sprawa(null, dopasowanie("jedyna_pozycja", 97)))).toEqual(brak);
    expect(kartotekaSprawy(sprawa(null, dopasowanie("niejednoznaczne", null)))).toEqual(brak);
    expect(kartotekaSprawy(sprawa(null, null))).toEqual(brak);
  });

  it("stan i cennik pytają o kartę z SKU oferty, gdy paragonu nie ma", () => {
    render(<Produkt szczegol={szczegol({ kartoteka: dopasowanie("sku", 42) }, { twId: null, twSymbol: null })} />);
    expect(karta).toHaveBeenCalledWith(42);
  });

  it("symbol zdublowany zostaje brakiem i mówi zdaniem serwera, nie kodem", () => {
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(<Produkt szczegol={szczegol({ kartoteka: dopasowanie("niejednoznaczne", null) },
      { twId: null, twSymbol: null })} />);
    expect(karta).toHaveBeenCalledWith(null);
    expect(screen.getByText("zdanie serwera o braku")).toBeInTheDocument();
  });
});

describe("Produkt: co to jest, czy mamy i ile kosztuje", () => {
  it("nazwa, symbol z ilością i stan z półką z Subiekta", () => {
    render(<Produkt szczegol={szczegol()} />);
    expect(screen.getByRole("heading", { name: "Produkt" })).toBeInTheDocument();
    expect(screen.getByText("NÓŻ do kosiarki 46 cm")).toBeInTheDocument();
    expect(screen.getByText("14-31051")).toBeInTheDocument();
    expect(screen.getByText(/1 szt\./)).toBeInTheDocument();
    expect(screen.getByText(/W Subiekcie:/)).toHaveTextContent("W Subiekcie: 7 szt. · półka D02-01-04");
  });

  it("nieznana ilość milczy — sztuka z domysłu nie staje przy symbolu", () => {
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(<Produkt szczegol={szczegol({}, { ilosc: null })} />);
    expect(screen.getByText("14-31051").closest("span.text-sm")).toHaveTextContent(/^14-31051$/);
    expect(screen.queryByText(/szt\./)).not.toBeInTheDocument();
  });

  it("brak na stanie mówi o sobie wprost — przy wymianie to cała decyzja", () => {
    karta.mockReturnValue({ data: { ...KARTA, mag: { stan: 0, rez: 0, avail: 0 } }, isLoading: false, error: null });
    render(<Produkt szczegol={szczegol()} />);
    expect(screen.getByText("brak na stanie")).toBeInTheDocument();
  });

  it("bez karty z Subiekta wiersz stanu NIE staje — zero byłoby kłamstwem", () => {
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(<Produkt szczegol={szczegol()} />);
    expect(screen.queryByText(/W Subiekcie:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 szt/)).not.toBeInTheDocument();
  });

  it("ceny stoją bez klikania, bez poziomu zakupu, z ceną oferty i ceną, za którą kupił", () => {
    render(<Produkt szczegol={szczegol()} />);
    expect(screen.getByText("Ceny tego towaru w Subiekcie")).toBeVisible();
    const p = ceny.mock.calls[0][0];
    expect(p.ceny.map((c: { poziom: number }) => c.poziom)).toEqual([1, 2]);
    expect(p.oferta).toEqual({ grosze: 2980, waluta: "PLN" });
    expect(p.zakup).toEqual({ grosze: 2799, waluta: "PLN" });
  });

  it("bez cennika nie ma pustej ramki po cenach", () => {
    karta.mockReturnValue({ data: { ...KARTA, ceny: [] }, isLoading: false, error: null });
    render(<Produkt szczegol={szczegol()} />);
    expect(screen.queryByText("Ceny tego towaru w Subiekcie")).not.toBeInTheDocument();
  });

  it("starszy serwer bez ceny oferty: oferta i zakup są brakiem, nie zerem", () => {
    render(<Produkt szczegol={szczegol({}, { ofertaCenaGrosze: undefined, cenaParagonuGrosze: null })} />);
    const p = ceny.mock.calls[0][0];
    expect(p.oferta).toBeNull();
    expect(p.zakup).toBeNull();
  });

  it("Chce, Podstawa i historia towaru stoją słowem", () => {
    render(<Produkt szczegol={szczegol({ historia: { towar: { ile: 3, uznanych: 2, odrzuconych: 1 }, klient: null } },
      { oczekiwanie: "EXCHANGE", oczekiwanaKwotaGrosze: 17900 })} />);
    expect(screen.getByText("Wymiana")).toBeInTheDocument();
    expect(screen.getByText(/179,00 PLN/)).toBeInTheDocument();
    expect(screen.getByText("Rękojmia · usterka przy używaniu")).toBeInTheDocument();
    expect(screen.getByText("3 reklamacje (2 uznane, 1 odrzucona)")).toBeInTheDocument();
  });

  it("bez historii towaru wiersza „Ten towar” nie ma — pierwsza sprawa to nie informacja", () => {
    render(<Produkt szczegol={szczegol()} />);
    expect(screen.queryByText("Ten towar")).not.toBeInTheDocument();
  });

  it("łącze do oferty prowadzi do Allegro w nowej karcie", () => {
    render(<Produkt szczegol={szczegol()} />);
    const lacze = screen.getByRole("link", { name: /Oferta/ });
    expect(lacze).toHaveAttribute("href", "https://allegro.pl/o/1");
    expect(lacze).toHaveAttribute("target", "_blank");
  });
});

describe("Fakty zamówienia stoją na drodze sprawy, nie w karcie", () => {
  it("karta nie ma zamówienia, przesyłki, „Paragonu” ani „Tego zakupu”", () => {
    const zwrot = { rodzaj: "zwrot" as const, id: 7, at: "2026-09-20T10:00:00.000Z", opis: null };
    render(<MemoryRouter><Produkt szczegol={szczegol({ droga: [zwrot],
      przesylka: przesylka({ waybill: "600000727616" }) })} /></MemoryRouter>);
    for (const t of ["Zamówienie", "Płatność", "Przesyłka", "Paragon", "Ten zakup"]) {
      expect(screen.queryByText(t)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/27,99 PLN/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ord-5|zwrot/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sprawdź/ })).not.toBeInTheDocument();
  });
});
