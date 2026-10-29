import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { atrapaZapisow } from "../test/zapisy";
import { Wymiary, braki } from "./Wymiary";
import type { ListaBezWymiarow, PozycjaBezWymiarow } from "../api/wymiary";

/* ── Ekran „Wymiary” ──────────────────────────────────────────────────────
   1. ZERO ZAPISU PRZY OTWARCIU, także gdy formularz sam wybiera pierwszy towar.
   2. Wyłączona funkcja: zdanie z serwera zamiast formularza.
   3. Pełna droga samą klawiaturą: Enter po polach, zapis, następny towar.
   4. Puste pole nie jedzie do serwera — zostaje w Subiekcie bez zmian.
   5. Towar w kolejce jest wyszarzony i nie da się go wybrać. */

const poz = (twId: number, symbol: string, nazwa: string, inne: Partial<PozycjaBezWymiarow> = {}): PozycjaBezWymiarow =>
  ({ twId, symbol, nazwa, ean: null, stan: 2, sprzedaz: 0, masa: null, dlugosc: null, szerokosc: null,
    wysokosc: null, oczekuje: false, ...inne });

const LISTA: ListaBezWymiarow = {
  wlaczone: true, razem: 3,
  pozycje: [
    poz(1, "KOSA-1", "Kosa spalinowa"),
    poz(2, "KON-2", "Konewka 10 l", { oczekuje: true }),
    poz(3, "GRA-3", "Grabie metalowe", { masa: 1.4, dlugosc: "150" }),
  ],
};

let lista: ListaBezWymiarow = LISTA;

function pokaz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><Wymiary /></MemoryRouter></QueryClientProvider>);
}

const atrapa = () => atrapaZapisow(
  (url) => (url.startsWith("/api/wymiary/bez-wymiarow") ? lista : undefined),
  (url) => (url.startsWith("/api/wymiary/") ? { status: 200, cialo: { queueId: 9 } } : undefined));

/** Ciało zapisu pod danym adresem, z prawdziwych wywołań `fetch`. */
const cialo = (url: string) => {
  const w = vi.mocked(fetch).mock.calls.find(([u, i]) => u === url && i?.method && i.method !== "GET");
  return w ? JSON.parse(String(w[1]!.body)) : undefined;
};

beforeEach(() => { lista = LISTA; });
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
    lista = { wlaczone: false, powod: "Wymiary czekają na konfigurację: WYMIARY_POLE_DLUGOSC", razem: 0, pozycje: [] };
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
    /* Kursor stoi w pierwszym polu, którego kartoteka nie ma — tu w wadze. */
    await waitFor(() => expect(screen.getByLabelText("Waga (kg)")).toHaveFocus());
    await u.keyboard("2,5{Enter}40{Enter}12,5{Enter}8{Enter}");

    await waitFor(() => expect(stan.wyslane).toEqual(["POST /api/wymiary/1"]));
    expect(cialo("/api/wymiary/1")).toEqual({ masaKg: "2,5", dlugosc: "40", szerokosc: "12,5", wysokosc: "8" });
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
    expect(braki(poz(1, "A", "a", { masa: 2, dlugosc: "10" }))).toBe("szerokość, wysokość");
    expect(braki(poz(1, "A", "a", { dlugosc: "1", szerokosc: "2", wysokosc: "3" }))).toBe("waga");
  });
});
