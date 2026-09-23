import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { KandydatZamiennosci, Pasowanie, Zastosowanie } from "../api/typy";

/* ── Ekran wiedzy (E2) ───────────────────────────────────────────────────────
   Kolejka ma nieść to, po czym biuro rozstrzyga: kartotekę, maszynę, dowód.
   Odrzucenie bez powodu nie ma prawa wyjść z ekranu, a ręczna propozycja bez
   kartoteki, maszyny i dowodu — nie ma prawa wyjść z formularza.            */

const propozycja = (n: Partial<Zastosowanie> = {}): Zastosowanie => ({
  id: 3, twId: 14, symbol: "SZR-148/82", polaryzacja: "pasuje", powodNegatywny: null, zdaniePowodu: null,
  model: { id: 1, rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450", wariant: null, lata: null,
    klucz: "maszyna|nacls46450", etykieta: "NAC LS 46-450" },
  stan: "propozycja", zrodlo: "dobor", komentarz: null, conversationId: 4821, zastepujeId: null,
  zaproponowal: "A. Lewandowska", zaproponowanoAt: "2026-09-02T08:00:00Z", rozstrzygnal: null,
  rozstrzygnietoAt: null, powodRozstrzygniecia: null, pewnosc: "prawdopodobne",
  warunki: { rokOd: null, rokDo: null, seryjnyOd: null, seryjnyDo: null, warunek: null }, zdanieWarunkow: null,
  zdanieZrodla: "zastosowanie do NAC LS 46-450 zatwierdzone na podstawie rozmowy — rozmowa, 2.09.2026, A. Lewandowska; bez dowodu technicznego",
  dowody: [{ id: 9, rodzaj: "rozmowa", nazwaRodzaju: "rozmowa", tresc: "dobór zatwierdzony w rozmowie #4821",
    link: null, zadanieId: null, conversationId: 4821, autor: "A. Lewandowska", at: "2026-09-02T08:00:00Z" }],
  ...n,
});

/** Propozycja pasowania część↔część (0.230.0): uszczelka do gaźnika, z rozmowy. */
const pasowanie = (n: Partial<Pasowanie> = {}): Pasowanie => ({
  id: 5, czesc: { twId: 811, symbol: "LC170430140-0001", nazwa: "Uszczelka gaźnika GX160" },
  doCzego: { twId: 502, symbol: "W09-0211", nazwa: "Gaźnik GX160" },
  rola: "uszczelka", nazwaRoli: "uszczelka", pozycja: "od strony filtra",
  polaryzacja: "pasuje", powodNegatywny: null, zdaniePowodu: null, stan: "propozycja", zrodlo: "dobor",
  rodzajDowodu: "rozmowa", nazwaRodzajuDowodu: "rozmowa", dowodTresc: "dobór w rozmowie #4821", dowodLink: null,
  komentarz: null, conversationId: 4821, zastepujeId: null,
  zaproponowal: "A. Lewandowska", zaproponowanoAt: "2026-09-07T08:00:00Z",
  rozstrzygnal: null, rozstrzygnietoAt: null, powodRozstrzygniecia: null, pewnosc: "prawdopodobne",
  zdanieZrodla: "uszczelka (od strony filtra) LC170430140-0001 pasuje do W09-0211 — rozmowa, 7.09.2026, A. Lewandowska",
  ...n,
});

let LISTA: Zastosowanie[] = [];
let PASOWANIA: Pasowanie[] = [];
let ZAMIENNOSCI: KandydatZamiennosci[] = [];
let WIEDZA: unknown = undefined;
let WYKAZY: import("../api/typy").PrzegladWykazu[] = [];
const zatwierdzZWykazu = vi.fn();
const rozstrzygnijZamiennosc = vi.fn();
const wycofajZamiennosc = vi.fn();
const rozstrzygnij = vi.fn();
const rozstrzygnijPasowanie = vi.fn();
const zaproponuj = vi.fn();

