import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Dobor as DoborTyp, KandydaciDoboru } from "../api/typy";
import { Konflikt } from "../api/klient";

/* ── Zakładka doboru (§11, etap E1) ──────────────────────────────────────────
   Pilnujemy trzech stanów i jednego wyścigu: pusty dobór mówi, czego brakuje
   (zamiast milczeć); kandydat niesie DROGĘ i ŹRÓDŁO, a wybór jedzie z wersją;
   wybrany wstawia do szkicu ZDANIE SERWERA i zatwierdza się jednym kliknięciem;
   409 przy danych nie kasuje wpisanego.                                     */

const kandydaci = vi.fn();
const zapisz = { mutate: vi.fn(), isPending: false, error: null as unknown };
const status = { mutate: vi.fn(), isPending: false, error: null as unknown };
const wybierz = { mutate: vi.fn(), isPending: false, error: null as unknown };
/* Silniki maszyny jadą tą samą trasą co dowody wiedzy — atrapa oddaje to,
   co ustawi test, a domyślnie pustą listę (maszyna bez znanego silnika). */
type WiedzaAtrapa = { data: { zastosowanie: null; zabudowa: null; silniki: unknown[]; pomiary: unknown[] } };
const wiedzaDoboru = vi.fn<() => WiedzaAtrapa>(
  () => ({ data: { zastosowanie: null, zabudowa: null, silniki: [], pomiary: [] } }));
vi.mock("../api/rozmowy", () => ({
  useKandydaci: (id: number | null) => kandydaci(id),
  useZapiszDaneDoboru: () => zapisz,
  useStatusDoboru: () => status,
  useWybierzKandydata: () => wybierz,
  useWiedzaDoboru: () => wiedzaDoboru(),
}));
vi.mock("../wyszukiwarka", () => ({ Wyszukiwarka: () => <div data-testid="wyszukiwarka" /> }));
/* Zdjęcia kartotek (0.203.0). Pobranie idzie `fetch`em, a w jsdomie nie ma
   dokąd go wysłać — atrapa mówi „każda kartoteka ma obraz". Dzięki temu kafle
   renderują się jako `<img>` i widać, PRZY KTÓRYCH wierszach stoją. */
vi.mock("../towar/useZdjecie", () => ({
  useZdjecie: (twId: number | null) => (twId == null ? null : `blob:${twId}`),
}));

const { Dobor } = await import("./Dobor");

const dobor = (n: Partial<DoborTyp> = {}): DoborTyp => ({
  status: "not_started", wersja: 1, brakuje: null, wybrany: null, updatedBy: null, updatedAt: null,
  dane: { marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null, silnik: null,
    oem: null, nazwaCzesci: null, parametry: {} },
  ...n,
});

const PUSTE: KandydaciDoboru = {
  kandydaci: [], negatywne: [],
  drogi: [
    { droga: "symbol", sprawdzona: false, wynikow: 0, powod: "agent nie wpisał symbolu" },
    { droga: "ean", sprawdzona: false, wynikow: 0, powod: "agent nie wpisał EAN" },
    { droga: "oem", sprawdzona: false, wynikow: 0, powod: "agent nie wpisał numeru OEM" },
    { droga: "zastosowanie", sprawdzona: false, wynikow: 0, powod: "etap E2" },
    { droga: "oferta", sprawdzona: false, wynikow: 0, powod: "rozmowa nie jest powiązana z ofertą" },
    { droga: "zamiennik", sprawdzona: false, wynikow: 0, powod: "bez kartoteki oferty" },
    { droga: "pelnotekst", sprawdzona: false, wynikow: 0, powod: "agent nie wpisał nazwy części ani maszyny" },
    { droga: "wyszukiwarka", sprawdzona: false, wynikow: 0, powod: "wybór ręczny" },
  ],
};

