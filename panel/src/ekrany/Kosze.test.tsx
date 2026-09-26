import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Kosze } from "./Kosze";
import { Dowody } from "../zwroty/Dowody";
import type { Pominieta, SzczegolKosza, WierszKosza } from "../api/kosze";
import type { Zwrot } from "../api/typy";
import { _wyczyscPamiecZdjec } from "../towar/useZdjecie";

/* ── Kosze w zakładce Zwroty (0.438.0) ─────────────────────────────────────
   Gwarancje przeniesione z MAGAZYNU ZWROTÓW w `biuro.html` i jedna nowa:

   1. ZERO ZAPISU PRZY PATRZENIU — otwarcie ekranu i wejście w kosz to same
      odczyty (umowa z `CLAUDE.md`).
   2. WIĄZANIE KOSZ ↔ ZWROT W OBIE STRONY. Kosz prowadzi do swoich zwrotów,
      a karta zwrotu do swoich koszy. Do 0.438.0 działała tylko pierwsza
      połowa — a wiązanie jednostronne to wiązanie, którego nie ma.
   3. POMINIĘTE czekają na ZAŁATWIONE z notatką; pozycja zostaje pominięta.
   4. „W KTÓRYM KOSZU?" szuka SERWER, po snapshocie z kosza.
   5. PRZEŁĄCZNIK prowadzi między zwrotami a koszami w jednej zakładce. */

const kosz = (id: number, o: Partial<WierszKosza> = {}): WierszKosza => ({
  id, kod: `Z-${id}`, status: "zamkniety", pozycji: 3, odlozonych: 1, pominietych: 0, mmNumer: null,
  utworzonoAt: "2026-09-20T08:00:00.000Z", zamknietoAt: "2026-09-20T10:00:00.000Z", zamknietoPrzez: "Ala",
  rozlozonoAt: null, rozlozonoPrzez: null, rodzaj: "zwroty", anulowanoAt: null, anulowanoPrzez: null,
  zwrotow: 2, brakujeKorekt: 0, mmStan: "zamowiona", wirtualny: true, ...o,
});

const SZCZEGOL: SzczegolKosza = {
  id: 14, kod: "Z-14", status: "zamkniety", utworzonoAt: "2026-09-20T08:00:00.000Z",
  zamknietoAt: "2026-09-20T10:00:00.000Z", zamknietoPrzez: "Ala", rozlozonoAt: null, rozlozonoPrzez: null,
  odlozonych: 1, mmNumer: null, powrot: null, rodzaj: "zwroty", anulowanoAt: null, anulowanoPrzez: null,
  doEdycji: false,
  zwroty: [{ id: 501, numer: "ZW-501", korektaNumer: "KFS 7/2026" }, { id: 502, numer: "ZW-502", korektaNumer: null }],
  pozycje: [
    { id: 1, twId: 7, symbol: "HM-0410", nazwa: "Szarpak", ilosc: 1, status: "done", unit: "szt.",
      lokOczekiwana: "ZWR-1", lokFaktyczna: "ZWR-1", odlozonoPrzez: "j.wrona", odlozonoAt: "2026-09-21T09:00:00.000Z",
      zalatwioneAt: null, zalatwionePrzez: null, zalatwioneNotatka: null, powod: null, mmStatus: null, mmNumer: null },
    { id: 2, twId: 8, symbol: "HM-0520", nazwa: "Gaźnik", ilosc: 2, status: "skipped", unit: "szt.",
      lokOczekiwana: null, lokFaktyczna: null, odlozonoPrzez: null, odlozonoAt: null,
      zalatwioneAt: null, zalatwionePrzez: null, zalatwioneNotatka: null, powod: "brak w pudle", mmStatus: null, mmNumer: null },
  ],
};

const POMINIETE: Pominieta[] = [{ pozycjaId: 2, koszId: 14, kod: "Z-14", mmNumer: null, twId: 8,
  symbol: "HM-0520", nazwa: "Gaźnik", ilosc: 2, powod: "brak w pudle", at: "2026-09-21T09:00:00.000Z", dni: 1 }];

