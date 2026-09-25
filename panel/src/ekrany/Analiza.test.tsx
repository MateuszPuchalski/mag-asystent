import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analiza } from "./Analiza";
import type { AnalizaAudytu, AnalizaDostaw, Metryki, RaportTygodnia, RaportWydajnosci } from "../api/wglad";

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

/* Kształt minimalny — treść karty ma własny test w `analiza/Ergonomia.test.tsx`. */
const ERGONOMIA = {
  days: 7, daneDo: null, progMs: 300,
  czasy: { n: 0, powyzejProgu: 0, udzialPowyzejProgu: 0, p95: null, wgTrasy: [], wgKolektora: [] },
  skanGlowny: { n: 0, p50: null, p95: null, wgKolektora: [] },
  powtorzoneSkany: [], odrzucenia: [], przerwy: [], poprawki: [],
};

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

/* Raport tygodnia — kształt jak `services/raport-tygodnia.ts`. */
const tydzien = (t: string, dni: string[], pozycje: number, migawki: RaportTygodnia["migawki"] = []): RaportTygodnia => ({
  wersja: 1, tydzien: t, od: "x", do: "x", dni,
  magazyn: { pozycje, pozycjeWgDnia: [pozycje, 0, 0, 0, 0, 0, 0], dostawZamknietych: 4, medianaMinutDostawy: 42,
    problemyZgloszone: 3, problemyRozwiazane: 2, dotknieciaNaPozycje: 0.2, p95SkanuMs: 180,
    etykietyDoPrzedruku: [{ kod: "R-11-2", reczne: 5 }], szukaniaBezWynikow: [{ q: "szarpak", ile: 2 }],
    upadkiKolektorow: 0, odrzuconeOperacje: 0 },
  obsluga: { wiadomosciOdKlientow: 40, odpowiedzi: 35, medianaMin: 38, p90Min: 250,
    klientCzekaNaKoniec: { n: 1, najdluzejMin: 120 }, zwrotyNowe: 6, zwrotyZamkniete: 5,
    reklamacjeNowe: 2, reklamacjeRozstrzygniete: 1 },
  copilot: { wywolan: 120, bledow: 1, kosztUsd: 1.37 },
  system: { kopieNocne: 7, rozjazdyRekoncyliacji: 0, zapisyNieudane: 0, odrzuconeZadaniaHttp: 3 },
  migawki,
});
const W38 = tydzien("2026-W38", ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"], 412,
  [{ data: "2026-09-21", at: "2026-09-20T22:05:00.000Z", stan: { doDecyzji: { wszystko: 9, magazyn: 4, obsluga: 5, pilne: 2, najstarszaGodz: 50 },
    problemyOtwarte: 3, kolejka: { bledy: 1, wDrodze: 0 }, klientCzeka: { n: 1, najdluzejMin: 120 },
    zwroty: { decyzja: 4 }, reklamacje: null } }]);