const Z_KANDYDATAMI: KandydaciDoboru = {
  negatywne: [],
  kandydaci: [
    { nr: 1, twId: 14, symbol: "FTC272", nazwa: "Podkładka przekładni STIHL FS120", stan: 28,
      droga: "oferta", pewnosc: "prawdopodobne", zrodlo: 'Kartoteka oferty 148 — SKU oferty „FTC272"', ostrzezenia: [] },
    { nr: 2, twId: 1654, symbol: "24-04003", nazwa: "Podkładka zamienna", stan: 0,
      droga: "zamiennik", pewnosc: "wymaga_danych", zrodlo: 'Zamiennik z opisu kartoteki „FTC272"',
      ostrzezenia: ["nie pasuje do FS250 — inny rozstaw"] },
  ],
  drogi: PUSTE.drogi.map((d) => d.droga === "oferta" || d.droga === "zamiennik"
    ? { droga: d.droga, sprawdzona: true, wynikow: 1 } : d),
};

const pokaz = (d: DoborTyp, uchwyty: Partial<{ onWstawDoSzkicu: (t: string) => void; onZlecPomiar: () => void }> = {}) =>
  render(<Dobor dobor={d} rozmowaId={4821} onWstawDoSzkicu={uchwyty.onWstawDoSzkicu ?? vi.fn()}
    onZlecPomiar={uchwyty.onZlecPomiar ?? vi.fn()} />);

beforeEach(() => {
  zapisz.mutate.mockReset(); status.mutate.mockReset(); wybierz.mutate.mockReset();
  kandydaci.mockReturnValue({ data: PUSTE, isLoading: false, error: null });
});

