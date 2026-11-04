import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { atrapaZapisow } from "../test/zapisy";
import { Zdjecia } from "./Zdjecia";
import type { PozycjaOferty, PozycjaZeZdjeciem } from "../api/zdjecia";
import type { Ocena } from "../zdjecia/ostrosc";

/* ── Niewyraźne zdjęcia kartotek zastąpione zdjęciami z Allegro ────────────
   1. Otwarcie ekranu i okna to zero zapisów: indeks, dopasowanie i pomiar
      ruszają dopiero z „Sprawdź zdjęcia”.
   2. Zbiórka towarów ze zdjęciem stronami po 200, dopasowanie paczkami po 100.
      Zostają towary z ofertą ze zdjęciem, bez kolejki i bez niejednoznacznych.
   3. Pomiar: lista od najgorszych, licznik, próg i domyślne zaznaczenie.
   4. Zamiana wysyła `zamien: true` i `zrodlo: "allegro"`; oferta, która nie
      jest lepsza, idzie do pominiętych bez zapisu.
   5. Zatrzymanie pomiaru zostawia zmierzone i pozwala dokończyć.

   Płótno podmieniamy: `wczytajPlik` czyta adres z ciała odpowiedzi atrapy,
   a `ocenZdjecie` oddaje ocenę zapisaną dla tego adresu. Sam rachunek
   ostrości ma testy w `zdjecia/ostrosc.test.ts`. */
const m = vi.hoisted(() => ({ oceny: {} as Record<string, Ocena> }));
vi.mock("../zdjecia/obraz", () => ({
  wczytajPlik: vi.fn(async (b: Blob) => {
    const { obraz } = JSON.parse(await b.text()) as { obraz: string };
    return { kanwa: { obraz }, szer: 100, wys: 100 };
  }),
  ocenZdjecie: vi.fn((z: { kanwa: { obraz: string } }) => {
    const o = m.oceny[z.kanwa.obraz];
    if (!o) throw new Error(`brak oceny dla ${z.kanwa.obraz}`);
    return o;
  }),
  podgladEdycji: vi.fn(() => ({ adres: "data:image/jpeg;base64,RURZQ0pB", szer: 100, wys: 80 })),
  doWyslania: vi.fn(async () => ({ base64: "V1lTTEFOWQ==", adres: "data:image/jpeg;base64,V1lTTEFOWQ==" })),
  pngZrodla: vi.fn(() => "UE5H"),
  zlozGotowy: vi.fn(async () => ({ base64: "R09UT1dZ", adres: "data:image/jpeg;base64,R09UT1dZ", bok: 800 })),
}));

const towar = (i: number, z: Partial<PozycjaZeZdjeciem> = {}): PozycjaZeZdjeciem =>
  ({ twId: i, symbol: `T-${i}`, nazwa: `Towar ${i}`, bajtow: 40_000, oczekuje: false, ...z });

/* 205 towarów: zbiórka potrzebuje dwóch stron. T-5 czeka w kolejce, T-6 ma kod w kilku towarach. */
let TOWARY: PozycjaZeZdjeciem[];
let OFERTY: Record<string, NonNullable<PozycjaOferty["oferta"]>>;
let NIEJEDNOZNACZNE: Set<string>;
/** Symbole, których ofertę serwer znalazł po kodzie producenta, nie po sygnaturze. */
let KODY: Set<string>;
/** Pobrania zdjęć z Subiekta, które czekają na ręczne puszczenie. */
let wstrzymane: Map<string, Promise<void>>;

const oferta = (id: string, nazwa: string, zdjecie = true) =>
  ({ id, nazwa, status: "ACTIVE", startedAt: null, zdjecie });

const zdjecieTowaru = (twId: number) => `/api/products/${twId}/zdjecie`;
const zdjecieOferty = (id: string) => `/api/zdjecia/allegro/oferta/${id}/zdjecie`;

const OK = { status: 200, cialo: { queueId: 1, etag: "e", bajtow: 900, wSubiekcie: true } };

