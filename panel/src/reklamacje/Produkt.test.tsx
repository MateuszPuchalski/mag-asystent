import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type {
  DopasowanieKartoteki, Reklamacja, StanPrzesylki, SzczegolReklamacji, Zamowienie,
} from "../api/typy";

/* ── Karta Produkt i Zamówienie ──────────────────────────────────────────────
   Fakty, z których wydaje się werdykt, w jednej karcie pod decyzją. Testy
   pilnują tego, co rozstrzyga decyzję, a nie wyglądu karty:

   1. JEDNA KARTOTEKA NA SPRAWĘ. Paragon bije sygnaturę, SKU i pamięć wskazań
      wchodzą, zgadywanie nie. Stan, półka i cennik pytają o tę samą kartę.
   2. BRAK KARTY TO BRAK WIERSZA, nie „0 szt.” — zero przy braku wiedzy kłamie.
   3. CENY BEZ KLIKANIA, bo służą do triażu; poziom 0 (zakup) poza osią.
   4. PACZKA PYTA NA KLIKNIĘCIE — patrzenie nie wysyła żądań do Allegro.
   5. ZAMÓWIENIE BEZ PARAGONU: numeru paragonu nie ma w danych.
   6. JEDNA DROGA KLIENTA: z reklamacji do innych spraw tego zamówienia.  */

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

describe("Zamówienie: kiedy, za ile i czy dotarło", () => {
  it("kupiono z datą i odstępem do zgłoszenia, płatność z kwotą, typem i datą", () => {
    render(<Produkt szczegol={szczegol()} />);
    expect(screen.getByText(/^\d{2}\.09\.2026 · 10 dni przed zgłoszeniem$/)).toBeInTheDocument();
    expect(screen.getByText("Opłacono 27,99 PLN")).toBeInTheDocument();
    expect(screen.getByText(/· online · \d{2}\.09\.2026/)).toBeInTheDocument();
  });

  it("wiersza „Paragon” nie ma — numeru paragonu nie ma w danych", () => {
    render(<Produkt szczegol={szczegol()} />);
    expect(screen.queryByText("Paragon")).not.toBeInTheDocument();
  });

  it("bez daty zakupu i bez zamówienia mówi „nie wiemy”, nie zero", () => {
    render(<Produkt szczegol={szczegol({ zamowienie: null }, { kupionoAt: null, zgloszonoPoDniach: null })} />);
    expect(screen.getByText("nie wiemy")).toBeInTheDocument();
    expect(screen.getByText("zamówienia jeszcze nie pobraliśmy")).toBeInTheDocument();
  });

  it("numer zamówienia jest łączem do Allegro z kopiowaniem obok", () => {
    render(<Produkt szczegol={szczegol()} />);
    expect(screen.getByRole("link", { name: /ord-5/ })).toHaveAttribute("href", "https://allegro.pl/z/5");
    expect(screen.getByTitle("Kopiuj numer zamówienia")).toBeInTheDocument();
  });
});