describe("zakładka doboru", () => {
  it("pusty dobór mówi, czego brakuje, a pominięte drogi niosą powód", () => {
    pokaz(dobor());
    expect(screen.getByText("Nierozpoczęty", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/o jaką maszynę i część chodzi/)).toBeInTheDocument();
    expect(screen.getByText(/Żadna sprawdzona droga nic nie dała/)).toBeInTheDocument();
    /* Szczebel pominięty NIE wygląda jak „zero wyników" (blizna 0.153.1). */
    expect(screen.getByTitle(/pominięty: rozmowa nie jest powiązana z ofertą/)).toBeInTheDocument();
    /* Bez wyboru nie ma czego zatwierdzać. */
    expect(screen.queryByRole("button", { name: /ZATWIERDŹ DOBÓR/ })).not.toBeInTheDocument();
    expect(kandydaci).toHaveBeenCalledWith(4821);
  });

  it("kandydat niesie drogę, źródło i ostrzeżenie, a wybór jedzie z wersją doboru", async () => {
    kandydaci.mockReturnValue({ data: Z_KANDYDATAMI, isLoading: false, error: null });
    pokaz(dobor({ status: "searching", wersja: 3, dane: { ...dobor().dane, marka: "STIHL", model: "FS250" } }));
    expect(screen.getByText("FTC272")).toBeInTheDocument();
    expect(screen.getByText(/SKU oferty/)).toBeInTheDocument();
    expect(screen.getByText(/droga: zamiennik/)).toBeInTheDocument();
    expect(screen.getByText(/inny rozstaw/)).toBeInTheDocument();
    /* Dane wejściowe widać chipami — to one mówią, do czego dobieramy. */
    expect(screen.getByText("STIHL")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: /Wybierz/ })[0]);
    expect(wybierz.mutate).toHaveBeenCalledWith(
      { id: 4821, twId: 14, droga: "oferta", expectedVersion: 3 }, expect.anything());
  });

  it("wybrany wstawia do szkicu ZDANIE SERWERA i zatwierdza się jednym kliknięciem", async () => {
    const onWstawDoSzkicu = vi.fn();
    const onZlecPomiar = vi.fn();
    pokaz(dobor({ status: "candidates_found", wersja: 4, wybrany: {
      twId: 14, symbol: "FTC272", droga: "oferta", przez: "A. Lewandowska", at: "2026-09-02T08:00:00Z",
      zdanieDoSzkicu: "Do STIHL FS250 prawdopodobnie pasuje FTC272 — źródło: kartoteka oferty, o którą pyta klient; dobór bez potwierdzonego zastosowania.",
    } }), { onWstawDoSzkicu, onZlecPomiar });
    expect(screen.getByText(/A\. Lewandowska/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Wstaw do szkicu ze źródłem/ }));
    expect(onWstawDoSzkicu).toHaveBeenCalledWith(expect.stringMatching(/^Do STIHL FS250 prawdopodobnie pasuje FTC272 — źródło:/));

    await userEvent.click(screen.getByRole("button", { name: /Zleć pomiar/ }));
    expect(onZlecPomiar).toHaveBeenCalledWith(expect.objectContaining({ id: 14, sym: "FTC272" }));

    await userEvent.click(screen.getByRole("button", { name: /ZATWIERDŹ DOBÓR/ }));
    /* `silnikModelId: null` = wiedza rośnie przy MASZYNIE — zachowanie sprzed
       dołożenia szczebla „przez silnik". */
    expect(status.mutate).toHaveBeenCalledWith(
      { id: 4821, status: "confirmed", brakuje: null, silnikModelId: null }, expect.anything());
  });

  /* ── Zdjęcia przy doborze (0.203.0) ────────────────────────────────────
     Dobór odpowiada na pytanie „czy TO jest ta część", a odpowiadał samym
     symbolem i nazwą. Zdjęcie stoi w trzech miejscach tej zakładki, bo każde
     odpowiada na inne pytanie: przy kandydacie „którego wybrać", przy
     negatywie „czy to nie ten odrzucony", przy wyborze „co poszło do
     odpowiedzi". Test pilnuje wszystkich trzech naraz — pojedyncze zniknięcie
     wyglądałoby jak brak zdjęcia w kartotece, nie jak regres. */
  it("kandydat, negatyw i wybrana kartoteka niosą zdjęcie", () => {
    kandydaci.mockReturnValue({ isLoading: false, error: null, data: {
      ...Z_KANDYDATAMI,
      negatywne: [{ twId: 77, symbol: "SZR-140/82", nazwa: "Szarpak 140", powod: "niewłaściwy rozstaw",
        zrodlo: "pomiar własny", at: "2026-09-01" }],
    } });
    pokaz(dobor({ status: "candidates_found", wybrany: {
      twId: 14, symbol: "FTC272", droga: "oferta", przez: "A. Lewandowska", at: "",
      zdanieDoSzkicu: "Do STIHL FS250 pasuje FTC272 — źródło: kartoteka oferty." } }));

    expect(screen.getByAltText("Podkładka przekładni STIHL FS120")).toBeInTheDocument();
    expect(screen.getByAltText("Podkładka zamienna")).toBeInTheDocument();
    expect(screen.getByAltText("Szarpak 140")).toBeInTheDocument();
    /* Wybrany dobór zna sam symbol — `WyborDoboru` nie niesie nazwy. */
    expect(screen.getByAltText("FTC272")).toBeInTheDocument();
  });

  it("zatwierdzony dobór nie ma drugiego przycisku zatwierdzania", () => {
    pokaz(dobor({ status: "confirmed", wybrany: {
      twId: 14, symbol: "FTC272", droga: "oferta", przez: "A. Lewandowska", at: "", zdanieDoSzkicu: "Do X pasuje FTC272 — źródło: kartoteka oferty." } }));
    expect(screen.getByText("Dobór zatwierdzony", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ZATWIERDŹ DOBÓR/ })).not.toBeInTheDocument();
  });

  it("konflikt wersji przy danych mówi, kto zmienił, i NIE kasuje wpisanego", async () => {
    zapisz.mutate.mockImplementation((_v: unknown, o: { onError: (e: Error) => void }) =>
      o.onError(new Konflikt("Ktoś zmienił dobór", { wersja: 2, updatedBy: "M. Wójcik" })));
    pokaz(dobor());
    await userEvent.click(screen.getByRole("button", { name: /Wpisz dane/ }));
    await userEvent.type(screen.getByLabelText("Marka"), "NAC");
    await userEvent.type(screen.getByLabelText("Model"), "LS 46-450");
    await userEvent.click(screen.getByRole("button", { name: "ZAPISZ" }));

    expect(zapisz.mutate).toHaveBeenCalledWith(expect.objectContaining({
      id: 4821, expectedVersion: 1, dane: expect.objectContaining({ marka: "NAC", model: "LS 46-450" }),
    }), expect.anything());
    expect(screen.getByText(/M\. Wójcik/)).toBeInTheDocument();
    expect(screen.getByLabelText("Marka")).toHaveValue("NAC");
  });

  it("„brakuje danych” pyta, czego dopytać, i wstawia pytanie do szkicu tylko na kliknięcie", async () => {
    const onWstawDoSzkicu = vi.fn();
    pokaz(dobor({ status: "missing_information", brakuje: "pełny numer seryjny" }), { onWstawDoSzkicu });
    expect(onWstawDoSzkicu).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /wstaw pytanie do szkicu/ }));
    expect(onWstawDoSzkicu).toHaveBeenCalledWith(expect.stringContaining("pełny numer seryjny"));
  });

  it("Copilotowego `extracting_data` nie da się wybrać ręcznie", () => {
    pokaz(dobor());
    const opcje = [...screen.getByLabelText("Status doboru").querySelectorAll("option")].map((o) => o.value);
    expect(opcje).not.toContain("extracting_data");
    expect(opcje).toContain("confirmed");
  });

  /* ── Baza wiedzy przy doborze (E2) ─────────────────────────────────────── */

  it("negatyw jest widoczny także dla kartoteki spoza kandydatów", () => {
    kandydaci.mockReturnValue({ data: { ...PUSTE, negatywne: [
      { twId: 77, symbol: "SZR-140/82", nazwa: "Szarpak 140", powod: "niewłaściwy rozstaw",
        zrodlo: "nie pasuje do NAC LS 46-450: niewłaściwy rozstaw — pomiar własny, 1.09.2026, M. Kowal", at: "2026-09-01" },
    ] }, isLoading: false, error: null });
    pokaz(dobor({ dane: { ...dobor().dane, marka: "NAC", model: "LS 46-450" } }));
    expect(screen.getByLabelText("Negatywne dopasowania")).toBeInTheDocument();
    expect(screen.getByText("SZR-140/82")).toBeInTheDocument();
    expect(screen.getByText(/ostrzeżenie, nie brak danych/)).toBeInTheDocument();
  });

});

