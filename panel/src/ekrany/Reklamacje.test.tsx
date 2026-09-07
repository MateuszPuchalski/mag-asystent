import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { KubelekReklamacji, Reklamacja } from "../api/typy";

/* ── Ekran reklamacji ────────────────────────────────────────────────────────
   Trzy rzeczy warte testu, bo żadnej nie widać w serwisie:

   1. ZERO ZAPISU PRZY PATRZENIU (blizna 0.18.0). Otwarcie ekranu i wybranie
      sprawy nie mają prawa wywołać ani jednej mutacji.
   2. PRZEŁĄCZENIE KUBEŁKA PRZESTAWIA KURSOR. Ta sama usterka znaleziona okiem
      przy zwrotach: lista się zmienia, a zaznaczenie zostaje na sprawie
      z poprzedniego kubełka.
   3. LICZBA ODSIANYCH DYSKUSJI jest widoczna. Bez niej ktoś szukałby kiedyś
      reklamacji, która nigdy reklamacją nie była.                          */

const rek = (id: number, kubelek: KubelekReklamacji, numer: string): Reklamacja => ({
  id, externalId: `i-${id}`, numer, orderId: `ord-${id}`, offerId: null,
  kupujacyLogin: `klient${id}`, prawo: "COMPLAINT",
  powodTyp: "NOT_AS_DESCRIBED", powodOpis: `Opis sprawy ${id}`, temat: null, opis: null,
  oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: 5000, waluta: "PLN",
  statusAllegro: kubelek === "decyzja" ? "CLAIM_SUBMITTED" : "CLAIM_ACCEPTED",
  decyzjaDo: "2026-09-20T10:00:00.000Z", dniDoTerminu: 13, poTerminie: false,
  zwrotWymagany: null, czatAktywny: true, wiadomosciIle: 1,
  ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-06T10:00:00.000Z", prowadzi: null, prowadziAt: null,
  notatka: null, wersja: 1, kubelek, sygnaly: [],
  link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: `Towar ${id}`, ofertaZdjecie: "brak", twId: null, twSymbol: null,
});

const REKLAMACJE = [
  rek(1, "decyzja", "111/2026"),
  rek(2, "zamknieta", "222/2026"),
];

/* `vi.hoisted`, bo fabryka `vi.mock` jedzie przed resztą pliku. */
const scena = vi.hoisted(() => ({
  mutacje: [] as string[],
  stan: {} as Record<string, unknown>,
}));

vi.mock("../api/reklamacje", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/reklamacje")>("../api/reklamacje");
  const mutacja = (nazwa: string) => () => ({
    mutate: (...a: unknown[]) => { scena.mutacje.push(`${nazwa}:${JSON.stringify(a[0])}`); },
    isPending: false, error: null,
  });
  return {
    ...rzeczywisty,
    useReklamacje: () => ({
      data: {
        reklamacje: REKLAMACJE,
        liczniki: { decyzja: 1, odpowiedz: 0, zamknieta: 1 },
        stan: scena.stan,
      },
      isLoading: false, error: null,
    }),
    useReklamacja: (id: number | null) => ({
      data: id === null ? undefined : {
        reklamacja: REKLAMACJE.find((r) => r.id === id) ?? REKLAMACJE[0],
        czat: [{
          id: 1, externalId: "w-1", autorLogin: "klient1", autorRola: "BUYER",
          tresc: "Kosiarka przestała ciąć", utworzonoAt: "2026-09-06T10:01:00.000Z",
          zalaczniki: [{ id: 9, wiadomoscId: 1, nazwa: "usterka.jpg", podglad: true }],
        }],
        zalaczniki: [], zwroty: [], rozmowy: [], kartoteka: null,
      },
    }),
    useProwadze: mutacja("prowadze"),
    useNotatka: mutacja("notatka"),
    useSynchronizuj: mutacja("synchronizuj"),
  };
});

const { Reklamacje } = await import("./Reklamacje");

function pokaz(adres = "/obsluga/reklamacje") {
  scena.mutacje = [];
  scena.stan = {
    status: "current", alarm: false, ostatniaProba: null,
    ostatniaUdanaSynchronizacja: "2026-09-07T11:00:00.000Z", kodOstatniegoBledu: null,
    liczbaBledow: 0, opoznienieMs: 0, nastepnaProba: null, interwalMs: 180000,
    pozostaloDoPobrania: 0, dyskusjiPominietych: 35,
  };
  const klient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={klient}>
      <MemoryRouter initialEntries={[adres]}>
        <Routes>
          <Route path="/obsluga/reklamacje" element={<Reklamacje />} />
          <Route path="/obsluga/reklamacje/:id" element={<Reklamacje />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>);
}

