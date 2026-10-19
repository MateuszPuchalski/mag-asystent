import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { atrapaZapisow } from "../test/zapisy";
import { Zdjecia, nastepnyWolny, sasiad } from "./Zdjecia";
import type { ListaBezZdjecia, PozycjaBezZdjecia } from "../api/zdjecia";

/* ── Ekran „Zdjęcia” ──────────────────────────────────────────────────────
   1. ZERO ZAPISU PRZY OTWARCIU, także gdy edytor sam wybiera pierwszy towar.
   2. Wyłączona funkcja: zdanie z serwera zamiast edytora.
   3. Towar w kolejce jest wyszarzony i nie da się go wybrać.
   4. Pełna droga: plik → podgląd → zatwierdzenie → następny wolny towar.
   5. „Jeszcze raz” porzuca podgląd na serwerze.

   Płótno podmieniamy, bo jsdom nie rysuje. Rachunek obróbki ma własne
   testy w `zdjecia/obrobka.test.ts`. */
vi.mock("../zdjecia/obraz", () => ({
  wczytajPlik: vi.fn(async () => ({ kanwa: {}, szer: 100, wys: 80 })),
  podgladEdycji: vi.fn(() => ({ adres: "data:image/jpeg;base64,RURZQ0pB", szer: 100, wys: 80 })),
  doWyslania: vi.fn(async () => ({ base64: "V1lTTEFOWQ==", adres: "data:image/jpeg;base64,V1lTTEFOWQ==" })),
  zlozGotowy: vi.fn(async () => ({ base64: "R09UT1dZ", adres: "data:image/jpeg;base64,R09UT1dZ" })),
}));

const poz = (twId: number, symbol: string, nazwa: string, oczekuje = false): PozycjaBezZdjecia =>
  ({ twId, symbol, nazwa, ean: `59000000000${twId}`, stan: twId === 3 ? 0 : twId * 2.5, oczekuje });

const LISTA: ListaBezZdjecia = {
  wlaczone: true, razem: 3,
  pozycje: [poz(1, "SEK-1", "Sekator kowadełkowy"), poz(2, "KON-2", "Konewka 10 l", true), poz(3, "GRA-3", "Grabie metalowe")],
};

let lista: ListaBezZdjecia = LISTA;
let odpowiedzZapisu: { status: number; cialo: unknown } = { status: 200, cialo: { queueId: 5, etag: "e", bajtow: 1234, wSubiekcie: true } };

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><Zdjecia /></MemoryRouter></QueryClientProvider>);
}

const atrapa = () => atrapaZapisow(
  (url) => (url.startsWith("/api/zdjecia/bez-zdjecia") ? lista : undefined),
  (url) => {
    if (url === "/api/products/1/zdjecie/wstepne") {
      return { status: 200, cialo: { podgladId: "p-77", tlo: "usuniete", png: "UE5H", mime: "image/png" } };
    }
    if (url === "/api/products/1/zdjecie") return odpowiedzZapisu;
    return undefined;
  });

/** Ciało zapisu pod danym adresem, z prawdziwych wywołań `fetch`. */
const cialo = (url: string) => {
  const w = vi.mocked(fetch).mock.calls.find(([u, i]) => u === url && i?.method && i.method !== "GET");
  return w ? JSON.parse(String(w[1]!.body)) : undefined;
};

