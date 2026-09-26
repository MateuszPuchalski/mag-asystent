import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DoDecyzji } from "./DoDecyzji";
import type { PozycjaDecyzji } from "../api/decyzje";

/* ── DO DECYZJI (0.435.0) ──────────────────────────────────────────────────
   Trzy gwarancje ekranu startowego biura:

   1. ZERO ZAPISU. To ekran, na który się WCHODZI — co rano i po każdej
      przerwie. Umowa „zero zapisu przy patrzeniu" obowiązuje go bardziej
      niż każdy inny.
   2. WIERSZ PROWADZI DO ŹRÓDŁA. Ekran przeniesiony ma adres panelu, a ten,
      który jeszcze mieszka w biurze, otwiera się mostem — z tokenem, żeby
      człowiek nie logował się drugi raz.
   3. KOLEJNOŚĆ JEST SERWERA. Panel jej nie przestawia — dwie reguły
      sortowania rozjechałyby się przy pierwszej poprawce jednej z nich. */

const POZYCJE: PozycjaDecyzji[] = [
  { klucz: "zapis:1", obszar: "magazyn", zrodlo: "zapisy", pytanie: "Ponowić czy anulować zapis do Subiekta?",
    co: "RP-2201 → R-07-1 · brak stanu", od: "2026-09-21T10:00:00.000Z", pilne: true, cel: { panel: "/obsluga/stan?karta=kolejka" } },
  { klucz: "dostawa:802", obszar: "magazyn", zrodlo: "dostawy", pytanie: "Reklamować u dostawcy czy zamknąć wyjątki?",
    co: "FZ 802/MAG/09/2026 · Rosa-Pol · 2 wyjątki", od: "2026-09-20T10:00:00.000Z", pilne: false,
    cel: { panel: "/obsluga/dostawy/802" } },
  { klucz: "kolejka:reklamacje", obszar: "obsluga", zrodlo: "reklamacje", pytanie: "Uznać czy odrzucić?",
    co: "3 reklamacje czekają na werdykt", od: "2026-09-19T10:00:00.000Z", pilne: false,
    cel: { panel: "/obsluga/reklamacje" } },
];

let wyslane: string[] = [];

beforeEach(() => {
  wyslane = [];
  localStorage.clear();
  localStorage.setItem("wertis-panel-token", "tok-biura");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "GET") wyslane.push(`${init?.method} ${url}`);
    if (url === "/api/biuro/do-decyzji") {
      return new Response(JSON.stringify({ pozycje: POZYCJE,
        liczniki: { wszystko: 3, magazyn: 2, obsluga: 1 } }));
    }
    if (url === "/api/obsluga/moje") return new Response(JSON.stringify({ sprawy: [] }));
    if (url === "/api/obsluga/wzmianki") return new Response(JSON.stringify({ wzmianki: [], nowe: 0 }));
    if (url === "/api/obsluga/ja") {
      return new Response(JSON.stringify({ user: { userId: 1, name: "Ola Biuro", role: "biuro" } }));
    }
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={["/obsluga/"]}><DoDecyzji /></MemoryRouter>
  </QueryClientProvider>);
}

describe("DO DECYZJI", () => {
  it("otwarcie ekranu niczego nie zapisuje", async () => {
    pokaz();
    await screen.findByText("Uznać czy odrzucić?");
    expect(wyslane).toEqual([]);
  });

  it("kolejność wierszy jest kolejnością serwera", async () => {
    pokaz();
    await screen.findByText("Uznać czy odrzucić?");
    const decyzje = screen.getByRole("region", { name: "Do decyzji biura" });
    const pytania = within(decyzje).getAllByRole("listitem").map((li) => li.querySelector("b")?.textContent);
    expect(pytania).toEqual(POZYCJE.map((p) => p.pytanie));
  });

  it("każdy wiersz prowadzi do ekranu panelu — zapis w błędzie wprost do karty kolejki (0.441.0)", async () => {
    /* Do 0.441.0 zapis w błędzie prowadził mostem do `/biuro`, na STAN
       SYSTEMU. Stan przeszedł do panelu, a wiersz trafia wprost do karty,
       na której rozstrzyga się jego sprawa. */
    pokaz();
    const dostawa = await screen.findByRole("link", { name: /Reklamować u dostawcy/ });
    expect(dostawa).toHaveAttribute("href", "/obsluga/dostawy/802");
    const zapis = screen.getByRole("link", { name: /Ponowić czy anulować/ });
    expect(zapis).toHaveAttribute("href", "/obsluga/stan?karta=kolejka");
    expect(screen.queryAllByRole("link").filter((a) => a.getAttribute("href") === "/biuro")).toEqual([]);
  });

  it("sito obszaru zawęża listę i niesie liczniki", async () => {
    pokaz();
    await screen.findByText("Uznać czy odrzucić?");
    await userEvent.click(screen.getByRole("button", { name: /Obsługa klienta/ }));
    expect(screen.queryByText("Reklamować u dostawcy czy zamknąć wyjątki?")).toBeNull();
    expect(screen.getByText("Uznać czy odrzucić?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Magazyn 2/ })).toBeInTheDocument();
    /* Suma stoi w nagłówku sekcji (0.524.0), więc „Wszystko" nie powtarza jej
       w pigułce — jeden fakt, jedno miejsce. */
    expect(screen.getByRole("heading", { name: "Do decyzji biura · 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wszystko" })).toBeInTheDocument();
  });
});

/* ── Jedna lista „Do zrobienia" (23 września 2026) ───────────────────────────
   Wzmianki i moje sprawy stoją na tym samym ekranie co decyzje, w tej
   kolejności — i ich dojście niczego nie zapisuje. */
describe("DO ZROBIENIA — trzy sekcje na jednym ekranie", () => {
  it("wzmianki, moje sprawy i decyzje biura, w tej kolejności, bez zapisu", async () => {
    pokaz();
    await screen.findByText("Uznać czy odrzucić?");
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label")))
      .toEqual(["Wspomniano o mnie", "Moje sprawy", "Do decyzji biura"]);
    expect(await screen.findByText(/Nikt Cię jeszcze nie wzmiankował/)).toBeInTheDocument();
    expect(await screen.findByText(/Nic nie prowadzisz/)).toBeInTheDocument();
    expect(wyslane).toEqual([]);
  });

  it("bez tytułu nad sekcjami; trzy nagłówki mają jeden kształt licznika (0.524.0)", async () => {
    /* Tytuł „Do zrobienia" powtarzał podświetloną zakładkę. Liczniki miały
       trzy zapisy; teraz każdy stoi po kropce w nagłówku sekcji. */
    pokaz();
    await screen.findByText("Uznać czy odrzucić?");
    await screen.findByText(/Nic nie prowadzisz/);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByText(/najpilniejsze pierwsze/)).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent))
      .toEqual(["Wspomniano o mnie · 0", "Moje sprawy · 0", "Do decyzji biura · 3"]);
  });
});
