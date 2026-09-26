import { describe, expect, it } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { PomiaryDecyzji } from "./PomiaryDecyzji";
import type { PomiarTarcia } from "../api/wglad";

/* ── Pomiary pod decyzje (26 września 2026, 0.532.0) ───────────────────────
   Cztery sekcje, każda nazwana decyzją, której służy. Na wierzchu jedno
   zdanie, szczegóły zwinięte (§26e). Pusty stan mówi zdaniem, nie zerem,
   które udawałoby pomiar. Zero zapisu przy otwarciu pilnuje test ekranu
   Analizy — ta karta nie ma własnych żądań, liczy z odczytu tarcia.       */

const los = (zeSzkicem: number, bezZmian: number) =>
  ({ zeSzkicem, bezZmian, udzialBezZmian: zeSzkicem ? Number((bezZmian / zeSzkicem).toFixed(2)) : null });

const dane = (n: Partial<PomiarTarcia> = {}): PomiarTarcia => ({
  dni: 30, osoby: null,
  razem: { wyslanych: 40, zeSzkicem: 20, bezZmian: 9, udzialBezZmian: 0.45,
    cofnietychWysylek: 10, cofnietychZakonczen: 1, medianaSekDoWysylki: 95, probekCzasu: 38 },
  oknoCofniecia: { odlozonych: 50, cofnietych: 10, udzial: 0.2, poOknie: 0, bezCzasu: 2,
    kubelki: [{ odSek: 0, doSek: 2, ile: 6 }, { odSek: 2, doSek: 4, ile: 2 }, { odSek: 4, doSek: 6, ile: 0 },
      { odSek: 6, doSek: 8, ile: 0 }, { odSek: 8, doSek: 10, ile: 0 }], odczyt: { przedSek: 2, udzial: 0.75 } },
  tarcieSzkicu: { zTwierdzeniami: los(10, 3), bezTwierdzen: los(8, 6), bezDanych: 2,
    przedPo: { granica: "2026-09-25T09:00:00.000Z", przed: los(12, 9), po: los(18, 9) } },
  gotowosc: [
    { kategoria: "ORDER_STATUS", zeSzkicem: 12, bezZmian: 11, dni: 5,
      udzial: { k: 11, n: 12, p: 0.92, dolna: 0.65, gorna: 0.99 } },
    { kategoria: "bez rozpoznania", zeSzkicem: 3, bezZmian: 1, dni: 2,
      udzial: { k: 1, n: 3, p: 0.33, dolna: 0.06, gorna: 0.79 } },
  ],
  pominiecia: { odKiedy: "2026-09-20", pominiec: 7, wyslanych: 40,
    wgDnia: [{ dzien: "2026-09-24", pominiec: 4, wyslanych: 22 }, { dzien: "2026-09-25", pominiec: 3, wyslanych: 18 }],
    wgKategorii: [{ kategoria: "RETURN", pominiec: 5, wyslanych: 10 }, { kategoria: "bez rozpoznania", pominiec: 2, wyslanych: 30 }] },
  ...n,
});

const sekcja = (nazwa: string) => screen.getByRole("region", { name: nazwa });

describe("PomiaryDecyzji", () => {
  it("cztery sekcje nazwane decyzją, każda z jednym zdaniem na wierzchu", () => {
    render(<PomiaryDecyzji t={dane()} />);
    expect(sekcja("Okno cofnięcia").textContent).toContain("75% cofnięć przed 2 s");
    expect(sekcja("Tarcie przy szkicu").textContent)
      .toContain("Bez zmian: 30% szkiców z twierdzeniami do sprawdzenia, 75% bez nich");
    expect(sekcja("Gotowość do autowysyłki").textContent)
      .toContain("Najmocniej: Status zamówienia — co najmniej 65% szkiców bez zmian, ale z 5 dni");
    expect(sekcja("Pominięcia").textContent).toContain("7 pominiętych rozmów przy 40 wysyłkach");
  });

  it("szczegóły zwinięte; w nich rozkład, porównanie przed i po oraz tabele", () => {
    render(<PomiaryDecyzji t={dane()} />);
    for (const s of ["Okno cofnięcia", "Tarcie przy szkicu", "Gotowość do autowysyłki", "Pominięcia"]) {
      expect(within(sekcja(s)).getByText("Szczegóły").closest("details")!.open).toBe(false);
    }
    const okno = sekcja("Okno cofnięcia");
    expect(within(okno).getByText("0–2 s")).toBeInTheDocument();
    expect(okno.textContent).toContain("Bez czasu: 2");
    expect(sekcja("Tarcie przy szkicu").textContent).toMatch(/Przed 25\.09\.2026, \d\d:00 bez zmian szło 75% \(9 z 12\)/);
    expect(within(sekcja("Gotowość do autowysyłki")).getByText("11 z 12")).toBeInTheDocument();
    expect(within(sekcja("Pominięcia")).getByText("Zwrot")).toBeInTheDocument();
  });

  it("pusty stan mówi zdaniem; brak porównania przed i po — powodem", () => {
    const zero = los(0, 0);
    render(<PomiaryDecyzji t={dane({
      oknoCofniecia: { odlozonych: 0, cofnietych: 0, udzial: null, poOknie: 0, bezCzasu: 0, odczyt: null,
        kubelki: [2, 4, 6, 8, 10].map((d) => ({ odSek: d - 2, doSek: d, ile: 0 })) },
      tarcieSzkicu: { zTwierdzeniami: zero, bezTwierdzen: zero, bezDanych: 0, przedPo: null },
      gotowosc: [], pominiecia: { odKiedy: null, pominiec: 0, wyslanych: 0, wgDnia: [], wgKategorii: [] },
    })} />);
    expect(sekcja("Okno cofnięcia").textContent).toContain("Brak zmierzonych cofnięć w tym oknie.");
    expect(sekcja("Tarcie przy szkicu").textContent).toContain("Brak wysłanych szkiców z policzonymi twierdzeniami.");
    expect(sekcja("Tarcie przy szkicu").textContent).toContain("Porównania przed i po wejściu tarcia nie da się policzyć");
    expect(sekcja("Gotowość do autowysyłki").textContent).toContain("Brak wysłanych szkiców w tym oknie.");
    expect(sekcja("Pominięcia").textContent).toContain("Skrzynka nie zgłosiła jeszcze żadnego pominięcia.");
  });

  it("licznik, który już ruszył, pokazuje zero jako wynik okna", () => {
    render(<PomiaryDecyzji t={dane({ pominiecia: { odKiedy: "2026-09-01", pominiec: 0, wyslanych: 1,
      wgDnia: [], wgKategorii: [] } })} />);
    expect(sekcja("Pominięcia").textContent).toContain("0 pominiętych rozmów przy 1 wysyłce");
  });

  it("nie ma w niej ludzi ani barw oceny", () => {
    const { container } = render(<PomiaryDecyzji t={dane({ osoby: [{ osoba: "A. Lewandowska",
      ...dane().razem }] })} />);
    expect(container.textContent).not.toContain("Lewandowska");
    expect(container.innerHTML).not.toMatch(/text-(red|green|emerald|rose)-/);
  });
});
