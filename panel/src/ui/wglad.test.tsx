import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { KartaWgladu, Przekroje } from "./wglad";

/* ── Karta wglądu: pusta jedną linią, przekroje w karcie liczby (0.542.0) ──
   Wariant C Analizy z 27 września 2026. Pilnujemy dwóch rzeczy: karta bez
   danych mówi zdaniem, dlaczego jest pusta, i nie rysuje ciała; przekroje
   jednego pomiaru stoją przełącznikiem, a przekrój, którego nie ma (osoba
   dla roli biuro), nie zostawia po sobie martwej pozycji. */
describe("KartaWgladu", () => {
  it("pusta karta to tytuł i zdanie — bez opisu i bez treści", () => {
    render(<KartaWgladu tytul="Eskalacja po rozmowie" opis="długi opis" pusta="Brak rozmów w tym oknie.">
      <p>treść</p></KartaWgladu>);
    expect(screen.getByRole("heading", { name: "Eskalacja po rozmowie" })).toBeTruthy();
    expect(screen.getByText("Brak rozmów w tym oknie.")).toBeTruthy();
    expect(screen.queryByText("długi opis")).toBeNull();
    expect(screen.queryByText("treść")).toBeNull();
  });

  it("bez `pusta` karta rysuje się jak dotąd", () => {
    render(<KartaWgladu tytul="Czas" opis="opis" pusta={null}><p>treść</p></KartaWgladu>);
    expect(screen.getByText("opis")).toBeTruthy();
    expect(screen.getByText("treść")).toBeTruthy();
  });
});

describe("Przekroje", () => {
  it("przełącza przekroje jednego pomiaru", async () => {
    render(<Przekroje pozycje={[
      { klucz: "k", etykieta: "według kategorii", tresc: <p>tabela kategorii</p> },
      { klucz: "o", etykieta: "według osoby", tresc: <p>tabela osób</p> },
    ]} />);
    expect(screen.getByText("tabela kategorii")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "według osoby" }));
    expect(screen.getByText("tabela osób")).toBeTruthy();
    expect(screen.queryByText("tabela kategorii")).toBeNull();
  });

  it("jeden przekrój to podpis, nie przełącznik z jedną pozycją", () => {
    render(<Przekroje pozycje={[
      { klucz: "k", etykieta: "według kategorii", tresc: <p>tabela kategorii</p> },
      null,
    ]} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("według kategorii")).toBeTruthy();
  });
});
