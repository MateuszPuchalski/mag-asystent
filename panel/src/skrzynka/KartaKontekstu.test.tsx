import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KartaKontekstu } from "./KartaKontekstu";
import { ustawKadr } from "../test/kadr";
import type { HistoriaKlienta, OsRozmowy } from "../api/typy";

/* ── Karta zakupu i klienta nad rozmową ─────────────────────────────────────
   Pilnujemy: karta pokazuje to, co mamy, nie udaje tego, czego nie mamy
   (przesyłka niesprawdzona), nie stoi pustą ramką, zwija się do jednej linii
   z zapamiętanym wyborem i nie wywraca rozmowy przy złym ładunku historii.
   Karta niczego nie pobiera: żaden zapis ani zapytanie do przewoźnika. */

const pozycja = (n: Record<string, unknown> = {}) => ({
  offerId: "oferta-1", nazwa: "NÓŻ TRAKTORKA KOSIARKI DO MTD 54cm", sku: "W27-1310", ilosc: 1,
  cenaGrosze: 8999, waluta: "PLN", zwracana: false, wracaIlosc: 0, twId: null, twSymbol: null,
  twZrodlo: null, ofertaZdjecie: "brak", ...n,
});

const dane = (n: Record<string, unknown> = {}): OsRozmowy => ({
  rozmowa: { id: 10 }, os: [], droga: [], oferta: null,
  zamowienie: {
    externalId: "17147703077", link: "https://allegro.example/zam", przesylka: null,
    pobrane: { externalId: "17147703077", status: "READY_FOR_PROCESSING", platnoscTyp: "ONLINE",
      platnoscAt: "2026-10-02T14:12:00.000Z", kupionoAt: "2026-10-02T14:10:00.000Z",
      sumaGrosze: 8999, waluta: "PLN", pozycje: [pozycja()] },
  },
  ...n,
} as unknown as OsRozmowy);

const historia = (n: Partial<HistoriaKlienta> = {}): HistoriaKlienta =>
  ({ login: "k", maszyny: [], wpisy: [], ...n } as HistoriaKlienta);

let zapisy: string[] = [];
beforeEach(() => {
  zapisy = [];
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    zapisy.push(`${init?.method ?? "GET"} ${url}`);
    return new Response("{}");
  }));
});
afterEach(() => vi.unstubAllGlobals());

const pokaz = (d: OsRozmowy, h?: HistoriaKlienta) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <KartaKontekstu dane={d} historia={h} /></QueryClientProvider>);

