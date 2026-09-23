import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analiza } from "./Analiza";
import type { AnalizaAudytu, AnalizaDostaw, Metryki, RaportWydajnosci } from "../api/wglad";

/* ── ANALIZA w panelu (0.440.0) ──────────────────────────────────────────
   Gwarancje przeniesione z ANALIZY w `biuro.html`:

   1. ZERO ZAPISU PRZY PATRZENIU — oba zakresy, każde okno, to same odczyty.
   2. POBIERANY JEST TYLKO WIDOCZNY ZAKRES.
   3. WYDAJNOŚĆ PER OSOBA stoi z podstawą prawną i zdaniem, że zgłoszony
      problem NIE jest miarą błędu — strażnik z `biuro.test.ts` przeszedł tu.
      Dla roli biuro serwer przysyła `null` i karty nie ma wcale.
   4. KAŻDY ZAKRES MA SWOJE OKNA — czip spoza zbioru trasy nie istnieje.
   5. WGRANIE ZBIÓREK to jedyny zapis i idzie jako `{ csv }`.
   6. METRYKI słuchają okna pracy hali — przeszły tu ze stanu systemu. */

const DOSTAWY: AnalizaDostaw = {
  dni: 90, zamknietych: 66, pozaWertis: 2, pozycjiRozlozonych: 1874, udzialWyjatkow: 4.2, medianaDni: 2,
  dostawcy: [{ dostawca: "Rosa-Pol", dostaw: 11, pozycji: 300, udzialWyjatkow: 7, medianaDni: 2 }],
  wyjatki: [{ typ: "brak", nazwa: "Brak towaru", otwartych: 3, rozwiazanych: 9 }],
  tygodnie: [{ tydzien: "2026-W37", ile: 11 }, { tydzien: "2026-W38", ile: 22 }],
  szczyt: null, daneDo: "2026-09-22T12:31:00.000Z",
};

const WYDAJNOSC: RaportWydajnosci = {
  days: 7, podstawaPrawna: "Monitoring pracy — art. 22² Kodeksu pracy.", progWiarygodnosci: 20,
  wiersze: [{ userId: 3, osoba: "Jan Wrona", pozycje: 412, minutyAktywne: 1140, tempo: 21.7,
    zgloszoneProblemy: 6, recznePrzepisania: 2, wiarygodne: true }],
  nieprzypisanychZdarzen: 0,
};

const hala = (wydajnosc: RaportWydajnosci | null): AnalizaAudytu => ({
  days: 7, dni: [{ data: "2026-09-21", pozycje: 40, zdarzen: 90 }], godziny: Array(24).fill(1),
  rytm: { dostawZamknietych: 5, medianaMinutDostawy: 42, pozycjiNaDostawe: 8, problemyZgloszone: 3,
    problemyRozwiazane: 2, problemyOtwarte: 1 },
  szukania: { top: [{ q: "szarpak", ile: 9 }], bezWynikow: [] },
  urzadzenia: [{ device: "KOL-03", upadki: 2, niskieBaterie: 0, odrzucone: 0, zdarzen: 400 }],
  wydajnosc, szczyt: null, daneDo: "2026-09-22T12:31:00.000Z",
});

const METRYKI: Metryki = { days: 7, dotknieciaNaPozycje: 0.2, p95OdpowiedziMs: 120,
  etykietyDoPrzedruku: [{ code: "R-09-4", reczne: 3, razem: 10, udzial: 0.3 }], towaryBezCzytelnegoKodu: [], zdarzen: 900 };

let adresy: string[] = [];
let zapisy: string[] = [];
let wydajnosc: RaportWydajnosci | null = WYDAJNOSC;