beforeEach(() => {
  lista = LISTA;
  odpowiedzZapisu = { status: 200, cialo: { queueId: 5, etag: "e", bajtow: 1234, wSubiekcie: true } };
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Zdjęcia", () => {
  it("otwarcie ekranu nie wysyła żadnego zapisu, choć sam wybiera pierwszy towar", async () => {
    const stan = atrapa();
    pokaz();
    expect(await screen.findByRole("heading", { name: "Sekator kowadełkowy" })).toBeInTheDocument();
    expect(screen.getByText("3 towary bez zdjęcia")).toBeInTheDocument();
    expect(stan.wyslane).toEqual([]);
    expect(stan.nieznane).toEqual([]);
  });

  /* Kolejność i filtr to tylko inne pytanie o listę: GET z nowymi
     parametrami, od pierwszej strony, bez żadnego zapisu. */
  it("kolejność i „tylko na stanie” pytają serwer od nowa i niczego nie zapisują", async () => {
    const stan = atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Sekator kowadełkowy" });
    /* Stan sekatora stoi na liście i w nagłówku edytora. */
    expect(screen.getAllByText("stan 2,5")).toHaveLength(2);
    expect(screen.getByText("stan 0")).toBeInTheDocument();
    const adresy = () => vi.mocked(fetch).mock.calls.map(([adres]) => String(adres))
      .filter((a) => a.startsWith("/api/zdjecia/bez-zdjecia"));
    expect(adresy()[0]).toContain("sortuj=stan");

    await u.selectOptions(screen.getByLabelText("Kolejność"), "nazwa");
    await waitFor(() => expect(adresy().at(-1)).toContain("sortuj=nazwa"));
    await u.click(screen.getByLabelText("Tylko na stanie"));
    await waitFor(() => expect(adresy().at(-1)).toContain("naStanie=1"));
    expect(adresy().at(-1)).toContain("offset=0");
    expect(stan.wyslane).toEqual([]);
  });

  it("wyłączona funkcja: zdanie z serwera, bez edytora", async () => {
    lista = { wlaczone: false, powod: "Dodawanie zdjęć jest wyłączone w wertis.env.", razem: 0, pozycje: [] };
    const stan = atrapa();
    pokaz();
    expect(await screen.findByText("Dodawanie zdjęć jest wyłączone w wertis.env.")).toBeInTheDocument();
    expect(screen.queryByText("Wybierz plik z dysku")).not.toBeInTheDocument();
    expect(stan.wyslane).toEqual([]);
  });

  it("towar ze zdjęciem w kolejce jest wyszarzony i nie da się go wybrać", async () => {
    atrapa();
    pokaz();
    const wiersz = (await screen.findByText("Konewka 10 l")).closest("button")!;
    expect(wiersz).toBeDisabled();
    expect(within(wiersz).getByText("w kolejce")).toBeInTheDocument();
  });

  /* Domyślnie bez białego kwadratu, decyzją właściciela: serwer zapisuje
     wycięcie sam, a przeglądarka nie składa i nie wysyła gotowego pliku. */
  it("plik → podgląd → zatwierdzenie bez białego kwadratu i przejście do następnego wolnego towaru", async () => {
    const stan = atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Sekator kowadełkowy" });
    await u.upload(screen.getByLabelText(/Upuść zdjęcie/), new File(["x"], "sekator.jpg", { type: "image/jpeg" }));
    await u.click(await screen.findByRole("button", { name: /^Usuń tło i pokaż podgląd/ }));
    expect(await screen.findByRole("img", { name: "Gotowe zdjęcie towaru" })).toBeInTheDocument();
    expect(cialo("/api/products/1/zdjecie/wstepne")).toEqual({ zdjecie: "V1lTTEFOWQ==" });
    expect(screen.getByLabelText(/^Usuń tło/)).toBeChecked();
    expect(screen.getByLabelText(/^Białe tło i kwadrat/)).not.toBeChecked();

    await u.click(screen.getByRole("button", { name: /^Zatwierdź/ }));
    /* Konewka czeka w kolejce, więc następny wolny to grabie. */
    expect(await screen.findByRole("heading", { name: "Grabie metalowe" })).toBeInTheDocument();
    expect(cialo("/api/products/1/zdjecie")).toEqual({ podgladId: "p-77", zTlem: false, zrodlo: "panel" });
    expect(screen.getByRole("status")).toHaveTextContent("Zapisano zdjęcie SEK-1");
    /* Zatwierdzony podgląd zużył serwer — porzucanie go byłoby zbędnym zapisem. */
    expect(stan.wyslane).toEqual(["POST /api/products/1/zdjecie/wstepne", "POST /api/products/1/zdjecie"]);
  });

  /* Wybór białego kwadratu przeżywa przejście do następnego towaru: przy pracy
     seryjnej agent ustawia go raz, nie przy każdym zdjęciu. */
  it("włączony biały kwadrat wysyła gotowy plik i zostaje włączony przy następnym towarze", async () => {
    atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Sekator kowadełkowy" });
    await u.upload(screen.getByLabelText(/Upuść zdjęcie/), new File(["x"], "s.jpg", { type: "image/jpeg" }));
    await u.click(await screen.findByRole("button", { name: /^Usuń tło i pokaż podgląd/ }));
    await screen.findByRole("img", { name: "Gotowe zdjęcie towaru" });
    await u.click(screen.getByLabelText(/^Białe tło i kwadrat/));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Zatwierdź/ })).toBeEnabled());
    await u.click(screen.getByRole("button", { name: /^Zatwierdź/ }));
    await screen.findByRole("heading", { name: "Grabie metalowe" });
    expect(cialo("/api/products/1/zdjecie")).toEqual({ podgladId: "p-77", zTlem: false, zrodlo: "panel", gotowy: "R09UT1dZ" });
  });

  it("zostawione tło idzie jako zTlem, bez gotowego pliku", async () => {
    atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Sekator kowadełkowy" });
    await u.upload(screen.getByLabelText(/Upuść zdjęcie/), new File(["x"], "s.png", { type: "image/png" }));
    await u.click(await screen.findByRole("button", { name: /^Usuń tło i pokaż podgląd/ }));
    await screen.findByRole("img", { name: "Gotowe zdjęcie towaru" });
    await u.click(screen.getByLabelText(/^Usuń tło/));
    await u.click(screen.getByRole("button", { name: /^Zatwierdź/ }));
    await screen.findByRole("heading", { name: "Grabie metalowe" });
    expect(cialo("/api/products/1/zdjecie")).toEqual({ podgladId: "p-77", zTlem: true, zrodlo: "panel" });
  });

  it("„Jeszcze raz” porzuca podgląd na serwerze i wraca do poprawek", async () => {
    const stan = atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Sekator kowadełkowy" });
    await u.upload(screen.getByLabelText(/Upuść zdjęcie/), new File(["x"], "s.jpg", { type: "image/jpeg" }));
    await u.click(await screen.findByRole("button", { name: /^Usuń tło i pokaż podgląd/ }));
    await screen.findByRole("img", { name: "Gotowe zdjęcie towaru" });
    await u.click(screen.getByRole("button", { name: /^Jeszcze raz/ }));
    expect(await screen.findByRole("button", { name: /^Usuń tło i pokaż podgląd/ })).toBeInTheDocument();
    await waitFor(() => expect(stan.wyslane).toContain("DELETE /api/products/1/zdjecie/wstepne/p-77"));
  });

  it("odrzucony gotowy plik (400) zostawia podgląd, więc da się poprawić bez nowego zdjęcia", async () => {
    odpowiedzZapisu = { status: 400, cialo: { error: "Gotowe zdjęcie jest za duże (600 KB, limit 512 KB)." } };
    const stan = atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Sekator kowadełkowy" });
    await u.upload(screen.getByLabelText(/Upuść zdjęcie/), new File(["x"], "s.jpg", { type: "image/jpeg" }));
    await u.click(await screen.findByRole("button", { name: /^Usuń tło i pokaż podgląd/ }));
    await screen.findByRole("img", { name: "Gotowe zdjęcie towaru" });
    await u.click(screen.getByLabelText(/^Białe tło i kwadrat/));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Zatwierdź/ })).toBeEnabled());
    await u.click(screen.getByRole("button", { name: /^Zatwierdź/ }));
    expect(await screen.findByText(/za duże \(600 KB/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sekator kowadełkowy" })).toBeInTheDocument();
    await u.click(screen.getByLabelText(/^Białe tło i kwadrat/));
    expect(screen.getByRole("button", { name: /^Zatwierdź/ })).toBeEnabled();
    expect(stan.wyslane.filter((w) => w.startsWith("DELETE"))).toEqual([]);
  });

  /* Praca seryjna z klawiatury: Enter prowadzi przez oba kroki, litery
     przełączają, a j przechodzi dalej bez zapisu. */
  it("klawiatura: Enter → podgląd, B przełącza kwadrat, Enter zatwierdza", async () => {
    atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Sekator kowadełkowy" });
    await u.upload(screen.getByLabelText(/Upuść zdjęcie/), new File(["x"], "s.jpg", { type: "image/jpeg" }));
    await screen.findByRole("button", { name: /^Usuń tło i pokaż podgląd/ });
    (document.activeElement as HTMLElement | null)?.blur();
    await u.keyboard("{Enter}");
    await screen.findByRole("img", { name: "Gotowe zdjęcie towaru" });
    await u.keyboard("b");
    expect(screen.getByLabelText(/^Białe tło i kwadrat/)).toBeChecked();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Zatwierdź/ })).toBeEnabled());
    await u.keyboard("{Enter}");
    await screen.findByRole("heading", { name: "Grabie metalowe" });
    expect(cialo("/api/products/1/zdjecie")).toMatchObject({ gotowy: "R09UT1dZ" });
  });

  it("klawiatura: Esc w podglądzie to „Jeszcze raz”", async () => {
    const stan = atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Sekator kowadełkowy" });
    await u.upload(screen.getByLabelText(/Upuść zdjęcie/), new File(["x"], "s.jpg", { type: "image/jpeg" }));
    await u.click(await screen.findByRole("button", { name: /^Usuń tło i pokaż podgląd/ }));
    await screen.findByRole("img", { name: "Gotowe zdjęcie towaru" });
    await u.keyboard("{Escape}");
    expect(await screen.findByRole("button", { name: /^Usuń tło i pokaż podgląd/ })).toBeInTheDocument();
    await waitFor(() => expect(stan.wyslane).toContain("DELETE /api/products/1/zdjecie/wstepne/p-77"));
  });

  it("j / k i „Pomiń” chodzą po wolnych towarach bez żadnego zapisu", async () => {
    const stan = atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Sekator kowadełkowy" });
    await u.keyboard("j");
    expect(await screen.findByRole("heading", { name: "Grabie metalowe" })).toBeInTheDocument();
    await u.keyboard("k");
    expect(await screen.findByRole("heading", { name: "Sekator kowadełkowy" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /^Pomiń/ }));
    expect(await screen.findByRole("heading", { name: "Grabie metalowe" })).toBeInTheDocument();
    /* Litera w polu szukania to pisanie, nie ruch po liście. */
    await u.type(screen.getByLabelText("Szukaj towaru bez zdjęcia"), "j");
    expect(screen.getByRole("heading", { name: "Grabie metalowe" })).toBeInTheDocument();
    expect(stan.wyslane).toEqual([]);
  });

  it("awaria bazy Subiekta (503) to błąd z ponowieniem, nie wyłączona funkcja", async () => {
    let proba = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      proba++;
      return proba === 1
        ? new Response(JSON.stringify({ error: "Baza Subiekta nie odpowiada." }), { status: 503 })
        : new Response(JSON.stringify(LISTA), { status: 200 });
    }));
    const u = userEvent.setup();
    pokaz();
    expect(await screen.findByText("Baza Subiekta nie odpowiada.")).toBeInTheDocument();
    expect(screen.queryByText(/Każdy towar ma zdjęcie/)).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Spróbuj jeszcze raz" }));
    expect(await screen.findByRole("heading", { name: "Sekator kowadełkowy" })).toBeInTheDocument();
  });

  it("plik, który nie jest zdjęciem, dostaje zdanie, co zrobić", async () => {
    atrapa();
    const u = userEvent.setup({ applyAccept: false });
    pokaz();
    await screen.findByRole("heading", { name: "Sekator kowadełkowy" });
    await u.upload(screen.getByLabelText(/Upuść zdjęcie/), new File(["x"], "faktura.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/To nie jest zdjęcie/)).toBeInTheDocument();
  });
});