describe("KartaKontekstu", () => {
  it("pokazuje towar, SKU, ilość z ceną, numer zamówienia i sumę", () => {
    pokaz(dane(), historia({ wpisy: [{ rodzaj: "zwrot" } as never] }));
    const karta = screen.getByRole("region", { name: "Kontekst zakupu" });
    expect(karta).toHaveTextContent("NÓŻ TRAKTORKA KOSIARKI DO MTD 54cm");
    expect(karta).toHaveTextContent("W27-1310");
    expect(karta).toHaveTextContent("1 × 89,99 PLN");
    expect(karta).toHaveTextContent("17147703077");
    expect(screen.getByRole("link", { name: "Otwórz zamówienie w Allegro" })).toHaveAttribute("href", "https://allegro.example/zam");
  });

  it("pasek statusu: złożone i opłacone z datą, przesyłka NIE SPRAWDZONA zamiast zmyślonego „nie”", () => {
    pokaz(dane());
    const pasek = screen.getByRole("list", { name: "Status zakupu" });
    expect(pasek).toHaveTextContent("Złożone");
    expect(pasek).toHaveTextContent("02.10");
    expect(pasek).toHaveTextContent("Opłacone");
    expect(pasek.textContent?.match(/nie sprawdzono/g)).toHaveLength(2);
  });

  it("po sprawdzeniu przesyłki mówi, co wiemy: numer to nadane, brak daty dostarczenia", () => {
    const d = dane();
    (d.zamowienie as never as { przesylka: unknown }).przesylka =
      { waybill: "JJD1", przewoznik: "dpd", status: "IN_TRANSIT", dostarczonoAt: null, sprawdzonoAt: "2026-10-03T08:00:00.000Z" };
    pokaz(d);
    const pasek = screen.getByRole("list", { name: "Status zakupu" });
    expect(pasek).not.toHaveTextContent("nie sprawdzono");
    expect(pasek).toHaveTextContent("Nadane");
  });

  it("anulowane zamówienie jest nazwane i nie ma paska statusu", () => {
    const d = dane();
    ((d.zamowienie as never as { pobrane: { status: string } }).pobrane).status = "CANCELLED";
    pokaz(d);
    expect(screen.getByText("anulowane")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Status zakupu" })).toBeNull();
  });

  it("nie stoi pustą ramką, gdy nie ma ani zakupu, ani historii", () => {
    /* Bez loginu nie wiemy, KTO pisze, więc „nowy klient” byłby kłamstwem. */
    const { container } = pokaz(dane({ zamowienie: null, oferta: null }), historia({ login: null }));
    expect(container.querySelector("section")).toBeNull();
  });

  it("bez zamówienia pokazuje ofertę, o którą pyta klient, i mówi, że zamówienia nie powiązano", () => {
    pokaz(dane({ zamowienie: null, oferta: { externalId: "o-9", pobrana: {
      nazwa: "Kosiarka testowa", sku: "KT-1", cenaGrosze: 1000, waluta: "PLN", zdjecie: "brak" } } }));
    const karta = screen.getByRole("region", { name: "Kontekst zakupu" });
    expect(karta).toHaveTextContent("Kosiarka testowa");
    expect(karta).toHaveTextContent("zamówienia jeszcze nie powiązano");
  });

  it("pasek klienta: nowy klient, gdy login znany, a historii brak", () => {
    pokaz(dane(), historia());
    expect(screen.getByText("Nowy klient")).toBeInTheDocument();
  });

  it("pasek klienta: wcześniejsze sprawy słowem, bez „nowy klient”", () => {
    pokaz(dane(), historia({ wpisy: [{ rodzaj: "zwrot" } as never, { rodzaj: "zwrot" } as never] }));
    expect(screen.getByText(/Wcześniej u nas: 2 zwroty/)).toBeInTheDocument();
    expect(screen.queryByText("Nowy klient")).toBeNull();
  });

  it("zły ładunek historii nie wywraca karty", () => {
    expect(() => pokaz(dane(), {} as never)).not.toThrow();
    expect(screen.getByRole("region", { name: "Kontekst zakupu" })).toBeInTheDocument();
    expect(screen.queryByText("Nowy klient")).toBeNull();
  });

  it("zwija się do jednej linii z nazwą i sumą, a wybór zostaje w przeglądarce", async () => {
    const { unmount } = pokaz(dane());
    await userEvent.click(screen.getByRole("button", { name: "Zwiń kartę zakupu" }));
    const zwinieta = screen.getByRole("button", { name: /rozwiń/ });
    expect(zwinieta).toHaveTextContent("NÓŻ TRAKTORKA KOSIARKI DO MTD 54cm");
    expect(zwinieta).toHaveTextContent("89,99 PLN");
    expect(screen.queryByRole("list", { name: "Status zakupu" })).toBeNull();
    unmount();
    pokaz(dane());
    expect(screen.getByRole("button", { name: /rozwiń/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /rozwiń/ }));
    expect(screen.getByRole("list", { name: "Status zakupu" })).toBeInTheDocument();
  });

  it("pokazuje dwie pozycje i liczy resztę, zamiast rozpychać oś", () => {
    const d = dane();
    ((d.zamowienie as never as { pobrane: { pozycje: unknown[] } }).pobrane).pozycje =
      [pozycja(), pozycja({ offerId: "o2", nazwa: "Drugi" }), pozycja({ offerId: "o3", nazwa: "Trzeci" }),
        pozycja({ offerId: "o4", nazwa: "Czwarty" })];
    pokaz(d);
    expect(screen.getByText("Drugi")).toBeInTheDocument();
    expect(screen.queryByText("Trzeci")).toBeNull();
    expect(screen.getByText(/\+ 2 pozycje w zamówieniu/)).toBeInTheDocument();
  });

  it.each([[3, "+ 1 pozycja"], [4, "+ 2 pozycje"], [7, "+ 5 pozycji"], [13, "+ 11 pozycji"], [14, "+ 12 pozycji"]])(
    "resztę pozycji odmienia w trzech formach: %i pozycji → „%s”", (razem, oczekiwane) => {
      const d = dane();
      ((d.zamowienie as never as { pobrane: { pozycje: unknown[] } }).pobrane).pozycje =
        Array.from({ length: razem }, (_, i) => pozycja({ offerId: `o${i}`, nazwa: `Towar ${i}` }));
      pokaz(d);
      expect(screen.getByText(new RegExp(`^${oczekiwane.replace("+", "\\+")} w zamówieniu`))).toBeInTheDocument();
    });

  it("niczego nie zapisuje i nie pyta serwera o przesyłkę", () => {
    pokaz(dane(), historia());
    expect(zapisy.filter((z) => !z.startsWith("GET "))).toEqual([]);
    expect(zapisy.some((z) => /przesylk/i.test(z))).toBe(false);
  });

  describe("streszczenie przypięte, gdy karty nie widać", () => {
    /* Oś zjeżdża na dół przy otwarciu i chowa kartę za górną krawędzią. Pasek
       ma istnieć WYŁĄCZNIE wtedy; w kadrze dublowałby kartę o linię wyżej. */
    const przypiety = () => screen.queryByRole("button", { name: /Pokaż kartę zakupu/ });

    it("karta w kadrze — paska nie ma", () => {
      pokaz(dane());
      expect(przypiety()).toBeNull();
    });

    it("karta poza kadrem — pasek niesie towar i cenę, a kliknięcie przewija do karty", async () => {
      pokaz(dane());
      act(() => ustawKadr(false));
      const pasek = przypiety();
      expect(pasek).not.toBeNull();
      expect(pasek).toHaveTextContent("NÓŻ TRAKTORKA KOSIARKI DO MTD 54cm");
      expect(pasek).toHaveTextContent("89,99 PLN");
      /* Przewija listę, nie stronę: `scrollIntoView` wypychał nagłówek ekranu. */
      const przewin = vi.fn();
      const wstrzyknieto = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTo");
      Element.prototype.scrollTo = przewin as unknown as typeof Element.prototype.scrollTo;
      const skokStrony = vi.spyOn(Element.prototype, "scrollIntoView");
      skokStrony.mockClear();
      await userEvent.click(pasek!);
      if (wstrzyknieto) Object.defineProperty(Element.prototype, "scrollTo", wstrzyknieto);
      else delete (Element.prototype as unknown as Record<string, unknown>).scrollTo;
      expect(przewin).toHaveBeenCalledTimes(1);
      expect(przewin.mock.calls[0][0]).toMatchObject({ behavior: "smooth" });
      expect(skokStrony).not.toHaveBeenCalled();
    });

    it("powrót karty do kadru zdejmuje pasek", () => {
      pokaz(dane());
      act(() => ustawKadr(false));
      expect(przypiety()).not.toBeNull();
      act(() => ustawKadr(true));
      expect(przypiety()).toBeNull();
    });

    it("zwinięta karta poza kadrem też ma pasek", () => {
      window.localStorage.setItem("wertis.skrzynka.karta.zwinieta", "1");
      pokaz(dane());
      act(() => ustawKadr(false));
      expect(przypiety()).not.toBeNull();
    });

    it("pasek nie zabiera miejsca w układzie osi", () => {
      /* `space-y-3` osi doliczyłby odstęp każdemu dziecku; wrapper musi go mieć
         wyzerowanego i zerową wysokość, inaczej pasek przesuwa wypowiedzi. */
      const { container } = pokaz(dane());
      const wrapper = container.querySelector(".sticky");
      expect(wrapper).not.toBeNull();
      expect(wrapper!.className).toMatch(/!mt-0/);
      expect(wrapper!.className).toMatch(/\bh-0\b/);
    });

    it("rozmowa bez zakupu i historii nie ma ani karty, ani paska", () => {
      pokaz(dane({ zamowienie: null, oferta: null }));
      act(() => ustawKadr(false));
      expect(przypiety()).toBeNull();
      expect(screen.queryByRole("region", { name: "Kontekst zakupu" })).toBeNull();
    });
  });
});