beforeEach(() => {
  adresy = []; zapisy = []; wydajnosc = WYDAJNOSC;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metoda = init?.method ?? "GET";
    adresy.push(url);
    if (metoda !== "GET") {
      zapisy.push(`${metoda} ${url} ${init?.body ?? ""}`);
      return new Response(JSON.stringify({ wierszy: 3, nowych: 3, pominietychDuplikatow: 0, dopasowanych: 3,
        niedopasowanych: 0, przykladyNiedopasowanych: [], odrzuconychWierszy: 0, okres: { od: "2026-09-01", do: "2026-09-21" } }));
    }
    if (url.startsWith("/api/biuro/dostawy/analiza?dni=")) return new Response(JSON.stringify({ analiza: DOSTAWY }));
    if (url.startsWith("/api/analiza?days=")) return new Response(JSON.stringify(hala(wydajnosc)));
    if (url.startsWith("/api/metrics?days=")) return new Response(JSON.stringify(METRYKI));
    if (url.startsWith("/api/analiza/obsluga?days=")) return new Response(JSON.stringify({
      dni: 30, daneDo: "2026-09-22T12:31:00.000Z",
      ogolem: { n: 42, medianaMin: 38, p90Min: 250 },
      wgKategorii: [{ klucz: "PRODUCT_COMPATIBILITY", n: 20, medianaMin: 95 },
        { klucz: "nierozpoznane", n: 3, medianaMin: 12 }],
      wgOsoby: null, czekaTeraz: { n: 2, najdluzejMin: 130 },
    }));
    if (url === "/api/biuro/zbiorki/kandydaci") {
      return new Response(JSON.stringify({ okno: null, prog: 0, kandydaci: [], juzWStrefie: 0, bezReguly: 0 }));
    }
    if (url === "/api/auth/me") return new Response(JSON.stringify({ user: { userId: 1, name: "Anna", role: "admin" } }));
    throw new Error(`nieoczekiwany adres w teście: ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><Analiza /></MemoryRouter></QueryClientProvider>);
}

const naPraceHali = async () => {
  await screen.findByText("Rosa-Pol");
  await userEvent.click(screen.getByRole("button", { name: "Praca hali" }));
  await screen.findByText("Operacje per dzień");
};

describe("Analiza w panelu", () => {
  it("startuje na dostawach i pobiera WYŁĄCZNIE ten zakres", async () => {
    pokaz();
    await screen.findByText("Rosa-Pol");
    expect(adresy).toEqual(["/api/biuro/dostawy/analiza?dni=90"]);
    expect(screen.getByRole("button", { name: "90 dni" }).getAttribute("aria-pressed")).toBe("true");
    /* Zakres dostaw nie ma trasy eksportu, więc nie ma przycisku CSV. */
    expect(screen.queryByRole("button", { name: /CSV/ })).toBeNull();
  });

  it("zero zapisu przy patrzeniu — oba zakresy i zmiana okna", async () => {
    pokaz();
    await naPraceHali();
    await userEvent.click(screen.getByRole("button", { name: "30 dni" }));
    await waitFor(() => expect(adresy).toContain("/api/analiza?days=30"));
    expect(adresy).toContain("/api/metrics?days=30");
    expect(zapisy).toEqual([]);
  });

  it("każdy zakres ma swoje okna i pamięta wybór", async () => {
    pokaz();
    await screen.findByText("Rosa-Pol");
    expect(screen.getByRole("button", { name: "180 dni" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "7 dni" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "30 dni" }));
    await naPraceHali();
    expect(screen.getByRole("button", { name: "7 dni" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Dostawy" }));
    expect(screen.getByRole("button", { name: "30 dni" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("wydajność per osoba stoi z podstawą prawną i zdaniem o zgłoszeniach (strażnik z biura)", async () => {
    pokaz();
    await naPraceHali();
    expect(screen.getByText("Wydajność per osoba")).toBeTruthy();
    expect(screen.getByText(/art\. 22² Kodeksu pracy/)).toBeTruthy();
    expect(screen.getByText("nie są miarą błędu")).toBeTruthy();
    expect(screen.getByText("Jan Wrona")).toBeTruthy();
  });

  it("rola biuro nie dostaje raportu per osoba — karty nie ma wcale", async () => {
    wydajnosc = null;
    pokaz();
    await naPraceHali();
    expect(screen.queryByText("Wydajność per osoba")).toBeNull();
    expect(screen.queryByText("Jan Wrona")).toBeNull();
  });

  it("metryki przyszły ze stanu systemu i słuchają okna pracy hali", async () => {
    pokaz();
    await naPraceHali();
    expect(await screen.findByText("R-09-4")).toBeTruthy();
    expect(adresy).toContain("/api/metrics?days=7");
  });

  it("wgranie zbiórek to jedyny zapis i idzie jako { csv }", async () => {
    pokaz();
    await naPraceHali();
    const plik = new File(["symbol;data\nHM-1;2026-09-01"], "zbiorki.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText("Plik CSV zbiórek"), plik);
    await screen.findByText(/Wgrano 3 wierszy/);
    expect(zapisy).toEqual([`POST /api/biuro/zbiorki/import ${JSON.stringify({ csv: "symbol;data\nHM-1;2026-09-01" })}`]);
  });
});

/* ── Zakres OBSŁUGA KLIENTA (23 września 2026) ───────────────────────────────
   Luka zapisana w ekranie od 0.440.0. Pilnujemy trzech rzeczy: zakres pobiera
   tylko siebie, nie zapisuje nic i nie rysuje karty osób, gdy serwer jej
   nie przysłał (rola biuro). */
describe("zakres Obsługa klienta", () => {
  it("pokazuje medianę i kategorie, bez karty osób dla biura, bez zapisu", async () => {
    pokaz();
    await screen.findByText("Rosa-Pol");
    await userEvent.click(screen.getByRole("button", { name: "Obsługa klienta" }));
    await screen.findByText("Czas odpowiedzi klientowi");
    expect(adresy).toContain("/api/analiza/obsluga?days=30");
    expect(screen.getByText("38 min")).toBeInTheDocument();
    expect(screen.getByText("Dobór")).toBeInTheDocument();
    expect(screen.getByText("nierozpoznane")).toBeInTheDocument();
    expect(screen.queryByText("Według osoby")).toBeNull();
    expect(zapisy).toEqual([]);
  });
});
