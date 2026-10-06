import { describe, expect, it } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { PomiarCopilota, zgodnoscPrzeplywu } from "./PomiarCopilota";
import type { PomiarCopilota as Pomiar } from "../api/typy";

/* ── Pomiar Copilota (uproszczony 0.519.0) ──────────────────────────────────
   Na wierzchu zostaje to, na czym zapada decyzja o modelu: wywołania,
   nieudane i rachunek. Tokeny i prefiks instrukcji to głos programisty —
   nie wracają na ekran. Objaw ciszy cache zostaje, tylko w szczegółach.    */

const dane = (n: Partial<Pomiar> = {}): Pomiar => ({
  wywolan: 20, bledow: 1,
  tokeny: { wej: 16000, wyj: 900, cacheZapis: 0, cacheOdczyt: 0 },
  kosztUsd: 0.5, udzialCache: 0,
  klasyfikacja: {
    taksonomia: "v3", decyzji: 20, wgZrodla: { MODEL: 15, ALLEGRO_MAPPING: 4, FALLBACK: 1 },
    wgStatusu: { FAILED: 1 }, wymagaCzlowieka: 2, oznaczonych: 10, nieoznaczonych: 10,
    poprawionych: 3, mapowanie: null,
    biezacy: { model: "claude-opus-5", promptWersja: "k4" },
    klasyfikatory: [{ model: "claude-opus-5", promptWersja: "k4", decyzji: 15, oznaczonych: 10,
      zgodnosc: { k: 7, n: 10, p: 0.7, dolna: 0.4, gorna: 0.89 } }],
    wgKategorii: [{ kategoria: "PRODUCT_COMPATIBILITY", przewidzianych: 8,
      precyzja: { k: 6, n: 8, p: 0.75, dolna: 0.41, gorna: 0.93 }, czulosc: null }],
  },
  wgZadania: [],
  szkice: {
    ile: 0, odrzuconych: 0, wyslanychBezZmian: 0, wyslanychPoprawionych: 0,
  },
  przeplyw: [], naZywo: [],
  ...n,
});