describe("Przesyłka do klienta", () => {
  it("mówi wprost, że jeszcze NIE PYTALIŚMY — to brak wiedzy nasz, nie Allegro", () => {
    render(<Produkt szczegol={szczegol({ przesylka: przesylka() })} onSprawdzPrzesylke={vi.fn()} />);
    expect(screen.getByText("nie pytaliśmy jeszcze Allegro")).toBeInTheDocument();
  });

  it("odróżnia BRAK NUMERU u Allegro od braku pytania", () => {
    render(<Produkt szczegol={szczegol({ przesylka: przesylka({ sprawdzonoAt: "2026-09-29T10:00:00.000Z" }) })} />);
    expect(screen.getByText("Allegro nie ma numeru przesyłki")).toBeInTheDocument();
  });

  it("doręczenie stoi z datą, a numer listu da się skopiować", () => {
    render(<Produkt szczegol={szczegol({ przesylka: przesylka({
      waybill: "600000727616", przewoznik: "INPOST", status: "DELIVERED",
      dostarczonoAt: "2026-09-20T10:00:00.000Z", sprawdzonoAt: "2026-09-29T10:00:00.000Z" }) })} />);
    expect(screen.getByText(/^doręczona \d{2}\.09\.2026/)).toHaveTextContent(/InPost/);
    expect(screen.getByText("600000727616")).toBeInTheDocument();
    expect(screen.getByTitle("Kopiuj numer przesyłki")).toBeInTheDocument();
  });

  it("w drodze mówi SŁOWEM, nie kodem przewoźnika", () => {
    render(<Produkt szczegol={szczegol({ przesylka: przesylka({
      waybill: "6000", przewoznik: "DPD", status: "IN_TRANSIT", sprawdzonoAt: "2026-09-29T10:00:00.000Z" }) })} />);
    expect(screen.getByText(/w drodze do klienta/)).toBeInTheDocument();
    expect(screen.queryByText(/IN_TRANSIT/)).not.toBeInTheDocument();
  });

  it("pyta Allegro TYLKO na kliknięcie — samo otwarcie karty nie pyta", async () => {
    const onSprawdz = vi.fn();
    render(<Produkt szczegol={szczegol({ przesylka: przesylka() })} onSprawdzPrzesylke={onSprawdz} />);
    expect(onSprawdz).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "sprawdź" }));
    expect(onSprawdz).toHaveBeenCalledTimes(1);
  });

  it("bez procedury pytania nie ma martwego przycisku, a bez zamówienia — przesyłki", () => {
    const { unmount } = render(<Produkt szczegol={szczegol({ przesylka: przesylka() })} />);
    expect(screen.queryByRole("button", { name: /sprawdź/ })).not.toBeInTheDocument();
    unmount();
    render(<Produkt szczegol={szczegol({ przesylka: null })} onSprawdzPrzesylke={vi.fn()} />);
    expect(screen.getByText("bez danych o przesyłce")).toBeInTheDocument();
  });

  it("błąd pytania o paczkę stoi przy przesyłce", () => {
    render(<Produkt szczegol={szczegol({ przesylka: przesylka() })} onSprawdzPrzesylke={vi.fn()}
      bladPrzesylki="Allegro nie odpowiedziało" />);
    expect(screen.getByText("Allegro nie odpowiedziało")).toBeInTheDocument();
  });
});

describe("Ten zakup: inne sprawy tego zamówienia", () => {
  const przystanek = (rodzaj: "rozmowa" | "dyskusja" | "reklamacja" | "zwrot", id: number) =>
    ({ rodzaj, id, at: "2026-09-20T10:00:00.000Z", opis: null });
  const naTrasie = (n: Partial<SzczegolReklamacji>) =>
    render(<MemoryRouter><Produkt szczegol={szczegol(n)} /></MemoryRouter>);

  it("przystanek zwrotu i rozmowy prowadzi do swojej kolejki, bez tej reklamacji", () => {
    naTrasie({ droga: [przystanek("rozmowa", 3), przystanek("reklamacja", 5), przystanek("zwrot", 7)] });
    expect(screen.getByText("Ten zakup")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^zwrot/ })).toHaveAttribute("href", "/obsluga/zwroty/7");
    expect(screen.getByRole("link", { name: /^pytanie/ })).toHaveAttribute("href", "/obsluga/skrzynka/3");
    expect(screen.queryByRole("link", { name: /^reklamacja/ })).not.toBeInTheDocument();
  });

  it("dyskusja z rodzeństwa i z drogi staje raz", () => {
    const dyskusja = { id: 8, typ: "DISPUTE", numer: null, temat: null, statusAllegro: null,
      decyzjaDo: null, otwartoAt: "2026-09-21T10:00:00.000Z", prowadzi: null, otwarta: true };
    naTrasie({ droga: [przystanek("dyskusja", 8), przystanek("reklamacja", 5)], sprawy: [dyskusja] });
    expect(screen.getAllByRole("link", { name: /^dyskusja/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /^dyskusja/ })).toHaveAttribute("href", "/obsluga/dyskusje/8");
  });

  it("bez innych spraw wiersz nie staje — także gdy droga zna tylko tę reklamację", () => {
    naTrasie({ droga: [przystanek("reklamacja", 5)], sprawy: [] });
    expect(screen.queryByText("Ten zakup")).not.toBeInTheDocument();
  });
});
