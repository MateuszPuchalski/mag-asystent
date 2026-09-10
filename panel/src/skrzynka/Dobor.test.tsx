import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Dobor as DoborTyp, KandydaciDoboru, SzkicCopilota } from "../api/typy";
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
type WiedzaAtrapa = { data: {
  zastosowanie: null; zabudowa: null; silniki: unknown[]; pomiary: unknown[]; silnikZPola?: unknown;
} };
const wiedzaDoboru = vi.fn<() => WiedzaAtrapa>(
  () => ({ data: { zastosowanie: null, zabudowa: null, silniki: [], pomiary: [] } }));
vi.mock("../api/rozmowy", () => ({
  useKandydaci: (id: number | null) => kandydaci(id),
  useZapiszDaneDoboru: () => zapisz,
  useStatusDoboru: () => status,
  useWybierzKandydata: () => wybierz,
  useWiedzaDoboru: () => wiedzaDoboru(),
}));
/* Los danych z rozmowy (przyrost trzeci) idzie trasą Copilota, nie rozmów. */
const ocenDane = { mutate: vi.fn(), isPending: false, error: null as unknown };
/* Para z rozmowy (przyrost czwarty) idzie tą samą drogą, co dane: hook Copilota. */
const ocenPasowanie = { mutate: vi.fn(), isPending: false, error: null as unknown };
vi.mock("../api/copilot", () => ({ useOcenDaneDoboru: () => ocenDane, useOcenPasowanie: () => ocenPasowanie }));
vi.mock("../wyszukiwarka", () => ({ Wyszukiwarka: () => <div data-testid="wyszukiwarka" /> }));
/* Pasowanie „z pracy" (0.230.0) idzie trasą wiedzy, nie rozmów — hook z tego
   modułu woła `useQueryClient`, a zakładka renderuje się tu bez dostawcy. */
const zaproponujPasowanie = { mutate: vi.fn(), isPending: false, error: null as unknown };
/* Zabudowa spod pola „Silnik" (0.238.0) idzie tą samą trasą wiedzy, co z ekranu Silniki. */
const zaproponujZabudowe = { mutate: vi.fn(), isPending: false, error: null as unknown };
vi.mock("../api/wiedza", () => ({
  useZaproponujPasowanie: () => zaproponujPasowanie,
  useZaproponujZabudowe: () => zaproponujZabudowe,
}));
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
  kotwice: [],
  kandydaci: [], negatywne: [],
  drogi: [
    { droga: "symbol", sprawdzona: false, wynikow: 0, powod: "agent nie wpisał symbolu" },
    { droga: "ean", sprawdzona: false, wynikow: 0, powod: "agent nie wpisał EAN" },
    { droga: "oem", sprawdzona: false, wynikow: 0, powod: "agent nie wpisał numeru OEM" },
    { droga: "zastosowanie", sprawdzona: false, wynikow: 0, powod: "etap E2" },
    { droga: "silnik", sprawdzona: false, wynikow: 0, powod: "nie wiadomo, jaki silnik stoi w maszynie" },
    { droga: "pasowanie", sprawdzona: false, wynikow: 0, powod: "agent nie wpisał symbolu ani numeru, a rozmowa nie ma kartoteki oferty" },
    { droga: "oferta", sprawdzona: false, wynikow: 0, powod: "rozmowa nie jest powiązana z ofertą" },
    { droga: "zamiennik", sprawdzona: false, wynikow: 0, powod: "bez kartoteki oferty" },
    { droga: "pelnotekst", sprawdzona: false, wynikow: 0, powod: "agent nie wpisał nazwy części ani maszyny" },
    { droga: "wymiar", sprawdzona: false, wynikow: 0, powod: "agent nie wpisał wymiarów w parametrach doboru (np. długość: 148 cm)" },
    { droga: "wyszukiwarka", sprawdzona: false, wynikow: 0, powod: "wybór ręczny" },
  ],
};

