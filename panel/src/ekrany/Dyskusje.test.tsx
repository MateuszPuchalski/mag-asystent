import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Dyskusja, KubelekDyskusji, WiadomoscReklamacji } from "../api/typy";

/* ── Ekran dyskusji (0.245.0) ────────────────────────────────────────────────
   Cztery rzeczy warte testu, bo żadnej nie widać w serwisie:

   1. ZERO ZAPISU PRZY PATRZENIU (blizna 0.18.0).
   2. PRZEŁĄCZENIE KUBEŁKA PRZESTAWIA KURSOR — ta sama usterka znaleziona
      okiem przy zwrotach.
   3. PUNKT ODNIESIENIA ŚWIEŻOŚCI liczy się z osi i przesuwa go TAKŻE DORADCA
      Allegro: rozmowa bywa trójstronna, a własna odpowiedź go nie rusza.
   4. NIE MA PRZYCISKU SYNCHRONIZACJI, a pasek mówi dlaczego. Dyskusje
      i reklamacje jadą jedną listą; drugi przycisk byłby drugą drogą
      w limit 429, a jego brak bez zdania czytałoby się jak usterka.        */

const dys = (id: number, kubelek: KubelekDyskusji, temat: string): Dyskusja => ({
  id, externalId: `d-${id}`, orderId: `ord-${id}`, kupujacyLogin: `klient${id}`,
  temat, opis: `Opis sprawy ${id}`,
  statusAllegro: kubelek === "zamknieta" ? "DISPUTE_CLOSED" : "DISPUTE_ONGOING",
  czatAktywny: kubelek !== "zamknieta", wiadomosciIle: 1, czatUrwany: false,
  ostatniaWiadomoscStatus: kubelek === "klient" ? "SELLER_REPLIED" : "BUYER_REPLIED",
  ostatniaWiadomoscAt: "2026-09-04T10:00:00.000Z",
  ruchNasz: kubelek === "odpowiedz", czekaOdDni: kubelek === "odpowiedz" ? 5 : null,
  dlugoCzeka: kubelek === "odpowiedz",
  otwartoAt: "2026-09-01T10:00:00.000Z", prowadzi: null, prowadziId: null, prowadziAt: null, notatka: null,
  zakonczenieStatus: null, zakonczenieAt: null, zakonczeniePrzez: null,
  wersja: 1, kubelek, sygnaly: [], linkZamowienia: null,
});

const DYSKUSJE = [
  dys(1, "odpowiedz", "Przesyłka nie dotarła"),
  dys(2, "zamknieta", "Sprawa wyjaśniona"),
  /* Pod sito „Moje": obie prowadzi „A. Lewandowska”, ale tylko sprawa 4
     należy do zalogowanego konta (7). Sprawę 5 ma IMIENNICZKA o numerze 9. */
  { ...dys(4, "odpowiedz", "Towar inny niż w opisie"),
    prowadzi: "A. Lewandowska", prowadziId: 7 },
  { ...dys(5, "odpowiedz", "Reklamacja ceny"),
    prowadzi: "A. Lewandowska", prowadziId: 9 },
];

/* `vi.hoisted`, bo fabryka `vi.mock` jedzie przed resztą pliku. */
const scena = vi.hoisted(() => ({
  mutacje: [] as string[],
  stan: {} as Record<string, unknown>,
  czat: [] as unknown[],
}));

/* Tożsamość zalogowanego — bez niej sita „Moje" nie ma w drzewie. */
vi.mock("../api/rozmowy", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/rozmowy")>("../api/rozmowy");
  return {
    ...rzeczywisty,
    useJa: () => ({ data: { user: { userId: 7, name: "A. Lewandowska", role: "biuro" } } }),
  };
});

vi.mock("../api/dyskusje", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/dyskusje")>("../api/dyskusje");
  const mutacja = (nazwa: string) => () => ({
    mutate: (...a: unknown[]) => { scena.mutacje.push(`${nazwa}:${JSON.stringify(a[0])}`); },
    isPending: false, error: null,
  });
  return {
    ...rzeczywisty,
    useDyskusje: () => ({
      data: {
        dyskusje: DYSKUSJE,
        liczniki: { odpowiedz: 3, klient: 0, zamknieta: 1 },
        stan: scena.stan,
      },
      isLoading: false, error: null,
    }),
    useDyskusja: (id: number | null) => ({
      data: id === null ? undefined : {
        dyskusja: DYSKUSJE.find((d) => d.id === id) ?? DYSKUSJE[0],
        czat: scena.czat,
        zalaczniki: [], zwroty: [], rozmowy: [],
      },
    }),
    useProwadzeDyskusje: mutacja("prowadze"),
    useNotatkaDyskusji: mutacja("notatka"),
    useOdpowiedzWDyskusji: mutacja("odpowiedz"),
    useZakoncz: mutacja("zakoncz"),
  };
});

const { Dyskusje } = await import("./Dyskusje");

const wiad = (n: Partial<WiadomoscReklamacji> = {}): WiadomoscReklamacji => ({
  id: 1, externalId: "w-1", autorLogin: "klient1", autorRola: "BUYER",
  tresc: "Przesyłka nie dotarła", utworzonoAt: "2026-09-04T10:01:00.000Z",
  zalaczniki: [], ...n,
});

function pokaz(adres = "/obsluga/dyskusje", czat: WiadomoscReklamacji[] = [wiad()]) {
  scena.mutacje = [];
  scena.czat = czat;
  scena.stan = {
    status: "current", alarm: false, ostatniaProba: null,
    ostatniaUdanaSynchronizacja: "2026-09-09T11:00:00.000Z", kodOstatniegoBledu: null,
    liczbaBledow: 0, opoznienieMs: 0, nastepnaProba: null, interwalMs: 180000,
    pozostaloDoPobrania: 0, dyskusjiPominietych: 35,
  };
  const klient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={klient}>
      <MemoryRouter initialEntries={[adres]}>
        <Routes>
          <Route path="/obsluga/dyskusje" element={<Dyskusje />} />
          <Route path="/obsluga/dyskusje/:id" element={<Dyskusje />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>);
}

