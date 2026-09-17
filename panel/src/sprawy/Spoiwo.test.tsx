import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PrzystanekDrogi, SprawaZakupu } from "../api/typy";
import { DrogaZakupu, SprawyZakupu } from "./Spoiwo";

/* ── Spoiwo kolejek (`docs/obsluga-klienta-calosc.md`) ───────────────────────
   Blok jest wspólny dla czterech ekranów, więc testy pilnują tego, co przy
   kopiowaniu go w czterech miejscach rozjechałoby się pierwsze:

   1. DYSKUSJA NIE JEST REKLAMACJĄ. Jedna plakietka na oba byty to blizna
      0.121.0, kupiona już raz.
   2. DROGA Z JEDNEGO PRZYSTANKU NIE JEST DROGĄ. Pasek o jednym elemencie
      zajmowałby miejsce, nie mówiąc nic.
   3. TERMIN POKAZUJE SIĘ TYLKO TAM, GDZIE JEST. Dyskusja go nie ma, a zegar
      wymyślony kazałby gonić pracę bez terminu.                             */

const sprawa = (n: Partial<SprawaZakupu> = {}): SprawaZakupu => ({
  id: 7, typ: "CLAIM", numer: "12/2026", temat: "Nie działa", statusAllegro: null,
  decyzjaDo: null, otwartoAt: "2026-09-10T08:00:00Z", prowadzi: null, otwarta: true, ...n,
});

const przystanek = (n: Partial<PrzystanekDrogi> = {}): PrzystanekDrogi => ({
  rodzaj: "rozmowa", id: 1, at: "2026-09-01T08:00:00Z", opis: null, ...n,
});

describe("sprawy tego zakupu", () => {
  it("rozróżnia dyskusję od reklamacji i prowadzi do właściwej kolejki", () => {
    render(<MemoryRouter><SprawyZakupu sprawy={[
      sprawa({ id: 7, typ: "CLAIM", temat: "Nie działa" }),
      sprawa({ id: 9, typ: "DISPUTE", numer: null, temat: "Gdzie paczka" }),
    ]} /></MemoryRouter>);

    expect(screen.getByText("reklamacja")).toBeInTheDocument();
    expect(screen.getByText("dyskusja")).toBeInTheDocument();
    const linki = screen.getAllByRole("link", { name: "Otwórz" });
    expect(linki.map((a) => a.getAttribute("href")))
      .toEqual(["/obsluga/reklamacje/7", "/obsluga/dyskusje/9"]);
  });

  it("termin pokazuje się tylko przy sprawie, która go ma", () => {
    render(<MemoryRouter><SprawyZakupu sprawy={[
      sprawa({ id: 7, decyzjaDo: "2026-09-20T00:00:00Z" }),
      sprawa({ id: 9, typ: "DISPUTE", numer: null, decyzjaDo: null }),
    ]} /></MemoryRouter>);

    expect(screen.getAllByText(/termin/).length).toBe(1);
  });

  it("bez spraw blok nie zajmuje miejsca", () => {
    const { container } = render(<MemoryRouter><SprawyZakupu sprawy={[]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it("sprawa zamknięta mówi o tym słowem, nie samym kolorem", () => {
    render(<MemoryRouter><SprawyZakupu sprawy={[sprawa({ otwarta: false, statusAllegro: "CLAIM_ACCEPTED" })]} /></MemoryRouter>);
    expect(screen.getByText("zamknięta")).toBeInTheDocument();
  });
});

describe("droga tego zakupu", () => {
  it("układa przystanki i podświetla ten, na którym stoi agent", () => {
    render(<MemoryRouter><DrogaZakupu tutaj={{ rodzaj: "reklamacja", id: 5 }} droga={[
      przystanek({ rodzaj: "rozmowa", id: 1 }),
      przystanek({ rodzaj: "dyskusja", id: 3, at: "2026-09-03T08:00:00Z" }),
      przystanek({ rodzaj: "reklamacja", id: 5, at: "2026-09-06T08:00:00Z" }),
    ]} /></MemoryRouter>);

    /* Przystanek, na którym agent stoi, nie jest odnośnikiem: klik prowadzący
       tam, gdzie już jesteś, jest kliknięciem straconym. */
    const linki = screen.getAllByRole("link");
    expect(linki.map((a) => a.getAttribute("href")))
      .toEqual(["/obsluga/skrzynka/1", "/obsluga/dyskusje/3"]);
    expect(screen.getByText("reklamacja")).toBeInTheDocument();
  });

  it("jeden przystanek to nie droga", () => {
    const { container } = render(<MemoryRouter><DrogaZakupu droga={[przystanek()]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