const W37 = tydzien("2026-W37", ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"], 400);
let tygodnie: string[] = ["2026-W38", "2026-W37"];

let adresy: string[] = [];
let zapisy: string[] = [];
let wydajnosc: RaportWydajnosci | null = WYDAJNOSC;

beforeEach(() => {
  adresy = []; zapisy = []; wydajnosc = WYDAJNOSC; tygodnie = ["2026-W38", "2026-W37"];
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
    if (url.startsWith("/api/analiza/ergonomia?days=")) return new Response(JSON.stringify(ERGONOMIA));
    if (url.startsWith("/api/analiza/obsluga?days=")) return new Response(JSON.stringify({
      dni: 30, daneDo: "2026-09-22T12:31:00.000Z",
      ogolem: { n: 42, medianaMin: 38, p90Min: 250 },
      wgKategorii: [{ klucz: "PRODUCT_COMPATIBILITY", n: 20, medianaMin: 95 },
        { klucz: "nierozpoznane", n: 3, medianaMin: 12 }],
      wgOsoby: null, czekaTeraz: { n: 2, najdluzejMin: 130 },
      powroty: { oknoDni: 7, n: 40, bezPowrotu: 30, wrocilo: 10, wrociloBezRozpoznania: 4, czeka: 2,
        wgKategorii: [{ klucz: "PRODUCT_COMPATIBILITY", n: 20, bezPowrotu: 11 }], wgOsoby: null },
    }));
    if (url.startsWith("/api/analiza/tarcie?days=")) return new Response(JSON.stringify({
      dni: 30, osoby: null, razem: { wyslanych: 40, zeSzkicem: 20, bezZmian: 9, udzialBezZmian: 0.45,
        cofnietychWysylek: 3, cofnietychZakonczen: 1, medianaSekDoWysylki: 95, probekCzasu: 38 } }));
    /* Miary obsługi (0.444.0, przyszły z ustawień). Kształty minimalne —
       treść każdej karty ma własny test obok niej; tu liczy się skład. */
    if (url === "/api/obsluga/sygnatury") return new Response(JSON.stringify(
      { pozycji: 0, bezSygnatury: 0, trafia: 0, sygnatur: 0, pudla: [], zdublowane: [] }));
    if (url === "/api/obsluga/pokrycie-wiedzy") return new Response(JSON.stringify({
      kartotek: 3200, zOpisem: 1400, zIdentyfikatorem: 460, identyfikatorow: 1900, identyfikatorowRecznych: 0,
      modeleZOpisu: { nowych: 0, przerobionych: 0, odrzuconych: 0 },
      zastosowania: { zatwierdzonych: 0, negatywnych: 0, propozycji: 0 },
      tokeny: { tokenow: 0, nowych: 0, zatwierdzonych: 0 }, wymiary: { kartotek: 0, wymiarow: 0 },
      fts: { dostepne: true, wpisow: 0 } }));
    if (url === "/api/obsluga/wiedza-automat") return new Response(JSON.stringify([]));
    if (url === "/api/obsluga/eskalacja") return new Response(JSON.stringify({ miesiace: [] }));
    if (url === "/api/obsluga/copilot") return new Response(JSON.stringify({ wlaczony: false, powod: "wyłączony",
      model: "x", modelKlasyfikacji: "x", maxPartia: 20, autoKlasyfikacja: false, autoSzkic: false }));
    if (url.startsWith("/api/obsluga/skutecznosc-doboru?dni=")) return new Response(JSON.stringify({
      dni: 30, granicaHistorii: null, wyborow: 4, drogi: [{ droga: "oem", wybranych: 4, zatwierdzonych: 0 }],
      medianaDoWyboruMin: 12, wyborowZCzasem: 4, osoby: [], bezKonta: 0,
      naStole: { doborow: 0, statusy: [] }, progWiarygodnosci: 20, podstawaPrawna: "art. 22²" }));
    if (url === "/api/biuro/zbiorki/kandydaci") {
      return new Response(JSON.stringify({ okno: null, prog: 0, kandydaci: [], juzWStrefie: 0, bezReguly: 0 }));
    }
    if (url.startsWith("/api/analiza/uzycie?days=")) return new Response(JSON.stringify({
      dni: 30, spozaRejestru: [],
      obszary: [{ obszar: "Skrzynka", nieuzywane: [{ typ: "rozmowa_priorytet", ile: 0, ostatnio: null }],
        uzywane: [{ typ: "rozmowa_wyslana", ile: 12, ostatnio: "2026-09-22T10:00:00Z" }] }] }));
    if (url === "/api/analiza/tygodnie") return new Response(JSON.stringify({ tygodnie: tygodnie.map((t) =>
      ({ tydzien: t, od: "x", do: "x", wersja: 1, utworzono: "x" })) }));
    if (url === "/api/analiza/tygodnie/2026-W38") return new Response(JSON.stringify({ raport: W38, poprzedni: W37 }));
    if (url === "/api/analiza/tygodnie/2026-W37") return new Response(JSON.stringify({ raport: W37, poprzedni: null }));
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

  it("ergonomia w liczbach stoi w pracy hali, słucha jej okna i nie idzie z innych zakresów", async () => {
    pokaz();
    await screen.findByText("Rosa-Pol");
    expect(adresy.some((a) => a.startsWith("/api/analiza/ergonomia"))).toBe(false);
    await naPraceHali();
    expect(await screen.findByText("Ergonomia w liczbach")).toBeTruthy();
    expect(adresy).toContain("/api/analiza/ergonomia?days=7");
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
    /* Kategoria stoi w dwóch tabelach od 24 września 2026: czasu
       i „bez ponownego pytania”. */
    expect(screen.getAllByText("Dobór").length).toBe(2);
    expect(screen.getByText("nierozpoznane")).toBeInTheDocument();
    expect(screen.queryByText("Według osoby")).toBeNull();
    expect(zapisy).toEqual([]);
  });

  /* Tarcie w skrzynce (@wydanie): trzy liczby pod czasem odpowiedzi, bez
     karty osób dla biura i bez zapisu przy otwarciu. */
  it("pokazuje tarcie: cofnięcia, czas do wysyłki i szkice bez zmian", async () => {
    pokaz();
    await screen.findByText("Rosa-Pol");
    await userEvent.click(screen.getByRole("button", { name: "Obsługa klienta" }));
    await screen.findByText("Tarcie w skrzynce");
    expect(adresy).toContain("/api/analiza/tarcie?days=30");
    expect(screen.getByText("95 s")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByText(/cofniętych wysyłek z 40/)).toBeInTheDocument();
    expect(screen.queryByText("Tarcie według osoby")).toBeNull();
    expect(zapisy).toEqual([]);
  });

  /* Bez ponownego pytania (24 września 2026): udział liczony z odpowiedzi
     z wynikiem, a niepewność i odpowiedzi bez wyniku stoją obok, nie w nim. */
  it("pokazuje udział bez ponownego pytania i mówi, ile w nim niepewności", async () => {
    pokaz();
    await screen.findByText("Rosa-Pol");
    await userEvent.click(screen.getByRole("button", { name: "Obsługa klienta" }));
    await screen.findByText("Bez ponownego pytania");
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText(/4 bez rozpoznania, mogło być podziękowanie/)).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
    expect(screen.queryByText("Bez ponownego pytania według osoby")).toBeNull();
  });

  /* Miary obsługi przeszły tu z ustawień w 0.444.0. Pilnujemy trzech
     rzeczy: stoją pod czasem odpowiedzi, dobór słucha okna ZAKRESU (jeden
     selektor, nie dwa) i żadna z nich nie pobiera się w innym zakresie. */
  it("niesie miary obsługi z ustawień; dobór idzie za oknem zakresu", async () => {
    pokaz();
    await screen.findByText("Rosa-Pol");
    expect(adresy.some((a) => a.startsWith("/api/obsluga/"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Obsługa klienta" }));
    await screen.findByText("Sygnatura → kartoteka Subiekta");
    expect(screen.getByText("Wiedza z opisów kartotek i ofert")).toBeInTheDocument();
    await screen.findByText(/Skuteczność doboru/);
    expect(adresy).toContain("/api/obsluga/skutecznosc-doboru?dni=30");
    /* Karta doboru nie ma już własnego selektora okna. */
    expect(screen.queryByRole("group", { name: "Okno raportu" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "7 dni" }));
    await waitFor(() => expect(adresy).toContain("/api/obsluga/skutecznosc-doboru?dni=7"));
    /* Wyłączony Copilot nie zostawia po sobie pustej karty. */
    expect(screen.queryByText(/Copilot — rozpoznawanie kategorii/)).toBeNull();
    expect(zapisy).toEqual([]);
  });
});

/* ── Zakres Użycie (23 września 2026) ────────────────────────────────────────
   Nieużyte czynności stoją na wierzchu, użyte — zwinięte; wejście w zakres
   pobiera wyłącznie jego raport i niczego nie zapisuje. */
describe("zakres Użycie", () => {
  it("pokazuje nieużyte na wierzchu, pobiera tylko swój raport i niczego nie zapisuje", async () => {
    pokaz();
    await screen.findByText("Rosa-Pol");
    await userEvent.click(screen.getByRole("button", { name: "Użycie" }));
    expect(await screen.findByText("rozmowa_priorytet")).toBeTruthy();
    expect(screen.getByText("nigdy")).toBeTruthy();
    expect(screen.getByText("Użyte (1)")).toBeTruthy();
    expect(adresy.some((a) => a === "/api/analiza/uzycie?days=30")).toBe(true);
    expect(zapisy).toEqual([]);
  });
});

/* ── Zakres TYDZIEŃ (0.497.0) ───────────────────────────────────────────────
   Raport tygodnia zapisuje takt serwera, a ekran tylko czyta. Pilnujemy:
   zero zapisu przy patrzeniu i przy zmianie tygodnia, porównanie z poprzednim
   w sztukach, brak czipów okna i zdanie zamiast pustej karty. */
describe("Analiza: zakres Tydzień", () => {
  const naTydzien = async () => {
    await screen.findByText("Rosa-Pol");
    await userEvent.click(screen.getByRole("button", { name: "Tydzień" }));
  };

  it("najnowszy tydzień z poprzednim obok, różnica w sztukach, bez zapisu", async () => {
    pokaz();
    await naTydzien();
    expect(await screen.findByText("Tydzień t38 · 14.09–20.09.2026")).toBeTruthy();
    const wiersz = screen.getByText("Pozycje rozłożone i przeniesione").closest("tr")!;
    expect(wiersz.textContent).toContain("412");
    expect(wiersz.textContent).toContain("400");
    expect(wiersz.textContent).toContain("+12");
    // migawka: stan na zamknięcie tygodnia, a sekcja bez odczytu to kreska
    expect(screen.getByText("21.09")).toBeTruthy();
    expect(screen.getByText("R-11-2")).toBeTruthy();
    // raport ma stałe granice — czip okna niczego by nie zmienił
    expect(screen.queryByRole("group", { name: "Okno analizy" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "t37" }));
    expect(await screen.findByText(/Poprzedniego tygodnia nie policzono/)).toBeTruthy();
    expect(adresy).toContain("/api/analiza/tygodnie/2026-W37");
    expect(zapisy).toEqual([]);
  });

  it("bez raportów mówi, kiedy powstanie pierwszy, i nie pyta o żaden tydzień", async () => {
    tygodnie = [];
    pokaz();
    await naTydzien();
    expect(await screen.findByText(/Pierwszy raport powstanie sam w poniedziałek/)).toBeTruthy();
    expect(adresy.filter((a) => a.startsWith("/api/analiza/tygodnie/"))).toEqual([]);
  });
});