function atrapa() {
  const stan = atrapaZapisow((url) => {
    if (url.startsWith("/api/zdjecia/bez-zdjecia")) {
      return { wlaczone: true, razem: 1, pozycje: [{ twId: 900, symbol: "B-1", nazwa: "Bez zdjęcia", ean: null,
        stan: 1, sprzedaz: 0, oczekuje: false }] };
    }
    if (url.startsWith("/api/zdjecia/ze-zdjeciem")) {
      const p = new URL(url, "http://x").searchParams;
      const limit = Number(p.get("limit")), offset = Number(p.get("offset"));
      return { wlaczone: true, razem: TOWARY.length, pozycje: TOWARY.slice(offset, offset + limit) };
    }
    if (url === "/api/zdjecia/allegro/indeks") return { ofert: 12, zKodem: 5, doPobrania: 0, listaAt: null };
    if (/^\/api\/products\/\d+\/zdjecie$/.test(url) || /^\/api\/zdjecia\/allegro\/oferta\/\d+\/zdjecie$/.test(url)) {
      return { obraz: url };
    }
    return undefined;
  }, (url) => (/^\/api\/products\/\d+\/zdjecie\/gotowe$/.test(url) ? OK : undefined));
  const pod = vi.mocked(fetch).getMockImplementation()!;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const odp = await pod(url, init);
    const czekaj = wstrzymane.get(url);
    if (czekaj) await czekaj;
    if (url === "/api/zdjecia/allegro/indeks/lista") {
      return new Response(JSON.stringify({ ofert: 3, razem: 3, nastepny: null }));
    }
    if (url === "/api/zdjecia/allegro/indeks/parametry") return new Response(JSON.stringify({ pobrano: 0, zostalo: 0 }));
    if (url !== "/api/zdjecia/allegro/dopasuj") return odp;
    const { symbole } = JSON.parse(String(init!.body)) as { symbole: string[] };
    const pozycje: PozycjaOferty[] = symbole.map((s): PozycjaOferty =>
      OFERTY[s] ? { symbol: s, ofert: 1, oferta: OFERTY[s], po: KODY.has(s) ? "kod_producenta" : "sygnatura" }
        : NIEJEDNOZNACZNE.has(s) ? { symbol: s, ofert: 0, oferta: null, po: null, niejednoznaczny: true }
        : { symbol: s, ofert: 0, oferta: null, po: null });
    return new Response(JSON.stringify({ wlaczone: true, pozycje }));
  }));
  return stan;
}

const ciala = (url: string) => vi.mocked(fetch).mock.calls
  .filter(([u, i]) => u === url && i?.method === "POST").map(([, i]) => JSON.parse(String(i!.body)));
const pobrane = (wzor: RegExp) => vi.mocked(fetch).mock.calls.map(([a]) => String(a)).filter((a) => wzor.test(a));

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><Zdjecia /></MemoryRouter></QueryClientProvider>);
}

async function otworzOkno() {
  const u = userEvent.setup();
  pokaz();
  await screen.findByRole("heading", { name: "Bez zdjęcia" });
  await u.click(screen.getByRole("button", { name: "Popraw niewyraźne" }));
  return { u, okno: screen.getByRole("dialog", { name: "Niewyraźne zdjęcia z ofert Allegro" }) };
}

/** Okno po sprawdzeniu i pomiarze; czeka na przycisk zamiany. */
async function sprawdzone(przycisk: string) {
  const o = await otworzOkno();
  await o.u.click(within(o.okno).getByRole("button", { name: "Sprawdź zdjęcia" }));
  await within(o.okno).findByRole("button", { name: przycisk });
  return o;
}

const symboleListy = (okno: HTMLElement) =>
  within(okno).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label")!.replace("Zamień zdjęcie ", ""));

