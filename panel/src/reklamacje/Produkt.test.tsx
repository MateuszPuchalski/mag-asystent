import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type {
  DokumentParagonu, DopasowanieKartoteki, ParagonReklamacji, PozycjaParagonu, Reklamacja, StanPrzesylki,
  SzczegolReklamacji, Zamowienie,
} from "../api/typy";

/* ── Karta Produkt ───────────────────────────────────────────────────────────
   Fakty towaru, z których wydaje się werdykt, w karcie pod decyzją. Testy
   pilnują tego, co rozstrzyga decyzję, a nie wyglądu karty:

   1. SYMBOL TYLKO Z DOKUMENTU SUBIEKTA. Cały paragon albo faktura, sporna
      pozycja wyróżniona neutralnie. Bez dokumentu zdanie z powodem i żadnego
      symbolu z oferty, mapowania ani SKU. Stan, półka i cennik pytają
      o kartę spornej pozycji i o nic innego.
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

/* Schowek podmieniony na samym pomocniku: jsdom nie ma ani `clipboard`, ani
   `execCommand`, a test pyta tylko, CO poszło do schowka. */
const kopiuj = vi.fn(async (_t: string) => true);
vi.mock("../ui/kopiuj", () => ({ kopiujDoSchowka: (t: string) => kopiuj(t) }));

const { Produkt } = await import("./Produkt");
const { naruszeniaWcag } = await import("../test/dostepnosc");

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

const pozycja = (n: Partial<PozycjaParagonu> = {}): PozycjaParagonu => ({
  twId: 11, symbol: "14-31051", nazwa: "Nóż dolny 46 cm do kosiarki", ilosc: 1, usluga: false, sporna: true, ...n,
});

const dokument = (n: Partial<DokumentParagonu> = {}): DokumentParagonu => ({
  dokId: 900, numer: "PA 1234/10/2026", typ: "PA", data: "2026-10-03",
  pozycje: [
    pozycja(),
    pozycja({ twId: 12, symbol: "14-20007", nazwa: "Śruba noża M10", ilosc: 2, sporna: false }),
    pozycja({ twId: 99, symbol: "PRZESYŁKA", nazwa: "Przesyłka kurierska", usluga: true, sporna: false }),
  ], ...n,
});

const paragon = (n: Partial<ParagonReklamacji> = {}): ParagonReklamacji => ({
  dokumenty: [dokument()], spornaTwId: 11, brak: null, oknoDni: 60, ...n,
});

const szczegol = (n: Partial<SzczegolReklamacji> = {}, r: Partial<Reklamacja> = {}) => ({
  reklamacja: rek(r), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [],
  droga: [], kartoteka: null, karta: null, zamowienie: ZAMOWIENIE, przesylka: null,
  historia: { towar: null, klient: null }, paragon: paragon(), ...n,
} as unknown as SzczegolReklamacji);

const kupiony = () => screen.getByRole("region", { name: "Kupiony towar" });
const wiersz = (symbol: string) => screen.getByText(symbol).closest("tr") as HTMLElement;

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

