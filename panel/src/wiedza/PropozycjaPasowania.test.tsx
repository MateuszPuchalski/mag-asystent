import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Pasowanie } from "../api/typy";

/* ── Karta propozycji pasowania (0.230.0) ───────────────────────────────────
   Rozstrzygający ma widzieć OBA końce, rolę z pozycją i dowód. Odrzucenie
   bez powodu nie ma prawa wyjść z karty — autor musi wiedzieć, co poprawić. */

vi.mock("../towar/useZdjecie", () => ({
  useZdjecie: (twId: number | null) => (twId == null ? null : `blob:${twId}`),
}));

const { PropozycjaPasowania } = await import("./PropozycjaPasowania");

const P: Pasowanie = {
  id: 5, czesc: { twId: 811, symbol: "LC170430140-0001", nazwa: "Uszczelka gaźnika GX160" },
  doCzego: { twId: 502, symbol: "W09-0211", nazwa: "Gaźnik GX160" },
  rola: "uszczelka", nazwaRoli: "uszczelka", pozycja: "od strony filtra",
  polaryzacja: "pasuje", powodNegatywny: null, zdaniePowodu: null, stan: "propozycja", zrodlo: "dobor",
  rodzajDowodu: "rozmowa", nazwaRodzajuDowodu: "rozmowa", dowodTresc: "dobór w rozmowie #4821", dowodLink: null,
  komentarz: null, conversationId: 4821, zastepujeId: null,
  zaproponowal: "A. Lewandowska", zaproponowanoAt: "2026-09-07T08:00:00Z",
  rozstrzygnal: null, rozstrzygnietoAt: null, powodRozstrzygniecia: null, pewnosc: "prawdopodobne",
  zdanieZrodla: "uszczelka (od strony filtra) LC170430140-0001 pasuje do W09-0211 — rozmowa, 7.09.2026, A. Lewandowska",
};

const pokaz = (onDecyzja = vi.fn()) => {
  render(<MemoryRouter><PropozycjaPasowania p={P} trwa={false} onDecyzja={onDecyzja} /></MemoryRouter>);
  return onDecyzja;
};

describe("PropozycjaPasowania", () => {
  it("niesie oba końce, rolę z pozycją, dowód i odnośnik do rozmowy", () => {
    pokaz();
    expect(screen.getByRole("article", { name: "Pasowanie: LC170430140-0001 → W09-0211" })).toBeInTheDocument();
    expect(screen.getByText("uszczelka · od strony filtra")).toBeInTheDocument();
    expect(screen.getByText(/dobór w rozmowie #4821/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "rozmowa #4821" })).toHaveAttribute("href", "/obsluga/skrzynka/4821");
    /* Dwa kafle: rozstrzygający porównuje uszczelkę z gaźnikiem, nie dwa symbole. */
    expect(screen.getAllByRole("img").length).toBe(2);
  });

  it("parę z Copilota znaczy pastylka; parę z ręki i z doboru nie", () => {
    const { unmount } = render(<MemoryRouter><PropozycjaPasowania trwa={false} onDecyzja={vi.fn()}
      p={{ ...P, zrodlo: "copilot", dowodTresc: "Copilot rozpoznał w rozmowie #4821: LC170430140-0001 pasuje do W09-0211" }} /></MemoryRouter>);
    expect(screen.getByText("z Copilota")).toBeInTheDocument();
    unmount();
    pokaz();
    expect(screen.queryByText("z Copilota")).toBeNull();
  });

  it("zatwierdzenie idzie bez powodu, odrzucenie — dopiero z powodem", async () => {
    const onDecyzja = pokaz();
    await userEvent.click(screen.getByRole("button", { name: "Zatwierdź" }));
    expect(onDecyzja).toHaveBeenCalledWith("zatwierdz", null);

    await userEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    const potwierdz = screen.getByRole("button", { name: "Odrzuć" });
    expect(potwierdz).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Powód odrzucenia"), "to uszczelka kolektora, nie filtra");
    await userEvent.click(potwierdz);
    expect(onDecyzja).toHaveBeenCalledWith("odrzuc", "to uszczelka kolektora, nie filtra");
  });
});
