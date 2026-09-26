import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Skrzynka } from "./Skrzynka";

/* ── EKRAN SKRZYNKI (@wydanie) ───────────────────────────────────────────────
   Skrzynka nie miała testu EKRANU — tylko testy swoich klocków. Reguła
   „zero zapisu przy patrzeniu" nie miała więc tu strażnika, a pętla pracy
   (wysyłka → następna rozmowa → pisanie) nie była sprawdzana jako całość.
   Każda usterka, którą naprawiło to wydanie, żyła właśnie na styku klocków:

   1. ZERO ZAPISU. Otwarcie ekranu nie wysyła nic poza GET. Otwarcie rozmowy
      wysyła jedno: uchwyt obecności (§6.3, decyzja 0.159.0) — pamięć procesu,
      nie wiersz w bazie.
   2. WYSYŁKA POPRZEDNIEJ NIE BLOKUJE BIEŻĄCEJ. Jedna mutacja niosła obie drogi.
   3. TEKST ZOSTAJE PRZY SWOJEJ ROZMOWIE. j/k kasowały niezapisaną odpowiedź,
      a notatka przechodziła do następnej rozmowy.
   4. KLAWIATURA OD LISTY DO WYSYŁKI. Enter do pola, Ctrl+Enter spoza pola,
      podwójne Ctrl+Enter nie wysyła następnej rozmowy.
   5. NASTĘPNA ROZMOWA CZEKA W PAMIĘCI, zanim agent do niej przejdzie. */

/* Prawa kolumna ma własne testy i własne zapytania; tu pytamy o pętlę pracy. */
vi.mock("../skrzynka/Kontekst", () => ({ Kontekst: () => null }));

const wiersz = (id: number, n: Record<string, unknown> = {}) => ({
  id, klient: `klient${id}`, ostatniaWiadomosc: `Pytanie ${id}`,
  ostatniaWiadomoscAt: "2026-09-26T08:00:00.000Z", ostatniaOdKlienta: true,
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "waiting_for_us", priorytet: "normalny", reklamacyjna: false,
  czekaOdMs: (10 - id) * 60_000, nowychOdOdpowiedzi: 1, zadanieWToku: false,
  dobor: "not_started", odlozoneDo: null, poTerminie: false, podziekowal: false,
  zakonczenie: null, kopilot: null, oglada: null, ...n,
});

const szczegoly = (id: number, n: Record<string, unknown> = {}) => ({
  rozmowa: wiersz(id),
  os: [{ id: `msg-${id}`, rodzaj: "wiadomosc", messageId: id * 10, autor: `klient${id}`,
    odKlienta: true, tresc: `Pytanie ${id}`, at: "2026-09-26T08:00:00.000Z",
    ofertaId: null, nazwaOferty: null, zamowienieId: null }],
  szkic: null, ofertaWskazana: null, zamowienie: null, oferta: null,
  kandydaciZamowien: [], zwroty: [], sprawy: [], droga: [],
  dobor: { status: "not_started", wersja: 1, dane: {}, brakuje: null, wybrany: null,
    updatedBy: null, updatedAt: null },
  szkicCopilota: null, ...n,
});

const SZKIC = (id: number) => ({
  tresc: `Dzień dobry, odpowiedź ${id}.`, zastrzezenia: [], uzyteFakty: [], messageId: id * 10,
  model: "m", at: "2026-09-26T08:01:00.000Z", przez: "Copilot", ocena: null,
  daneDoboru: null, daneOcena: null, doborWersja: 1, pasowanie: null, pasowanieOcena: null,
  twierdzenia: [], odczytZeZdjec: [],
  lukiKartoteki: { symbol: null, numery: [], modele: [], wpisane: [], czeka: 0 },
});

let zadania: Array<{ metoda: string; url: string; body: string | null }> = [];
let rozmowy = [wiersz(1), wiersz(2), wiersz(3)];
let dane: Record<number, ReturnType<typeof szczegoly>> = {};
/* Wysyłka, która nie wraca — tak wygląda chwila, w której Allegro odpowiada. */
let wysylkaWisi = false;

