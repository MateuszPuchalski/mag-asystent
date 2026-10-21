import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { atrapaZapisow } from "../test/zapisy";
import { Zdjecia } from "./Zdjecia";
import type { ListaBezZdjecia, PozycjaBezZdjecia, PozycjaOferty } from "../api/zdjecia";

/* ── Zdjęcia kartotek z ofert Allegro ──────────────────────────────────────
   1. Otwarcie ekranu i okna to zero zapisów: pytanie Allegro idzie dopiero
      z „Sprawdź oferty”, bo kosztuje limit i zapisuje wybór oferty.
   2. Zbiórka towarów bez zdjęcia stronami po 200, pytanie paczkami po 100.
   3. Podsumowanie liczy cztery klasy; odznaczony towar nie idzie.
   4. Zdjęcie idzie z `zrodlo: "allegro"` i `plik: "oferta <id>"`.
   5. 429: przerwa i jedno ponowienie paczki; drugie 429 zatrzymuje ze zdaniem.

   Płótno podmieniamy jak w `ZdjeciaImport.test.tsx`. */
const m = vi.hoisted(() => ({ maly: false }));
vi.mock("../zdjecia/obraz", () => ({
  wczytajPlik: vi.fn(async () => (m.maly ? { kanwa: {}, szer: 200, wys: 150 } : { kanwa: {}, szer: 1200, wys: 900 })),
  podgladEdycji: vi.fn(() => ({ adres: "data:image/jpeg;base64,RURZQ0pB", szer: 100, wys: 80 })),
  doWyslania: vi.fn(async () => ({ base64: "V1lTTEFOWQ==", adres: "data:image/jpeg;base64,V1lTTEFOWQ==" })),
  pngZrodla: vi.fn(() => "UE5H"),
  zlozGotowy: vi.fn(async () => ({ base64: "R09UT1dZ", adres: "data:image/jpeg;base64,R09UT1dZ", bok: 800 })),
}));

const towar = (i: number, z: Partial<PozycjaBezZdjecia> = {}): PozycjaBezZdjecia =>
  ({ twId: i, symbol: `T-${i}`, nazwa: `Towar ${i}`, ean: null, stan: 1, sprzedaz: 0, oczekuje: false, ...z });

/* 205 towarów: zbiórka potrzebuje dwóch stron, a 204 pytane symbole — trzech paczek. */
let TOWARY: PozycjaBezZdjecia[];
const OFERTY: Record<string, PozycjaOferty["oferta"]> = {
  "T-1": { id: "9001", nazwa: "Sekator ogrodowy", status: "ACTIVE", startedAt: null, zdjecie: true },
  "T-2": { id: "9002", nazwa: "Nożyce do żywopłotu", status: "ENDED", startedAt: null, zdjecie: true },
  "T-3": { id: "9003", nazwa: "Grabie", status: "ACTIVE", startedAt: null, zdjecie: false },
};

/** Kolejne odpowiedzi `dopasuj`, zanim zacznie oddawać dopasowanie; `null` = zwykła odpowiedź. */
let przerwy: Array<{ status: number; cialo: unknown }>;
let wylaczone: string | null;

const strona = (url: string): ListaBezZdjecia | undefined => {
  if (!url.startsWith("/api/zdjecia/bez-zdjecia")) return undefined;
  const p = new URL(url, "http://x").searchParams;
  const limit = Number(p.get("limit")), offset = Number(p.get("offset"));
  return { wlaczone: true, razem: TOWARY.length, pozycje: TOWARY.slice(offset, offset + limit) };
};

const OK = { status: 200, cialo: { queueId: 1, etag: "e", bajtow: 900, wSubiekcie: true } };

function atrapa() {
  const stan = atrapaZapisow(
    (url) => strona(url) ?? (/^\/api\/zdjecia\/allegro\/oferta\/\d+\/zdjecie$/.test(url) ? { obraz: url } : undefined),
    (url) => (/^\/api\/products\/\d+\/zdjecie\/gotowe$/.test(url) ? OK : undefined));
  /* Odpowiedź `dopasuj` zależy od ciała, którego atrapa zapisów nie widzi —
     owijamy ją, a zapis dalej liczy się w `stan.wyslane`. */
  const pod = vi.mocked(fetch).getMockImplementation()!;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const odp = await pod(url, init);
    if (url !== "/api/zdjecia/allegro/dopasuj") return odp;
    const p = przerwy.shift();
    if (p) return new Response(JSON.stringify(p.cialo), { status: p.status });
    if (wylaczone) return new Response(JSON.stringify({ wlaczone: false, powod: wylaczone, pozycje: [] }));
    const { symbole } = JSON.parse(String(init!.body)) as { symbole: string[] };
    const pozycje: PozycjaOferty[] = symbole.map((s) => ({ symbol: s, ofert: OFERTY[s] ? 1 : 0, oferta: OFERTY[s] ?? null }));
    return new Response(JSON.stringify({ wlaczone: true, pozycje }));
  }));
  return stan;
}