let wyslane: string[] = [];
let szukane: string[] = [];
/* Pierwsza odmowa ponowienia MM (0.503.0): `null` = serwer ponawia od razu. */
let odmowaPonowienia: string | null = null;

function odpowiedz(url: string, init?: RequestInit): unknown {
  const metoda = init?.method ?? "GET";
  if (metoda !== "GET") {
    wyslane.push(`${metoda} ${url} ${init?.body ?? ""}`);
    if (url.endsWith("/ponow-mm")) {
      const blad = odmowaPonowienia; odmowaPonowienia = null;
      return blad ? { __status: 409, error: blad } : { ponowione: 3 };
    }
    return { pominiete: [] };
  }
  if (url === "/api/biuro/kosze/17") return { kosz: { ...SZCZEGOL, id: 17, kod: "Z-17", status: "rozlozony" } };
  /* Kosz jeszcze bez dokumentu — przeliczenie jest dozwolone (@wydanie). */
  if (url === "/api/biuro/kosze/18") return { kosz: { ...SZCZEGOL, id: 18, kod: "Z-18", status: "otwarty", doEdycji: true } };
  if (url === "/api/biuro/kosze/16") return { kosz: { ...SZCZEGOL, id: 16, kod: "Z-16", status: "otwarty" } };
  if (url === "/api/biuro/kosze") return { kosze: [kosz(14, { pominietych: 1 }),
    /* Kłopoty z MM (0.501.0): rozłożony po odmowie i otwarty z błędem teraz. */
    kosz(15, { status: "rozlozony", problemMm: { prob: 1, ostatniBlad: "Brak towaru w magazynie",
      ostatnioAt: "2026-09-21T09:00:00.000Z", nierozwiazany: false } }),
    kosz(16, { status: "otwarty", problemMm: { prob: 3, ostatniBlad: "Kartoteka w edycji",
      ostatnioAt: "2026-09-22T09:00:00.000Z", nierozwiazany: true } }),
    /* Bez MM powrotnego (0.505.0): rozłożony, dokument bez znanego kierunku. */
    kosz(17, { status: "rozlozony", rozlozonoAt: "2026-09-20T09:00:00.000Z", bezPowrotu: "kierunek" })] };
  if (url === "/api/biuro/kosze/pominiete") return { pominiete: POMINIETE };
  if (url === "/api/biuro/kosze/14") return { kosz: SZCZEGOL };
  if (url.startsWith("/api/biuro/kosze/szukaj?q=")) {
    szukane.push(decodeURIComponent(url.split("q=")[1]));
    return { znalezione: [{ koszId: 15, kod: "Z-15", mmNumer: null, koszStatus: "rozlozony", symbol: "HM-0410",
      nazwa: "Szarpak", ilosc: 1, status: "done", lokFaktyczna: "ZWR-2", powod: null, kiedy: null }] };
  }
  /* Pasek otwartego koszyka pyta o swoje — tu pusty, bo test nie jest o nim. */
  if (url === "/api/obsluga/zwroty/kosz") return { kosze: [] };
  throw new Error(`nieoczekiwany adres w teście: ${url}`);
}