vi.mock("../api/wiedza", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/wiedza")>("../api/wiedza");
  return {
    ...rzeczywisty,
    useKolejkaWiedzy: () => ({ data: { propozycje: LISTA, liczba: LISTA.length,
      pasowania: PASOWANIA, pasowanDoRozstrzygniecia: PASOWANIA.length,
      zamiennosciOem: ZAMIENNOSCI, zamiennosciOemDoRozstrzygniecia: ZAMIENNOSCI.length, wykazy: WYKAZY },
    isLoading: false, error: null }),
    useZatwierdzZWykazu: () => ({ mutate: zatwierdzZWykazu, isPending: false }),
    useRozstrzygnijZamiennosc: () => ({ mutate: rozstrzygnijZamiennosc, isPending: false }),
    useWycofajZamiennosc: () => ({ mutate: wycofajZamiennosc, isPending: false, error: null }),
    useRozstrzygnijZastosowanie: () => ({ mutate: rozstrzygnij, isPending: false }),
    useRozstrzygnijPasowanie: () => ({ mutate: rozstrzygnijPasowanie, isPending: false }),
    useZaproponujZastosowanie: () => ({ mutate: zaproponuj, isPending: false }),
    useModele: () => ({ data: { modele: [] } }),
    useWiedzaTowaru: (twId: number | null) => ({ data: twId === null ? undefined : WIEDZA, isLoading: false, error: null }),
    useModeleZOpisow: () => ({ data: { wiersze: [], liczba: 2 }, isLoading: false, error: null }),
    /* Tokeny (0.239.0) dokładają się do liczby na zakładce „Z opisów": 2 + 3 = 5. */
    useTokenySilnikow: () => ({ data: { tokeny: [], nowychRazem: 3 }, isLoading: false, error: null }),
    useDodajToken: () => ({ mutate: vi.fn(), isPending: false }),
    useRozstrzygnijToken: () => ({ mutate: vi.fn(), isPending: false }),
    useUsunToken: () => ({ mutate: vi.fn(), isPending: false }),
    usePrzerobModelZOpisu: () => ({ mutate: vi.fn(), isPending: false }),
    useOdrzucModelZOpisu: () => ({ mutate: vi.fn(), isPending: false }),
    useIdentyfikatory: () => ({ data: [], isLoading: false, error: null }),
    /* Sieć (0.465.0): jedna uszczelka do jednego gaźnika wystarczy, żeby
       sprawdzić przejście z rysunku do „Sprawdź kartotekę". */
    useSiecWiedzy: () => ({ data: { wezly: [
      { klucz: "tw:811", rodzaj: "kartoteka", twId: 811, etykieta: "LC170430140-0001", nazwa: "Uszczelka gaźnika GX160" },
      { klucz: "tw:502", rodzaj: "kartoteka", twId: 502, etykieta: "W09-0211", nazwa: "Gaźnik GX160" },
    ], krawedzie: [{ z: "tw:811", do: "tw:502", warstwa: "pasowania", rodzaj: "pasuje", polaryzacja: "pasuje",
      wierszId: 5, rola: "uszczelka", pewnosc: "potwierdzone", obustronnie: false, zdanie: "uszczelka pasuje do W09-0211" }] },
    isLoading: false, error: null }),
    useDodajIdentyfikator: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  };
});
vi.mock("../wyszukiwarka", () => ({
  Wyszukiwarka: ({ wybrany, onWybierz }: { wybrany: { sym: string } | null; onWybierz: (t: unknown) => void }) => <>
    {wybrany && <span>wybrano {wybrany.sym}</span>}
    <button type="button" onClick={() => onWybierz({ id: 14, sym: "SZR-148/82", name: "Szarpak", locs: [] })}>wybierz towar</button>
  </>,
}));

const { Wiedza } = await import("./Wiedza");

const pokaz = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={["/obsluga/wiedza"]}>
      <Routes>
        <Route path="/obsluga/wiedza" element={<Wiedza />} />
        <Route path="/obsluga/skrzynka/:id" element={<p>Rozmowa otwarta</p>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);

