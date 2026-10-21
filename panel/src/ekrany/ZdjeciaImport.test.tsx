import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { atrapaZapisow } from "../test/zapisy";
import { Zdjecia } from "./Zdjecia";
import type { ListaBezZdjecia, PozycjaDopasowania } from "../api/zdjecia";

/* ── Import zdjęć z folderu ───────────────────────────────────────────────
   1. Otwarcie ekranu i okna to zero zapisów, dopóki agent nie wybierze plików.
   2. Wybór → `dopasuj` z symbolami → podsumowanie z liczbami → „Dodaj N”.
   3. Zdjęcie idzie do właściwego towaru, z `zrodlo: "import"` i nazwą pliku.
   4. 409 to pominięcie, nie błąd; błąd da się ponowić; „Zatrzymaj” kończy bieżące.

   Płótno podmieniamy jak w `Zdjecia.test.tsx`. Wymiary bierzemy z nazwy pliku,
   a `brama` przytrzymuje składanie, żeby złapać import w trakcie. */
const m = vi.hoisted(() => ({
  brama: { p: Promise.resolve() as Promise<void> },
  wymiary: {} as Record<string, [number, number]>,
}));
vi.mock("../zdjecia/obraz", () => ({
  wczytajPlik: vi.fn(async (p: File) => {
    const [szer, wys] = m.wymiary[p.name] ?? [1000, 800];
    return { kanwa: {}, szer, wys };
  }),
  podgladEdycji: vi.fn(() => ({ adres: "data:image/jpeg;base64,RURZQ0pB", szer: 100, wys: 80 })),
  doWyslania: vi.fn(async () => ({ base64: "V1lTTEFOWQ==", adres: "data:image/jpeg;base64,V1lTTEFOWQ==" })),
  pngZrodla: vi.fn(() => "UE5H"),
  zlozGotowy: vi.fn(async () => {
    await m.brama.p;
    return { base64: "R09UT1dZ", adres: "data:image/jpeg;base64,R09UT1dZ", bok: 800 };
  }),
}));

const LISTA: ListaBezZdjecia = {
  wlaczone: true, razem: 1,
  pozycje: [{ twId: 1, symbol: "SEK-1", nazwa: "Sekator", ean: null, stan: 1, sprzedaz: 0, oczekuje: false }],
};

const dop = (symbol: string, twId: number | null, z: Partial<PozycjaDopasowania> = {}): PozycjaDopasowania =>
  ({ symbol, twId, nazwa: twId ? `Towar ${symbol}` : null, maZdjecie: false, oczekuje: false, zablokowany: false, ...z });

let dopasowanie: { wlaczone: boolean; powod?: string; pozycje: PozycjaDopasowania[] };
/** Odpowiedzi na kolejne zapisy jednego towaru; ostatnia powtarza się dalej. */
let gotowe: Record<number, Array<{ status: number; cialo: unknown }>>;
const OK = { status: 200, cialo: { queueId: 1, etag: "e", bajtow: 900, wSubiekcie: true } };

const atrapa = () => atrapaZapisow(
  (url) => (url.startsWith("/api/zdjecia/bez-zdjecia") ? LISTA : undefined),
  (url) => {
    if (url === "/api/zdjecia/dopasuj") return { status: 200, cialo: dopasowanie };
    const t = /^\/api\/products\/(\d+)\/zdjecie\/gotowe$/.exec(url);
    if (t) {
      const kolejka = gotowe[Number(t[1])] ?? [OK];
      return kolejka.length > 1 ? kolejka.shift()! : kolejka[0];
    }
    return undefined;
  });

const ciala = (url: string) => vi.mocked(fetch).mock.calls
  .filter(([u, i]) => u === url && i?.method === "POST").map(([, i]) => JSON.parse(String(i!.body)));

const plik = (nazwa: string) =>
  new File(["x"], nazwa, { type: nazwa.endsWith(".png") ? "image/png" : "image/jpeg" });

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><Zdjecia /></MemoryRouter></QueryClientProvider>);
}

async function otworzOkno() {
  const u = userEvent.setup();
  pokaz();
  await screen.findByRole("heading", { name: "Sekator" });
  await u.click(screen.getByRole("button", { name: "Import z folderu" }));
  return { u, okno: screen.getByRole("dialog", { name: "Import zdjęć z folderu" }) };
}

