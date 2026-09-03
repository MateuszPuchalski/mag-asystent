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
const wiedza = vi.fn();
const pomiar = { mutate: vi.fn(), isPending: false, error: null as unknown };
vi.mock("../api/rozmowy", () => ({
  useKandydaci: (id: number | null) => kandydaci(id),
  useZapiszDaneDoboru: () => zapisz,
  useStatusDoboru: () => status,
  useWybierzKandydata: () => wybierz,
  useWiedzaDoboru: (id: number | null) => wiedza(id),
  usePomiarDoWiedzy: () => pomiar,
}));
vi.mock("../wyszukiwarka", () => ({ Wyszukiwarka: () => <div data-testid="wyszukiwarka" /> }));

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
  zapisz.mutate.mockReset(); status.mutate.mockReset(); wybierz.mutate.mockReset(); pomiar.mutate.mockReset();
  kandydaci.mockReturnValue({ data: PUSTE, isLoading: false, error: null });
  wiedza.mockReturnValue({ data: { zastosowanie: null, pomiary: [] }, isLoading: false, error: null });
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
    expect(status.mutate).toHaveBeenCalledWith(
      { id: 4821, status: "confirmed", brakuje: null }, expect.anything());
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

  it("wybrany bez wpisu w bazie wiedzy mówi, że dobór to przypuszczenie; z wpisem pokazuje dowody", () => {
    const wybrany = { twId: 14, symbol: "FTC272", droga: "oferta" as const, przez: "A. Lewandowska", at: "",
      zdanieDoSzkicu: "Do STIHL FS250 pasuje FTC272 — źródło: potwierdzone zastosowanie do STIHL FS250 — katalog dostawcy, 2.09.2026, A. Lewandowska." };
    const { rerender } = render(<Dobor dobor={dobor({ status: "confirmed", wybrany })} rozmowaId={4821}
      onWstawDoSzkicu={vi.fn()} onZlecPomiar={vi.fn()} />);
    expect(screen.getByText(/Brak wpisu w bazie wiedzy/)).toBeInTheDocument();

    wiedza.mockReturnValue({ isLoading: false, error: null, data: { pomiary: [], zastosowanie: {
      id: 3, twId: 14, symbol: "FTC272", polaryzacja: "pasuje", powodNegatywny: null, zdaniePowodu: null,
      model: { id: 1, rodzaj: "maszyna", marka: "STIHL", nazwa: "FS250", wariant: null, lata: null, klucz: "maszyna|stihlfs250", etykieta: "STIHL FS250" },
      stan: "zatwierdzone", zrodlo: "dobor", komentarz: null, conversationId: 4821, zastepujeId: null,
      zaproponowal: "A. Lewandowska", zaproponowanoAt: "2026-09-02T08:00:00Z", rozstrzygnal: "O. Nowak",
      rozstrzygnietoAt: "2026-09-02T09:00:00Z", powodRozstrzygniecia: null, pewnosc: "potwierdzone",
      zdanieZrodla: "potwierdzone zastosowanie do STIHL FS250 — katalog dostawcy, 2.09.2026, A. Lewandowska",
      dowody: [{ id: 9, rodzaj: "katalog_dostawcy", nazwaRodzaju: "katalog dostawcy", tresc: "Katalog 2024, s. 12",
        link: null, zadanieId: null, conversationId: null, autor: "A. Lewandowska", at: "2026-09-02T08:00:00Z" }],
    } } });
    rerender(<Dobor dobor={dobor({ status: "confirmed", wybrany })} rozmowaId={4821}
      onWstawDoSzkicu={vi.fn()} onZlecPomiar={vi.fn()} />);
    expect(screen.getByLabelText("Dowody zastosowania")).toBeInTheDocument();
    expect(screen.getByText("Katalog 2024, s. 12")).toBeInTheDocument();
    expect(screen.getByText(/zatwierdził O\. Nowak/)).toBeInTheDocument();
  });

  it("pomiar z hali proponuje się jako dowód dopiero z marką i modelem — i tylko na kliknięcie", async () => {
    const pomiary = [{ zadanieId: 312, tytul: "Zmierz rozstaw", wynik: "rozstaw 148 mm", wykonanoAt: "2026-09-01T09:00:00Z",
      wykonanoPrzez: "M. Kowal", twId: 14, symbol: "FTC272", zaproponowano: false }];
    wiedza.mockReturnValue({ data: { zastosowanie: null, pomiary }, isLoading: false, error: null });
    const { rerender } = render(<Dobor dobor={dobor()} rozmowaId={4821} onWstawDoSzkicu={vi.fn()} onZlecPomiar={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Zaproponuj jako dowód/ })).toBeDisabled();
    expect(screen.getByText(/najpierw marka i model/)).toBeInTheDocument();
    expect(pomiar.mutate).not.toHaveBeenCalled();

    rerender(<Dobor dobor={dobor({ dane: { ...dobor().dane, marka: "STIHL", model: "FS250" } })} rozmowaId={4821}
      onWstawDoSzkicu={vi.fn()} onZlecPomiar={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText("Wynik pomiaru: Zmierz rozstaw"), "nie_pasuje");
    await userEvent.click(screen.getByRole("button", { name: /Zaproponuj jako dowód/ }));
    expect(pomiar.mutate).toHaveBeenCalledWith(
      { id: 4821, zadanieId: 312, twId: 14, polaryzacja: "nie_pasuje", powodNegatywny: "niewlasciwy_rozstaw" });

    wiedza.mockReturnValue({ data: { zastosowanie: null, pomiary: [{ ...pomiary[0], zaproponowano: true }] }, isLoading: false, error: null });
    rerender(<Dobor dobor={dobor()} rozmowaId={4821} onWstawDoSzkicu={vi.fn()} onZlecPomiar={vi.fn()} />);
    expect(screen.getByText(/w kolejce wiedzy/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zaproponuj jako dowód/ })).not.toBeInTheDocument();
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