function odpowiedz(url: string, metoda: string): Response {
  const json = (v: unknown) => new Response(JSON.stringify(v));
  if (url === "/api/conversations/events") return new Response(new ReadableStream({ start() {} }));
  if (metoda !== "GET") {
    if (url.endsWith("/send")) {
      return wysylkaWisi ? (new Promise<never>(() => {}) as never) : json({ status: "sent" });
    }
    return json({ ok: true });
  }
  if (url === "/api/auth/me") return json({ user: { userId: 7, name: "A. Lewandowska", role: "biuro" } });
  if (url === "/api/obsluga/rozmowy") return json({ rozmowy, stan: { ostatniaSynchronizacja: null, bledy: 0 } });
  const m = /^\/api\/obsluga\/rozmowy\/(\d+)$/.exec(url);
  if (m) return json(dane[Number(m[1])] ?? szczegoly(Number(m[1])));
  if (url === "/api/obsluga/copilot") return json({ wlaczony: false, powod: "wyłączony" });
  if (url === "/api/health") return json({ allegroInbox: { status: "current", alarm: false } });
  if (url === "/api/users") return json({ users: [] });
  if (url.includes("/copilot/pytania/")) return json([]);
  if (url.endsWith("/zalaczniki")) return json({ zalaczniki: [] });
  return json({});
}

beforeEach(() => {
  zadania = []; wysylkaWisi = false;
  rozmowy = [wiersz(1), wiersz(2), wiersz(3)];
  dane = {};
  localStorage.setItem("wertis-panel-token", "t");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    zadania.push({ metoda, url, body: (init?.body as string) ?? null });
    return odpowiedz(url, metoda);
  }));
});
/* Sprzątanie PRZED zdjęciem atrapy `fetch`: odmontowanie ekranu zgłasza
   pominięcie z odroczeniem o jeden obrót pętli (powód w `Skrzynka.tsx`),
   a bez tego raport trafiałby do atrapy NASTĘPNEGO testu. */
afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllGlobals();
});

function Adres() {
  return <output aria-label="adres">{useLocation().pathname}</output>;
}

function pokaz(sciezka = "/obsluga/skrzynka") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[sciezka]}>
    <Routes>
      <Route path="/obsluga/skrzynka" element={<><Skrzynka /><Adres /></>} />
      <Route path="/obsluga/skrzynka/:id" element={<><Skrzynka /><Adres /></>} />
    </Routes>
  </MemoryRouter></QueryClientProvider>);
}

const adres = () => screen.getByLabelText("adres").textContent;
const nieGet = () => zadania.filter((z) => z.metoda !== "GET");
const pole = () => screen.findByRole("textbox", { name: "Szkic odpowiedzi" }) as Promise<HTMLTextAreaElement>;

describe("EKRAN SKRZYNKI: zero zapisu przy patrzeniu", () => {
  it("otwarcie ekranu wysyła wyłącznie GET", async () => {
    pokaz();
    expect(await screen.findByText("Pytanie 1")).toBeInTheDocument();
    expect(nieGet()).toEqual([]);
  });

  it("otwarcie rozmowy wysyła tylko uchwyt obecności — i nic, co pisze do bazy", async () => {
    pokaz("/obsluga/skrzynka/1");
    await pole();
    expect(nieGet().map((z) => z.url)).toEqual(
      nieGet().map(() => "/api/conversations/1/presence"));
  });
});

