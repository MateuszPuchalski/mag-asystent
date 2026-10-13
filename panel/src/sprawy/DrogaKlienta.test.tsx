import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { atrapaZapisow } from "../test/zapisy";
import { DrogaKlienta } from "./DrogaKlienta";

/* ── Powłoka paska drogi ─────────────────────────────────────────────────────
   Pilnujemy trzech rzeczy z reguły „brak danych to nie zero”: awaria serwera
   jest błędem, a nie pustym paskiem, sprawa bez numeru zamówienia nie pyta
   serwera, i kształt, którego nie znamy, nie wywraca ekranu. */

const DROGA = {
  orderId: "ord-1", linkZamowienia: null, reklamacja: null, sprawy: [],
  zamowienie: { kupionoAt: "2026-09-20T10:00:00.000Z", platnoscAt: null, platnoscTyp: "ONLINE",
    sumaGrosze: 4999, waluta: "PLN" },
  przesylka: null, droga: [],
};

const pokaz = (orderId: string | null | undefined, opcje: Partial<React.ComponentProps<typeof DrogaKlienta>> = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><DrogaKlienta orderId={orderId} {...opcje} /></MemoryRouter>
  </QueryClientProvider>);

afterEach(() => vi.unstubAllGlobals());

describe("DrogaKlienta", () => {
  it("bez numeru zamówienia nie rysuje nic i nie pyta serwera", async () => {
    const stan = atrapaZapisow(() => DROGA);
    const { container } = pokaz(null);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(stan.wyslane).toEqual([]);
    expect(stan.nieznane).toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("czyta drogę jednym GET-em po numerze zamówienia, z kodowaniem adresu", async () => {
    const stan = atrapaZapisow((url) => (url === "/api/obsluga/droga/a%2Fb" ? { ...DROGA, orderId: "a/b" } : undefined));
    pokaz("a/b");
    expect(await screen.findByRole("list", { name: "Droga sprawy" })).toBeInTheDocument();
    expect(stan.nieznane).toEqual([]);
    expect(stan.wyslane).toEqual([]);
  });

  it("awaria serwera to błąd na ekranie, nie pusty pasek", async () => {
    atrapaZapisow(() => undefined);
    pokaz("ord-1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się wczytać drogi klienta");
    expect(screen.queryByRole("list", { name: "Droga sprawy" })).toBeNull();
  });

  it("odpowiedź bez list drogi i spraw to brak paska, nie wyjątek", async () => {
    const stan = atrapaZapisow(() => ({}));
    const { container } = pokaz("ord-1");
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(stan.wyslane).toEqual([]);
  });

  /* Numer zamówienia mieszka w kroku Zakup paska. Gdy pasek się wczytuje albo
     padł, ekran bez własnego numeru nie może go zgubić. */
  describe("numer zamówienia, gdy pasek go jeszcze nie niesie", () => {
    const numery = () => screen.queryAllByText(/ord-1/, { selector: "span.sr-only" });

    it("w trakcie wczytywania stoi raz, z kopiowaniem i bez łącza", () => {
      /* Odpowiedź, która nie nadchodzi: zapytanie zostaje w stanie wczytywania. */
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
      pokaz("ord-1");
      expect(screen.getByRole("status")).toHaveTextContent("Wczytuję drogę klienta");
      expect(numery()).toHaveLength(1);
      expect(screen.getAllByTitle("Kopiuj numer zamówienia")).toHaveLength(1);
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("po awarii stoi raz obok błędu, a z łączem, gdy ekran je zna", async () => {
      atrapaZapisow(() => undefined);
      pokaz("ord-1", { linkZamowienia: "https://allegro.pl/moje-allegro/sprzedaz/zamowienia/ord-1" });
      expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się wczytać");
      expect(numery()).toHaveLength(1);
      expect(screen.getAllByTitle("Kopiuj numer zamówienia")).toHaveLength(1);
      expect(screen.getByRole("link")).toHaveAttribute("href", expect.stringContaining("ord-1"));
    });

    it("po wczytaniu stoi raz: tylko w kroku Zakup paska", async () => {
      atrapaZapisow(() => DROGA);
      pokaz("ord-1");
      await screen.findByRole("list", { name: "Droga sprawy" });
      expect(numery()).toHaveLength(1);
      expect(screen.getAllByTitle("Kopiuj numer zamówienia")).toHaveLength(1);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("ekran z bezNumerow sam pokazuje numer, więc pasek go nie dubluje w ładowaniu ani w błędzie", async () => {
      atrapaZapisow(() => undefined);
      pokaz("ord-1", { bezNumerow: true });
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(numery()).toHaveLength(0);
      expect(screen.queryByTitle("Kopiuj numer zamówienia")).toBeNull();
    });
  });
});