beforeEach(() => {
  rozstrzygnij.mockReset(); rozstrzygnijPasowanie.mockReset(); zaproponuj.mockReset();
  rozstrzygnijZamiennosc.mockReset(); wycofajZamiennosc.mockReset(); zatwierdzZWykazu.mockReset();
  LISTA = []; PASOWANIA = []; ZAMIENNOSCI = []; WIEDZA = undefined; WYKAZY = [];
});

describe("Ekran wiedzy", () => {
  /* Pasowania część↔część (0.230.0) czekają w TEJ SAMEJ kolejce jako druga
     sekcja — ta sama decyzja tego samego człowieka. Osobna zakładka łamałaby
     etykiety, a osobny licznik bez sekcji kłamałby przez pominięcie. */
  it("pasowania części stoją jako druga sekcja kolejki z własnym licznikiem", async () => {
    PASOWANIA = [pasowanie()];
    pokaz();
    expect(screen.getByText(/1 pasowanie do rozstrzygnięcia/)).toBeInTheDocument();
    /* Pusta lista zastosowań NIE pokazuje „nic nie czeka", bo czeka pasowanie. */
    expect(screen.queryByText(/Nic nie czeka/)).toBeNull();
    const sekcja = screen.getByRole("region", { name: "Pasowania części" });
    expect(sekcja).toHaveTextContent("Pasowania części (1)");
    expect(screen.getByText("LC170430140-0001")).toBeInTheDocument();
    expect(screen.getByText("W09-0211")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /rozmowa #4821/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zatwierdź" }));
    expect(rozstrzygnijPasowanie).toHaveBeenCalledWith({ id: 5, decyzja: "zatwierdz", powod: null }, expect.anything());
  });

  it("kolejka niesie kartotekę, maszynę, dowód i odnośnik do rozmowy", () => {
    LISTA = [propozycja()];
    pokaz();
    expect(screen.getByText("SZR-148/82")).toBeInTheDocument();
    expect(screen.getByText("NAC LS 46-450")).toBeInTheDocument();
    expect(screen.getByText(/dobór zatwierdzony w rozmowie #4821/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /z rozmowy #4821/ })).toBeInTheDocument();
    expect(screen.getByText("1 do rozstrzygnięcia")).toBeInTheDocument();
  });

  it("zatwierdzenie oddaje identyfikator; odrzucenie bez powodu nie wychodzi z ekranu", async () => {
    LISTA = [propozycja()];
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /ZATWIERDŹ/ }));
    expect(rozstrzygnij).toHaveBeenCalledWith({ id: 3, decyzja: "zatwierdz", powod: null }, expect.anything());

    await userEvent.click(screen.getByRole("button", { name: /ODRZUĆ/ }));
    const potwierdz = screen.getByRole("button", { name: /Potwierdź odrzucenie/ });
    expect(potwierdz).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Powód odrzucenia/), "to LS 51");
    await userEvent.click(potwierdz);
    expect(rozstrzygnij).toHaveBeenLastCalledWith({ id: 3, decyzja: "odrzuc", powod: "to LS 51" }, expect.anything());
  });

  it("zakładka „Z opisów i ofert” liczy teksty do przerobienia RAZEM z kartotekami z tokenem", () => {
    /* Jedna liczba pracy: 2 sekcje + 3 kartoteki z tokenem = 5. Oba czekają
       na tego samego człowieka w tym samym widoku. */
    pokaz();
    expect(screen.getByRole("button", { name: "Z opisów i ofert (5)" })).toBeInTheDocument();
  });

  it("pusta kolejka mówi, skąd biorą się propozycje", () => {
    pokaz();
    expect(screen.getByText(/Nic nie czeka/)).toBeInTheDocument();
  });

  it("ręczna propozycja nie wychodzi bez kartoteki, maszyny i dowodu — a z nimi niesie komplet", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: "Nowa propozycja" }));
    const wyslij = screen.getByRole("button", { name: /ZAPROPONUJ DO KOLEJKI/ });
    expect(wyslij).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "wybierz towar" }));
    await userEvent.type(screen.getByLabelText("Marka"), "NAC");
    await userEvent.type(screen.getByLabelText("Model"), "LS 46-450");
    expect(wyslij).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Treść dowodu"), "katalog 2024, s. 34");
    await userEvent.click(screen.getByLabelText("nie pasuje"));
    await userEvent.selectOptions(screen.getByLabelText("Powód negatywny"), "mylace_oznaczenie");
    await userEvent.click(wyslij);
    expect(zaproponuj).toHaveBeenCalledWith(expect.objectContaining({
      twId: 14, polaryzacja: "nie_pasuje", powodNegatywny: "mylace_oznaczenie",
      model: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450", wariant: null },
      dowod: { rodzaj: "katalog_dostawcy", tresc: "katalog 2024, s. 34", link: null },
    }), expect.anything());
  });

  /* Warunki wpisu: zatwierdza się twierdzenie RAZEM z granicą, więc karta
     kolejki ją pokazuje — a poprawka mówi, który wpis zastąpi. */
  it("karta kolejki pokazuje warunki i to, który wpis poprawka zastąpi", () => {
    LISTA = [propozycja({ zastepujeId: 2, zdanieWarunkow: "roczniki 2014–2018, nr seryjny od 175000000",
      warunki: { rokOd: 2014, rokDo: 2018, seryjnyOd: "175000000", seryjnyDo: null, warunek: null } })];
    pokaz();
    expect(screen.getByText("roczniki 2014–2018, nr seryjny od 175000000")).toBeInTheDocument();
    expect(screen.getByText(/Poprawka wpisu #2 — po zatwierdzeniu tamten schodzi na wycofane/)).toBeInTheDocument();
  });

  it("ręczna propozycja z warunkami niesie je w ciele — pusta sekcja to `null`, nie pięć pustych pól", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: "Nowa propozycja" }));
    await userEvent.click(screen.getByRole("button", { name: "wybierz towar" }));
    await userEvent.type(screen.getByLabelText("Marka"), "STIHL");
    await userEvent.type(screen.getByLabelText("Model"), "MS 250");
    await userEvent.type(screen.getByLabelText("Treść dowodu"), "IPL 2024");
    await userEvent.click(screen.getByRole("button", { name: /ZAPROPONUJ DO KOLEJKI/ }));
    expect(zaproponuj).toHaveBeenLastCalledWith(expect.objectContaining({ warunki: null }), expect.anything());

    await userEvent.click(screen.getByText("Warunki — lata, numer seryjny (opcjonalnie)"));
    await userEvent.type(screen.getByLabelText("Rocznik od"), "2014");
    await userEvent.type(screen.getByLabelText("Nr seryjny od"), " 175000000 ");
    await userEvent.click(screen.getByRole("button", { name: /ZAPROPONUJ DO KOLEJKI/ }));
    expect(zaproponuj).toHaveBeenLastCalledWith(expect.objectContaining({
      warunki: { rokOd: 2014, rokDo: null, seryjnyOd: "175000000", seryjnyDo: null, warunek: null },
    }), expect.anything());
  });

  it("„Popraw warunki” przy zatwierdzonym wpisie składa POPRAWKĘ z dowodem, nie edycję w miejscu", async () => {
    WIEDZA = { potwierdzone: [propozycja({ id: 5, stan: "zatwierdzone", pewnosc: "potwierdzone",
      zdanieWarunkow: "rocznik od 2014", warunki: { rokOd: 2014, rokDo: null, seryjnyOd: null, seryjnyDo: null, warunek: null } })],
    negatywne: [], propozycje: [], pasowania: { pasujeDo: [], pasujace: [], negatywne: [], propozycje: [] }, zamiennosciOem: [] };
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: "Sprawdź kartotekę" }));
    await userEvent.click(screen.getByRole("button", { name: "wybierz towar" }));
    const sekcja = screen.getByRole("region", { name: "Potwierdzone zastosowania" });
    expect(sekcja).toHaveTextContent("Tylko: rocznik od 2014");
    await userEvent.click(within(sekcja).getByRole("button", { name: "Popraw warunki" }));
    expect(within(sekcja).getByLabelText("Rocznik od")).toHaveValue("2014");
    await userEvent.type(within(sekcja).getByLabelText("Rocznik do"), "2018");
    const wyslij = within(sekcja).getByRole("button", { name: "Zaproponuj poprawkę" });
    expect(wyslij).toBeDisabled();
    await userEvent.type(within(sekcja).getByLabelText("Dowód na nowe warunki"), "IPL 2024, s. 12");
    await userEvent.click(wyslij);
    expect(zaproponuj).toHaveBeenCalledWith({
      twId: 14, zastepujeId: 5, polaryzacja: "pasuje", powodNegatywny: null,
      model: { rodzaj: "maszyna", marka: "NAC", nazwa: "LS 46-450", wariant: null }, komentarz: null,
      warunki: { rokOd: 2014, rokDo: 2018, seryjnyOd: null, seryjnyDo: null, warunek: null },
      dowod: { rodzaj: "katalog_dostawcy", tresc: "IPL 2024, s. 12" },
    }, expect.anything());
  });

  /* Wykaz części: kilkadziesiąt propozycji z jednej decyzji. Stoją JEDNĄ
     listą — nie jako karty — i żadna nie pojawia się drugi raz niżej. */
  it("propozycje z wykazu stoją jedną listą, a zatwierdzenie bierze tylko zaznaczone", async () => {
    LISTA = [propozycja({ id: 21, symbol: "W19-0201", importId: 4 }), propozycja({ id: 22, symbol: "W04-0201", importId: 4 }),
      propozycja({ id: 3 })];
    WYKAZY = [{ id: 4, zrodlo: "IPL Honda GX160", link: null, rodzaj: "silnik", pozycje: [
      { id: 21, twId: 81, symbol: "W19-0201", nazwa: "Korek oleju", maszyna: "silnik Honda GX160", warunki: null,
        dowod: "silnik Honda GX160 — numer 15600-ZE1-003" },
      { id: 22, twId: 82, symbol: "W04-0201", nazwa: "Tłok kpl.", maszyna: "silnik Honda GX160", warunki: "roczniki 2008–2016",
        dowod: "silnik Honda GX160 — numer 13101-ZE1-000" }] }];
    pokaz();
    const lista = screen.getByRole("region", { name: "Wykaz: IPL Honda GX160" });
    expect(lista).toHaveTextContent("2 propozycje czekają");
    expect(lista).toHaveTextContent("Tylko: roczniki 2008–2016");
    expect(screen.queryByRole("article", { name: /Propozycja: W19-0201/ })).toBeNull();
    expect(screen.getByRole("article", { name: /Propozycja: SZR-148\/82/ })).toBeInTheDocument();

    await userEvent.click(within(lista).getByRole("checkbox", { name: "Zatwierdź: W04-0201 → silnik Honda GX160" }));
    expect(lista).toHaveTextContent("1 odznaczona zostanie w kolejce");
    await userEvent.click(within(lista).getByRole("button", { name: /Zatwierdź zaznaczone \(1\)/ }));
    expect(zatwierdzZWykazu).toHaveBeenCalledWith({ importId: 4, ids: [21] }, expect.anything());
  });

  it("odrzucenie wiersza z wykazu wymaga powodu i idzie zwykłą decyzją o propozycji", async () => {
    LISTA = [propozycja({ id: 21, importId: 4 })];
    WYKAZY = [{ id: 4, zrodlo: "IPL Honda GX160", link: null, rodzaj: "silnik", pozycje: [
      { id: 21, twId: 81, symbol: "W19-0201", nazwa: "Korek oleju", maszyna: "silnik Honda GX160", warunki: null, dowod: "numer" }] }];
    pokaz();
    const lista = screen.getByRole("region", { name: "Wykaz: IPL Honda GX160" });
    await userEvent.click(within(lista).getByRole("button", { name: /Odrzuć/ }));
    const potwierdz = within(lista).getByRole("button", { name: "Potwierdź odrzucenie" });
    expect(potwierdz).toBeDisabled();
    await userEvent.type(within(lista).getByLabelText("Powód odrzucenia: W19-0201"), "to korek GX200");
    await userEvent.click(potwierdz);
    expect(rozstrzygnij).toHaveBeenCalledWith({ id: 21, decyzja: "odrzuc", powod: "to korek GX200" }, expect.anything());
    expect(zatwierdzZWykazu).not.toHaveBeenCalled();
  });

  /* Przejście z Sieci (0.465.0): wskazana część ląduje w „Sprawdź kartotekę”
     już wybrana — szukanie tego samego symbolu drugi raz to czysta strata. */
  it("„Otwórz w Sprawdź kartotekę” z sieci przełącza zakładkę i niesie wybraną część", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: "Sieć" }));
    await userEvent.click(screen.getByRole("button", { name: /^LC170430140-0001 —/ }));
    await userEvent.click(screen.getByRole("button", { name: /Otwórz w „Sprawdź kartotekę"/ }));
    expect(screen.getByRole("button", { name: "Sprawdź kartotekę" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("wybrano LC170430140-0001")).toBeInTheDocument();
  });

  /* Zamienność przez wspólny numer oryginału: trzecia sekcja tej samej
     kolejki. Decyzja idzie o PARZE kartotek — kandydat nie ma numeru. */
  it("pary ze wspólnym numerem oryginału stoją jako trzecia sekcja kolejki i oddają decyzję o parze", async () => {
    ZAMIENNOSCI = [{ a: { twId: 11, symbol: "W09-1307", nazwa: "Gaźnik do traktorka B&S" },
      b: { twId: 12, symbol: "76-080", nazwa: "Gaźnik do traktorka B&S" }, numery: ["281707", "390811"] }];
    pokaz();
    expect(screen.getByText(/1 para ze wspólnym numerem/)).toBeInTheDocument();
    expect(screen.queryByText(/Nic nie czeka/)).toBeNull();
    const sekcja = screen.getByRole("region", { name: "Wspólny numer oryginału" });
    expect(sekcja).toHaveTextContent("Wspólny numer oryginału (1)");
    expect(sekcja).toHaveTextContent(/nie lewy z prawym/);
    await userEvent.click(screen.getByRole("button", { name: "Zamienne" }));
    expect(rozstrzygnijZamiennosc).toHaveBeenCalledWith({ twA: 11, twB: 12, decyzja: "zatwierdz", powod: null }, expect.anything());
  });

  it("„Sprawdź kartotekę” pokazuje decyzję o zamienności i cofa odrzucenie wyłącznie z powodem", async () => {
    WIEDZA = { potwierdzone: [], negatywne: [], propozycje: [],
      pasowania: { pasujeDo: [], pasujace: [], negatywne: [], propozycje: [] },
      zamiennosciOem: [{ id: 7, a: { twId: 14, symbol: "SZR-148/82", nazwa: "Szarpak" },
        b: { twId: 15, symbol: "SZR-150", nazwa: "Szarpak prawy" }, stan: "odrzucone", numery: ["545008032"],
        powod: "lewy i prawy", rozstrzygnal: "A. Lewandowska", rozstrzygnietoAt: "2026-09-23T10:00:00Z",
        wycofal: null, wycofanoAt: null, powodWycofania: null,
        zdanie: "SZR-148/82 i SZR-150 NIE są zamienne mimo wspólnego numeru 545008032: lewy i prawy — A. Lewandowska, 23.09.2026" }] };
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: "Sprawdź kartotekę" }));
    await userEvent.click(screen.getByRole("button", { name: "wybierz towar" }));
    const sekcja = screen.getByRole("region", { name: "Zamienność przez numer oryginału" });
    expect(sekcja).toHaveTextContent("nie zastępuje");
    expect(sekcja).toHaveTextContent("SZR-150");
    expect(sekcja).toHaveTextContent(/NIE są zamienne mimo wspólnego numeru 545008032/);
    await userEvent.click(screen.getByRole("button", { name: "Wycofaj" }));
    const potwierdz = screen.getByRole("button", { name: "Potwierdź wycofanie" });
    expect(potwierdz).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Powód wycofania: SZR-148/82 ⟷ SZR-150" }), "sprawdzone na półce");
    await userEvent.click(potwierdz);
    expect(wycofajZamiennosc).toHaveBeenCalledWith({ id: 7, powod: "sprawdzone na półce" }, expect.anything());
  });
});
