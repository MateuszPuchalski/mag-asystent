import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Prowadzi } from "./Prowadzi";

/* ── Wspólny pasek „kto prowadzi" (0.392.0) ──────────────────────────────────
   Jeden kształt dla trzech ekranów, ale NIE jedna waga i NIE jedno zachowanie.
   Testy pilnują dokładnie tych dwóch różnic, bo to one są tu decyzją:

   1. WAGA WYNIKA Z KOSZTU NIEZROBIENIA. W skrzynce nieprzejętą rozmowę piszą
      czasem dwie osoby naraz (0.247.0), więc przycisk jest główny. Reklamacja
      czeka w kolejce i tyle.
   2. ODDAĆ MOŻNA TYLKO TO, CO SERWER PRZYJMIE. `przejmijRozmowe` przypisuje
      wyłącznie rozmowę niczyją, więc skrzynka nie ma prawa rysować „oddaj".  */

describe("pasek prowadzącego", () => {
  it("bez prowadzącego mówi o nikim i proponuje wzięcie", async () => {
    const onKlik = vi.fn();
    render(<Prowadzi prowadzi={null} trwa={false} onProwadze={onKlik} />);

    expect(screen.getByText("nikt")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Prowadzę tę sprawę" }));
    expect(onKlik).toHaveBeenCalled();
  });

  it("sprawa WZIĘTA PRZEZ KOGOŚ INNEGO nie ma przycisku — odbiera się osobną drogą", () => {
    render(<Prowadzi prowadzi="A. Lewandowska" trwa={false} onProwadze={vi.fn()} />);

    expect(screen.getByText("A. Lewandowska")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("własną sprawę da się odłożyć", async () => {
    const onKlik = vi.fn();
    render(<Prowadzi prowadzi="Ja" jaProwadze trwa={false} onProwadze={onKlik} />);

    expect(screen.getByText("Ty")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Odłóż sprawę" }));
    expect(onKlik).toHaveBeenCalled();
  });

  it("skrzynka NIE proponuje oddania, bo serwer takiego zapisu nie przyjmie", () => {
    /* `przejmijRozmowe` działa tylko na `assigned_user_id IS NULL`. Przycisk
       „oddaj" wołałby zapis, który odbija się konfliktem. */
    render(<Prowadzi prowadzi="Ja" jaProwadze mozeOddac={false} trwa={false}
      onProwadze={vi.fn()} />);

    expect(screen.getByText("Ty")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("etykiety da się przestawić — skrzynka ma własną", () => {
    render(<Prowadzi prowadzi={null} mocny etykietaWez="PRZEJMIJ ROZMOWĘ"
      trwa={false} onProwadze={vi.fn()} />);

    expect(screen.getByRole("button", { name: "PRZEJMIJ ROZMOWĘ" })).toBeInTheDocument();
  });
});
