import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Pasowanie, Zastosowanie } from "../api/typy";

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
const rozstrzygnij = vi.fn();
const rozstrzygnijPasowanie = vi.fn();
const zaproponuj = vi.fn();

/* `PRAWDZIWE` oddaje ekranowi prawdziwe haki nad atrapą `fetch`. Atrapy
   mutacji łapią wyłącznie kliknięcia; rozstrzygnięcie wysłane z efektu przy
   otwarciu przeszłoby obok nich prawdziwą siecią. Zwrotnica obejmuje WSZYSTKIE
   atrapy naraz, bo hak dołożony do atrap bez zwrotnicy zostałby w teście
   zapisu ślepy — a nikt by tego nie zauważył. */
let PRAWDZIWE = false;

vi.mock("../api/wiedza", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/wiedza")>("../api/wiedza");
  type Hak = (...a: never[]) => unknown;
  const atrapy: Record<string, Hak> = {
    useKolejkaWiedzy: () => ({ data: { propozycje: LISTA, liczba: LISTA.length,
      pasowania: PASOWANIA, pasowanDoRozstrzygniecia: PASOWANIA.length }, isLoading: false, error: null }),
    useRozstrzygnijZastosowanie: () => ({ mutate: rozstrzygnij, isPending: false }),
    useRozstrzygnijPasowanie: () => ({ mutate: rozstrzygnijPasowanie, isPending: false }),
    useZaproponujZastosowanie: () => ({ mutate: zaproponuj, isPending: false }),
    useModele: () => ({ data: { modele: [] } }),
    useWiedzaTowaru: () => ({ data: undefined, isLoading: false, error: null }),
    useModeleZOpisow: () => ({ data: { wiersze: [], liczba: 2 }, isLoading: false, error: null }),
    /* Tokeny (0.239.0) dokładają się do liczby na zakładce „Z opisów": 2 + 3 = 5. */
    useTokenySilnikow: () => ({ data: { tokeny: [], nowychRazem: 3 }, isLoading: false, error: null }),
    useDodajToken: () => ({ mutate: vi.fn(), isPending: false }),
    useRozstrzygnijToken: () => ({ mutate: vi.fn(), isPending: false }),
    useUsunToken: () => ({ mutate: vi.fn(), isPending: false }),
    usePrzerobModelZOpisu: () => ({ mutate: vi.fn(), isPending: false }),
    useOdrzucModelZOpisu: () => ({ mutate: vi.fn(), isPending: false }),
    useIdentyfikatory: () => ({ data: [], isLoading: false, error: null }),
    useDodajIdentyfikator: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  };
  const zwrotnica = Object.fromEntries(Object.entries(atrapy).map(([nazwa, atrapa]) =>
    [nazwa, (...a: never[]) => (PRAWDZIWE
      ? (rzeczywisty[nazwa as keyof typeof rzeczywisty] as Hak)(...a) : atrapa(...a))]));
  return { ...rzeczywisty, ...zwrotnica };
});
vi.mock("../wyszukiwarka", () => ({
  Wyszukiwarka: ({ onWybierz }: { onWybierz: (t: unknown) => void }) =>
    <button type="button" onClick={() => onWybierz({ id: 14, sym: "SZR-148/82", name: "Szarpak", locs: [] })}>wybierz towar</button>,
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

beforeEach(() => { rozstrzygnij.mockReset(); rozstrzygnijPasowanie.mockReset(); zaproponuj.mockReset(); LISTA = []; PASOWANIA = []; PRAWDZIWE = false; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Ekran wiedzy", () => {
  it("otwarcie kolejki to same odczyty — propozycja nie rozstrzyga się od spojrzenia", async () => {
    /* Zatwierdzona propozycja wchodzi do wiedzy, z której dobór odpowiada
       klientom. Zapis przy otwarciu byłby więc decyzją biura, której nikt
       nie podjął — dokładnie tym, czego automat nie ma prawa robić. */
    PRAWDZIWE = true;
    const zapisy: string[] = [];
    const DANE: Record<string, unknown> = {
      "/api/obsluga/wiedza/kolejka": { propozycje: [propozycja()], liczba: 1,
        pasowania: [pasowanie()], pasowanDoRozstrzygniecia: 1 },
      "/api/obsluga/wiedza/z-opisow": { wiersze: [], liczba: 0 },
      "/api/obsluga/wiedza/tokeny": { tokeny: [], nowychRazem: 0 },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const metoda = init?.method ?? "GET";
      if (metoda !== "GET") zapisy.push(`${metoda} ${url}`);
      if (metoda === "GET" && url in DANE) return new Response(JSON.stringify(DANE[url]), { status: 200 });
      /* Silniki i reszta zakładek to nie pytanie tego testu — odmowa zamiast
         wymyślonego kształtu, a zapis i tak zostanie złapany wyżej. */
      return new Response(JSON.stringify({ error: "poza tym testem" }), { status: 404 });
    }));

    pokaz();
    await screen.findByText("SZR-148/82");
    await screen.findByText("LC170430140-0001");
    expect(zapisy).toEqual([]);
  });

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
});