describe("kandydat bez kartoteki (E3)", () => {
  it("numer OEM bez wiersza w kartotece stoi na liście bez stanu i BEZ Wybierz", async () => {
    /* Decyzja właściciela (makieta Dobor.dc.html): „nie mamy tego u siebie" to
       odpowiedź dla klienta. Wybierz ukryty, bo `twId: null` w wyborze znaczy „zdejmij". */
    kandydaci.mockReturnValue({ data: {
      ...Z_KANDYDATAMI,
      kandydaci: [...Z_KANDYDATAMI.kandydaci,
        { nr: 3, twId: null, symbol: "OEM 118550127/0", nazwa: "identyfikator bez wiersza w kartotece", stan: null,
          droga: "oem", pewnosc: "wymaga_danych", ostrzezenia: [],
          zrodlo: "numer z danych wejściowych — nie ma go w żadnym opisie kartoteki" }],
    }, isLoading: false, error: null });
    pokaz(dobor({ status: "candidates_found", dane: { ...dobor().dane, oem: "118550127/0" } }));
    expect(screen.getByText("OEM 118550127/0")).toBeInTheDocument();
    expect(screen.getByText("brak w kartotece")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Wybierz/ })).toHaveLength(2);
    expect(screen.getByText(/nie ma go w żadnym opisie/)).toBeInTheDocument();
  });
});

