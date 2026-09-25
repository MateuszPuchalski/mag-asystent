import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stan } from "./Stan";
import { NAZWA_ROZJAZDU, csvRozjazdow } from "../stan/Rekoncyliacja";
import reconcileZrodlo from "../../../server/src/services/reconcile.ts?raw";

/* ── STAN SYSTEMU w panelu (0.441.0) ────────────────────────────────────
   Gwarancje przeniesione z testów NADZORU w `server/src/routes/biuro.test.ts`
   (numery tamtych testów w nawiasach) i trzy nowe:

   1. ZERO ZAPISU PRZY PATRZENIU — i rekoncyliacja nie biegnie przy otwarciu.
   2. PONÓW bez pytania, ANULUJ za potwierdzeniem, oba bez ciała (974).
   3. Decyzja o kolizji idzie z rodzajem i notatką.
   4. PAROWANIE ALLEGRO: jedna pętla, rytm serwera, `brak` kończy, PRZERWIJ
      nie wysyła nic (953, 999).
   5. Arkusz lokalizacji stoi wyłącznie u administratora.
   6. NOWE: nazwy WSZYSTKICH rodzajów rozjazdu z unii serwera.
   7. NOWE: `?karta=` przewija do karty. */

let wyslane: string[] = [];
let odczyty: string[] = [];
let rola = "admin";
let parowanie: Array<{ stan: string; nastepnyPollMs?: number }> = [];

const KOLEJKA = { summary: { pending: 1, error: 1, done: 3 }, items: [
  { id: 7, time: "12:00", status: "pending", label: "Lokalizacja RP-4120", detail: "P-01-3 → P-02-1", errMsg: null },
  { id: 9, time: "11:40", status: "error", label: "MM kosza K-010", detail: "ZWR", errMsg: "brak stanu" },
] };