const ciala = (url: string) => vi.mocked(fetch).mock.calls
  .filter(([u, i]) => u === url && i?.method === "POST").map(([, i]) => JSON.parse(String(i!.body)));

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><Zdjecia /></MemoryRouter></QueryClientProvider>);
}

async function otworzOkno() {
  const u = userEvent.setup();
  pokaz();
  await screen.findByRole("heading", { name: "Towar 0" });
  await u.click(screen.getByRole("button", { name: "Z ofert Allegro" }));
  return { u, okno: screen.getByRole("dialog", { name: "Zdjęcia z ofert Allegro" }) };
}

const liczba = (okno: HTMLElement, etykieta: string) =>
  within(okno).getByText(etykieta).closest("li")!.querySelector(".tabular-nums")!.textContent;

beforeEach(() => {
  m.maly = false;
  /* Ostatni towar ma zdjęcie w kolejce: leży na drugiej stronie zbiórki. */
  TOWARY = Array.from({ length: 205 }, (_, i) => towar(i));
  TOWARY[204] = towar(204, { oczekuje: true });
  przerwy = [];
  wylaczone = null;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Zdjęcia z ofert Allegro", () => {
  it("otwarcie ekranu i okna nie wysyła żadnego zapisu ani pytania do Allegro", async () => {
    const stan = atrapa();
    const { okno } = await otworzOkno();
    expect(within(okno).getByRole("button", { name: "Sprawdź oferty" })).toBeInTheDocument();
    expect(stan.wyslane).toEqual([]);
    expect(stan.nieznane).toEqual([]);
    /* Otwarcie okna nie zbiera nawet listy: lista ekranu to jedno pytanie o pierwszą stronę. */
    expect(vi.mocked(fetch).mock.calls.filter(([a]) => String(a).includes("limit=200"))).toHaveLength(0);
  });

  it("sprawdzenie zbiera wszystkie strony, pyta paczkami po 100 i liczy cztery klasy", async () => {
    const stan = atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    await within(okno).findByRole("button", { name: "Dodaj 2 zdjęcia" });

    const zbiorka = vi.mocked(fetch).mock.calls.map(([a]) => String(a)).filter((a) => a.includes("limit=200"));
    expect(zbiorka).toHaveLength(2);
    expect(zbiorka[1]).toContain("offset=200");
    const paczki = ciala("/api/zdjecia/allegro/dopasuj").map((c: { symbole: string[] }) => c.symbole.length);
    expect(paczki).toEqual([100, 100, 4]);
    /* Towar z kolejką nie idzie do Allegro. */
    expect(ciala("/api/zdjecia/allegro/dopasuj").flatMap((c: { symbole: string[] }) => c.symbole)).not.toContain("T-204");

    expect(liczba(okno, "Oferta ze zdjęciem — do dodania")).toBe("2");
    expect(liczba(okno, "Oferta bez zdjęcia")).toBe("1");
    expect(liczba(okno, "Bez oferty Allegro")).toBe("201");
    expect(liczba(okno, "Zdjęcie już czeka w kolejce")).toBe("1");
    expect(within(okno).getByText("T-3 — Towar 3")).toBeInTheDocument();
    expect(within(okno).getByText("T-204 — Towar 204")).toBeInTheDocument();
    /* Podgląd: wiersz na towar, zaznaczony domyślnie, z nazwą oferty. */
    expect(within(okno).getByRole("checkbox", { name: "Dodaj zdjęcie do T-1" })).toBeChecked();
    expect(within(okno).getByText("Oferta: Nożyce do żywopłotu")).toBeInTheDocument();
    expect(stan.wyslane.every((w) => w === "POST /api/zdjecia/allegro/dopasuj")).toBe(true);
    expect(stan.nieznane).toEqual([]);
  });

  it("import wysyła gotowe z `zrodlo: allegro`, pomija odznaczone i pokazuje tabelę do arkusza", async () => {
    m.maly = true;
    OFERTY["T-5"] = { id: "9005", nazwa: "Łopata", status: "ACTIVE", startedAt: null, zdjecie: true };
    const stan = atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    await within(okno).findByRole("button", { name: "Dodaj 3 zdjęcia" });
    await u.click(within(okno).getByRole("checkbox", { name: "Dodaj zdjęcie do T-5" }));
    await u.click(within(okno).getByRole("button", { name: "Dodaj 2 zdjęcia" }));

    expect(await within(okno).findByText(/Dodano 2, pominięto 0, błędy 0\./)).toBeInTheDocument();
    expect(ciala("/api/products/1/zdjecie/gotowe")).toEqual([{ gotowy: "R09UT1dZ", zrodlo: "allegro", plik: "oferta 9001" }]);
    expect(ciala("/api/products/2/zdjecie/gotowe")).toEqual([{ gotowy: "R09UT1dZ", zrodlo: "allegro", plik: "oferta 9002" }]);
    expect(ciala("/api/products/5/zdjecie/gotowe")).toEqual([]);
    const pobrane = vi.mocked(fetch).mock.calls.map(([a]) => String(a)).filter((a) => a.startsWith("/api/zdjecia/allegro/oferta/"));
    expect(pobrane.sort()).toEqual(["/api/zdjecia/allegro/oferta/9001/zdjecie", "/api/zdjecia/allegro/oferta/9002/zdjecie"]);

    const wiersze = within(okno).getAllByRole("row").slice(1)
      .map((w) => within(w).getAllByRole("cell").map((c) => c.textContent));
    expect(wiersze).toEqual([
      ["T-1", "Towar 1", "Sekator ogrodowy (9001)", "kolejka do Subiekta"],
      ["T-2", "Towar 2", "Nożyce do żywopłotu (9002)", "kolejka do Subiekta"],
    ]);
    expect(within(okno).getByRole("button", { name: "Kopiuj listę do arkusza" })).toBeInTheDocument();
    expect(within(okno).getByText(/2 zdjęcia ma poniżej 300 px/)).toBeInTheDocument();
    expect(stan.nieznane).toEqual([]);
    delete OFERTY["T-5"];
  });

  it("429 czeka, ile prosi Allegro, i ponawia tę samą paczkę raz", async () => {
    przerwy = [{ status: 429, cialo: { error: "Limit Allegro", poIluMs: 400 } }];
    atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    expect(await within(okno).findByText(/Allegro prosi o przerwę\. Pytam znowu za \d s\./)).toBeInTheDocument();
    await within(okno).findByRole("button", { name: "Dodaj 2 zdjęcia" }, { timeout: 3000 });
    const paczki = ciala("/api/zdjecia/allegro/dopasuj").map((c: { symbole: string[] }) => c.symbole);
    expect(paczki).toHaveLength(4);
    expect(paczki[1]).toEqual(paczki[0]);
    expect(within(okno).queryByText(/dalej prosi o przerwę/)).not.toBeInTheDocument();
  });

  it("drugie 429 z rzędu zatrzymuje pytanie ze zdaniem, a sprawdzone zostają", async () => {
    const limit = { status: 429, cialo: { error: "Limit Allegro", poIluMs: 10 } };
    przerwy = [limit, limit];
    atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    expect(await within(okno).findByText(/Allegro dalej prosi o przerwę/)).toBeInTheDocument();
    expect(ciala("/api/zdjecia/allegro/dopasuj")).toHaveLength(2);
    expect(within(okno).getByText(/Sprawdzono 0 z 204 towary/)).toBeInTheDocument();
    expect(within(okno).getByRole("button", { name: "Nie ma czego dodać" })).toBeDisabled();
  });

  it("„Zatrzymaj” w czasie przerwy kończy sprawdzanie bez dalszych pytań", async () => {
    przerwy = [{ status: 429, cialo: { error: "Limit Allegro", poIluMs: 60_000 } }];
    atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    await within(okno).findByText(/Allegro prosi o przerwę/);
    await u.click(within(okno).getByRole("button", { name: "Zatrzymaj" }));
    expect(await within(okno).findByText(/Sprawdzono 0 z 204 towary/)).toBeInTheDocument();
    expect(ciala("/api/zdjecia/allegro/dopasuj")).toHaveLength(1);
  });

  it("wyłączona funkcja: zdanie z serwera zamiast podsumowania", async () => {
    wylaczone = "Konto Allegro nie jest połączone.";
    const stan = atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    expect(await within(okno).findByText("Konto Allegro nie jest połączone.")).toBeInTheDocument();
    expect(within(okno).queryByRole("button", { name: /^Dodaj/ })).not.toBeInTheDocument();
    await waitFor(() => expect(stan.wyslane).toEqual(["POST /api/zdjecia/allegro/dopasuj"]));
  });
});
