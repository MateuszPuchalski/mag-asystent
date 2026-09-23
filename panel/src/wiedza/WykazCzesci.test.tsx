import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ImportWykazu, MapowanieWykazu, RaportWykazu } from "../api/typy";
import { WykazCzesci } from "./WykazCzesci";

/* ── Wykaz części producenta ─────────────────────────────────────────────────
   Po prawdziwym `fetch`: otwarcie to wyłącznie odczyt historii. Marka, której
   w pliku nie ma, wpisuje się raz dla całego wykazu, a podgląd liczy się sam,
   gdy mapowanie jest kompletne. Zapis czeka na nazwę wykazu — idzie do dowodu
   każdej propozycji — i niesie mapowanie widoczne na ekranie.               */

type Zadanie = { zrodlo: string; mapowanie: MapowanieWykazu | null; zastosuj: boolean; rodzajDowodu: string; link: string | null };

const ZGADNIETE: MapowanieWykazu = { marka: null, model: { kolumna: 0 }, wariant: null, numery: [2],
  rokOd: null, rokDo: null, seryjnyOd: 3, seryjnyDo: null, rodzaj: "maszyna" };
const RAPORT = (n: Partial<RaportWykazu> = {}): RaportWykazu => ({
  naglowki: ["Model", "Poz.", "Numer części", "Nr seryjny od"],
  probka: [["MS 250", "1", "1123 120 0600", "175000000"]],
  mapowanie: ZGADNIETE, zgadniete: true, wierszy: 3, dopasowanych: 2, bezMaszyny: 0, bezNumerow: 0,
  bledneWarunki: { liczba: 1, przyklady: ["wiersz 4: Rok od jest późniejszy niż rok do"] },
  bezKartoteki: { liczba: 1, przyklady: ["0000 000 0000"] },
  maszyn: { nowych: 1, znanych: 0 }, par: { nowych: 2, znanych: 1, znanychInneWarunki: 1 },
  przyklady: [{ symbol: "W09-0211", nazwa: "Gaźnik", maszyna: "STIHL MS 250", numery: ["1123 120 0600"], warunki: "nr seryjny od 175000000" }],
  inneWarunki: [{ symbol: "F-160", nazwa: "Filtr", maszyna: "STIHL MS 250", numery: ["1123 120 1600"], warunki: null }],
  zapisano: null, ...n,
});
const AKTYWNY: ImportWykazu = { id: 4, zrodlo: "IPL STIHL MS 250", link: null, plik: "ms250.csv", rodzaj: "maszyna",
  wierszy: 120, par: 14, propozycji: 14, czeka: 9, zatwierdzonych: 5, stan: "aktywny", zaimportowal: "A. Lewandowska",
  at: "2026-09-23T10:00:00Z", wycofal: null, wycofanoAt: null };

let wyslane: Array<{ url: string; body: Zadanie | null }> = [];
let odczyty: string[] = [];
let historia: ImportWykazu[] = [];