/* ── Silnik przestaje być polem-sierotą ─────────────────────────────────────
   Do tego wydania agent wypełniał pole „Silnik", a żaden szczebel go nie
   czytał. Szczebel „przez silnik" idzie przez ZATWIERDZONĄ zabudowę, więc
   ekran musi rozróżnić trzy stany: silnik znany z bazy, sam wpisany tekst
   (czyli notatka) i brak jednego i drugiego.                               */

describe("Dobór a silnik maszyny", () => {
  const zabudowa = (id: number, etykieta: string) => ({
    id, silnik: { id, etykieta }, maszyna: { etykieta: "NAC LS 46-450" },
    pewnosc: "potwierdzone", zdanieZrodla: `${etykieta} stoi w NAC LS 46-450 — producent`,
  });
  const zDanymi = (n: Partial<DoborTyp> = {}) => dobor({
    dane: { marka: "NAC", model: "LS 46-450", wariant: null, rocznik: null, nrSeryjny: null,
      silnik: "B&S 450E", oem: null, nazwaCzesci: null, parametry: {} },
    ...n,
  });

  beforeEach(() => {
    kandydaci.mockReturnValue({ data: PUSTE, isLoading: false, error: null });
    wiedzaDoboru.mockReturnValue({ data: { zastosowanie: null, zabudowa: null, silniki: [], pomiary: [] } });
  });

  it("bez zabudowy mówi, że wpisany silnik to na razie notatka", () => {
    render(<Dobor dobor={zDanymi()} rozmowaId={4821} onWstawDoSzkicu={vi.fn()} onZlecPomiar={vi.fn()} />);
    expect(screen.getByText(/to na razie tylko notatka/)).toBeInTheDocument();
    expect(screen.getByText(/Wiedza → Silniki/)).toBeInTheDocument();
  });

  it("przy dwóch zabudowach każe potwierdzić tabliczkę", () => {
    wiedzaDoboru.mockReturnValue({ data: { zastosowanie: null, zabudowa: null, pomiary: [],
      silniki: [zabudowa(7, "silnik Briggs & Stratton 450E"), zabudowa(8, "silnik Honda GCV160")] } });
    render(<Dobor dobor={zDanymi()} rozmowaId={4821} onWstawDoSzkicu={vi.fn()} onZlecPomiar={vi.fn()} />);
    expect(screen.getByText(/bywa z kilkoma silnikami, potwierdź z tabliczki/)).toBeInTheDocument();
  });

  it("wybór „do silnika” jedzie razem ze statusem — bez zabudowy nie ma go wcale", async () => {
    const wybrany = { twId: 14, symbol: "FTC272", droga: "silnik" as const, przez: "Ala",
      at: "2026-09-07T10:00:00Z", zdanieDoSzkicu: "Do NAC LS 46-450 pasuje FTC272." };
    /* Najpierw bez zabudowy: opcji silnikowej NIE MA, bo nie ma faktu w bazie. */
    const { unmount } = render(<Dobor dobor={zDanymi({ wybrany })} rozmowaId={4821}
      onWstawDoSzkicu={vi.fn()} onZlecPomiar={vi.fn()} />);
    expect(screen.queryByText(/zastosowanie zapisz do/)).toBeNull();
    unmount();

    wiedzaDoboru.mockReturnValue({ data: { zastosowanie: null, zabudowa: null, pomiary: [],
      silniki: [zabudowa(7, "silnik Briggs & Stratton 450E")] } });
    render(<Dobor dobor={zDanymi({ wybrany })} rozmowaId={4821}
      onWstawDoSzkicu={vi.fn()} onZlecPomiar={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: /Briggs & Stratton 450E/ }));
    await userEvent.click(screen.getByRole("button", { name: /ZATWIERDŹ DOBÓR/ }));
    expect(status.mutate).toHaveBeenCalledWith(
      { id: 4821, status: "confirmed", brakuje: null, silnikModelId: 7 }, expect.anything());
  });
});
