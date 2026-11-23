import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { KolumnaKolejki, PustaKolejka, SzukajWKolejce } from "./KolumnaKolejki";
import { KARTA_DOWODOW, KARTA_PRACY, SIATKA_SKRZYNKI, SIATKA_TRZECH_KOLUMN } from "./index";
import dostawy from "../ekrany/Dostawy.tsx?raw";
import reklamacje from "../ekrany/Reklamacje.tsx?raw";
import skrzynka from "../skrzynka/Kolejka.tsx?raw";
import zwroty from "../ekrany/Zwroty.tsx?raw";
import kosze from "../ekrany/Kosze.tsx?raw";
import ekranSkrzynki from "../ekrany/Skrzynka.tsx?raw";

/* ── Jedna kolumna listy na cztery kolejki ───────────────────────────────────
   Pilnujemy kolejności pasm i tego, że żadna z czterech kolejek nie wraca do
   własnego układu. Kolejka z własną kolumną to piąty nawyk do nauczenia. */

describe("KolumnaKolejki", () => {
  it("pasma stoją w stałej kolejności: tytuł, kubełki, szukanie, drugi filtr, lista", () => {
    render(<KolumnaKolejki tytul="Zwroty" akcje={<button type="button">Akcja</button>}
      kubelki={<button type="button">Kubełek</button>}
      szukaj={<SzukajWKolejce wartosc="" onZmien={() => {}} etykieta="Szukaj" placeholder="Szukaj" />}
      drugi={<span>Drugi filtr</span>}>
      <p>Lista</p>
    </KolumnaKolejki>);
    const w = (t: string | RegExp) => screen.getByText(t);
    const po = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(po(screen.getByRole("heading", { name: "Zwroty" }), w("Kubełek"))).toBe(true);
    expect(po(w("Kubełek"), screen.getByLabelText("Szukaj"))).toBe(true);
    expect(po(screen.getByLabelText("Szukaj"), w("Drugi filtr"))).toBe(true);
    expect(po(w("Drugi filtr"), w("Lista"))).toBe(true);
    expect(screen.getByRole("region", { name: "Zwroty" })).toBeInTheDocument();
  });

  it("brak pasma nie zostawia pustego wiersza", () => {
    const { container } = render(<KolumnaKolejki etykieta="Kolejka"><p>Lista</p></KolumnaKolejki>);
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelectorAll("section > div")).toHaveLength(1);
  });

  it("pusta lista to Pusto z ikoną, jedno zdanie", () => {
    const { container } = render(<PustaKolejka ikona={Inbox}>Nic tu nie ma.</PustaKolejka>);
    expect(screen.getByText("Nic tu nie ma.")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("szukanie ma krzyżyk dopiero po wpisaniu", () => {
    const { rerender } = render(<SzukajWKolejce wartosc="" onZmien={() => {}} etykieta="Szukaj" placeholder="p" />);
    expect(screen.queryByRole("button", { name: "Wyczyść szukanie" })).toBeNull();
    rerender(<SzukajWKolejce wartosc="a" onZmien={() => {}} etykieta="Szukaj" placeholder="p" />);
    expect(screen.getByRole("button", { name: "Wyczyść szukanie" })).toBeInTheDocument();
  });
});

describe("kolejki używają jednej kolumny", () => {
  it("skrzynka, zwroty, reklamacje i dostawy składają listę z KolumnaKolejki", () => {
    for (const [nazwa, zrodlo] of Object.entries({ skrzynka, zwroty, reklamacje, dostawy })) {
      expect(zrodlo, nazwa).toContain("<KolumnaKolejki");
    }
  });

  it("zwroty, dostawy i kosze chowają dowody pod pracę poniżej xl", () => {
    /* Praca dostaje szerokość obok listy: dowody są w jednym pojemniku z pracą. */
    for (const [nazwa, zrodlo] of Object.entries({ zwroty, dostawy, kosze })) {
      expect(zrodlo, nazwa).toContain("<SrodekIDowody>");
      expect(zrodlo, nazwa).toContain("KARTA_PRACY");
      expect(zrodlo, nazwa).toContain("KARTA_DOWODOW");
    }
    expect(KARTA_PRACY).toContain("xl:min-h-0");
    expect(KARTA_DOWODOW).toContain("shrink-0");
    /* Trzecia kolumna siatki zaczyna się dopiero od xl, czyli od 1280 px. */
    expect(SIATKA_TRZECH_KOLUMN).toMatch(/lg:grid-cols-\[21rem_minmax\(0,1fr\)\] /);
    expect(SIATKA_TRZECH_KOLUMN).toContain("xl:grid-cols-[21rem_minmax(0,1fr)_16rem]");
  });

  it("kolumna listy ma tę samą szerokość na każdej kolejce", () => {
    /* Trzy siatki piszą szerokość listy osobno (reklamacje progami `xl`, więc
       nie mogą wziąć wspólnego napisu). Zmiana w jednej bez pozostałych dałaby
       agentowi kolejkę, która skacze przy przejściu między zakładkami. */
    const listy = (s: string) => [...new Set([...s.matchAll(/grid-cols-\[(\d+rem)_/g)].map((m) => m[1]))];
    for (const siatka of [SIATKA_TRZECH_KOLUMN, SIATKA_SKRZYNKI(true), SIATKA_SKRZYNKI(false), reklamacje]) {
      expect(listy(siatka)).toEqual(["21rem", "25rem"]);
    }
  });

  it("skrzynka bez otwartej rozmowy oddaje rozmowie miejsce po kontekście", () => {
    expect(SIATKA_SKRZYNKI(false)).not.toContain("16rem");
    expect(SIATKA_SKRZYNKI(true)).toContain("16rem");
    expect(ekranSkrzynki).toContain("SIATKA_SKRZYNKI(Boolean(rozmowa.data))");
  });
});