describe("EKRAN SKRZYNKI: pętla pracy", () => {
  it("następna rozmowa jest wczytana, zanim agent do niej przejdzie", async () => {
    pokaz("/obsluga/skrzynka/1");
    await pole();
    await waitFor(() => expect(zadania.some((z) => z.url === "/api/obsluga/rozmowy/2")).toBe(true));
  });

  it("wysyłka przechodzi dalej, a wysyłka POPRZEDNIEJ nie gasi przycisku bieżącej", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    wysylkaWisi = true;
    pokaz("/obsluga/skrzynka/1");
    await u.type(await pole(), "Już wysyłamy.");
    await u.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    await waitFor(() => expect(adres()).toBe("/obsluga/skrzynka/2"));
    /* Dziesięć sekund mija — odpowiedź do klienta 1 idzie do Allegro i wisi. */
    await act(async () => { vi.advanceTimersByTime(10_500); });
    expect(await screen.findByText(/Wysyłam do/)).toBeInTheDocument();
    await u.type(await pole(), "Druga odpowiedź.");
    const przycisk = screen.getByRole("button", { name: /Wyślij do klienta/ });
    expect(przycisk).toBeEnabled();
    expect(przycisk).not.toHaveTextContent("Wysyłam");
  });

  it("niezapisana odpowiedź wraca z rozmową, a notatka nie przechodzi do następnej", async () => {
    const u = userEvent.setup();
    pokaz("/obsluga/skrzynka/1");
    await u.type(await pole(), "Pół odpowiedzi");
    await u.click(screen.getByRole("button", { name: /Notatka wewnętrzna/ }));
    await u.type(screen.getByRole("textbox", { name: /Notatka wewnętrzna/ }), "klient trudny");
    /* Fokus z pola na tło, żeby j chodziło po liście, a nie pisało. */
    (document.activeElement as HTMLElement).blur();
    await u.keyboard("j");
    await waitFor(() => expect(adres()).toBe("/obsluga/skrzynka/2"));
    expect(await pole()).toHaveValue("");
    await u.click(screen.getByRole("button", { name: /Notatka wewnętrzna/ }));
    expect(screen.getByRole("textbox", { name: /Notatka wewnętrzna/ })).toHaveValue("");
    (document.activeElement as HTMLElement).blur();
    await u.keyboard("k");
    await waitFor(() => expect(adres()).toBe("/obsluga/skrzynka/1"));
    expect(await pole()).toHaveValue("Pół odpowiedzi");
  });

  it("Enter prowadzi do pola, Ctrl+Enter spoza pola wysyła — ale nie w pierwszej sekundzie", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    dane[1] = szczegoly(1, { szkicCopilota: SZKIC(1) });
    dane[2] = szczegoly(2, { szkicCopilota: SZKIC(2) });
    pokaz("/obsluga/skrzynka/1");
    expect(await pole()).toHaveValue("Dzień dobry, odpowiedź 1.");
    /* Ctrl+Enter w pierwszej sekundzie milczy: to może być odbicie palca
       po wysyłce poprzedniej rozmowy. */
    await u.keyboard("{Control>}{Enter}{/Control}");
    expect(adres()).toBe("/obsluga/skrzynka/1");
    await act(async () => { vi.advanceTimersByTime(1100); });
    await u.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(adres()).toBe("/obsluga/skrzynka/2"));
    /* Następna ma szkic w polu — podwójne Ctrl+Enter go NIE wysyła. */
    expect(await pole()).toHaveValue("Dzień dobry, odpowiedź 2.");
    await u.keyboard("{Control>}{Enter}{/Control}");
    expect(adres()).toBe("/obsluga/skrzynka/2");
    expect(document.activeElement).toBe(document.body);
    await u.keyboard("{Enter}");
    expect(document.activeElement).toBe(await pole());
  });

  it("E nie kasuje poprawionego szkicu, który już stoi w polu", async () => {
    const u = userEvent.setup();
    dane[1] = szczegoly(1, { szkicCopilota: SZKIC(1) });
    pokaz("/obsluga/skrzynka/1");
    const p = await pole();
    await u.type(p, " Poprawka.");
    p.blur();
    await u.keyboard("e");
    expect(p).toHaveValue("Dzień dobry, odpowiedź 1. Poprawka.");
    expect(nieGet().some((z) => z.url.includes("/szkic/") && z.url.endsWith("/ocena"))).toBe(false);
  });

  it("klient dopisał — wysyłka pyta od razu, zamiast odkładać odpowiedź na dziesięć sekund", async () => {
    const u = userEvent.setup();
    rozmowy = [wiersz(1, { oglada: { userId: 9, name: "M. Wójcik" } }), wiersz(2)];
    pokaz("/obsluga/skrzynka/1");
    await u.type(await pole(), "Odpowiedź");
    await u.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    /* Kolega trzyma rozmowę — pasek z jawną zgodą, a nie dymek po fakcie. */
    expect(await screen.findByText(/siedzi teraz przy tej rozmowie/)).toBeInTheDocument();
    expect(adres()).toBe("/obsluga/skrzynka/1");
    expect(screen.queryByText(/wyjdzie za/)).not.toBeInTheDocument();
  });

  it("„Poproś o przekazanie” pisze do notatki, nie do odpowiedzi klientowi", async () => {
    /* Do tej wersji prośba nadpisywała pole ODPOWIEDZI — w cudzej rozmowie,
       której i tak nie da się wysłać. Scenę stawia wysyłka „mimo to", na
       którą serwer odpowiada 409 z właścicielem rozmowy. */
    const u = userEvent.setup();
    rozmowy = [wiersz(1, { oglada: { userId: 9, name: "M. Wójcik" } }), wiersz(2)];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const metoda = init?.method ?? "GET";
      zadania.push({ metoda, url, body: (init?.body as string) ?? null });
      if (metoda === "POST" && url.endsWith("/send")) {
        return new Response(JSON.stringify({ error: "Prowadzi kto inny", assignedUserId: 9,
          assignedUserName: "M. Wójcik", version: 2 }), { status: 409 });
      }
      return odpowiedz(url, metoda);
    }));
    pokaz("/obsluga/skrzynka/1");
    await u.type(await pole(), "Moja odpowiedź");
    await u.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    await u.click(await screen.findByRole("button", { name: "Odpowiedz mimo to" }));
    await u.click(await screen.findByRole("button", { name: /Poproś .* o przekazanie/ }));
    expect(screen.getByRole("textbox", { name: /Notatka wewnętrzna/ }))
      .toHaveValue("@M. Wójcik — przejmiesz tę rozmowę?");
    await u.click(screen.getByRole("button", { name: /Odpowiedź do klienta/ }));
    expect(await pole()).toHaveValue("Moja odpowiedź");
  });

  it("„Cofnij” po wysyłce wraca do rozmowy z całą treścią", async () => {
    const u = userEvent.setup();
    pokaz("/obsluga/skrzynka/1");
    await u.type(await pole(), "Moja odpowiedź");
    await u.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    await waitFor(() => expect(adres()).toBe("/obsluga/skrzynka/2"));
    await u.click(await screen.findByRole("button", { name: "Cofnij" }));
    await waitFor(() => expect(adres()).toBe("/obsluga/skrzynka/1"));
    expect(await pole()).toHaveValue("Moja odpowiedź");
    expect(nieGet().some((z) => z.url.endsWith("/send"))).toBe(false);
  });

  /* ── Pomiary pod decyzje (@wydanie) ────────────────────────────────────── */
  it("wyjście z rozmowy bez ruchu zgłasza jedno pominięcie — z kategorią, nigdy przy otwarciu", async () => {
    const u = userEvent.setup();
    /* Pełny kształt rozpoznania — ten sam, co w `skrzynka/Copilot.test.tsx`. */
    const kopilot = { kategoria: "RETURN", dodatkowe: [], akcja: "CHECK_STOCK", akcjaModelu: null,
      wymagaCzlowieka: false, brakDanychZamowienia: false, brakDanychProduktu: false,
      pewnosc: "wysoka", zrodlo: "MODEL", status: "SUCCESS", kody: [], uzasadnienie: null,
      nieaktualna: false, kategoriaCzlowieka: null, kategoriaModelu: "RETURN" };
    rozmowy = [wiersz(1, { kopilot }), wiersz(2), wiersz(3)];
    dane[1] = szczegoly(1, { rozmowa: wiersz(1, { kopilot }) });
    pokaz("/obsluga/skrzynka/1");
    await pole();
    expect(zadania.some((z) => z.url === "/api/obsluga/pominiecie")).toBe(false);
    (document.activeElement as HTMLElement).blur();
    await u.keyboard("j");
    await waitFor(() => expect(zadania.filter((z) => z.url === "/api/obsluga/pominiecie")).toHaveLength(1));
    expect(JSON.parse(zadania.find((z) => z.url === "/api/obsluga/pominiecie")!.body!)).toEqual({ kategoria: "RETURN" });
  });

  it("wysyłka to ruch — przejście dalej po niej nie jest pominięciem, a „Cofnij” niesie czas", async () => {
    const u = userEvent.setup();
    pokaz("/obsluga/skrzynka/1");
    await u.type(await pole(), "Odpowiedź");
    await u.click(screen.getByRole("button", { name: /Wyślij do klienta/ }));
    await waitFor(() => expect(adres()).toBe("/obsluga/skrzynka/2"));
    await u.click(await screen.findByRole("button", { name: "Cofnij" }));
    const cofniecie = await waitFor(() => {
      const z = zadania.find((x) => x.url === "/api/conversations/1/wysylka-cofnieta");
      expect(z).toBeTruthy();
      return z!;
    });
    const { msOdKolejki } = JSON.parse(cofniecie.body!) as { msOdKolejki: number };
    expect(msOdKolejki).toBeGreaterThanOrEqual(0);
    expect(msOdKolejki).toBeLessThan(10_000);
    /* Z rozmowy 1 odeszło się wysyłką — pominięcia nie ma. Rozmowa 2, z której
       „Cofnij” zawróciło bez ruchu, jest pominięciem i tak ma być liczona. */
    await waitFor(() => expect(adres()).toBe("/obsluga/skrzynka/1"));
    await waitFor(() => expect(zadania.filter((z) => z.url === "/api/obsluga/pominiecie")).toHaveLength(1));
  });
});
