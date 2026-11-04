import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { atrapaZapisow } from "../test/zapisy";
import { Wymiary, braki } from "./Wymiary";
import { rozpoznajSymbole, type ListaBezWymiarow, type PozycjaBezWymiarow } from "../api/wymiary";

/* ── Ekran „Wymiary” ──────────────────────────────────────────────────────
   1. ZERO ZAPISU PRZY OTWARCIU, także gdy formularz sam wybiera pierwszy towar.
   2. Wyłączona funkcja: zdanie z serwera zamiast formularza.
   3. Pełna droga samą klawiaturą: Enter po polach, zapis, następny towar.
   4. Puste pole nie jedzie do serwera — zostaje w Subiekcie bez zmian.
   5. Towar w kolejce jest wyszarzony i nie da się go wybrać.
   6. Filtr pilnych widać tylko wtedy, gdy jest co zmierzyć; okno listy
      zapisuje całość jednym PUT, a samo otwarcie niczego nie zapisuje. */

const poz = (twId: number, symbol: string, nazwa: string, inne: Partial<PozycjaBezWymiarow> = {}): PozycjaBezWymiarow =>
  ({ twId, symbol, nazwa, ean: null, stan: 2, sprzedaz: 0, lokalizacja: null, brutto: null, netto: null, dlugosc: null, szerokosc: null,
    wysokosc: null, oczekuje: false, ...inne });

const LISTA: ListaBezWymiarow = {
  wlaczone: true, razem: 3, pilneRazem: 0,
  pozycje: [
    poz(1, "KOSA-1", "Kosa spalinowa"),
    poz(2, "KON-2", "Konewka 10 l", { oczekuje: true }),
    poz(3, "GRA-3", "Grabie metalowe", { brutto: 1.4, netto: 1.2, dlugosc: "150" }),
  ],
};

let lista: ListaBezWymiarow = LISTA;

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><Wymiary /></MemoryRouter></QueryClientProvider>);
}

let pilneSymbole: string[] = [];

const atrapa = () => atrapaZapisow(
  (url) => (url.startsWith("/api/wymiary/bez-wymiarow") ? lista
    : url === "/api/wymiary/pilne" ? { symbole: pilneSymbole } : undefined),
  (url) => (url.startsWith("/api/wymiary/") ? { status: 200, cialo: { queueId: 9 } } : undefined));

/** Ciało zapisu pod danym adresem, z prawdziwych wywołań `fetch`. */
const cialo = (url: string) => {
  const w = vi.mocked(fetch).mock.calls.find(([u, i]) => u === url && i?.method && i.method !== "GET");
  return w ? JSON.parse(String(w[1]!.body)) : undefined;
};

