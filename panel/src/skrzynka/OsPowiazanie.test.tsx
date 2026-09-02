import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Os } from "./Os";
import type { WpisOsi } from "../api/typy";

/* Powiązanie wiadomości z towarem (0.166.0). Mail Allegro „Wiadomość dotyczy"
   pokazuje tytuł i zamówienie; panel do 0.165.0 pokazywał goły numer oferty,
   a numer zamówienia wyrzucał przy mapowaniu. */
describe("Powiązanie wiadomości na osi", () => {
  const wpis = (n: Partial<WpisOsi> = {}): WpisOsi => ({
    id: "msg-1", rodzaj: "wiadomosc", autor: "kupujacy_7", odKlienta: true,
    tresc: "Ta sztuka pasuje?", at: "2026-09-01T10:00:00Z", ofertaId: null, ...n,
  });
  const os = (w: WpisOsi) => render(<Os wpisy={[w]} zrodloPomiaru={null} mozeZlecac={false}
    onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);

  it("oferta z nazwą z zamówienia, gdy nazwę znamy", () => {
    os(wpis({ ofertaId: "17235726715", nazwaOferty: "Szarpak do NAC LS 46-450" }));
    expect(screen.getByText(/oferta 17235726715 — Szarpak do NAC/)).toBeInTheDocument();
  });

  it("oferta bez nazwy zostaje numerem, nie zgaduje tytułu", () => {
    os(wpis({ ofertaId: "17235726715", nazwaOferty: null }));
    expect(screen.getByText(/oferta 17235726715$/)).toBeInTheDocument();
  });

  it("zamówienie widać skrócone, a całość w podpowiedzi", () => {
    os(wpis({ zamowienieId: "2f8c1a3e-9b7d-4c1e-8a2b-000000000001" }));
    const z = screen.getByText(/zamówienie 2f8c1a3e…/);
    expect(z).toHaveAttribute("title", "2f8c1a3e-9b7d-4c1e-8a2b-000000000001");
  });

  it("wiadomość bez powiązań nie udaje, że jakieś ma", () => {
    os(wpis());
    expect(screen.queryByText(/oferta/)).toBeNull();
    expect(screen.queryByText(/zamówienie/)).toBeNull();
  });
});