describe("Ekran reklamacji", () => {
  it("otwarcie ekranu i wybranie sprawy NIE wywołują żadnej mutacji", async () => {
    pokaz();
    expect(scena.mutacje).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /111\/2026/ }));
    expect(scena.mutacje).toEqual([]);
  });

  it("kubełki niosą pytanie i licznik, a pytanie stoi nad listą", () => {
    pokaz();
    expect(screen.getByTitle(/Uznać czy odrzucić\? \(klawisz 1\)/)).toBeInTheDocument();
    expect(screen.getByTitle(/Co odpisać klientowi\? \(klawisz 2\)/)).toBeInTheDocument();
    /* Pytanie zastępuje menu akcji — dekalog, punkt 5. */
    expect(screen.getByText("Uznać czy odrzucić?")).toBeInTheDocument();
  });

  it("kubełek DO DECYZJI pokazuje tylko sprawy przed werdyktem", () => {
    pokaz();
    expect(screen.getByText("111/2026")).toBeInTheDocument();
    expect(screen.queryByText("222/2026")).not.toBeInTheDocument();
  });

  it("przełączenie kubełka przestawia KURSOR na jego pierwszą sprawę", async () => {
    pokaz("/obsluga/reklamacje/1");
    await userEvent.click(screen.getByTitle(/Tylko wgląd\. \(klawisz 3\)/));
    /* Bez przestawienia kursora środkowa kolumna pokazywałaby rozmowę ze
       sprawy z poprzedniego kubełka. Wiersz kolejki JEST wybrany — a numer
       stoi też w kolumnie dowodów, więc szukamy po roli, nie po tekście. */
    const wiersz = await screen.findByRole("button", { name: /222\/2026/ });
    expect(wiersz).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("button", { name: /111\/2026/ })).not.toBeInTheDocument();
  });

  it("liczba odsianych dyskusji stoi na pasku — to zakres panelu, nie błąd", () => {
    pokaz();
    expect(screen.getByText(/dyskusji pominiętych/)).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
  });

  it("ekran mówi WPROST, czego panel jeszcze nie robi", () => {
    /* Bez tego zdania puste miejsce pod rozmową obiecywałoby odpowiedź. */
    pokaz("/obsluga/reklamacje/1");
    expect(screen.getByText(/wysyła się na razie w Centrum Sprzedaży/)).toBeInTheDocument();
  });

  it("bez wybranej sprawy środek zaprasza do kolejki, zamiast świecić pustką", () => {
    pokaz();
    expect(screen.getByText(/Wybierz reklamację z kolejki/)).toBeInTheDocument();
  });

  it("„synchronizuj teraz” jest JAWNYM kliknięciem, nie skutkiem otwarcia", async () => {
    pokaz();
    expect(scena.mutacje).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /Synchronizuj teraz/ }));
    expect(scena.mutacje).toEqual(["synchronizuj:undefined"]);
  });

  it("„prowadzę” jedzie z WERSJĄ rekordu — inaczej nadpisałoby pracę kolegi", async () => {
    pokaz("/obsluga/reklamacje/1");
    await userEvent.click(screen.getByRole("button", { name: /Prowadzę tę sprawę/ }));
    expect(scena.mutacje).toEqual([`prowadze:${JSON.stringify({ id: 1, wersja: 1 })}`]);
  });

  it("cyfra przełącza kubełek, ale NIE wtedy, gdy piszesz w polu", async () => {
    pokaz("/obsluga/reklamacje/1");
    const pole = screen.getByLabelText("Szukaj reklamacji");
    await userEvent.type(pole, "3");
    expect(pole).toHaveValue("3");
    /* Kubełek się NIE przełączył: gdyby cyfra przeszła do skrótów, ekran
       stałby w kubełku ROZSTRZYGNIĘTE i pokazywał sprawę 222/2026. Zamiast
       tego stoi filtr, który do niczego nie pasuje. */
    expect(screen.getByText(/nie pasuje do tego, czego szukasz/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /222\/2026/ })).not.toBeInTheDocument();
  });
});