beforeEach(() => { lista = LISTA; pilneSymbole = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Wymiary", () => {
  it("otwarcie ekranu nie wysyła żadnego zapisu, choć sam wybiera pierwszy towar", async () => {
    const stan = atrapa();
    pokaz();
    expect(await screen.findByRole("heading", { name: "Kosa spalinowa" })).toBeInTheDocument();
    expect(stan.wyslane).toEqual([]);
    expect(stan.nieznane).toEqual([]);
  });

  it("wyłączona funkcja pokazuje zdanie z serwera zamiast formularza", async () => {
    lista = { wlaczone: false, powod: "Wymiary czekają na konfigurację: WYMIARY_POLE_DLUGOSC", razem: 0, pilneRazem: 0, pozycje: [] };
    atrapa();
    pokaz();
    expect(await screen.findByText(/czekają na konfigurację/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zapisz pomiar" })).toBeNull();
  });

  it("pomiar samą klawiaturą: Enter po polach, zapis i przejście do następnego wolnego towaru", async () => {
    const stan = atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Kosa spalinowa" });
    /* Kursor stoi w pierwszym polu, którego kartoteka nie ma — tu w wadze brutto. */
    await waitFor(() => expect(screen.getByLabelText("Waga brutto (kg)")).toHaveFocus());
    await u.keyboard("2,5{Enter}2,2{Enter}40{Enter}12,5{Enter}8{Enter}");

    await waitFor(() => expect(stan.wyslane).toEqual(["POST /api/wymiary/1"]));
    expect(cialo("/api/wymiary/1")).toEqual({ bruttoKg: "2,5", nettoKg: "2,2", dlugosc: "40", szerokosc: "12,5", wysokosc: "8" });
    expect(await screen.findByRole("status")).toHaveTextContent("Zapisano pomiar KOSA-1");
    /* Konewka czeka w kolejce, więc następny jest towar 3. */
    expect(await screen.findByRole("heading", { name: "Grabie metalowe" })).toBeInTheDocument();
  });

  it("zapis wysyła tylko wpisane pola; to, co kartoteka ma, stoi jako „w Subiekcie”", async () => {
    const stan = atrapa();
    const u = userEvent.setup();
    pokaz();
    await u.click(await screen.findByRole("button", { name: /GRA-3/ }));
    expect(screen.getByText("W Subiekcie: 1,4 kg")).toBeInTheDocument();
    expect(screen.getByText("W Subiekcie: 1,2 kg")).toBeInTheDocument();
    expect(screen.getByText("W Subiekcie: 150 cm")).toBeInTheDocument();
    /* Pierwszy brak to szerokość, więc tam stoi kursor. */
    await waitFor(() => expect(screen.getByLabelText("Szerokość (cm)")).toHaveFocus());
    await u.keyboard("10");
    await u.click(screen.getByRole("button", { name: "Zapisz pomiar" }));
    await waitFor(() => expect(stan.wyslane).toEqual(["POST /api/wymiary/3"]));
    expect(cialo("/api/wymiary/3")).toEqual({ szerokosc: "10" });
  });

  it("pusty formularz nie ma czego zapisać, a towar w kolejce jest zablokowany", async () => {
    const stan = atrapa();
    pokaz();
    await screen.findByRole("heading", { name: "Kosa spalinowa" });
    expect(screen.getByRole("button", { name: "Zapisz pomiar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /KON-2/ })).toBeDisabled();
    expect(stan.wyslane).toEqual([]);
  });

  it("braki mówią krótko, czego nie ma", () => {
    expect(braki(poz(1, "A", "a"))).toBe("waga, wymiary");
    expect(braki(poz(1, "A", "a", { brutto: 2, netto: 1.8, dlugosc: "10" }))).toBe("szerokość, wysokość");
    expect(braki(poz(1, "A", "a", { dlugosc: "1", szerokosc: "2", wysokosc: "3" }))).toBe("waga");
    expect(braki(poz(1, "A", "a", { brutto: 2, dlugosc: "1", szerokosc: "2", wysokosc: "3" }))).toBe("netto");
  });

  it("początek symbolu jedzie do serwera wielkimi literami, bez zapisu", async () => {
    const stan = atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Kosa spalinowa" });
    await u.type(screen.getByLabelText("Symbol zaczyna się od"), " w");
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("symbolOd=W&")
      || String(url).endsWith("symbolOd=W"))).toBe(true));
    expect(await screen.findByText(/symbole na W/)).toBeInTheDocument();
    expect(stan.wyslane).toEqual([]);
  });

  it("filtr pilnych chowa się, gdy z listy pilnych nie ma czego mierzyć", async () => {
    atrapa();
    pokaz();
    await screen.findByRole("heading", { name: "Kosa spalinowa" });
    expect(screen.queryByRole("checkbox", { name: /Tylko pilne/ })).toBeNull();
  });

  it("filtr pilnych pokazuje liczbę i wysyła pilne=1, bez zapisu", async () => {
    lista = { ...LISTA, pilneRazem: 7 };
    const stan = atrapa();
    const u = userEvent.setup();
    pokaz();
    await u.click(await screen.findByRole("checkbox", { name: "Tylko pilne (7)" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => /[?&]pilne=1(&|$)/.test(String(url)))).toBe(true));
    expect(stan.wyslane).toEqual([]);
  });

  it("pusta lista przy filtrze pilnych mówi, że pilne są zmierzone", async () => {
    lista = { ...LISTA, pilneRazem: 2 };
    atrapa();
    const u = userEvent.setup();
    pokaz();
    const filtr = await screen.findByRole("checkbox", { name: "Tylko pilne (2)" });
    lista = { ...LISTA, razem: 0, pilneRazem: 0, pozycje: [] };
    await u.click(filtr);
    expect(await screen.findByText("Wszystkie pilne towary mają wagę i wymiary.")).toBeInTheDocument();
    /* Zaznaczony filtr zostaje, choć licznik spadł do zera — inaczej nie dałoby się go odznaczyć. */
    expect(screen.getByRole("checkbox", { name: "Tylko pilne (0)" })).toBeChecked();
  });

  it("otwarcie okna listy pilnych czyta listę i niczego nie zapisuje", async () => {
    pilneSymbole = ["W37-0401", "W09-1304"];
    const stan = atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Kosa spalinowa" });
    await u.click(screen.getByRole("button", { name: "Lista pilnych…" }));
    const pole = await screen.findByLabelText(/Symbole, jeden pod drugim/);
    await waitFor(() => expect(pole).toHaveValue("W37-0401\nW09-1304"));
    expect(screen.getByText("Rozpoznano 2 symbole.")).toBeInTheDocument();
    expect(stan.wyslane).toEqual([]);
    expect(stan.nieznane).toEqual([]);
  });

  it("okno zapisuje wklejoną kolumnę jednym PUT z tablicą symboli", async () => {
    const stan = atrapa();
    const u = userEvent.setup();
    pokaz();
    await screen.findByRole("heading", { name: "Kosa spalinowa" });
    await u.click(screen.getByRole("button", { name: "Lista pilnych…" }));
    const pole = await screen.findByLabelText(/Symbole, jeden pod drugim/);
    await waitFor(() => expect(pole).not.toHaveAttribute("readonly"));
    await u.click(pole);
    await u.paste("Wertis NO.\nw37-0401\nW09-1304; W37-0401");
    expect(screen.getByText("Rozpoznano 2 symbole.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(stan.wyslane).toEqual(["PUT /api/wymiary/pilne"]));
    expect(cialo("/api/wymiary/pilne")).toEqual({ symbole: ["W37-0401", "W09-1304"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("rozpoznaje symbole po białych znakach, przecinkach i średnikach, bez powtórzeń", () => {
    expect(rozpoznajSymbole(" a-1,b-2;\tA-1\r\nc-3 ")).toEqual(["A-1", "B-2", "C-3"]);
    expect(rozpoznajSymbole("")).toEqual([]);
  });
});