describe("Kupiony towar: symbol tylko z paragonu albo faktury", () => {
  it("cały dokument: numer, data i WSZYSTKIE pozycje z ilością", () => {
    render(<Produkt szczegol={szczegol()} />);
    const k = kupiony();
    expect(within(k).getByText("Paragon PA 1234/10/2026").closest("caption"))
      .toHaveTextContent("Paragon PA 1234/10/2026 · 03.10.2026");
    expect(within(k).getAllByRole("row")).toHaveLength(4);
    for (const s of ["14-31051", "14-20007", "PRZESYŁKA"]) expect(within(k).getByText(s)).toBeInTheDocument();
    expect(within(wiersz("14-20007")).getByText("Śruba noża M10")).toBeInTheDocument();
    expect(within(wiersz("14-20007")).getByText("2")).toBeInTheDocument();
  });

  it("faktura mówi „Faktura”, a kilka dokumentów stoi po kolei", () => {
    render(<Produkt szczegol={szczegol({ paragon: paragon({ dokumenty: [
      dokument(),
      dokument({ dokId: 901, numer: "FS 77/10/2026", typ: "FS", data: "2026-10-05",
        pozycje: [pozycja({ twId: 13, symbol: "14-99999", nazwa: "Kosz na trawę", sporna: false })] }),
    ] }) })} />);
    const podpisy = within(kupiony()).getAllByRole("table").map((t) => t.querySelector("caption")?.textContent);
    expect(podpisy).toEqual(["Paragon PA 1234/10/2026 · 03.10.2026", "Faktura FS 77/10/2026 · 05.10.2026"]);
  });

  it("sporna pozycja ma napis „reklamowany” i neutralne tło, nie bursztyn", () => {
    render(<Produkt szczegol={szczegol()} />);
    const sporna = wiersz("14-31051");
    expect(within(sporna).getByText("reklamowany")).toBeInTheDocument();
    expect(sporna.className).toMatch(/bg-slate-100/);
    expect(sporna.className).not.toMatch(/amber/);
    expect(within(wiersz("14-20007")).queryByText("reklamowany")).not.toBeInTheDocument();
    expect(screen.getAllByText("reklamowany")).toHaveLength(1);
  });

  it("usługa jest wyciszona i nie daje się kopiować jak towar", () => {
    render(<Produkt szczegol={szczegol()} />);
    expect(wiersz("PRZESYŁKA").className).toMatch(/text-slate-500/);
    expect(within(wiersz("PRZESYŁKA")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("symbol kopiuje się kliknięciem przez wspólny pomocnik schowka", async () => {
    kopiuj.mockClear();
    render(<Produkt szczegol={szczegol()} />);
    await userEvent.click(within(wiersz("14-31051")).getByRole("button", { name: /14-31051/ }));
    expect(kopiuj).toHaveBeenCalledWith("14-31051");
    expect(await within(wiersz("14-31051")).findByText("Skopiowano symbol")).toBeInTheDocument();
  });

  it("faktura do paragonu: ta sama sporna kartoteka w dwóch dokumentach świeci w obu", () => {
    const sporny = (n: Partial<DokumentParagonu>) => dokument({
      pozycje: [pozycja(), pozycja({ twId: 12, symbol: "14-20007", nazwa: "Śruba noża M10", sporna: false })], ...n });
    render(<Produkt szczegol={szczegol({ paragon: paragon({ spornaTwId: 11, dokumenty: [
      sporny({}), sporny({ dokId: 901, numer: "FS 77/10/2026", typ: "FS", data: "2026-10-05" }),
    ] }) })} />);
    const wiersze = screen.getAllByText("reklamowany").map((e) => e.closest("tr"));
    expect(wiersze).toHaveLength(2);
    for (const w of wiersze) expect(w).toHaveTextContent("14-31051");
    expect(screen.queryByText(/Dokument nie wskazuje/)).not.toBeInTheDocument();
    expect(karta).toHaveBeenCalledWith(11);
    expect(screen.getByText("Ceny tego towaru w Subiekcie")).toBeInTheDocument();
  });

  it("kartoteki brak w kopii: bez symbolu do kopiowania i bez zmyślonej nazwy", () => {
    render(<Produkt szczegol={szczegol({ paragon: paragon({ dokumenty: [dokument({ pozycje: [
      pozycja(), pozycja({ twId: 77, symbol: null, nazwa: null, sporna: false }),
    ] })] }) })} />);
    const bezKarty = screen.getByText("nazwa nieznana").closest("tr") as HTMLElement;
    expect(within(bezKarty).getByText("brak symbolu w kopii kartoteki")).toBeInTheDocument();
    expect(within(bezKarty).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Kopiuj symbol/ })).toHaveLength(1);
  });

  it("bez jednoznacznego wskazania nic nie świeci, a zdanie mówi, że wybór należy do agenta", () => {
    const bezSpornej = dokument({ pozycje: dokument().pozycje.map((p) => ({ ...p, sporna: false })) });
    render(<Produkt szczegol={szczegol({ paragon: paragon({ dokumenty: [bezSpornej], spornaTwId: null }) })} />);
    expect(screen.queryByText("reklamowany")).not.toBeInTheDocument();
    expect(screen.getByText("Dokument nie wskazuje, którą pozycję klient reklamuje.")).toBeInTheDocument();
  });

  it.each([
    ["poza-oknem", "Zakup starszy niż 60 dni — tak daleko Subiekt nie jest kopiowany."],
    ["nie-znaleziono", "Dokument jeszcze niewystawiony albo bez numeru zamówienia."],
    ["bez-zamowienia", "Reklamacja bez zamówienia."],
  ] as const)("bez dokumentu (%s): zdanie z powodem i ŻADNEGO symbolu z oferty", (brak, zdanie) => {
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    /* Wiersz niesie symbol z oferty i mapowania, a kartoteka pewne SKU —
       żadne z nich nie ma prawa wyjść na kartę. */
    render(<Produkt szczegol={szczegol({ kartoteka: dopasowanie("sku", 42),
      paragon: paragon({ dokumenty: [], spornaTwId: null, brak }) }, { twId: 11, twSymbol: "14-31051" })} />);
    expect(within(kupiony()).getByText("Brak paragonu ani faktury w Subiekcie")).toBeInTheDocument();
    expect(within(kupiony()).getByText(zdanie)).toBeInTheDocument();
    expect(screen.queryByText("14-31051")).not.toBeInTheDocument();
    expect(screen.queryByText("X")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kopiuj symbol/ })).not.toBeInTheDocument();
    expect(karta).toHaveBeenCalledWith(null);
    expect(karta).not.toHaveBeenCalledWith(42);
  });

  it("pole jeszcze niewczytane to nie brak dokumentu — karta o nim milczy", () => {
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(<Produkt szczegol={szczegol({ paragon: undefined })} />);
    expect(screen.queryByRole("region", { name: "Kupiony towar" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Brak paragonu/)).not.toBeInTheDocument();
    expect(screen.queryByText("14-31051")).not.toBeInTheDocument();
    expect(karta).toHaveBeenCalledWith(null);
  });
});

describe("Dostępność karty z dokumentem i bez niego", () => {
  /* Karta nie leży w `ekrany/`, więc axe po teście jej nie mierzy. Tabela
     pozycji i przycisk symbolu to struktura, o którą łatwo się potknąć. */
  it("dokument z kilkoma pozycjami przechodzi WCAG 2.2 AA w strukturze", async () => {
    const { container } = render(<Produkt szczegol={szczegol()} />);
    expect(await naruszeniaWcag(container)).toBe("");
  });

  it("pozycja bez kartoteki w kopii przechodzi WCAG 2.2 AA w strukturze", async () => {
    const { container } = render(<Produkt szczegol={szczegol({ paragon: paragon({ dokumenty: [dokument({
      pozycje: [pozycja(), pozycja({ twId: 77, symbol: null, nazwa: null, sporna: false })] })] }) })} />);
    expect(await naruszeniaWcag(container)).toBe("");
  });

  it("brak dokumentu przechodzi WCAG 2.2 AA w strukturze", async () => {
    const { container } = render(<Produkt szczegol={szczegol({
      paragon: paragon({ dokumenty: [], spornaTwId: null, brak: "poza-oknem" }) })} />);
    expect(await naruszeniaWcag(container)).toBe("");
  });
});

describe("Oś cen i stan tylko dla spornej pozycji", () => {
  it("karta, stan i cennik pytają o `spornaTwId`, nie o kartotekę oferty", () => {
    render(<Produkt szczegol={szczegol({ kartoteka: dopasowanie("sku", 42), paragon: paragon({ spornaTwId: 12,
      dokumenty: [dokument({ pozycje: [pozycja({ sporna: false }), pozycja({ twId: 12, symbol: "14-20007", sporna: true })] })] }) },
      { twId: 11 })} />);
    expect(karta).toHaveBeenCalledWith(12);
    expect(karta).not.toHaveBeenCalledWith(42);
    expect(karta).not.toHaveBeenCalledWith(11);
  });

  it("bez spornej pozycji osi cen i stanu nie ma, choć karta leży w pamięci", () => {
    /* Hak oddaje dane nawet dla `null` — tak wygląda karta z pamięci
       zapytań. Karta ma ją zignorować, bo to nie jest towar sprawy. */
    render(<Produkt szczegol={szczegol({ paragon: paragon({ spornaTwId: null }) })} />);
    expect(karta).toHaveBeenCalledWith(null);
    expect(screen.queryByText("Ceny tego towaru w Subiekcie")).not.toBeInTheDocument();
    expect(screen.queryByText(/W Subiekcie:/)).not.toBeInTheDocument();
    expect(ceny).not.toHaveBeenCalled();
  });
});

describe("Produkt: co to jest, czy mamy i ile kosztuje", () => {
  it("nazwa oferty, ilość w reklamacji i stan z półką spornej kartoteki", () => {
    render(<Produkt szczegol={szczegol()} />);
    expect(screen.getByRole("heading", { name: "Produkt" })).toBeInTheDocument();
    expect(screen.getByText("NÓŻ do kosiarki 46 cm")).toBeInTheDocument();
    expect(screen.getByText("W reklamacji: 1 szt.")).toBeInTheDocument();
    expect(karta).toHaveBeenCalledWith(11);
    expect(screen.getByText(/W Subiekcie:/)).toHaveTextContent("W Subiekcie: 7 szt. · półka D02-01-04");
  });

  it("nieznana ilość milczy — sztuka z domysłu nie staje przy ofercie", () => {
    karta.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(<Produkt szczegol={szczegol({}, { ilosc: null })} />);
    expect(screen.queryByText(/W reklamacji:/)).not.toBeInTheDocument();
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
  /* Dokument sprzedaży stoi w karcie celowo (kupiony towar), więc lista
     pyta o fakty ZAMÓWIENIA: płatność, paczkę i rodzeństwo zakupu. */
  it("karta nie ma zamówienia, płatności, przesyłki ani „Tego zakupu”", () => {
    const zwrot = { rodzaj: "zwrot" as const, id: 7, at: "2026-09-20T10:00:00.000Z", opis: null };
    render(<MemoryRouter><Produkt szczegol={szczegol({ droga: [zwrot],
      przesylka: przesylka({ waybill: "600000727616" }) })} /></MemoryRouter>);
    for (const t of ["Zamówienie", "Płatność", "Przesyłka", "Ten zakup"]) {
      expect(screen.queryByText(t)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/27,99 PLN/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ord-5|zwrot/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sprawdź/ })).not.toBeInTheDocument();
  });
});