beforeEach(() => {
  TOWARY = Array.from({ length: 205 }, (_, i) => towar(i));
  TOWARY[5] = towar(5, { oczekuje: true });
  OFERTY = {
    "T-1": oferta("9001", "Sekator ogrodowy"),
    "T-2": oferta("9002", "Nożyce do żywopłotu"),
    "T-3": oferta("9003", "Grabie"),
    "T-4": oferta("9004", "Łopata", false),
    "T-5": oferta("9005", "Konewka"),
    "T-203": oferta("9203", "Taczka"),
  };
  NIEJEDNOZNACZNE = new Set(["T-6"]);
  wstrzymane = new Map();
  KODY = new Set();
  m.oceny = {
    /* Zdjęcia w Subiekcie: T-1 za małe, T-2 rozmyte, T-3 dobre, T-203 bez miary ostrości. */
    [zdjecieTowaru(1)]: { bok: 300, ostrosc: 500 },
    [zdjecieTowaru(2)]: { bok: 800, ostrosc: 40 },
    [zdjecieTowaru(3)]: { bok: 800, ostrosc: 900 },
    [zdjecieTowaru(203)]: { bok: 800, ostrosc: null },
    /* Zdjęcia ofert: 9001 i 9003 lepsze, 9002 jeszcze bardziej rozmyte. */
    [zdjecieOferty("9001")]: { bok: 1200, ostrosc: 600 },
    [zdjecieOferty("9002")]: { bok: 800, ostrosc: 30 },
    [zdjecieOferty("9003")]: { bok: 800, ostrosc: 1500 },
    [zdjecieOferty("9203")]: { bok: 800, ostrosc: 200 },
  };
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Niewyraźne zdjęcia z ofert Allegro", () => {
  it("otwarcie ekranu i okna nie wysyła żadnego zapisu ani nie zbiera towarów", async () => {
    const stan = atrapa();
    const { okno } = await otworzOkno();
    expect(within(okno).getByRole("button", { name: "Sprawdź zdjęcia" })).toBeInTheDocument();
    expect(await within(okno).findByText("Znamy 12 naszych ofert.")).toBeInTheDocument();
    expect(stan.wyslane).toEqual([]);
    expect(stan.nieznane).toEqual([]);
    expect(pobrane(/ze-zdjeciem/)).toHaveLength(0);
    expect(pobrane(/^\/api\/products\/\d+\/zdjecie$/)).toHaveLength(0);
  });

  it("sprawdzenie zbiera strony, dopasowuje paczkami i mierzy tylko towary z ofertą ze zdjęciem", async () => {
    const stan = atrapa();
    const { okno } = await sprawdzone("Zamień 2 zdjęcia");

    const zbiorka = pobrane(/ze-zdjeciem/);
    expect(zbiorka).toHaveLength(2);
    expect(zbiorka[1]).toContain("offset=200");
    const paczki = ciala("/api/zdjecia/allegro/dopasuj").map((c: { symbole: string[] }) => c.symbole);
    expect(paczki.map((p) => p.length)).toEqual([100, 100, 4]);
    expect(paczki.flat()).not.toContain("T-5");
    /* Mierzymy wyłącznie kartoteki, których oferta ma zdjęcie. */
    expect(pobrane(/^\/api\/products\/\d+\/zdjecie$/).sort())
      .toEqual([1, 2, 203, 3].map(zdjecieTowaru));
    expect(within(okno).getByText("T-6 — Towar 6")).toBeInTheDocument();
    expect(within(okno).getByText("T-4 — Towar 4")).toBeInTheDocument();
    expect(within(okno).getByText("T-5 — Towar 5")).toBeInTheDocument();
    expect(new Set(stan.wyslane)).toEqual(new Set(["POST /api/zdjecia/allegro/indeks/lista",
      "POST /api/zdjecia/allegro/indeks/parametry", "POST /api/zdjecia/allegro/dopasuj"]));
    expect(stan.nieznane).toEqual([]);
  });

  it("lista stoi od najgorszych, liczy niewyraźne i zaznacza tylko te pod progiem", async () => {
    atrapa();
    const { u, okno } = await sprawdzone("Zamień 2 zdjęcia");
    expect(symboleListy(okno)).toEqual(["T-2", "T-1", "T-3", "T-203"]);
    expect(within(okno).getByText(/Niewyraźnych: 2 z 4 zmierzonych/)).toBeInTheDocument();
    expect(within(okno).getByText("bok 800 px · ostrość 40")).toBeInTheDocument();
    expect(within(okno).getByText("bok 800 px · ostrość nie da się ocenić")).toBeInTheDocument();
    expect(within(okno).getByRole("checkbox", { name: "Zamień zdjęcie T-2" })).toBeChecked();
    expect(within(okno).getByRole("checkbox", { name: "Zamień zdjęcie T-1" })).toBeChecked();
    expect(within(okno).getByRole("checkbox", { name: "Zamień zdjęcie T-3" })).not.toBeChecked();
    expect(within(okno).getByRole("checkbox", { name: "Zamień zdjęcie T-203" })).not.toBeChecked();

    /* Wyższy próg ostrości obejmuje T-3; brak miary dalej nie jest niską ostrością. */
    const prog = within(okno).getByRole("spinbutton", { name: "Próg ostrości" });
    await u.clear(prog);
    await u.type(prog, "1000");
    expect(within(okno).getByText(/Niewyraźnych: 3 z 4 zmierzonych/)).toBeInTheDocument();
    expect(within(okno).getByRole("checkbox", { name: "Zamień zdjęcie T-3" })).toBeChecked();
    expect(within(okno).getByRole("checkbox", { name: "Zamień zdjęcie T-203" })).not.toBeChecked();

    /* Bok 900 obejmuje każde zdjęcie 800 px. Odznaczone ręcznie zostaje odznaczone. */
    await u.click(within(okno).getByRole("checkbox", { name: "Zamień zdjęcie T-1" }));
    const bok = within(okno).getByRole("spinbutton", { name: "Próg boku w pikselach" });
    await u.clear(bok);
    await u.type(bok, "900");
    expect(within(okno).getByRole("checkbox", { name: "Zamień zdjęcie T-203" })).toBeChecked();
    expect(within(okno).getByRole("checkbox", { name: "Zamień zdjęcie T-1" })).not.toBeChecked();
    expect(within(okno).getByRole("button", { name: "Zamień 3 zdjęcia" })).toBeEnabled();
  });

  it("zamiana wysyła `zamien: true` i `zrodlo: allegro`, a oferta nie lepsza idzie do pominiętych", async () => {
    const stan = atrapa();
    const { u, okno } = await sprawdzone("Zamień 2 zdjęcia");
    await u.click(within(okno).getByRole("button", { name: "Zamień 2 zdjęcia" }));

    expect(await within(okno).findByText(/Zamieniono 1, pominięto 1, błędy 0\./)).toBeInTheDocument();
    expect(ciala("/api/products/1/zdjecie/gotowe"))
      .toEqual([{ gotowy: "R09UT1dZ", zrodlo: "allegro", plik: "oferta 9001", zamien: true }]);
    expect(ciala("/api/products/2/zdjecie/gotowe")).toEqual([]);
    expect(pobrane(/^\/api\/zdjecia\/allegro\/oferta\//).sort()).toEqual([zdjecieOferty("9001"), zdjecieOferty("9002")]);

    const wiersze = within(okno).getAllByRole("row").slice(1)
      .map((w) => within(w).getAllByRole("cell").map((c) => c.textContent));
    expect(wiersze).toEqual([["T-1", "Towar 1", "Sekator ogrodowy (9001)", "sygnatura", "300 px / 500", "1200 px / 600", "kolejka do Subiekta"]]);
    expect(within(okno).getByRole("button", { name: "Kopiuj listę do arkusza" })).toBeInTheDocument();
    await u.click(within(okno).getByText("Pominięte: 1"));
    expect(within(okno).getByText(/zdjęcie z Allegro nie jest lepsze/)).toBeInTheDocument();
    expect(stan.wyslane.filter((w) => w.endsWith("/gotowe"))).toEqual(["POST /api/products/1/zdjecie/gotowe"]);
    expect(stan.nieznane).toEqual([]);
  });

  it("większy bok oferty ponad 800 px nie jest lepszy, bo do Subiekta i tak idzie 800", async () => {
    m.oceny[zdjecieOferty("9002")] = { bok: 1600, ostrosc: 30 };
    atrapa();
    const { u, okno } = await sprawdzone("Zamień 2 zdjęcia");
    await u.click(within(okno).getByRole("button", { name: "Zamień 2 zdjęcia" }));
    expect(await within(okno).findByText(/Zamieniono 1, pominięto 1, błędy 0\./)).toBeInTheDocument();
    expect(ciala("/api/products/2/zdjecie/gotowe")).toEqual([]);
  });

  it("dopasowanie po kodzie producenta ma znacznik, nie zaznacza się samo i stoi w tabeli", async () => {
    KODY = new Set(["T-1"]);
    atrapa();
    const { u, okno } = await sprawdzone("Zamień 1 zdjęcie");
    const t1 = within(okno).getByRole("checkbox", { name: "Zamień zdjęcie T-1" });
    expect(t1).not.toBeChecked();
    expect(within(t1.closest("label")!).getByText("kod producenta")).toBeInTheDocument();
    const t2 = within(okno).getByRole("checkbox", { name: "Zamień zdjęcie T-2" });
    expect(within(t2.closest("label")!).queryByText("kod producenta")).not.toBeInTheDocument();
    expect(within(okno).getByText("Dopasowane po kodzie producenta nie są zaznaczane same: 1")).toBeInTheDocument();

    await u.click(t1);
    await u.click(within(okno).getByRole("button", { name: "Zamień 2 zdjęcia" }));
    await within(okno).findByText(/Zamieniono 1, pominięto 1, błędy 0./);
    expect(ciala("/api/products/1/zdjecie/gotowe")).toHaveLength(1);
    expect(within(okno).getByRole("columnheader", { name: "Dopasowanie" })).toBeInTheDocument();
    const wiersz = within(okno).getAllByRole("row")[1];
    expect(within(wiersz).getAllByRole("cell")[3]).toHaveTextContent("kod producenta");
  });

  it("„Zatrzymaj” w pomiarze zostawia zmierzone i pozwala dokończyć", async () => {
    let pusc!: () => void;
    const brama = new Promise<void>((r) => { pusc = r; });
    for (const t of [1, 2, 3]) wstrzymane.set(zdjecieTowaru(t), brama);
    atrapa();
    const { u, okno } = await otworzOkno();
    await u.click(within(okno).getByRole("button", { name: "Sprawdź zdjęcia" }));
    expect(await within(okno).findByText("Mierzę zdjęcia w Subiekcie: 0 z 4…")).toBeInTheDocument();
    await u.click(within(okno).getByRole("button", { name: "Zatrzymaj" }));
    pusc();
    const dokoncz = await within(okno).findByRole("button", { name: "Dokończ pomiar (1)" });
    expect(pobrane(/^\/api\/products\/\d+\/zdjecie$/)).toHaveLength(3);
    expect(symboleListy(okno)).toEqual(["T-2", "T-1", "T-3"]);

    await u.click(dokoncz);
    await within(okno).findByRole("checkbox", { name: "Zamień zdjęcie T-203" });
    expect(within(okno).queryByRole("button", { name: /Dokończ pomiar/ })).not.toBeInTheDocument();
    expect(pobrane(/^\/api\/products\/\d+\/zdjecie$/)).toHaveLength(4);
  });

  it("zdjęcie, którego nie da się zmierzyć, stoi z powodem i nie trafia na listę", async () => {
    delete m.oceny[zdjecieTowaru(3)];
    atrapa();
    const { u, okno } = await sprawdzone("Zamień 2 zdjęcia");
    expect(symboleListy(okno)).toEqual(["T-2", "T-1", "T-203"]);
    await u.click(within(within(okno).getByText("Nie udało się zmierzyć").closest("li")!).getByText("Pokaż nazwy"));
    expect(within(okno).getByText("T-3 — brak oceny dla /api/products/3/zdjecie")).toBeInTheDocument();
  });
});