beforeEach(() => {
  wyslane = []; odczyty = []; historia = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const odp = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if ((init?.method ?? "GET") === "GET") {
      odczyty.push(url);
      if (url === "/api/obsluga/wiedza/wykazy") return odp(historia);
      throw new Error(`nieoczekiwany odczyt: ${url}`);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Zadanie : null;
    wyslane.push({ url, body });
    if (url === "/api/obsluga/wiedza/wykazy") {
      if (body!.zastosuj) return odp(RAPORT({ zgadniete: false, zapisano: { importId: 5, propozycji: 2 } }));
      return odp(body!.mapowanie ? RAPORT({ mapowanie: body!.mapowanie, zgadniete: false }) : RAPORT());
    }
    if (url === "/api/obsluga/wiedza/wykazy/4/wycofaj") return odp({ ...AKTYWNY, stan: "wycofany", czeka: 0 });
    throw new Error(`nieoczekiwany zapis: ${url}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const pokaz = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <WykazCzesci />
  </QueryClientProvider>);

const CSV = "Model;Poz.;Numer części;Nr seryjny od\nMS 250;1;1123 120 0600;175000000\n";
const wgraj = (u: ReturnType<typeof userEvent.setup>) =>
  u.upload(screen.getByLabelText("Plik wykazu"), new File([CSV], "IPL MS 250.csv", { type: "text/csv" }));

describe("Wykaz części producenta", () => {
  it("otwarcie to wyłącznie odczyt historii — zero zapisu przy patrzeniu", async () => {
    pokaz();
    await waitFor(() => expect(odczyty).toEqual(["/api/obsluga/wiedza/wykazy"]));
    expect(wyslane).toEqual([]);
  });

  it("marka wpisana raz dla pliku liczy podgląd sam; zapis niesie mapowanie z ekranu i nazwę wykazu", async () => {
    const u = userEvent.setup();
    pokaz();
    await wgraj(u);
    expect(await screen.findByText(/zgadnięte z nagłówków, sprawdź przed zapisem/)).toBeInTheDocument();
    /* Nazwa wykazu podpowiada się z nazwy pliku — człowiek ją poprawia, nie przepisuje. */
    expect(screen.getByRole("textbox", { name: "Nazwa wykazu" })).toHaveValue("IPL MS 250");
    expect(screen.getByRole("combobox", { name: "Marka: skąd" })).toHaveValue("tekst");
    const zapisz = screen.getByRole("button", { name: /Zaproponuj/ });
    expect(zapisz).toBeDisabled();
    expect(wyslane).toHaveLength(1);

    await u.type(screen.getByRole("textbox", { name: "Marka" }), "STIHL");
    await waitFor(() => expect(wyslane).toHaveLength(2), { timeout: 2000 });
    expect(wyslane[1].body).toMatchObject({ zastosuj: false, mapowanie: { marka: { tekst: "STIHL" }, model: { kolumna: 0 } } });
    const wynik = await screen.findByLabelText("Wynik podglądu wykazu");
    expect(wynik).toHaveTextContent("Kolejka zastosowań: +2 propozycje do zatwierdzenia");
    expect(wynik).toHaveTextContent("tylko: nr seryjny od 175000000");
    expect(wynik).toHaveTextContent(/inne warunki niż wpis w bazie: 1/);
    expect(wynik).toHaveTextContent("Wiersze z zepsutym zakresem nie wejdą: 1");

    await waitFor(() => expect(screen.getByRole("button", { name: "Zaproponuj 2 pary" })).toBeEnabled());
    await u.click(screen.getByRole("button", { name: "Zaproponuj 2 pary" }));
    const zapis = wyslane.find((w) => w.body?.zastosuj);
    expect(zapis?.body).toMatchObject({ zrodlo: "IPL MS 250", rodzajDowodu: "producent",
      mapowanie: { marka: { tekst: "STIHL" }, numery: [2], seryjnyOd: 3 } });
    expect(await screen.findByText(/Do kolejki trafiło 2 propozycje z wykazu „IPL MS 250”/)).toBeInTheDocument();
  });

  it("bez marki podgląd nie strzela co literę, a zapis czeka", async () => {
    const u = userEvent.setup();
    pokaz();
    await wgraj(u);
    await screen.findByText(/zgadnięte z nagłówków/);
    await u.click(screen.getByRole("checkbox", { name: "Poz." }));
    await new Promise((r) => setTimeout(r, 600));
    expect(wyslane).toHaveLength(1);
    expect(screen.getByText("Wskaż markę, model i kolumnę z numerami części.")).toBeInTheDocument();
  });

  it("wycofanie zdejmuje czekające — pytanie mówi, że zatwierdzone zostają", async () => {
    historia = [AKTYWNY, { ...AKTYWNY, id: 3, czeka: 0 }];
    const u = userEvent.setup();
    pokaz();
    const tabela = await screen.findByRole("table");
    expect(within(tabela).getAllByRole("button", { name: "Wycofaj" })).toHaveLength(1);
    await u.click(within(tabela).getByRole("button", { name: "Wycofaj" }));
    expect(screen.getByText(/Zdjąć 9 czekających propozycji z kolejki\? Zatwierdzone \(5\) zostają\./)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Wycofaj wykaz" }));
    await waitFor(() => expect(wyslane.map((w) => w.url)).toEqual(["/api/obsluga/wiedza/wykazy/4/wycofaj"]));
  });
});