describe("PomiarCopilota", () => {
  it("na wierzchu wywołania, nieudane i rachunek; bez tokenów i prefiksu", () => {
    render(<PomiarCopilota dane={dane()} />);
    expect(screen.getByText("wywołań")).toBeInTheDocument();
    expect(screen.getByText(/Rachunek/).textContent).toContain("2.00 zł");
    expect(screen.queryByText(/tokenów|tokeny liczone|prefiks/)).toBeNull();
  });

  it("decyzje i tabela precyzji leżą w zwiniętych szczegółach", () => {
    render(<PomiarCopilota dane={dane()} />);
    const szczegoly = screen.getByText("Szczegóły").closest("details")!;
    expect(szczegoly.open).toBe(false);
    expect(szczegoly).toContainElement(screen.getByLabelText("Decyzje klasyfikatora"));
    expect(szczegoly).toContainElement(screen.getByText("Dobór"));
    expect(screen.getByText("6 z 8 · 75 % (41–93 %)")).toBeInTheDocument();
  });

  /* Precyzja zlana z dwóch klasyfikatorów nie mówi nic o żadnym, więc karta
     nazywa ten, którego dotyczy tabela, a przy dwóch pokazuje porównanie. */
  it("nazywa klasyfikator tabeli, a porównanie pokazuje dopiero przy dwóch", () => {
    const { unmount } = render(<PomiarCopilota dane={dane()} />);
    expect(screen.getByLabelText("Decyzje klasyfikatora").textContent).toContain("claude-opus-5 (k4)");
    expect(screen.queryByLabelText("Porównanie klasyfikatorów")).toBeNull();
    unmount();

    const d = dane();
    d.klasyfikacja = { ...d.klasyfikacja,
      biezacy: { model: "jev-1.13.0", promptWersja: "jev-j4" },
      klasyfikatory: [
        { model: "jev-1.13.0", promptWersja: "jev-j4", decyzji: 40, oznaczonych: 12,
          zgodnosc: { k: 11, n: 12, p: 0.917, dolna: 0.646, gorna: 0.985 } },
        ...d.klasyfikacja.klasyfikatory,
      ] };
    render(<PomiarCopilota dane={d} />);
    const tabela = screen.getByLabelText("Porównanie klasyfikatorów");
    expect(within(tabela).getByText("jev-1.13.0 (jev-j4)")).toBeInTheDocument();
    expect(within(tabela).getByText("11 z 12 · 92 % (65–99 %)")).toBeInTheDocument();
    expect(within(tabela).getByText("claude-opus-5 (k4)")).toBeInTheDocument();
  });

  /* Szkice przed pracą (26 września 2026): własny wiersz, bo poranek ma
     własny limit, a zlany z dniem nie powiedziałby, ile kosztuje. */
  it("szkice przed pracą mają własny wiersz z rachunkiem; bez wywołań wiersza nie ma", () => {
    const { unmount } = render(<PomiarCopilota dane={dane()} />);
    expect(screen.queryByLabelText("Szkice przed pracą")).toBeNull();
    unmount();
    render(<PomiarCopilota dane={dane({ wgZadania: [
      { zadanie: "szkic", wywolan: 30, bledow: 0, kosztUsd: 3, medianaMs: null, p90Ms: null },
      { zadanie: "szkic_przed_praca", wywolan: 12, bledow: 1, kosztUsd: 1.2, medianaMs: null, p90Ms: null },
      { zadanie: "klasyfikacja_przed_praca", wywolan: 14, bledow: 0, kosztUsd: 0.05, medianaMs: null, p90Ms: null },
    ] })} />);
    const w = screen.getByLabelText("Szkice przed pracą");
    expect(w.textContent).toContain("12 szkiców i 14 rozpoznań");
    expect(w.textContent).toContain("1.25 USD (5.00 zł)");
    expect(within(w).getByText("1")).toHaveClass("text-ranga-uwaga");
    /* Wiersz dnia liczy tylko swoje zadanie — poranek nie wlicza się dwa razy. */
    expect(screen.getByLabelText("Szkice odpowiedzi").textContent).toContain("30 wywołań");
  });

  /* Czas czekania na Copilota (0.532.0): jedno zdanie o szkicu na wierzchu,
     tabela po zadaniu w szczegółach, nazwy zadań po ludzku. */
  it("podaje czas czekania: zdanie o szkicu na wierzchu, mediana i p90 zadań w szczegółach", () => {
    render(<PomiarCopilota dane={dane({ wgZadania: [
      { zadanie: "szkic", wywolan: 12, bledow: 0, kosztUsd: 0.3, medianaMs: 6_400, p90Ms: 14_000 },
      { zadanie: "klasyfikacja", wywolan: 8, bledow: 1, kosztUsd: 0.2, medianaMs: 900, p90Ms: 1_500 },
      { zadanie: "stare", wywolan: 2, bledow: 0, kosztUsd: 0, medianaMs: null, p90Ms: null },
    ] })} />);
    expect(screen.getByText(/Rachunek/).textContent).toContain("Na szkic czeka się zwykle 6,4 s, co dziesiąty dłużej niż 14,0 s.");
    const tabela = screen.getByLabelText("Czas czekania na Copilota");
    expect(screen.getByText("Szczegóły").closest("details")).toContainElement(tabela);
    expect(tabela.textContent).toContain("rozpoznanie kategorii");
    expect(tabela.textContent).toContain("0,9 s");
    expect(tabela.textContent).not.toContain("stare");
  });

  it("bez zmierzonego szkicu zdania o czekaniu nie ma", () => {
    render(<PomiarCopilota dane={dane()} />);
    expect(screen.getByText(/Rachunek/).textContent).not.toContain("czeka");
    expect(screen.queryByLabelText("Czas czekania na Copilota")).toBeNull();
  });

  it("cisza cache przy wywołaniach zostaje objawem — tonem, bez wykładu", () => {
    render(<PomiarCopilota dane={dane()} />);
    expect(screen.getByText("0 %")).toHaveClass("text-ranga-uwaga");
  });
  /* Przepływy w trybie cienia: zgodność liczy tylko rozstrzygnięte, `n` stoi
     obok, a zero rozstrzygnięć to kreska, nie 0 %. */
  it("zgodność przepływu to zgody przez rozstrzygnięte, z n; przy n = 0 kreska", () => {
    expect(zgodnoscPrzeplywu({ zgod: 7, sprzeciwow: 2 })).toBe("7 z 9 · 78 %");
    expect(zgodnoscPrzeplywu({ zgod: 0, sprzeciwow: 3 })).toBe("0 z 3 · 0 %");
    expect(zgodnoscPrzeplywu({ zgod: 0, sprzeciwow: 0 })).toBe("—");
  });

  it("tabela przepływów stoi na wierzchu, z polską kategorią, rodzajem i n", () => {
    render(<PomiarCopilota dane={dane({ przeplyw: [
      { kategoria: "ORDER_STATUS", rodzaj: "wyslij", propozycji: 12, zgod: 7, sprzeciwow: 2, bezWerdyktu: 3, wyslanychNaZywo: 0 },
      { kategoria: "COMPLAINT", rodzaj: "pilne", propozycji: 4, zgod: 0, sprzeciwow: 0, bezWerdyktu: 4, wyslanychNaZywo: 0 },
    ] })} />);
    const sekcja = screen.getByLabelText("Przepływy kategorii");
    expect(screen.getByText("Szczegóły").closest("details")).not.toContainElement(sekcja);
    expect(within(sekcja).getByText("Przepływy kategorii")).toBeInTheDocument();
    const wiersze = within(sekcja).getAllByRole("row").slice(1);
    expect(wiersze.map((w) => [...w.querySelectorAll("td")].map((td) => td.textContent))).toEqual([
      ["Status zamówienia", "wysłałby odpowiedź", "12", "0", "7", "2", "3", "7 z 9 · 78 %"],
      ["Reklamacja", "oznaczyłby pilne", "4", "—", "0", "0", "4", "—"],
    ]);
    expect(sekcja.textContent).not.toContain("0 %");
  });

  /* Na żywo: zdanie nad tabelą mówi, co dziś odpisuje bez człowieka, a kolumna
     „wysłane same" — ile razy. Bez włączonej kategorii zdanie mówi „nic". */
  it("w cieniu zdanie mówi „nic”, a tabela, że nic nie wykonało się samo", () => {
    render(<PomiarCopilota dane={dane({ przeplyw: [
      { kategoria: "ORDER_STATUS", rodzaj: "wyslij", propozycji: 3, zgod: 1, sprzeciwow: 0, bezWerdyktu: 2, wyslanychNaZywo: 0 },
    ] })} />);
    const sekcja = screen.getByLabelText("Przepływy kategorii");
    expect(sekcja.textContent).toContain("Na żywo: nic — wszystkie kategorie w cieniu.");
    expect(sekcja.textContent).toContain("Nic z tego nie wykonało się samo.");
    expect(within(sekcja).getByRole("columnheader", { name: "wysłane same" })).toBeInTheDocument();
  });

  it("na żywo zdanie nazywa kategorię po polsku, a kolumna liczy wysłane same", () => {
    render(<PomiarCopilota dane={dane({ naZywo: ["ORDER_STATUS"], przeplyw: [
      { kategoria: "ORDER_STATUS", rodzaj: "wyslij", propozycji: 20, zgod: 9, sprzeciwow: 1, bezWerdyktu: 10, wyslanychNaZywo: 14 },
    ] })} />);
    const sekcja = screen.getByLabelText("Przepływy kategorii");
    expect(sekcja.textContent).toContain("Na żywo: Status zamówienia.");
    expect(sekcja.textContent).not.toContain("ORDER_STATUS");
    expect(sekcja.textContent).not.toContain("w cieniu");
    expect(sekcja.textContent).not.toContain("Nic z tego nie wykonało się samo.");
    const [w] = within(sekcja).getAllByRole("row").slice(1);
    expect([...w.querySelectorAll("td")].map((td) => td.textContent)).toEqual(
      ["Status zamówienia", "wysłałby odpowiedź", "20", "14", "9", "1", "10", "9 z 10 · 90 %"]);
  });

  it("bez propozycji tabela mówi zdaniem, nie zerami", () => {
    render(<PomiarCopilota dane={dane()} />);
    const sekcja = screen.getByLabelText("Przepływy kategorii");
    expect(sekcja.textContent).toContain("Automat jeszcze nic nie zaproponował.");
    expect(within(sekcja).queryByRole("table")).toBeNull();
  });
});