beforeEach(() => {
  wyslane = []; szukane = []; odmowaPonowienia = null;
  _wyczyscPamiecZdjec();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (/\/zdjecie$/.test(url)) return new Response("{}", { status: 404 });
    const tresc = odpowiedz(url, init) as { __status?: number };
    return new Response(JSON.stringify(tresc), { status: tresc.__status ?? 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function Adres() { return <span data-testid="adres">{useLocation().pathname}</span>; }

function pokaz(adres = "/obsluga/zwroty/kosze") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={[adres]}>
      <Routes>
        <Route path="/obsluga/zwroty/kosze" element={<Kosze />} />
        <Route path="/obsluga/zwroty/kosze/:id" element={<Kosze />} />
        <Route path="*" element={<Adres />} />
      </Routes>
      <Adres />
    </MemoryRouter>
  </QueryClientProvider>);
}

describe("Kosze w zakładce Zwroty", () => {
  it("otwarcie ekranu i wejście w kosz nie wysyłają ani jednego zapisu", async () => {
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Z-14/ }));
    expect(await screen.findByRole("heading", { name: "Z-14" })).toBeInTheDocument();
    expect(wyslane).toEqual([]);
  });

  it("kubełek W PRACY niesie kosze w drodze, a rozłożone czekają we własnym", async () => {
    pokaz();
    expect(await screen.findByRole("button", { name: /Z-14/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Z-16/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Z-15/ })).toBeNull();
  });

  it("kosze z kłopotem MM mają znacznik i własny kubełek z treścią odmowy (0.501.0)", async () => {
    /* Zgłoszenie właściciela: „muszę sprawdzić stany z Subiektem". */
    pokaz();
    const w16 = await screen.findByRole("button", { name: /Z-16/ });
    expect(within(w16).getByText("MM w błędzie")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /Z-14/ })).queryByText(/MM (w|po) błędzie/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Problem z MM/ }));
    const wiersze = screen.getAllByRole("button", { name: /Z-1[567]/ });
    /* Najświeższy kłopot na górze — przekrój przez kubełki, także rozłożone.
       Kosz bez MM powrotnego stoi po chwili rozłożenia. */
    expect(wiersze.map((w) => within(w).getByText(/^Z-/).textContent)).toEqual(["Z-16", "Z-15", "Z-17"]);
    expect(within(wiersze[2]).getByText(/MM powrotne nie powstało/)).toBeInTheDocument();
    expect(within(wiersze[2]).getByText("bez MM powrotnej")).toBeInTheDocument();
    expect(within(wiersze[1]).getByText(/Brak towaru w magazynie/)).toBeInTheDocument();
    expect(within(wiersze[1]).getByText("MM po błędzie")).toBeInTheDocument();
    expect(wyslane).toEqual([]);
  });

  it("MM w błędzie ponawia się z karty kosza jednym przyciskiem (0.503.0)", async () => {
    /* Zgłoszenie właściciela: „dodaj, abym mógł wywołać ponownie". */
    pokaz("/obsluga/zwroty/kosze/16");
    await userEvent.click(await screen.findByRole("button", { name: "Ponów MM" }));
    expect(wyslane).toEqual(['POST /api/biuro/kosze/16/ponow-mm {"sprawdzono":false}']);
    expect(await screen.findByText(/Ponowiono 3 MM/)).toBeInTheDocument();
  });

  it("MM przerwane w zapisie wymaga drugiego ruchu po sprawdzeniu w Subiekcie (0.503.0)", async () => {
    odmowaPonowienia = "Jedno MM przerwano w trakcie zapisu. Sprawdź w Subiekcie, czy dokument nie powstał.";
    pokaz("/obsluga/zwroty/kosze/16");
    await userEvent.click(await screen.findByRole("button", { name: "Ponów MM" }));
    expect(await screen.findByText(/Sprawdź w Subiekcie/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Sprawdziłem w Subiekcie/ }));
    expect(wyslane).toEqual([
      'POST /api/biuro/kosze/16/ponow-mm {"sprawdzono":false}',
      'POST /api/biuro/kosze/16/ponow-mm {"sprawdzono":true}',
    ]);
  });

  it("MM, które weszło po błędzie, nie ma przycisku — zostaje sprawdzenie stanów", async () => {
    pokaz("/obsluga/zwroty/kosze/14");
    expect(await screen.findByRole("heading", { name: "Z-14" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ponów MM/ })).toBeNull();
  });

  it("karta kosza bez MM powrotnego mówi, co zrobić — zależnie od przyczyny (0.505.0)", async () => {
    pokaz("/obsluga/zwroty/kosze/17");
    expect(await screen.findByText(/MM powrotne wystaw w Subiekcie/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ponów MM/ })).toBeNull();
    expect(wyslane).toEqual([]);
  });

  it("kosz prowadzi do swoich zwrotów — połowa wiązania od strony kosza", async () => {
    pokaz("/obsluga/zwroty/kosze/14");
    const link = await screen.findByRole("link", { name: "ZW-501" });
    expect(link).toHaveAttribute("href", "/obsluga/zwroty/501");
    expect(screen.getByRole("link", { name: "ZW-502" })).toHaveAttribute("href", "/obsluga/zwroty/502");
  });

  it("karta zwrotu prowadzi do swojego kosza — druga połowa wiązania", () => {
    /* Tylko to, co Dowody czytają poza sekcją koszy — reszta zwrotu jest
       tu nieistotna, a pełna fikstura przykryłaby, o co chodzi w teście. */
    const zwrot = { id: 501, utworzono: "2026-09-19T08:00:00.000Z", terminAt: null, dniDoTerminu: null,
      zamowienie: null, orderId: null, rozmowy: [], pozycje: [] } as unknown as Zwrot;
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><MemoryRouter>
      <Dowody zwrot={zwrot} kosze={[{ id: 14, kod: "Z-14", status: "zamkniety" }]} />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("link", { name: "Z-14" })).toHaveAttribute("href", "/obsluga/zwroty/kosze/14");
    expect(screen.getByText("na hali")).toBeInTheDocument();
  });

  it("pominięte otwierają swój kosz, a ZAŁATWIONE wysyła notatkę — i tylko to", async () => {
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /Pominięte/ }));
    await userEvent.click(await screen.findByRole("button", { name: /HM-0520/ }));
    expect(screen.getAllByTestId("adres")[0]).toHaveTextContent("/obsluga/zwroty/kosze/14");
    const prawa = await screen.findByText(/Pominięte do załatwienia/);
    await userEvent.click(within(prawa.closest("div")!).getByRole("button", { name: "Załatwione" }));
    await userEvent.type(screen.getByLabelText("Jak załatwiono"), "znalazło się");
    await userEvent.click(screen.getAllByRole("button", { name: "Załatwione" }).at(-1)!);
    await waitFor(() => expect(wyslane).toEqual(
      ['POST /api/biuro/kosze/pominiete/2/zalatwione {"notatka":"znalazło się"}']));
  });

  it("„w którym koszu?” pyta SERWER i prowadzi do znalezionego kosza", async () => {
    pokaz();
    await screen.findByRole("button", { name: /Z-14/ });
    await userEvent.type(screen.getByLabelText("Szukaj towaru w koszach"), "HM");
    await waitFor(() => expect(szukane).toContain("HM"));
    await userEvent.click(await screen.findByRole("button", { name: /Szarpak/ }));
    expect(screen.getAllByTestId("adres")[0]).toHaveTextContent("/obsluga/zwroty/kosze/15");
  });

  it("kolejka nie powtarza tytułem wybranej zakładki przełącznika (@wydanie)", async () => {
    pokaz();
    await screen.findByRole("button", { name: /Z-14/ });
    /* Nazwa „Kosze" stoi raz — w przełączniku, który mówi, gdzie jesteśmy. */
    expect(screen.queryByText("Kosze", { selector: "b" })).toBeNull();
  });

  it("wyjaśnienie przeliczenia siedzi w podpowiedzi przycisku, nie w akapicie (@wydanie)", async () => {
    pokaz("/obsluga/zwroty/kosze/18");
    const przycisk = await screen.findByRole("button", { name: "Przelicz ze zwrotów" });
    expect(przycisk).toHaveAttribute("title", expect.stringMatching(/Dokumentu jeszcze nie ma/));
    /* Tekst nie stoi drugi raz jako akapit pod nagłówkiem kosza. */
    expect(screen.queryByText(/Dokumentu jeszcze nie ma/)).toBeNull();
    expect(wyslane).toEqual([]);
  });

  it("przełącznik prowadzi z koszy z powrotem do zwrotów", async () => {
    pokaz();
    await userEvent.click(await screen.findByRole("button", { name: /^Zwroty/ }));
    expect(screen.getAllByTestId("adres")[0]).toHaveTextContent(/^\/obsluga\/zwroty$/);
  });
});