/* Sito „Moje" pamięta wybór w przeglądarce — bez sprzątania jeden test
   włączałby filtr następnemu. */
afterEach(() => { try { localStorage.clear(); } catch { /* prywatne okno */ } });

describe("Ekran dyskusji", () => {
  it("otwarcie ekranu i wybranie sprawy NIE wywołują żadnej mutacji", async () => {
    pokaz();
    expect(scena.mutacje).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /Przesyłka nie dotarła/ }));
    expect(scena.mutacje).toEqual([]);
  });

  it("kubełki niosą pytanie i licznik, a pytanie stoi nad listą", () => {
    pokaz();
    expect(screen.getByRole("button", { name: /Do odpowiedzi\s*3/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Czeka na klienta\s*0/ })).toBeInTheDocument();
    expect(screen.getByText("Co odpisać?")).toBeInTheDocument();
  });

  it("przełączenie kubełka przestawia kursor na jego pierwszą sprawę", async () => {
    pokaz("/obsluga/dyskusje/1");
    await userEvent.click(screen.getByRole("button", { name: /Zamknięte\s*1/ }));
    expect(screen.getByRole("button", { name: /Sprawa wyjaśniona/ }))
      .toHaveAttribute("aria-current", "true");
  });

  it("NIE MA przycisku synchronizacji, a pasek mówi, gdzie jej szukać", () => {
    pokaz();
    expect(screen.queryByRole("button", { name: /synchronizuj/i })).not.toBeInTheDocument();
    expect(screen.getByText(/przyjeżdżają jedną listą/i)).toBeInTheDocument();
  });

  it("punkt świeżości bierze ostatnią NIE naszą wiadomość, także doradcy", async () => {
    /* Rozmowa jest TRÓJSTRONNA: doradca Allegro (`ADMIN`) przesuwa punkt
       odniesienia tak samo jak kupujący, a nasza własna odpowiedź nie. */
    pokaz("/obsluga/dyskusje/1", [
      wiad({ id: 1, autorRola: "BUYER" }),
      wiad({ id: 2, autorRola: "ADMIN", tresc: "Doradca Allegro" }),
      wiad({ id: 3, autorRola: "SELLER", tresc: "Nasza odpowiedź" }),
    ]);
    await userEvent.type(screen.getByLabelText("Odpowiedź w sprawie"), "Odpisuję");
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ/ }));
    const wyslane = scena.mutacje.find((m) => m.startsWith("odpowiedz:"));
    expect(wyslane).toBeTruthy();
    expect(JSON.parse(wyslane!.slice("odpowiedz:".length)).expectedLastMessageId).toBe(2);
  });

  it("prośba o zakończenie idzie z wersją sprawy z ekranu", async () => {
    pokaz("/obsluga/dyskusje/1", [wiad()]);
    await userEvent.click(screen.getByRole("button", { name: /POPROŚ O ZAKOŃCZENIE/ }));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /WYŚLIJ PROŚBĘ/ }));
    const wyslane = scena.mutacje.find((m) => m.startsWith("zakoncz:"));
    expect(wyslane).toBeTruthy();
    const ladunek = JSON.parse(wyslane!.slice("zakoncz:".length));
    expect(ladunek.wersja).toBe(1);
    expect(ladunek.expectedLastMessageId).toBe(1);
  });

  it("przy zamkniętej dyskusji nie ma ani edytora, ani prośby o zakończenie", () => {
    pokaz("/obsluga/dyskusje/2", [wiad()]);
    /* Pola odpowiedzi NIE MA — nie jest wyłączone. Notatka biura i wyszukiwarka
       zostają, bo dotyczą naszej pracy, nie rozmowy z kupującym. */
    expect(screen.queryByLabelText("Odpowiedź w sprawie")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /POPROŚ O ZAKOŃCZENIE/ })).not.toBeInTheDocument();
    expect(screen.getByText(/nowej wiadomości nie przyjmie/)).toBeInTheDocument();
  });

  /* ── Sito „Moje" (0.278.0) ────────────────────────────────────────────────
     Dyskusja i reklamacja to jeden wiersz i jedno sito. Ekran dyskusji dostaje
     je tym samym ruchem, bo „czyje to" jest tym samym pytaniem. */
  it("sito zawęża kubełek do MOICH spraw, po numerze konta, nie po imieniu", async () => {
    pokaz();
    expect(screen.getByRole("button", { name: /Towar inny niż w opisie/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reklamacja ceny/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Moje/ }));

    expect(screen.getByRole("button", { name: /Towar inny niż w opisie/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reklamacja ceny/ })).not.toBeInTheDocument();
  });

  it("sito mówi, ile chowa, a klawisz `m` je przełącza", async () => {
    pokaz();
    await userEvent.keyboard("m");
    expect(screen.getByText(/chowa 2 sprawy/)).toBeInTheDocument();
    await userEvent.keyboard("m");
    expect(screen.queryByText(/chowa/)).not.toBeInTheDocument();
  });

  it("szukanie po PROWADZĄCYM działa też w dyskusjach", async () => {
    pokaz();
    await userEvent.type(screen.getByLabelText("Szukaj dyskusji"), "lewandowsk");
    expect(screen.getByRole("button", { name: /Towar inny niż w opisie/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Przesyłka nie dotarła/ })).not.toBeInTheDocument();
  });
});