describe("następny wolny towar", () => {
  const L = [poz(1, "A", "a"), poz(2, "B", "b", true), poz(3, "C", "c"), poz(4, "D", "d")];
  it("bierze pierwszy wolny za bieżącym, pomijając kolejkę i zrobione", () => {
    expect(nastepnyWolny(L, 1, new Set())?.twId).toBe(3);
    expect(nastepnyWolny(L, 1, new Set([3]))?.twId).toBe(4);
  });
  it("na końcu listy wraca na górę, a bez wolnych oddaje null", () => {
    expect(nastepnyWolny(L, 4, new Set())?.twId).toBe(1);
    expect(nastepnyWolny(L, 4, new Set([1, 3]))).toBeNull();
  });
});

describe("sąsiad dla j / k", () => {
  const L = [poz(1, "A", "a"), poz(2, "B", "b", true), poz(3, "C", "c"), poz(4, "D", "d")];
  it("przeskakuje kolejkę i zrobione, a na krańcach stoi", () => {
    expect(sasiad(L, 1, 1, new Set())?.twId).toBe(3);
    expect(sasiad(L, 3, -1, new Set())?.twId).toBe(1);
    expect(sasiad(L, 1, 1, new Set([3]))?.twId).toBe(4);
    expect(sasiad(L, 4, 1, new Set())).toBeNull();
    expect(sasiad(L, 1, -1, new Set())).toBeNull();
  });
  it("bez wybranego zaczyna od pierwszego albo ostatniego wolnego", () => {
    expect(sasiad(L, null, 1, new Set())?.twId).toBe(1);
    expect(sasiad(L, null, -1, new Set())?.twId).toBe(4);
  });
});
