import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Zastosowanie } from "../api/typy";

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

let LISTA: Zastosowanie[] = [];
const rozstrzygnij = vi.fn();
const zaproponuj = vi.fn();

vi.mock("../api/wiedza", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/wiedza")>("../api/wiedza");
  return {
    ...rzeczywisty,
    useKolejkaWiedzy: () => ({ data: { propozycje: LISTA, liczba: LISTA.length }, isLoading: false, error: null }),
    useRozstrzygnijZastosowanie: () => ({ mutate: rozstrzygnij, isPending: false }),
    useZaproponujZastosowanie: () => ({ mutate: zaproponuj, isPending: false }),
    useModele: () => ({ data: { modele: [] } }),
    useWiedzaTowaru: () => ({ data: undefined, isLoading: false, error: null }),
    useModeleZOpisow: () => ({ data: { wiersze: [], liczba: 2 }, isLoading: false, error: null }),
    usePrzerobModelZOpisu: () => ({ mutate: vi.fn(), isPending: false }),
    useOdrzucModelZOpisu: () => ({ mutate: vi.fn(), isPending: false }),
    useIdentyfikatory: () => ({ data: [], isLoading: false, error: null }),
    useDodajIdentyfikator: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  };
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

beforeEach(() => { rozstrzygnij.mockReset(); zaproponuj.mockReset(); LISTA = []; });

describe("Ekran wiedzy", () => {
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
