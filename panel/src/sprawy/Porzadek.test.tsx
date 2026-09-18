import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasekPorzadku, posortuj, type OsPorzadku } from "./Porzadek";

/* ── Porządek kolejek obsługi (0.401.0) ──────────────────────────────────────
   Zgłoszenie właściciela: „dodaj sortowanie po dacie etc". Testy pilnują
   czterech decyzji, bo każda da się cicho odwrócić przy pierwszym refaktorze:

   1. PUSTE ZAWSZE NA KOŃCU. Sprawa bez terminu nie jest najpilniejsza ani
      najmniej pilna — jest sprawą, o której ta oś nic nie mówi.
   2. TERMIN ROŚNIE, reszta maleje. Przy terminie pytanie brzmi „co się pali",
      przy dacie i kwocie — „co najnowsze" i „co najdroższe".
   3. OŚ, KTÓREJ EKRAN NIE DEKLARUJE, nie przestawia listy. Dyskusja nie ma
      terminu ani kwoty.
   4. PASEK NIE RYSUJE SIĘ przy jednej osi — wybór z jednego elementu to nie
      wybór.                                                                 */

const s = (id: number, n: Partial<{ otwarto: string | null; termin: string | null; kwota: number | null }> = {}) =>
  ({ id, otwarto: "2026-09-01T00:00:00Z", termin: null, kwota: null, ...n });

const KLUCZE = {
  otwarto: (x: ReturnType<typeof s>) => x.otwarto,
  termin: (x: ReturnType<typeof s>) => x.termin,
  kwota: (x: ReturnType<typeof s>) => x.kwota,
};

describe("porządek kolejki", () => {
  it("po dacie otwarcia: NAJNOWSZE na górze", () => {
    const lista = [
      s(1, { otwarto: "2026-09-01T00:00:00Z" }),
      s(2, { otwarto: "2026-09-10T00:00:00Z" }),
      s(3, { otwarto: "2026-09-05T00:00:00Z" }),
    ];
    expect(posortuj(lista, "otwarto", KLUCZE).map((x) => x.id)).toEqual([2, 3, 1]);
  });

  it("po terminie ROŚNIE — najbliższy termin to ten, który się pali", () => {
    const lista = [
      s(1, { termin: "2026-09-30T00:00:00Z" }),
      s(2, { termin: "2026-09-08T00:00:00Z" }),
    ];
    expect(posortuj(lista, "termin", KLUCZE).map((x) => x.id)).toEqual([2, 1]);
  });

  it("sprawa BEZ terminu ląduje na końcu, a nie na czele", () => {
    /* Pustka nie jest pilnością. Gdyby `null` sortował się jako najmniejszy,
       sprawy bez terminu wypchnęłyby na dół te, które naprawdę się palą. */
    const lista = [s(1, { termin: null }), s(2, { termin: "2026-09-08T00:00:00Z" })];
    expect(posortuj(lista, "termin", KLUCZE).map((x) => x.id)).toEqual([2, 1]);
  });

  it("po kwocie: najdroższe na górze, a brak kwoty na końcu", () => {
    const lista = [s(1, { kwota: 500 }), s(2, { kwota: null }), s(3, { kwota: 9900 })];
    expect(posortuj(lista, "kwota", KLUCZE).map((x) => x.id)).toEqual([3, 1, 2]);
  });

  it("oś, której ekran NIE deklaruje, zostawia listę w spokoju", () => {
    /* Dyskusja nie ma terminu ani kwoty — i nie ma prawa udawać, że sortuje. */
    const lista = [s(1), s(2)];
    const bezTerminu = { otwarto: (x: ReturnType<typeof s>) => x.otwarto };
    expect(posortuj(lista, "termin", bezTerminu).map((x) => x.id)).toEqual([1, 2]);
  });

  it("NIE RUSZA listy wejściowej — sortuje kopię", () => {
    /* Lista przychodzi z `useMemo` wyżej; mutacja w miejscu dałaby zmianę,
       której React nie zobaczy, i ekran raz posortowany, raz nie. */
    const lista = [s(2, { otwarto: "2026-09-01T00:00:00Z" }), s(1, { otwarto: "2026-09-10T00:00:00Z" })];
    posortuj(lista, "otwarto", KLUCZE);
    expect(lista.map((x) => x.id)).toEqual([2, 1]);
  });
});

describe("pasek porządku", () => {
  beforeEach(() => localStorage.clear());

  it("PRZYCISK MÓWI BIEŻĄCĄ OŚ, a menu oddaje wybór", async () => {
    /* 0.402.0: pasmo pigułek zeszło do jednego przycisku z menu. Napis na
       przycisku jest tu sednem — jedno spojrzenie zamiast czytania czterech
       napisów, żeby poznać ten wybrany. */
    const onZmien = vi.fn();
    render(<PasekPorzadku porzadek="termin" dozwolone={["termin", "otwarto"]} onZmien={onZmien} />);

    const przycisk = screen.getByRole("button", { name: /Termin/ });
    expect(przycisk).toHaveAttribute("aria-expanded", "false");
    /* Osi NIEWYBRANEJ nie widać, dopóki menu jest zamknięte. */
    expect(screen.queryByRole("menuitemradio")).toBeNull();

    await userEvent.click(przycisk);
    expect(screen.getByRole("menuitemradio", { name: /Termin/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Od najnowszych/ }));
    expect(onZmien).toHaveBeenCalledWith("otwarto");
    /* Wybór ZAMYKA menu — inaczej zasłaniałoby listę, którą właśnie przestawiło. */
    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });

  it("przy JEDNEJ osi nie rysuje się wcale", () => {
    /* Wybór z jednego elementu to nie wybór, tylko ozdoba zajmująca wiersz. */
    const { container } = render(
      <PasekPorzadku porzadek="otwarto" dozwolone={["otwarto"] as OsPorzadku[]} onZmien={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
