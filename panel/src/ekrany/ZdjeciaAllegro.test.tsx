import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { atrapaZapisow } from "../test/zapisy";
import { Zdjecia } from "./Zdjecia";
import type { ListaBezZdjecia, PozycjaBezZdjecia, PozycjaOferty, StanIndeksu } from "../api/zdjecia";

/* ── Zdjęcia kartotek z ofert Allegro ──────────────────────────────────────
   1. Otwarcie ekranu i okna to zero zapisów: pytanie Allegro idzie dopiero
      z „Sprawdź oferty”, bo kosztuje limit i zapisuje wybór oferty.
   2. Zbiórka towarów bez zdjęcia stronami po 200, pytanie paczkami po 100.
   3. Podsumowanie liczy cztery klasy; odznaczony towar nie idzie.
   4. Zdjęcie idzie z `zrodlo: "allegro"` i `plik: "oferta <id>"`.
   5. 429: przerwa i jedno ponowienie paczki; drugie 429 zatrzymuje ze zdaniem.
   6. Indeks naszych ofert: lista stronami, kody producenta aż „zostało 0”.
      Zatrzymany albo przerwany indeks pozwala dopasować z tym, co jest.
   7. Oferta po kodzie producenta liczy się osobno i ma znacznik; kod
      w kilku towarach to osobny wiersz, nie „bez oferty”.

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

/** Oferty, które serwer znalazł po kodzie producenta, i symbole z kodem w kilku towarach. */
let KODY: Record<string, PozycjaOferty["oferta"]>;
let NIEJEDNOZNACZNE: Set<string>;

type Odp = { status: number; cialo: unknown };
/** Kolejne odpowiedzi `dopasuj`, zanim zacznie oddawać dopasowanie; `null` = zwykła odpowiedź. */
let przerwy: Odp[];
let wylaczone: string | null;
/** Kolejne odpowiedzi kroków indeksu; pusta lista = jedna strona i nic do odczytu. Obietnica wstrzymuje krok. */
let strony: Array<Odp | Promise<Odp>>;
let kroki: Array<Odp | Promise<Odp>>;
const INDEKS: StanIndeksu = { ofert: 12, zKodem: 5, doPobrania: 7, listaAt: "2026-10-20T10:00:00Z" };

const strona = (url: string): ListaBezZdjecia | undefined => {
  if (!url.startsWith("/api/zdjecia/bez-zdjecia")) return undefined;
  const p = new URL(url, "http://x").searchParams;
  const limit = Number(p.get("limit")), offset = Number(p.get("offset"));
  return { wlaczone: true, razem: TOWARY.length, pozycje: TOWARY.slice(offset, offset + limit) };
};

const OK = { status: 200, cialo: { queueId: 1, etag: "e", bajtow: 900, wSubiekcie: true } };

function atrapa() {
  const stan = atrapaZapisow(
    (url) => strona(url) ?? (url === "/api/zdjecia/allegro/indeks" ? INDEKS : undefined)
      ?? (/^\/api\/zdjecia\/allegro\/oferta\/\d+\/zdjecie$/.test(url) ? { obraz: url } : undefined),
    (url) => (/^\/api\/products\/\d+\/zdjecie\/gotowe$/.test(url) ? OK : undefined));
  /* Odpowiedź `dopasuj` zależy od ciała, którego atrapa zapisów nie widzi —
     owijamy ją, a zapis dalej liczy się w `stan.wyslane`. */
  const pod = vi.mocked(fetch).getMockImplementation()!;
  const odpowiedz = (o: Odp) => new Response(JSON.stringify(o.cialo), { status: o.status });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const odp = await pod(url, init);
    if (url === "/api/zdjecia/allegro/indeks/lista") {
      const s = strony.shift();
      return s ? odpowiedz(await s) : odpowiedz({ status: 200, cialo: { ofert: 3, razem: 3, nastepny: null } });
    }
    if (url === "/api/zdjecia/allegro/indeks/parametry") {
      const k = kroki.shift();
      return k ? odpowiedz(await k) : odpowiedz({ status: 200, cialo: { pobrano: 0, zostalo: 0 } });
    }
    if (url !== "/api/zdjecia/allegro/dopasuj") return odp;
    const p = przerwy.shift();
    if (p) return odpowiedz(p);
    if (wylaczone) return new Response(JSON.stringify({ wlaczone: false, powod: wylaczone, pozycje: [] }));
    const { symbole } = JSON.parse(String(init!.body)) as { symbole: string[] };
    const pozycje: PozycjaOferty[] = symbole.map((s): PozycjaOferty =>
      OFERTY[s] ? { symbol: s, ofert: 1, oferta: OFERTY[s], po: "sygnatura" }
        : KODY[s] ? { symbol: s, ofert: 1, oferta: KODY[s], po: "kod_producenta" }
        : NIEJEDNOZNACZNE.has(s) ? { symbol: s, ofert: 0, oferta: null, po: null, niejednoznaczny: true }
        : { symbol: s, ofert: 0, oferta: null, po: null });
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
  strony = [];
  kroki = [];
  KODY = {};
  NIEJEDNOZNACZNE = new Set();
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
    expect(new Set(stan.wyslane)).toEqual(new Set(["POST /api/zdjecia/allegro/indeks/lista",
      "POST /api/zdjecia/allegro/indeks/parametry", "POST /api/zdjecia/allegro/dopasuj"]));
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
      ["T-1", "Towar 1", "Sekator ogrodowy (9001)", "sygnatura", "kolejka do Subiekta"],
      ["T-2", "Towar 2", "Nożyce do żywopłotu (9002)", "sygnatura", "kolejka do Subiekta"],
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
    await waitFor(() => expect(stan.wyslane).toEqual(["POST /api/zdjecia/allegro/indeks/lista",
      "POST /api/zdjecia/allegro/indeks/parametry", "POST /api/zdjecia/allegro/dopasuj"]));
  });
});

