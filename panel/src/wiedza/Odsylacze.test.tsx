import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ImportOdsylaczy, RaportImportuOdsylaczy } from "../api/typy";
import { Odsylacze } from "./Odsylacze";

/* ── Import odsyłaczy od dostawców ───────────────────────────────────────────
   Po prawdziwym `fetch`: samo otwarcie to wyłącznie odczyt historii, a zapis
   niesie mapowanie, które człowiek widzi na ekranie — nie to, które serwer
   kiedyś zgadł. Zapis czeka na nazwę dostawcy, bo po niej nowy plik
   zastępuje stary.                                                         */

type Zadanie = { dostawca: string; plik: string | null; mapowanie: unknown; zastosuj: boolean; tresc: { csv?: string } };

const RAPORT = (n: Partial<RaportImportuOdsylaczy> = {}): RaportImportuOdsylaczy => ({
  naglowki: ["Indeks", "Nazwa", "EAN", "Numery OEM"],
  probka: [["W80-2005", "Worek WD3", "", "6.904-143.0"]],
  mapowanie: { symbol: 0, ean: 2, numery: [3], rodzaj: "oem" }, zgadniete: true,
  wierszy: 5, dopasowanych: 3, kartotek: 3,
  bezKartoteki: { liczba: 1, przyklady: ["XX-NIEMA"] }, niejednoznaczne: { liczba: 0, przyklady: [] },
  bezNumerow: 1, numerow: { nowych: 3, znanych: 1 }, zastapi: 0, noweKandydaty: 1,
  przyklady: [{ symbol: "W80-2005", nazwa: "Worek WD3", numery: ["6.904-143.0"] }], zapisano: null, ...n,
});
const AKTYWNY: ImportOdsylaczy = { id: 7, dostawca: "Kramp", plik: "kramp.csv", wierszy: 120, dopasowanych: 80, numerow: 214,
  stan: "aktywny", zaimportowal: "A. Lewandowska", at: "2026-09-23T10:00:00Z", wycofal: null, wycofanoAt: null };

let wyslane: Array<{ url: string; body: Zadanie | null }> = [];
let odczyty: string[] = [];
let historia: ImportOdsylaczy[] = [];

beforeEach(() => {
  wyslane = []; odczyty = []; historia = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    const odp = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (metoda === "GET") {
      odczyty.push(url);
      if (url === "/api/obsluga/wiedza/odsylacze") return odp(historia);
      throw new Error(`nieoczekiwany odczyt: ${url}`);
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Zadanie : null;
    wyslane.push({ url, body });
    if (url === "/api/obsluga/wiedza/odsylacze") {
      if (body!.zastosuj) return odp(RAPORT({ zgadniete: false, zapisano: { importId: 8, numerow: 3 } }));
      return odp(body!.mapowanie ? RAPORT({ mapowanie: body!.mapowanie as RaportImportuOdsylaczy["mapowanie"], zgadniete: false })
        : RAPORT());
    }
    if (url === "/api/obsluga/wiedza/odsylacze/7/wycofaj") return odp({ ...AKTYWNY, stan: "wycofany" });
    throw new Error(`nieoczekiwany zapis: ${metoda} ${url}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const pokaz = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Odsylacze />
  </QueryClientProvider>);

const CSV = "Indeks;Nazwa;EAN;Numery OEM\nW80-2005;Worek WD3;;6.904-143.0\n";
const wgraj = async (u: ReturnType<typeof userEvent.setup>) =>
  u.upload(screen.getByLabelText("Plik odsyłaczy"), new File([CSV], "kramp.csv", { type: "text/csv" }));

describe("Odsyłacze od dostawców", () => {
  it("otwarcie to wyłącznie odczyt historii — zero zapisu przy patrzeniu", async () => {
    pokaz();
    await waitFor(() => expect(odczyty).toEqual(["/api/obsluga/wiedza/odsylacze"]));
    expect(wyslane).toEqual([]);
  });

  it("wgrany plik daje podgląd ze zgadniętymi kolumnami i tym, co zrobi z kolejką zamienności", async () => {
    const u = userEvent.setup();
    pokaz();
    await wgraj(u);
    expect(await screen.findByText(/zgadnięte z nagłówków, sprawdź przed zapisem/)).toBeInTheDocument();
    expect(wyslane).toHaveLength(1);
    expect(wyslane[0].body).toMatchObject({ plik: "kramp.csv", mapowanie: null, zastosuj: false, tresc: { csv: CSV } });
    expect(screen.getByRole("combobox", { name: "Kolumna z naszym symbolem" })).toHaveValue("0");
    expect(screen.getByRole("checkbox", { name: "Numery OEM" })).toBeChecked();
    const wynik = screen.getByLabelText("Wynik podglądu");
    expect(wynik).toHaveTextContent("3 z 5 wierszy trafia w kartotekę");
    expect(wynik).toHaveTextContent("Kolejka „Wspólny numer oryginału”: +1 para do decyzji");
    expect(wynik).toHaveTextContent("Bez kartoteki: 1 — XX-NIEMA");
  });

  it("zapis czeka na dostawcę i niesie mapowanie widoczne na ekranie", async () => {
    const u = userEvent.setup();
    pokaz();
    await wgraj(u);
    const zapisz = await screen.findByRole("button", { name: "Zapisz 3 numery" });
    expect(zapisz).toBeDisabled();
    await u.type(screen.getByRole("textbox", { name: "Dostawca" }), "Kramp");
    await waitFor(() => expect(zapisz).toBeEnabled());
    await u.click(zapisz);
    const zapis = wyslane.find((w) => w.body?.zastosuj);
    expect(zapis?.body).toMatchObject({ dostawca: "Kramp", mapowanie: { symbol: 0, ean: 2, numery: [3], rodzaj: "oem" } });
    expect(await screen.findByText(/Zapisano 3 numery od dostawcy Kramp\. W kolejce „Wspólny numer oryginału” przybyło 1 parę/))
      .toBeInTheDocument();
  });

  it("zmiana kolumny liczy podgląd od nowa; bez kolumny numerów nie ma czego zapisać", async () => {
    const u = userEvent.setup();
    pokaz();
    await wgraj(u);
    await u.type(screen.getByRole("textbox", { name: "Dostawca" }), "Kramp");
    const numery = await screen.findByRole("checkbox", { name: "Numery OEM" });
    await u.click(numery);
    expect(wyslane.at(-1)?.body).toMatchObject({ mapowanie: { numery: [] }, zastosuj: false });
    expect(screen.queryByLabelText("Wynik podglądu")).toBeNull();
    expect(screen.getByRole("button", { name: /Zapisz/ })).toBeDisabled();
  });

  it("aktywny import cofa się w całości — po potwierdzeniu", async () => {
    historia = [AKTYWNY, { ...AKTYWNY, id: 6, stan: "zastapiony" }];
    const u = userEvent.setup();
    pokaz();
    const tabela = await screen.findByRole("table");
    expect(within(tabela).getByText("zastąpiony nowszym")).toBeInTheDocument();
    expect(within(tabela).getAllByRole("button", { name: "Wycofaj" })).toHaveLength(1);
    await u.click(within(tabela).getByRole("button", { name: "Wycofaj" }));
    await u.click(screen.getByRole("button", { name: "Wycofaj import" }));
    await waitFor(() => expect(wyslane.map((w) => w.url)).toEqual(["/api/obsluga/wiedza/odsylacze/7/wycofaj"]));
  });
});