const liczba = (okno: HTMLElement, etykieta: string) =>
  within(okno).getByText(etykieta).closest("li")!.querySelector(".tabular-nums")!.textContent;

beforeEach(() => {
  m.brama.p = Promise.resolve();
  m.wymiary = { "W08-0501.jpg": [400, 300], "W08-0501.png": [60, 60], "W04-0402.png": [120, 120] };
  dopasowanie = {
    wlaczone: true,
    pozycje: [dop("W08-0501", 11), dop("W04-0402", 12), dop("W01-0001", 13, { maZdjecie: true }),
      dop("W02-0002", 14, { oczekuje: true }), dop("W28-303", null), dop("W03-0003", 15, { zablokowany: true })],
  };
  gotowe = {};
});
afterEach(() => { vi.unstubAllGlobals(); });

const FOLDER = ["W08-0501.jpg", "W08-0501.png", "W04-0402.png", "W01-0001.jpg", "W02-0002.jpg",
  "W28-303.png", "Zrzut ekranu 2026-10-07 123809.jpg", "W03-0003.jpg"].map(plik);

describe("Import zdjęć z folderu", () => {
  it("otwarcie ekranu i okna importu nie wysyła żadnego zapisu", async () => {
    const stan = atrapa();
    const { okno } = await otworzOkno();
    expect(within(okno).getByLabelText("Wybierz folder")).toBeInTheDocument();
    expect(within(okno).getByLabelText("Wybierz pliki")).toBeInTheDocument();
    expect(stan.wyslane).toEqual([]);
    expect(stan.nieznane).toEqual([]);
  });

  it("wybór → dopasowanie → podsumowanie → „Dodaj 2 zdjęcia” wysyła gotowe do właściwych towarów", async () => {
    const stan = atrapa();
    const { u, okno } = await otworzOkno();
    await u.upload(within(okno).getByLabelText("Wybierz pliki"), FOLDER);

    const dodaj = await within(okno).findByRole("button", { name: "Dodaj 2 zdjęcia" });
    expect(ciala("/api/zdjecia/dopasuj")).toEqual([
      /* `W28` to kandydat z `W28-303` bez dopisku `-303`; który jest symbolem, rozstrzyga Subiekt. */
      { symbole: ["W08-0501", "W04-0402", "W01-0001", "W02-0002", "W28-303", "W28", "W03-0003"] }]);
    expect(within(okno).getByText("Wybrano 8 plików.")).toBeInTheDocument();
    expect(liczba(okno, "Do dodania")).toBe("2");
    expect(liczba(okno, "Mają już zdjęcie")).toBe("1");
    expect(liczba(okno, "Zdjęcie czeka w kolejce do Subiekta")).toBe("1");
    expect(liczba(okno, "Zablokowane w Subiekcie")).toBe("1");
    expect(liczba(okno, "Nie ma takiego symbolu w Subiekcie")).toBe("1");
    expect(liczba(okno, "Nazwa pliku nie jest symbolem")).toBe("1");
    expect(within(okno).getByText("W28-303.png")).toBeInTheDocument();
    expect(within(okno).getByText("Zrzut ekranu 2026-10-07 123809.jpg")).toBeInTheDocument();
    expect(within(okno).getByText(/1 towar ma po kilka plików/)).toBeInTheDocument();
    expect(within(okno).getByText(/1 zdjęcie z 2 ma poniżej 300 px/)).toBeInTheDocument();
    /* Sprawdzenie to jeszcze nie zapis zdjęcia. */
    expect(stan.wyslane).toEqual(["POST /api/zdjecia/dopasuj"]);

    const pytaniaListy = () => vi.mocked(fetch).mock.calls
      .filter(([a]) => String(a).startsWith("/api/zdjecia/bez-zdjecia")).length;
    const przed = pytaniaListy();
    await u.click(dodaj);
    expect(await within(okno).findByText(/Dodano 2, pominięto 0, błędy 0\./)).toBeInTheDocument();
    /* Z dwóch plików W08-0501 idzie ten z większą liczbą pikseli. */
    expect(ciala("/api/products/11/zdjecie/gotowe")).toEqual([{ gotowy: "R09UT1dZ", zrodlo: "import", plik: "W08-0501.jpg" }]);
    expect(ciala("/api/products/12/zdjecie/gotowe")).toEqual([{ gotowy: "R09UT1dZ", zrodlo: "import", plik: "W04-0402.png" }]);
    expect(stan.wyslane.filter((w) => w.includes("/gotowe"))).toHaveLength(2);
    expect(within(okno).getByRole("progressbar", { name: "Postęp importu" })).toHaveAttribute("aria-valuenow", "2");
    /* Podsumowanie mówi, który plik poszedł do której kartoteki, w kolejności listy. */
    expect(within(okno).getByText("Dodane zdjęcia: 2")).toBeInTheDocument();
    const wiersze = within(okno).getAllByRole("row").slice(1)
      .map((w) => within(w).getAllByRole("cell").map((c) => c.textContent));
    expect(wiersze).toEqual([
      ["W08-0501", "Towar W08-0501", "W08-0501.jpg", "kolejka do Subiekta"],
      ["W04-0402", "Towar W04-0402", "W04-0402.png", "kolejka do Subiekta"],
    ]);
    expect(within(okno).getByRole("button", { name: "Kopiuj listę do arkusza" })).toBeInTheDocument();
    /* Lista towarów bez zdjęcia odświeża się raz, po całym imporcie. */
    await waitFor(() => expect(pytaniaListy()).toBeGreaterThan(przed));
    await u.click(within(okno).getByRole("button", { name: "Zamknij" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("jeden plik na towar, gdy dwa symbole trafiają w tę samą kartotekę; kilka kartotek to osobna klasa", async () => {
    dopasowanie.pozycje.push(dop("W08-0501B", 11), dop("W09-0009", null, { niejednoznaczny: true }));
    m.wymiary["W08-0501B.png"] = [900, 900];
    atrapa();
    const { u, okno } = await otworzOkno();
    await u.upload(within(okno).getByLabelText("Wybierz pliki"),
      [...FOLDER, plik("W08-0501B.png"), plik("W09-0009.jpg")]);
    await within(okno).findByRole("button", { name: "Dodaj 2 zdjęcia" });
    expect(liczba(okno, "Kilka kartotek z tym symbolem — dodaj ręcznie w edytorze")).toBe("1");
    expect(liczba(okno, "Nie ma takiego symbolu w Subiekcie")).toBe("1");
    await u.click(within(okno).getByRole("button", { name: "Dodaj 2 zdjęcia" }));
    await within(okno).findByText(/Dodano 2, pominięto 0, błędy 0./);
    expect(ciala("/api/products/11/zdjecie/gotowe")).toEqual([{ gotowy: "R09UT1dZ", zrodlo: "import", plik: "W08-0501B.png" }]);
  });

  it("409 to pominięcie, a błąd wraca przyciskiem „Ponów nieudane”", async () => {
    dopasowanie.pozycje.push(dop("W05-0005", 16));
    gotowe = {
      11: [{ status: 409, cialo: { error: "Zdjęcie tego towaru już czeka w kolejce." } }],
      12: [{ status: 500, cialo: { error: "Serwer nie zapisał pliku." } }, OK],
    };
    atrapa();
    const { u, okno } = await otworzOkno();
    await u.upload(within(okno).getByLabelText("Wybierz pliki"), [...FOLDER, plik("W05-0005.jpg")]);
    await u.click(await within(okno).findByRole("button", { name: "Dodaj 3 zdjęcia" }));
    expect(await within(okno).findByText(/Dodano 1, pominięto 1, błędy 1\./)).toBeInTheDocument();
    expect(within(okno).getByText(/Serwer nie zapisał pliku\./)).toBeInTheDocument();
    expect(within(okno).getByText(/już czeka w kolejce/)).toBeInTheDocument();

    await u.click(within(okno).getByRole("button", { name: "Ponów nieudane (1)" }));
    expect(await within(okno).findByText(/Dodano 2, pominięto 1, błędy 0\./)).toBeInTheDocument();
    expect(ciala("/api/products/12/zdjecie/gotowe")).toHaveLength(2);
    /* Pominiętego nie ponawiamy: zdjęcie już czeka. */
    expect(ciala("/api/products/11/zdjecie/gotowe")).toHaveLength(1);
  });

  it("„Zatrzymaj” kończy bieżące zdjęcia, nie zaczyna nowych, a „Dokończ” wysyła resztę", async () => {
    dopasowanie.pozycje.push(dop("W05-0005", 16), dop("W06-0006", 17));
    let pusc!: () => void;
    m.brama.p = new Promise<void>((r) => { pusc = r; });
    atrapa();
    const { u, okno } = await otworzOkno();
    await u.upload(within(okno).getByLabelText("Wybierz pliki"),
      [...FOLDER, plik("W05-0005.jpg"), plik("W06-0006.jpg")]);
    await u.click(await within(okno).findByRole("button", { name: "Dodaj 4 zdjęcia" }));
    expect(await within(okno).findByText(/teraz/)).toHaveTextContent("W08-0501, W04-0402");
    await u.click(within(okno).getByRole("button", { name: "Zatrzymaj" }));
    pusc();
    expect(await within(okno).findByText(/Dodano 2, pominięto 0, błędy 0, nie wysłano 2\./)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([a]) => String(a).endsWith("/gotowe"))).toHaveLength(2);

    await u.click(within(okno).getByRole("button", { name: "Dokończ: 2 zdjęcia" }));
    expect(await within(okno).findByText(/Dodano 4, pominięto 0, błędy 0\./)).toBeInTheDocument();
    expect(ciala("/api/products/16/zdjecie/gotowe")).toHaveLength(1);
    expect(ciala("/api/products/17/zdjecie/gotowe")).toHaveLength(1);
  });

  it("zamknięcie w trakcie importu pyta, a „Zatrzymaj i zamknij” zamyka po bieżących", async () => {
    let pusc!: () => void;
    m.brama.p = new Promise<void>((r) => { pusc = r; });
    atrapa();
    const { u, okno } = await otworzOkno();
    await u.upload(within(okno).getByLabelText("Wybierz pliki"), FOLDER);
    await u.click(await within(okno).findByRole("button", { name: "Dodaj 2 zdjęcia" }));
    await within(okno).findByText(/teraz/);

    await u.keyboard("{Escape}");
    expect(within(okno).getByRole("alert")).toHaveTextContent("Import trwa: 0 z 2");
    await u.click(within(okno).getByRole("button", { name: "Importuj dalej" }));
    expect(within(okno).queryByRole("alert")).not.toBeInTheDocument();

    await u.click(within(okno).getByRole("button", { name: "Zamknij okno importu" }));
    await u.click(within(okno).getByRole("button", { name: "Zatrzymaj i zamknij" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pusc();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    /* Bieżące zdjęcia doszły do serwera — zatrzymanie ich nie zgubiło. */
    expect(vi.mocked(fetch).mock.calls.filter(([a]) => String(a).endsWith("/gotowe"))).toHaveLength(2);
  });

  it("wyłączona funkcja: zdanie z serwera zamiast podsumowania, bez żadnego zdjęcia", async () => {
    dopasowanie = { wlaczone: false, powod: "Dodawanie zdjęć jest wyłączone w wertis.env.", pozycje: [] };
    const stan = atrapa();
    const { u, okno } = await otworzOkno();
    await u.upload(within(okno).getByLabelText("Wybierz pliki"), FOLDER);
    expect(await within(okno).findByText("Dodawanie zdjęć jest wyłączone w wertis.env.")).toBeInTheDocument();
    expect(within(okno).queryByRole("button", { name: /^Dodaj/ })).not.toBeInTheDocument();
    expect(stan.wyslane).toEqual(["POST /api/zdjecia/dopasuj"]);
  });

  it("awaria bazy Subiekta przy dopasowaniu mówi, co zrobić", async () => {
    atrapaZapisow(
      (url) => (url.startsWith("/api/zdjecia/bez-zdjecia") ? LISTA : undefined),
      (url) => (url === "/api/zdjecia/dopasuj" ? { status: 503, cialo: { error: "Baza Subiekta nie odpowiada." } } : undefined));
    const { u, okno } = await otworzOkno();
    await u.upload(within(okno).getByLabelText("Wybierz pliki"), FOLDER);
    expect(await within(okno).findByText(/Baza Subiekta nie odpowiada\. Nic nie zostało dodane/)).toBeInTheDocument();
    expect(within(okno).getByLabelText("Wybierz pliki")).toBeInTheDocument();
  });
});
