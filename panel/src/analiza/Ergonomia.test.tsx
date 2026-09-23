import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";
import { KartaErgonomii, NAZWA_EKRANU, NAZWA_POPRAWKI } from "./Ergonomia";
import type { Ergonomia } from "../api/wglad";
import navZrodlo from "../../../android/core/src/main/kotlin/pl/wertis/kolektor/core/nav/NavModel.kt?raw";
import ergonomiaZrodlo from "../../../server/src/services/ergonomia.ts?raw";

/* ── Ergonomia w liczbach ──────────────────────────────────────────────
   1. Ekran przychodzi nazwą enuma z kolektora, a karta pokazuje go słowem.
      Test czyta `Screen` wprost z Kotlina: nowy ekran bez nazwy tutaj
      wywróci test, zamiast pokazać „DELIVERY_LINES" biuru.
   2. To samo dla zdarzeń poprawek — czytane z `CZYNNOSCI` serwisu.
   3. Pusty pomiar czasu mówi zdaniem, skąd się weźmie, zamiast stać zerem.
   4. Wolne odpowiedzi powyżej jednej na dziesięć dostają czerwień. */

const E: Ergonomia = {
  days: 7, daneDo: "2026-09-23T12:00:00.000Z", progMs: 300,
  czasy: {
    n: 40, powyzejProgu: 12, udzialPowyzejProgu: 0.3, p95: "> 1000 ms",
    wgTrasy: [{ ekran: "DELIVERY_LINES", trasa: "/api/delivery/:x/lines/:x/putaway", n: 20,
      powyzejProgu: 12, udzialPowyzejProgu: 0.6, p95: "> 1000 ms" },
    { ekran: "EKRAN_Z_JUTRA", trasa: "/api/x", n: 20, powyzejProgu: 0, udzialPowyzejProgu: 0, p95: "≤ 100 ms" }],
    wgKolektora: [{ device: "kol-a3f9", etykieta: "#A3F9", n: 40, powyzejProgu: 12, udzialPowyzejProgu: 0.3, p95: "> 1000 ms" }],
  },
  skanGlowny: { n: 5, p50: 120, p95: 400, wgKolektora: [{ device: "kol-a3f9", etykieta: "#A3F9", n: 5, p50: 120, p95: 400 }] },
  powtorzoneSkany: [{ device: "kol-a3f9", etykieta: "#A3F9", skanow: 5, powtorzonych: 1, udzial: 0.2 }],
  odrzucenia: [{ trasa: "/api/delivery/:x/lines/:x/putaway", status: 400, powod: "Kod # nie jest etykietą regału", ile: 7, urzadzen: 2 }],
  przerwy: [{ device: "kol-a3f9", etykieta: "#A3F9", przerw: 3, minutRazem: 4.5, najdluzszaMin: 2 }],
  poprawki: [{ czynnosc: "Rozkładanie dostaw", wykonane: 80, poprawek: 4, udzial: 0.05,
    rozbicie: { putaway_cofniete: 3, putaway_qty_fixed: 1, putaway_polka_zmieniona: 0 } }],
};

const wiersz = (tekst: string) => screen.getAllByText(tekst)[0].closest("tr") as HTMLElement;

describe("Ergonomia w liczbach", () => {
  it("każdy ekran kolektora ma nazwę słowem", () => {
    const blok = navZrodlo.slice(navZrodlo.indexOf("enum class Screen"), navZrodlo.indexOf("}", navZrodlo.indexOf("enum class Screen")));
    const ekrany = [...blok.replace(/\/\/.*$/gm, "").matchAll(/\b([A-Z][A-Z_]+)\b/g)].map((m) => m[1]);
    expect(ekrany.length).toBeGreaterThanOrEqual(18);
    for (const e of ekrany) expect(NAZWA_EKRANU[e], e).toBeTruthy();
  });

  it("każde zdarzenie poprawki ma nazwę słowem", () => {
    const blok = ergonomiaZrodlo.slice(ergonomiaZrodlo.indexOf("export const CZYNNOSCI"));
    const poprawki = [...blok.slice(0, blok.indexOf("\n];")).matchAll(/poprawki: \[([^\]]*)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
    expect(poprawki.length).toBeGreaterThanOrEqual(8);
    for (const p of poprawki) expect(NAZWA_POPRAWKI[p], p).toBeTruthy();
  });

  it("rysuje pięć pytań słowami, a nieznany ekran zostaje taki, jaki przyszedł", () => {
    render(<KartaErgonomii e={E} />);
    expect(within(wiersz("Dostawa")).getByText("12 (60%)")).toHaveClass("text-ranga-zle");
    expect(screen.getByText("EKRAN_Z_JUTRA")).toBeInTheDocument();
    expect(screen.getByText("Kod # nie jest etykietą regału")).toBeInTheDocument();
    expect(screen.getByText("cofnięte odłożenie: 3, korekta ilości: 1")).toBeInTheDocument();
    expect(screen.getByText("4,5 min")).toBeInTheDocument();
    expect(screen.queryByText(/Brak pomiarów czasu z pracy/)).toBeNull();
  });

  it("bez pomiarów czasu mówi, skąd się wezmą", () => {
    render(<KartaErgonomii e={{ ...E, czasy: { ...E.czasy, n: 0, powyzejProgu: 0, udzialPowyzejProgu: 0, p95: null,
      wgTrasy: [], wgKolektora: [] } }} />);
    expect(screen.getByText(/po aktualizacji aplikacji/)).toBeInTheDocument();
  });
});