const Z_KANDYDATAMI: KandydaciDoboru = {
  negatywne: [],
  kotwice: [{ twId: 14, symbol: "FTC272", nazwa: "Podkładka przekładni STIHL FS120" }],
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

const pokaz = (d: DoborTyp, uchwyty: Partial<{
  onWstawDoSzkicu: (t: string) => void; onZlecPomiar: () => void; propozycja: SzkicCopilota | null;
}> = {}) =>
  render(<Dobor dobor={d} rozmowaId={4821} propozycja={uchwyty.propozycja ?? null}
    onWstawDoSzkicu={uchwyty.onWstawDoSzkicu ?? vi.fn()} onZlecPomiar={uchwyty.onZlecPomiar ?? vi.fn()} />);

const propozycja = (dane: Partial<SzkicCopilota["daneDoboru"] & object>, n: Partial<SzkicCopilota> = {}): SzkicCopilota => ({
  tresc: "Dzień dobry…", zastrzezenia: [], uzyteFakty: [], twierdzenia: [], lukiKartoteki: [], messageId: 41, model: "claude-opus-5",
  at: "2026-09-08T12:00:00Z", przez: "A. Lewandowska", ocena: null, daneOcena: null, doborWersja: 1,
  daneDoboru: { ...dobor().dane, ...dane }, pasowanie: null, pasowanieOcena: null, ...n,
});

const PARA: SzkicCopilota["pasowanie"] = {
  czesc: { twId: 811, symbol: "LC170430140-0001", nazwa: "Uszczelka do gaźników GX160 (od strony filtra)" },
  doCzego: { twId: 502, symbol: "W09-0211", nazwa: "Gaźnik do silników HONDA GX160" },
  rola: "uszczelka", pozycja: "od strony filtra",
};

beforeEach(() => {
  zapisz.mutate.mockReset(); status.mutate.mockReset(); wybierz.mutate.mockReset(); zaproponujPasowanie.mutate.mockReset();
  ocenDane.mutate.mockReset(); ocenPasowanie.mutate.mockReset();
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

  it("czip „zgodne wymiary” pominięty niesie powód, a kandydat z tej drogi nazywa ją po polsku", () => {
    /* Blizna linki 148 cm: agent ma z czipa wiedzieć, CO wpisać, żeby szczebel ruszył. */
    kandydaci.mockReturnValue({ data: { ...Z_KANDYDATAMI, kandydaci: [
      { nr: 1, twId: 1402, symbol: "18-11010", nazwa: "Linka napędu Castel Garden 81000668/1 1170x1480", stan: 0,
        droga: "wymiar", pewnosc: "wymaga_danych", ostrzezenia: [],
        zrodlo: "zgodny wymiar 1480 mm (długość: 148 cm) w nazwie kartoteki „1170x1480” — nie dowód" },
    ] }, isLoading: false, error: null });
    pokaz(dobor({ status: "searching", dane: { ...dobor().dane, parametry: { "długość": "148 cm" } } }));
    expect(screen.getByTitle(/pominięty: agent nie wpisał wymiarów w parametrach doboru/)).toHaveTextContent("zgodne wymiary");
    expect(screen.getByText(/droga: zgodne wymiary/)).toBeInTheDocument();
    expect(screen.getByText(/zgodny wymiar 1480 mm/)).toBeInTheDocument();
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

  /* ── Dane z rozmowy (etap F, przyrost trzeci) ──────────────────────────
     Pytanie właściciela: „dlaczego dane wejściowe nie zostały wprowadzone
     automatycznie ze szkicu?". Pilnujemy granic: karta pokazuje TYLKO nowe
     pola, wpisuje na kliknięcie z wersją doboru, nie nadpisuje słowa agenta,
     a oceniona albo pusta propozycja nie zostawia po sobie karty. */
  it("karta z rozmowy pokazuje tylko nowe pola, nazywa różnice i wpisuje jednym kliknięciem z wersją", async () => {
    pokaz(dobor({ wersja: 2, dane: { ...dobor().dane, model: "GTV51" } }), {
      propozycja: propozycja({ marka: "Faworyt", model: "GTV51N196L-4W1", silnik: "Lonci v200", parametry: { klucz: "16" } }),
    });
    const karta = screen.getByRole("region", { name: "Dane z rozmowy" });
    expect(karta).toHaveTextContent("Marka: Faworyt");
    expect(karta).toHaveTextContent("Silnik: Lonci v200");
    expect(karta).toHaveTextContent("klucz: 16");
    /* Model agent ma inaczej — karta to mówi, ale go nie proponuje jako nowy. */
    expect(karta).toHaveTextContent(/Inaczej niż wpisano.*Model „GTV51N196L-4W1"/);
    expect(karta.querySelectorAll("b").length).toBeGreaterThanOrEqual(3);
    await userEvent.click(screen.getByRole("button", { name: "Wpisz do danych" }));
    expect(ocenDane.mutate).toHaveBeenCalledWith(
      { rozmowaId: 4821, ocena: "wpisane", expectedVersion: 2 }, expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    expect(ocenDane.mutate).toHaveBeenLastCalledWith(
      { rozmowaId: 4821, ocena: "odrzucone", expectedVersion: 2 }, expect.anything());
  });

  it("bez nowych pól, po ocenie albo bez propozycji karty nie ma", () => {
    const wpisane = { ...dobor().dane, marka: "Faworyt" };
    const { unmount } = pokaz(dobor({ dane: wpisane }), { propozycja: propozycja({ marka: "Faworyt" }) });
    expect(screen.queryByRole("region", { name: "Dane z rozmowy" })).toBeNull();
    unmount();
    const drugi = pokaz(dobor(), { propozycja: propozycja({ marka: "Faworyt" }, { daneOcena: "wpisane" }) });
    expect(screen.queryByRole("region", { name: "Dane z rozmowy" })).toBeNull();
    drugi.unmount();
    pokaz(dobor(), { propozycja: propozycja({}, { daneDoboru: null }) });
    expect(screen.queryByRole("region", { name: "Dane z rozmowy" })).toBeNull();
  });

  it("konflikt przy wpisywaniu z rozmowy mówi, kto zmienił, i zostawia kartę", async () => {
    ocenDane.mutate.mockImplementation((_v, o: { onError: (e: unknown) => void }) =>
      o.onError(new Konflikt("Ktoś zmienił dobór", { wersja: 5, updatedBy: "M. Wójcik" })));
    pokaz(dobor(), { propozycja: propozycja({ marka: "Faworyt" }) });
    await userEvent.click(screen.getByRole("button", { name: "Wpisz do danych" }));
    expect(screen.getByText(/Ktoś zmienił dane doboru \(M\. Wójcik\)/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Dane z rozmowy" })).toBeInTheDocument();
  });

  /* ── Pasowanie z rozmowy (etap F, przyrost czwarty) ──────────────────────
     Zapowiedź z 0.230.0. Pilnujemy granic: karta pokazuje OBA końce, rolę
     i pozycję; „Zaproponuj" i „Odrzuć" idą hookiem Copilota z samą oceną
     (parę zna serwer, nie ciało żądania); po ocenie zdanie z danych, a nie
     przyciski; odrzucona propozycja nie zostawia karty. */
  it("karta pary pokazuje oba końce z rolą i pozycją; klik proponuje albo odrzuca samą oceną", async () => {
    pokaz(dobor(), { propozycja: propozycja({}, { pasowanie: PARA }) });
    const karta = screen.getByRole("region", { name: "Pasowanie z rozmowy" });
    expect(karta).toHaveTextContent("LC170430140-0001");
    expect(karta).toHaveTextContent("W09-0211");
    expect(karta).toHaveTextContent("uszczelka · od strony filtra");
    await userEvent.click(within(karta).getByRole("button", { name: "Zaproponuj pasowanie" }));
    expect(ocenPasowanie.mutate).toHaveBeenCalledWith({ rozmowaId: 4821, ocena: "zaproponowane" });
    /* Drugi „Odrzuć" stoi w karcie danych — szukamy W REGIONIE pary. */
    await userEvent.click(within(karta).getByRole("button", { name: "Odrzuć" }));
    expect(ocenPasowanie.mutate).toHaveBeenLastCalledWith({ rozmowaId: 4821, ocena: "odrzucone" });
  });

  it("po zaproponowaniu karta mówi, że para czeka w kolejce, i nie ma przycisków; po odrzuceniu karty nie ma", () => {
    const { unmount } = pokaz(dobor(), { propozycja: propozycja({}, { pasowanie: PARA, pasowanieOcena: "zaproponowane" }) });
    const karta = screen.getByRole("region", { name: "Pasowanie z rozmowy" });
    expect(karta).toHaveTextContent(/czeka w kolejce wiedzy/);
    /* Kafle zdjęć też są przyciskami — pytamy o te dwa z decyzją. */
    expect(within(karta).queryByRole("button", { name: /Zaproponuj|Odrzuć/ })).toBeNull();
    unmount();
    pokaz(dobor(), { propozycja: propozycja({}, { pasowanie: PARA, pasowanieOcena: "odrzucone" }) });
    expect(screen.queryByRole("region", { name: "Pasowanie z rozmowy" })).toBeNull();
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

  /* ── Pasowanie część↔część (0.230.0) ────────────────────────────────────
     Klient pyta „czy ta uszczelka pasuje do mojego gaźnika". Odpowiedź rodzi
     się w doborze: wybrany kandydat pasuje DO kotwicy (kartoteki, którą agent
     wpisał symbolem/numerem albo którą ma oferta). Kierunek jest narzucony,
     a przycisk nie ma prawa proponować „X pasuje do X". */
  it("kandydat z drogi pasowania nosi własną plakietkę", () => {
    kandydaci.mockReturnValue({ data: { ...PUSTE, kandydaci: [
      { nr: 1, twId: 811, symbol: "LC170430140-0001", nazwa: "Uszczelka gaźnika GX160", stan: 12,
        droga: "pasowanie", pewnosc: "potwierdzone", ostrzezenia: [],
        zrodlo: "uszczelka (od strony filtra) LC170430140-0001 pasuje do W09-0211 — katalog dostawcy, 7.09.2026, Anna" },
    ] }, isLoading: false, error: null });
    pokaz(dobor({ status: "searching", dane: { ...dobor().dane, oem: "W09-0211" } }));
    expect(screen.getByText("droga: pasuje do części")).toBeInTheDocument();
    expect(screen.getByText(/od strony filtra/)).toBeInTheDocument();
  });

  it("„Pasuje do…” stoi tylko przy kotwicy INNEJ niż wybrany i wysyła kierunek z rozmową", async () => {
    kandydaci.mockReturnValue({ data: { ...PUSTE, kotwice: [
      { twId: 14, symbol: "FTC272", nazwa: "Podkładka" },
      { twId: 502, symbol: "W09-0211", nazwa: "Gaźnik GX160" },
    ] }, isLoading: false, error: null });
    pokaz(dobor({ status: "candidates_found", wybrany: {
      twId: 14, symbol: "FTC272", droga: "symbol", przez: "A. Lewandowska", at: "2026-09-02T08:00:00Z",
      zdanieDoSzkicu: "Do W09-0211 pasuje FTC272.",
    } }));
    /* Kotwica równa wybranemu nie dostaje przycisku — relacja do siebie samej. */
    expect(screen.queryByRole("button", { name: "Pasuje do FTC272" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Pasuje do W09-0211" }));
    /* Dowód z rozmowy jest wypełniony — agent nie przepisuje numeru rozmowy ręcznie. */
    expect(screen.getByLabelText("Dowód")).toHaveValue("dobór w rozmowie #4821");
    await userEvent.click(screen.getByRole("button", { name: /Zaproponuj pasowanie/ }));
    expect(zaproponujPasowanie.mutate).toHaveBeenCalledWith(expect.objectContaining({
      twId: 14, doTwId: 502, rola: "uszczelka", polaryzacja: "pasuje", rodzajDowodu: "rozmowa",
      dowodTresc: "dobór w rozmowie #4821", conversationId: 4821,
    }), expect.anything());
  });

  it("bez kotwicy innej niż wybrany przycisku pasowania nie ma wcale", () => {
    kandydaci.mockReturnValue({ data: Z_KANDYDATAMI, isLoading: false, error: null });
    pokaz(dobor({ status: "candidates_found", wybrany: {
      twId: 14, symbol: "FTC272", droga: "oferta", przez: "A. Lewandowska", at: "", zdanieDoSzkicu: "Do X pasuje FTC272.",
    } }));
    expect(screen.queryByRole("button", { name: /Pasuje do/ })).toBeNull();
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

  it("bez zabudowy i bez aliasu mówi, że tekstu nie ma w słowniku", () => {
    render(<Dobor dobor={zDanymi()} rozmowaId={4821} onWstawDoSzkicu={vi.fn()} onZlecPomiar={vi.fn()} />);
    expect(screen.getByText(/„B&S 450E" nie ma w słowniku silników/)).toBeInTheDocument();
    expect(screen.getByText(/Wiedza → Silniki/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zaproponuj zabudowę" })).toBeNull();
  });

  /* Słownik (0.238.0): alias rozpoznaje tekst, a jedno kliknięcie proponuje
     zabudowę z dowodem „rozmowa" i numerem rozmowy — automat nie zgaduje,
     człowiek rozstrzyga w Wiedza → Silniki. */
  it("alias bez pary daje przycisk, który proponuje zabudowę z dowodem „rozmowa” i numerem rozmowy", async () => {
    const silnik = { id: 9, rodzaj: "silnik", marka: "Briggs & Stratton", nazwa: "450E", wariant: null, lata: null,
      klucz: "silnik|bs450e", etykieta: "silnik Briggs & Stratton 450E" };
    wiedzaDoboru.mockReturnValue({ data: { zastosowanie: null, zabudowa: null, silniki: [], pomiary: [],
      silnikZPola: { alias: { id: 1, tekst: "B&S 450E", silnik, dodal: "Ala", dodanoAt: "x" }, zabudowa: null } } });
    render(<Dobor dobor={zDanymi()} rozmowaId={4821} onWstawDoSzkicu={vi.fn()} onZlecPomiar={vi.fn()} />);
    expect(screen.getByText(/Nikt nie potwierdził, że stoi w NAC LS 46-450/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zaproponuj zabudowę" }));
    expect(zaproponujZabudowe.mutate).toHaveBeenCalledWith({
      maszyna: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450", wariant: null },
      silnik: { rodzaj: "silnik", marka: "Briggs & Stratton", nazwa: "450E", wariant: null },
      rodzajDowodu: "rozmowa", dowodTresc: "klient podał silnik „B&S 450E” w rozmowie", conversationId: 4821,
    }, expect.anything());
  });

  it("gdy para już czeka, zamiast przycisku jest zdanie o kolejce", () => {
    wiedzaDoboru.mockReturnValue({ data: { zastosowanie: null, zabudowa: null, silniki: [], pomiary: [],
      silnikZPola: { alias: { id: 1, tekst: "B&S 450E", dodal: "Ala", dodanoAt: "x",
        silnik: { id: 9, etykieta: "silnik Briggs & Stratton 450E", marka: "Briggs & Stratton", nazwa: "450E", wariant: null } },
        zabudowa: { id: 5, stan: "propozycja" } } } });
    render(<Dobor dobor={zDanymi()} rozmowaId={4821} onWstawDoSzkicu={vi.fn()} onZlecPomiar={vi.fn()} />);
    expect(screen.getByText(/czeka na rozstrzygnięcie w Wiedza → Silniki/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zaproponuj zabudowę" })).toBeNull();
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
