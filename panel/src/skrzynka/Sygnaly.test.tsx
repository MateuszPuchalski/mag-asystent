import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Kopilot, Rozmowa } from "../api/typy";
import { licznikTytulu, powodyPowiadomienia, useSygnaly } from "./Sygnaly";

/* ── Sygnały poza ekranem (23 września 2026) ─────────────────────────────────
   Pilnujemy trzech rzeczy: licznik liczy nieprzeczytane słowa KLIENTA,
   powiadomienie dotyczy wyłącznie dwóch powodów, a pierwszy odczyt niczego
   nie wystrzeliwuje — inaczej poranne otwarcie zasypałoby ekran nocą. */

const rozmowa = (n: Partial<Rozmowa> = {}): Rozmowa => ({
  id: 1, klient: "marc***1", ostatniaWiadomosc: "Czy pasuje?",
  ostatniaWiadomoscAt: "2026-09-23T07:00:00.000Z", ostatniaOdKlienta: true,
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "waiting_for_us", odlozoneDo: null, poTerminie: false, podziekowal: false, oglada: null,
  priorytet: "normalny", czekaOdMs: 5 * 60_000, reklamacyjna: false, nowychOdOdpowiedzi: 0,
  zadanieWToku: false, dobor: "not_started", kopilot: null, ...n,
});
const kop = (n: Partial<Kopilot> = {}): Kopilot => ({
  kategoria: "COMPLAINT", dodatkowe: [], akcja: "HUMAN_REVIEW", akcjaModelu: null, wymagaCzlowieka: true,
  brakDanychZamowienia: false, brakDanychProduktu: false, pewnosc: "wysoka", zrodlo: "MODEL",
  status: "SUCCESS", kody: [], uzasadnienie: null, nieaktualna: false,
  kategoriaCzlowieka: null, kategoriaModelu: "COMPLAINT", ...n,
});

describe("licznik w tytule karty", () => {
  it("liczy nieprzeczytane słowa klienta, bez zamkniętych i spamu", () => {
    expect(licznikTytulu([
      rozmowa({ id: 1, nieprzeczytana: true }),
      rozmowa({ id: 2, nieprzeczytana: true, ostatniaOdKlienta: false }),
      rozmowa({ id: 3, nieprzeczytana: true, status: "spam" }),
      rozmowa({ id: 4 }),
    ])).toBe(1);
  });
});

describe("powody powiadomienia", () => {
  it("prośba o człowieka przy nieprzeczytanej i czekanie ponad godzinę", () => {
    expect(powodyPowiadomienia(rozmowa({ nieprzeczytana: true, kopilot: kop() }))).toEqual(["1:czlowiek"]);
    expect(powodyPowiadomienia(rozmowa({ czekaOdMs: 61 * 60_000 }))).toEqual(["1:godzina"]);
  });

  it("milczy przy podziękowaniu, przy czekaniu na klienta i przy starej etykiecie", () => {
    expect(powodyPowiadomienia(rozmowa({ czekaOdMs: 5 * 3600_000, podziekowal: true }))).toEqual([]);
    expect(powodyPowiadomienia(rozmowa({ czekaOdMs: 5 * 3600_000, status: "waiting_for_customer" }))).toEqual([]);
    expect(powodyPowiadomienia(rozmowa({ nieprzeczytana: true, kopilot: kop({ nieaktualna: true }) }))).toEqual([]);
  });
});

describe("hak sygnałów", () => {
  afterEach(() => vi.unstubAllGlobals());

  function Proba({ lista }: { lista: Rozmowa[] }) {
    useSygnaly(lista, () => {});
    return null;
  }

  it("tytuł karty niesie licznik i wraca po wyjściu ze skrzynki", () => {
    document.title = "WERTIS";
    const { rerender, unmount } = render(<Proba lista={[rozmowa({ nieprzeczytana: true })]} />);
    expect(document.title).toBe("(1) Skrzynka · WERTIS");
    rerender(<Proba lista={[rozmowa()]} />);
    expect(document.title).toBe("Skrzynka · WERTIS");
    unmount();
    expect(document.title).toBe("WERTIS");
  });

  it("pierwszy odczyt nie wystrzeliwuje, nowy powód — tak, gdy karta w tle", () => {
    const wyslane: string[] = [];
    class Powiadomienie {
      static permission = "granted";
      static requestPermission = vi.fn();
      onclick: (() => void) | null = null;
      constructor(tytul: string) { wyslane.push(tytul); }
      close() {}
    }
    vi.stubGlobal("Notification", Powiadomienie);
    localStorage.setItem("wertis.powiadomienia", "1");
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });

    const { rerender } = render(<Proba lista={[rozmowa({ id: 1, czekaOdMs: 2 * 3600_000 })]} />);
    expect(wyslane).toEqual([]);
    rerender(<Proba lista={[rozmowa({ id: 1, czekaOdMs: 2 * 3600_000 }),
      rozmowa({ id: 2, klient: "kowal", nieprzeczytana: true, kopilot: kop() })]} />);
    expect(wyslane).toEqual(["kowal prosi o człowieka"]);

    localStorage.removeItem("wertis.powiadomienia");
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });
});