beforeEach(() => {
  wyslane = []; odczyty = []; rola = "admin"; parowanie = [];
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    const odp = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (metoda !== "GET") {
      wyslane.push(`${metoda} ${url}${init?.body !== undefined ? ` ${init.body}` : ""}`);
      if (url === "/api/biuro/allegro/parowanie") return odp({ userCode: "ABCD-EFGH", link: "https://allegro.pl/skojarz" });
      if (url === "/api/biuro/lokalizacje/arkusz") return odp({ wierszy: 1, doZmiany: [], bezZmian: 1, nieznane: [], odrzucone: [], wKolejce: 0, zakolejkowano: null });
      return odp({ ok: true });
    }
    odczyty.push(url);
    if (url === "/api/queue") return odp(KOLEJKA);
    if (url === "/api/ean-conflicts") return odp({ conflicts: [{ ean: "5901234567890", hits: 3, autoResolved: 0,
      twIds: [11, 12], lastSeen: "2026-09-22T12:00:00.000Z", rozstrzygniecie: null, trafienPoDecyzji: 0 }] });
    if (url.startsWith("/api/biuro/wymiana")) return odp({ wiersze: [] });
    if (url === "/api/biuro/alarm-wymiany") return odp({ dni: 30, minSpraw: 5, spoznionychRazem: 0, kanaly: [] });
    if (url === "/api/biuro/allegro/status") return odp({ stan: "niepolaczone", srodowisko: "produkcja", wygasa: null });
    if (url === "/api/biuro/allegro/parowanie") return odp(parowanie.shift() ?? { stan: "czekam", nastepnyPollMs: 5000 });
    if (url === "/api/reconcile") return odp({ at: "2026-09-23T06:00:00.000Z", sprawdzono: { kartotek: 10, zadan: 4 },
      rozjazdy: [{ rodzaj: "zwrot_rozliczony_bez_korekty", klucz: "ZW-501", opis: "brak korekty", odKiedy: null }] });
    if (url === "/api/health") return odp({ wersja: "0.0.0", mode: "seeded", worker: { zyje: true, mode: "x", widziany: null },
      kopie: { nocna: "2026-09-24T00:30:00.000Z", przedAktualizacja: null, rekoncyliacja: null },
      allegroInbox: { status: "current", alarm: false, ostatniaProba: null, ostatniaUdanaSynchronizacja: null,
        kodOstatniegoBledu: null, tekstOstatniegoBledu: null, liczbaBledow: 0, watkiZBledem: 0, opoznienieMs: null,
        nastepnaProba: null, interwalMs: 60000 },
      obsluga: { rozmowyOczekujace: 0, zadaniaTerenowe: 0, najstarszeZadanieMs: null, kolejkaWysylek: "pusta", wysylkiDoSprawdzenia: 0 } });
    if (url === "/api/kolektory") return odp({ kolektory: [] });
    if (url === "/api/biuro/sonda-rzeczywistosci") return odp({ przebieg: "2026-09-24T06:00:00.000Z", kroki: [
      { krok: "watki", wynik: "ok", szczegol: "20 wątków na pierwszej stronie", ms: 310 },
      { krok: "zdjecie_rozmowy", wynik: "blad", szczegol: "1 z 1 zdjęć nie pobrało się: 403", ms: 820 },
      { krok: "zdjecia_copilota", wynik: "pominiety", szczegol: null, ms: 1 }] });
    if (url === "/api/auth/me") return odp({ user: { userId: 1, name: "Anna", role: rola } });
    throw new Error(`nieoczekiwany adres w teście: ${url}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function pokaz(adres = "/obsluga/stan") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[adres]}><Stan /></MemoryRouter></QueryClientProvider>);
}

const kartaKolejki = () => screen.getByRole("heading", { name: "Zapisy do Subiekta" }).closest(".card") as HTMLElement;

describe("Stan systemu w panelu", () => {
  it("otwarcie to same odczyty — i rekoncyliacja NIE biegnie sama", async () => {
    pokaz();
    await screen.findByText("MM kosza K-010");
    await screen.findByText("5901234567890");
    expect(wyslane).toEqual([]);
    expect(odczyty).not.toContain("/api/reconcile");
  });

  it("PONÓW bez pytania i bez ciała; ANULUJ dopiero po potwierdzeniu", async () => {
    pokaz();
    await screen.findByText("MM kosza K-010");
    await userEvent.click(within(kartaKolejki()).getByRole("button", { name: /Ponów/ }));
    await waitFor(() => expect(wyslane).toEqual(["POST /api/queue/9/retry"]));
    await userEvent.click(within(kartaKolejki()).getByRole("button", { name: "Anuluj" }));
    /* Pierwszy klik tylko pyta — zapisu jeszcze nie ma. */
    expect(wyslane).toEqual(["POST /api/queue/9/retry"]);
    await userEvent.click(within(kartaKolejki()).getByRole("button", { name: "Anuluj zadanie" }));
    await waitFor(() => expect(wyslane).toEqual(["POST /api/queue/9/retry", "POST /api/queue/7/cancel"]));
  });

  it("decyzja o kolizji idzie z rodzajem i notatką", async () => {
    pokaz();
    await screen.findByText("5901234567890");
    await userEvent.click(screen.getByRole("button", { name: "Dopuszczone" }));
    await userEvent.type(screen.getByLabelText("Notatka do decyzji"), "dwa rozmiary");
    await userEvent.click(screen.getByRole("button", { name: "Zapisz dopuszczone" }));
    await waitFor(() => expect(wyslane).toEqual([
      `POST /api/ean-conflicts/5901234567890/rozstrzygnij ${JSON.stringify({ rodzaj: "dopuszczone", notatka: "dwa rozmiary" })}`]));
  });

  /* Test na żywym Allegro (0.495.0): otwarcie karty CZYTA ostatni przebieg,
     nowy biegnie wyłącznie na kliknięcie — POST bez ciała. */
  it("test na żywo: wynik ostatniego przebiegu, a nowy tylko na kliknięcie", async () => {
    pokaz();
    await screen.findByText("Test na żywym Allegro");
    expect(await screen.findByText("nie działa")).toBeInTheDocument();
    expect(screen.getByText("zdjęcie z rozmowy")).toBeInTheDocument();
    expect(screen.getByText("pominięty")).toBeInTheDocument();
    expect(wyslane.filter((w) => w.includes("sonda"))).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /Przetestuj teraz/ }));
    await waitFor(() => expect(wyslane).toContain("POST /api/biuro/sonda-rzeczywistosci"));
  });

  it("rekoncyliacja biegnie na żądanie i nazywa rodzaj słowem, nie kluczem", async () => {
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Sprawdź teraz/ }));
    expect(await screen.findByText("zwrot rozliczony bez korekty")).toBeInTheDocument();
    expect(screen.queryByText("zwrot_rozliczony_bez_korekty")).toBeNull();
  });

  it("słownik rozjazdów zna KAŻDY rodzaj z unii serwera", () => {
    /* Biuro znało cztery z dziewięciu i resztę pokazywało surowym kluczem.
       Test czyta unię wprost z `services/reconcile.ts`, więc dziesiąty rodzaj
       dopisany na serwerze bez nazwy tutaj wywróci ten test. */
    const unia = reconcileZrodlo.slice(reconcileZrodlo.indexOf("rodzaj:"), reconcileZrodlo.indexOf(";", reconcileZrodlo.indexOf("rodzaj:")));
    const rodzaje = [...unia.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(rodzaje.length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(NAZWA_ROZJAZDU).sort()).toEqual([...rodzaje].sort());
  });

  it("CSV rozjazdów ma BOM i średniki — tak czyta go Excel PL", () => {
    const csv = csvRozjazdow({ at: "2026-09-23T06:00:00.000Z", sprawdzono: { kartotek: 1, zadan: 1 },
      rozjazdy: [{ rodzaj: "lokalizacja", klucz: "RP-1", opis: 'adres "A"', odKiedy: null }] });
    expect(csv.startsWith("\uFEFFrodzaj;klucz;opis;od_kiedy\r\n")).toBe(true);
    expect(csv).toContain('"adres ""A"""');
  });

  it("karta serwera pokazuje, że kopie bazy powstają (0.487.0)", async () => {
    /* Kopie robi serwer bez udziału człowieka, więc to jedyne miejsce w panelu,
       gdzie widać, że je robi. Data lokalna: 00:30Z to 2:30 w Warszawie. */
    pokaz();
    expect(await screen.findByText("nocna 2026-09-24 · przed aktualizacją —")).toBeInTheDocument();
  });

  it("arkusz lokalizacji stoi wyłącznie u administratora", async () => {
    rola = "biuro";
    pokaz();
    await screen.findByText("MM kosza K-010");
    expect(screen.queryByRole("heading", { name: "Masowa zmiana lokalizacji" })).toBeNull();
    /* Połączenie konta też jest adminowe — biuro dostaje zdanie, nie przycisk. */
    expect(await screen.findByText("Parowanie wykonuje administrator.")).toBeInTheDocument();
  });

  it("?karta= przewija do karty — wiersz DO DECYZJI trafia tam, gdzie jego sprawa", async () => {
    pokaz("/obsluga/stan?karta=kody");
    await screen.findByText("MM kosza K-010");
    /* Ostatni skok przychodzi PO odczytach — karty nad celem rosną, kiedy
       dochodzą ich dane — i każdy skok celuje w tę samą kartę. */
    await screen.findByText("5901234567890");
    const skok = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(skok.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(new Set(skok.mock.contexts.map((c) => (c as HTMLElement).id))).toEqual(new Set(["karta-kody"]));
    /* Po skoku po odczytach — cisza, choć karty dalej się odświeżają. */
    const ile = skok.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(skok.mock.calls.length).toBe(ile);
  });
});

describe("parowanie Allegro — jedna pętla (z biura 0.106.0 i 0.114.0)", () => {
  const ilePytan = () => odczyty.filter((u) => u === "/api/biuro/allegro/parowanie").length;

  it("rytm dyktuje serwer, a `brak` kończy pętlę i oddaje przycisk", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    parowanie = [{ stan: "czekam", nastepnyPollMs: 7000 }, { stan: "brak" }];
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Połącz z Allegro/ }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    await waitFor(() => expect(ilePytan()).toBe(1));
    /* Przed upływem rytmu serwera — ani jednego pytania więcej. */
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(ilePytan()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await waitFor(() => expect(ilePytan()).toBe(2));
    expect(await screen.findByText("sesja parowania przepadła")).toBeInTheDocument();
    /* `brak` kończy — żadnych dalszych pytań i przycisk wraca. */
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(ilePytan()).toBe(2);
    expect(screen.getByRole("button", { name: /Połącz z Allegro/ })).toBeInTheDocument();
    expect(wyslane).toEqual(["POST /api/biuro/allegro/parowanie"]);
  });

  it("PRZERWIJ zatrzymuje pętlę bez żadnego żądania", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Połącz z Allegro/ }));
    await screen.findByText("ABCD-EFGH");
    await waitFor(() => expect(ilePytan()).toBe(1));
    await userEvent.click(screen.getByRole("button", { name: "Przerwij" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(ilePytan()).toBe(1);
    expect(wyslane).toEqual(["POST /api/biuro/allegro/parowanie"]);
  });
});
