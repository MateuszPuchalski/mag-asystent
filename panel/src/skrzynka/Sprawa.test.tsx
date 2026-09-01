import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sprawa } from "./Sprawa";
import type { SprawaRozmowy, WierszSprawy } from "../api/typy";

/* ── Sprawa nad rozmową (§6.1, 0.161.0) ──────────────────────────────────────
   Pasek ma odpowiadać na jedno pytanie: „czy o tym samym problemie rozmawiamy
   gdzie indziej". Reszta — status, oś, historia — do sprawy NIE należy
   i pilnują tego testy serwera. Tu pilnujemy tego, co widzi agent.          */

const sprawa = (n: Partial<SprawaRozmowy> = {}): SprawaRozmowy => ({
  id: 3, tytul: "Szarpak do NAC LS 46-450",
  rozmowy: [
    { id: 10, klient: "zielony_ogrod", ostatniaWiadomoscAt: "2026-09-01T09:00:00.000Z" },
    { id: 11, klient: "zielony_ogrod", ostatniaWiadomoscAt: "2026-08-30T09:00:00.000Z" },
  ], ...n,
});

const LISTA: WierszSprawy[] = [
  { id: 3, tytul: "Szarpak do NAC LS 46-450", liczbaRozmow: 2,
    ostatniaWiadomoscAt: "2026-09-01T09:00:00.000Z" },
];

const pasek = (h: Partial<Parameters<typeof Sprawa>[0]> = {}) =>
  render(<Sprawa sprawa={null} rozmowaId={10} sprawy={LISTA} trwa={false} blad=""
    onZaloz={vi.fn()} onDolacz={vi.fn()} onOdlacz={vi.fn()} onOtworz={vi.fn()} {...h} />);

describe("Pasek sprawy", () => {
  it("pokazuje rodzeństwo, bo tam bywa odpowiedź, której agent zaraz szuka", () => {
    const onOtworz = vi.fn();
    pasek({ sprawa: sprawa(), onOtworz });
    expect(screen.getByText("Szarpak do NAC LS 46-450")).toBeInTheDocument();
    expect(screen.getByText(/druga rozmowa/)).toBeInTheDocument();
    /* Rozmowa bieżąca NIE jest własnym rodzeństwem. */
    expect(screen.queryByRole("button", { name: /#10/ })).toBeNull();
    expect(screen.getByRole("button", { name: /#11/ })).toBeInTheDocument();
  });

  it("sprawa z jedną rozmową mówi to wprost, zamiast udawać pustkę", () => {
    /* Klamrę zakłada się, gdy problem widać; druga rozmowa bywa dopiero
       jutro. Milczenie w tym miejscu wyglądałoby jak usterka. */
    pasek({ sprawa: sprawa({ rozmowy: [
      { id: 10, klient: "zielony_ogrod", ostatniaWiadomoscAt: "2026-09-01T09:00:00.000Z" }] }) });
    expect(screen.getByText(/na razie jedyna rozmowa/)).toBeInTheDocument();
  });

  it("rozmowa bez sprawy nie udaje, że jakąś ma", () => {
    pasek();
    expect(screen.getByText(/nie należy do żadnej sprawy/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ODKLEJ/ })).toBeNull();
  });

  it("nowa sprawa wymaga tytułu — klamra bez nazwy nic nie skleja", async () => {
    const onZaloz = vi.fn();
    pasek({ onZaloz });
    await userEvent.click(screen.getByRole("button", { name: /PRZYPISZ DO SPRAWY/ }));
    expect(screen.getByRole("button", { name: "ZAŁÓŻ" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Tytuł nowej sprawy/), "Szarpak");
    await userEvent.click(screen.getByRole("button", { name: "ZAŁÓŻ" }));
    expect(onZaloz).toHaveBeenCalledWith("Szarpak");
  });

  it("dołączenie do istniejącej sprawy niesie jej rozmiar, nie sam tytuł", async () => {
    /* Po liczbie rozmów agent poznaje, czy to ta duża sprawa sprzed miesiąca,
       czy dzisiejsza. Dwie sprawy o podobnym tytule zdarzają się co tydzień. */
    const onDolacz = vi.fn();
    pasek({ onDolacz });
    await userEvent.click(screen.getByRole("button", { name: /PRZYPISZ DO SPRAWY/ }));
    await userEvent.selectOptions(screen.getByLabelText(/Istniejąca sprawa/), "3");
    expect(onDolacz).toHaveBeenCalledWith(3);
    expect(screen.getByRole("option", { name: /Szarpak do NAC LS 46-450 \(2\)/ }))
      .toBeInTheDocument();
  });

  it("odmowa serwera ląduje przy pasku, nie w ogólnym błędzie ekranu", () => {
    pasek({ sprawa: sprawa(), blad: "Rozmowa należy już do sprawy „Filtr”" });
    expect(screen.getByText(/należy już do sprawy/)).toBeInTheDocument();
  });
});
