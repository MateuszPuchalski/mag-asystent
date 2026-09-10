import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkutecznoscDoboru as Raport } from "../api/typy";
import { SkutecznoscDoboru } from "./SkutecznoscDoboru";

/* ── Karta skuteczności doboru (0.267.0) ─────────────────────────────────────
   Karta bierze dane PROPSEM, jak `PokrycieSygnatur`, więc test nie mockuje
   ani jednego hooka. Pilnuje czterech rzeczy, z których każda jest decyzją
   projektową, a nie układem pikseli: zero zostaje widoczne, mediana bez
   próbki nie udaje liczby, podstawa prawna dojeżdża na ekran, a przy braku
   osi osobowej nie ma jej wcale.                                            */

const DROGI = ["oferta", "zamiennik", "symbol", "ean", "wyszukiwarka", "zastosowanie",
  "silnik", "pasowanie", "oem", "pelnotekst", "wymiar"] as const;

const dane = (n: Partial<Raport> = {}): Raport => ({
  dni: 30,
  granicaHistorii: "2026-08-31T22:00:00Z",
  wyborow: 5,
  drogi: DROGI.map((droga) => ({
    droga, wybranych: droga === "oem" ? 5 : 0, zatwierdzonych: droga === "oem" ? 3 : 0,
  })),
  medianaDoWyboruMin: 12,
  wyborowZCzasem: 5,
  osoby: [],
  bezKonta: 0,
  naStole: { doborow: 2, statusy: [] },
  progWiarygodnosci: 20,
  podstawaPrawna: "Monitoring pracowniczy (Kodeks pracy art. 22² i nast.): wymaga zapisu w regulaminie.",
  ...n,
});

describe("skuteczność doboru", () => {
  it("wypisuje WSZYSTKIE jedenaście dróg, także te z zerem", () => {
    /* Szczebel bez ani jednego wyboru jest najcenniejszym ustaleniem tego
       raportu: droga utrzymywana w kodzie, która nikomu nie odpowiedziała.
       Wypadnięcie jej razem z zerem zamieniłoby ustalenie w ciszę. */
    render(<SkutecznoscDoboru dane={dane()} dni={30} onDni={vi.fn()} />);
    for (const etykieta of ["OEM", "zgodne wymiary", "pełny tekst", "przez silnik"]) {
      expect(screen.getByText(etykieta)).toBeInTheDocument();
    }
    expect(screen.getByText(/Bez ani jednego wyboru w tym oknie/).textContent)
      .toContain("zgodne wymiary");
  });

  it("mediana bez próbki to kreska, nie zero, i zawsze niesie swoje `n`", () => {
    /* „Mediana 0 min" czyta się jako wynik. Kreska czyta się jako brak
       danych — i tylko to drugie jest prawdą przy pustym oknie. */
    render(<SkutecznoscDoboru dane={dane({ medianaDoWyboruMin: null, wyborowZCzasem: 0 })}
      dni={30} onDni={vi.fn()} />);
    const zdanie = screen.getByText(/Mediana od pytania klienta/).textContent ?? "";
    expect(zdanie).toContain("—");
    expect(zdanie).toContain("0 wyborów");
  });

  it("mówi, dokąd sięga historia — inaczej selektor obiecuje kwartał, którego nie ma", () => {
    render(<SkutecznoscDoboru dane={dane()} dni={90} onDni={vi.fn()} />);
    expect(screen.getByText(/2026-08-31/)).toBeInTheDocument();
  });

  it("bez osi osobowej nie ma tabeli osób ANI podstawy prawnej", () => {
    /* Zdanie o monitoringu ma stać tam, gdzie monitoring. Wypisane nad pustą
       tabelą byłoby ostrzeżeniem przed czymś, czego nie ma — a ostrzeżenie
       bez pokrycia uczy ignorowania ostrzeżeń. */
    render(<SkutecznoscDoboru dane={dane({ osoby: [] })} dni={30} onDni={vi.fn()} />);
    expect(screen.queryByText(/Kodeks pracy/)).toBeNull();
  });

  it("z osią osobową wypisuje podstawę prawną i tłumaczy kreskę przy medianie", () => {
    render(<SkutecznoscDoboru dni={30} onDni={vi.fn()} dane={dane({
      osoby: [
        { userId: 1, osoba: "A. Lewandowska", wybranych: 30, zatwierdzonych: 20,
          najczestszaDroga: "zastosowanie", medianaMin: 9 },
        { userId: 2, osoba: "O. Nowak", wybranych: 4, zatwierdzonych: 1,
          najczestszaDroga: "wyszukiwarka", medianaMin: null },
      ],
    })} />);
    expect(screen.getByText(/Kodeks pracy/)).toBeInTheDocument();
    expect(screen.getByText("A. Lewandowska")).toBeInTheDocument();
    expect(screen.getByText("9 min")).toBeInTheDocument();
    /* Poniżej progu kreska z powodem w tytule — nie zero i nie puste miejsce. */
    expect(screen.getByTitle(/poniżej 20 wyborów/)).toBeInTheDocument();
  });

  it("selektor okna oddaje wybór ekranowi, bo okno wchodzi do klucza cache", async () => {
    const onDni = vi.fn();
    render(<SkutecznoscDoboru dane={dane()} dni={30} onDni={onDni} />);
    await userEvent.click(screen.getByRole("button", { name: "90 dni" }));
    expect(onDni).toHaveBeenCalledWith(90);
  });

  it("bez danych nie renderuje nic — karta nie miga pustym szkieletem", () => {
    const { container } = render(<SkutecznoscDoboru dane={undefined} dni={30} onDni={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