describe("Zdjęcia z ofert Allegro — kod producenta", () => {
  it("otwarcie okna czyta sam stan indeksu i nic nie zapisuje", async () => {
    const stan = atrapa();
    const { okno } = await otworzOkno();
    expect(await within(okno).findByText("Znamy 12 naszych ofert, kody producenta: 5, do odczytu: 7.")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([a]) => a === "/api/zdjecia/allegro/indeks")).toBe(true);
    expect(stan.wyslane).toEqual([]);
    expect(stan.nieznane).toEqual([]);
  });

  it("indeks: lista stronami, kody aż „zostało 0”, potem dopasowanie", async () => {
    strony = [{ status: 200, cialo: { ofert: 1000, razem: 1500, nastepny: 1000 } },
      { status: 200, cialo: { ofert: 500, razem: 1500, nastepny: null } }];
    kroki = [{ status: 200, cialo: { pobrano: 10, zostalo: 5 } }, { status: 200, cialo: { pobrano: 5, zostalo: 0 } }];
    const stan = atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    await within(okno).findByRole("button", { name: "Dodaj 2 zdjęcia" });
    expect(ciala("/api/zdjecia/allegro/indeks/lista")).toEqual([{ offset: 0 }, { offset: 1000 }]);
    expect(ciala("/api/zdjecia/allegro/indeks/parametry")).toEqual([{}, {}]);
    /* Kolejność: indeks cały przed pierwszym pytaniem o dopasowanie. */
    const pierwszeDopasuj = stan.wyslane.indexOf("POST /api/zdjecia/allegro/dopasuj");
    expect(stan.wyslane.lastIndexOf("POST /api/zdjecia/allegro/indeks/parametry")).toBeLessThan(pierwszeDopasuj);
  });

  it("„Zatrzymaj” w czytaniu kodów zostawia wybór: dopasuj z tym, co jest", async () => {
    let pusc!: (o: Odp) => void;
    kroki = [{ status: 200, cialo: { pobrano: 10, zostalo: 20 } }, new Promise<Odp>((r) => { pusc = r; })];
    const stan = atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    expect(await within(okno).findByText("Czytam kody producenta: pobrano 10, zostało 20…")).toBeInTheDocument();
    await u.click(within(okno).getByRole("button", { name: "Zatrzymaj" }));
    pusc({ status: 200, cialo: { pobrano: 10, zostalo: 10 } });
    expect(await within(okno).findByText(/Zatrzymano czytanie naszych ofert/)).toBeInTheDocument();
    expect(ciala("/api/zdjecia/allegro/indeks/parametry")).toHaveLength(2);
    expect(stan.wyslane).not.toContain("POST /api/zdjecia/allegro/dopasuj");

    await u.click(within(okno).getByRole("button", { name: "Dopasuj z tym, co jest" }));
    await within(okno).findByRole("button", { name: "Dodaj 2 zdjęcia" });
    expect(ciala("/api/zdjecia/allegro/indeks/parametry")).toHaveLength(2);
  });

  it("oferta po kodzie producenta liczy się osobno, ma znacznik i kolumnę w wyniku", async () => {
    KODY = { "T-7": { id: "9007", nazwa: "Kosz na liście", status: "ACTIVE", startedAt: null, zdjecie: true } };
    atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    await within(okno).findByRole("button", { name: "Dodaj 3 zdjęcia" });
    expect(liczba(okno, "Oferta ze zdjęciem — do dodania")).toBe("3");
    expect(within(okno).getByText("po sygnaturze 2 · po kodzie producenta 1")).toBeInTheDocument();
    const wiersz = within(okno).getByRole("checkbox", { name: "Dodaj zdjęcie do T-7" }).closest("label")!;
    expect(within(wiersz).getByText("kod producenta")).toBeInTheDocument();
    const t1 = within(okno).getByRole("checkbox", { name: "Dodaj zdjęcie do T-1" }).closest("label")!;
    expect(within(t1).queryByText("kod producenta")).not.toBeInTheDocument();

    await u.click(within(okno).getByRole("button", { name: "Dodaj 3 zdjęcia" }));
    await within(okno).findByText(/Dodano 3, pominięto 0, błędy 0\./);
    const wiersze = within(okno).getAllByRole("row").slice(1)
      .map((w) => within(w).getAllByRole("cell").map((c) => c.textContent));
    expect(wiersze[2]).toEqual(["T-7", "Towar 7", "Kosz na liście (9007)", "kod producenta", "kolejka do Subiekta"]);
    expect(within(okno).getByRole("columnheader", { name: "Dopasowanie" })).toBeInTheDocument();
  });

  it("kod producenta w kilku towarach to osobny wiersz, nie „bez oferty”", async () => {
    NIEJEDNOZNACZNE = new Set(["T-8", "T-9"]);
    atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    await within(okno).findByRole("button", { name: "Dodaj 2 zdjęcia" });
    expect(liczba(okno, "Kod producenta w kilku towarach — dodaj ręcznie")).toBe("2");
    expect(liczba(okno, "Bez oferty Allegro")).toBe("199");
    expect(within(okno).getByText("T-8 — Towar 8")).toBeInTheDocument();
  });

  it("429 w czytaniu kodów: przerwa i jedno ponowienie kroku", async () => {
    kroki = [{ status: 429, cialo: { error: "Limit Allegro", poIluMs: 400 } }, { status: 200, cialo: { pobrano: 3, zostalo: 0 } }];
    atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    expect(await within(okno).findByText(/Allegro prosi o przerwę\. Pytam znowu za \d s\./)).toBeInTheDocument();
    await within(okno).findByRole("button", { name: "Dodaj 2 zdjęcia" }, { timeout: 3000 });
    expect(ciala("/api/zdjecia/allegro/indeks/parametry")).toHaveLength(2);
  });

  it("drugie 429 w czytaniu kodów zatrzymuje indeks ze zdaniem, a dopasowanie dalej jest możliwe", async () => {
    const limit = { status: 429, cialo: { error: "Limit Allegro", poIluMs: 10 } };
    kroki = [limit, limit];
    const stan = atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    expect(await within(okno).findByText(/Allegro dalej prosi o przerwę przy czytaniu naszych ofert/)).toBeInTheDocument();
    expect(ciala("/api/zdjecia/allegro/indeks/parametry")).toHaveLength(2);
    expect(stan.wyslane).not.toContain("POST /api/zdjecia/allegro/dopasuj");
    await u.click(within(okno).getByRole("button", { name: "Dopasuj z tym, co jest" }));
    await within(okno).findByRole("button", { name: "Dodaj 2 zdjęcia" });
  });

  it("krok kodów bez postępu nie kręci się w miejscu", async () => {
    kroki = [{ status: 200, cialo: { pobrano: 0, zostalo: 4 } }];
    atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź oferty" }));
    await within(okno).findByRole("button", { name: "Dodaj 2 zdjęcia" });
    expect(ciala("/api/zdjecia/allegro/indeks/parametry")).toHaveLength(1);
    expect(within(okno).getByText(/Kodów producenta z 4 ofert nie udało się teraz odczytać/)).toBeInTheDocument();
  });
});
