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

/* ── Kto to powiedział (0.193.0) ─────────────────────────────────────────────
   Makieta `docs/projekt-widokow/Main.dc.html` odróżnia rodzaje kart czterema
   cechami — tłem, ramką, ikoną i wcięciem — plus podpisem rodzaju. Front
   doszedł do jednej: tło #ffffff kontra #f8fafc, przy tej samej ramce.
   Na ekranie wiadomość klienta i nasza odpowiedź wyglądały identycznie.     */
describe("Rodzaj wpisu widać, zanim się go przeczyta", () => {
  const wpis = (n: Partial<WpisOsi> = {}): WpisOsi => ({
    id: "msg-1", rodzaj: "wiadomosc", autor: "kupujacy_7", odKlienta: true,
    tresc: "Ta sztuka pasuje?", at: "2026-09-01T10:00:00Z", ofertaId: null, ...n,
  });
  const os = (wpisy: WpisOsi[]) => render(<Os wpisy={wpisy} zrodloPomiaru={null}
    mozeZlecac={false} onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);

  it("wiadomość klienta i nasza odpowiedź mają RÓŻNE podpisy rodzaju", () => {
    os([wpis(), wpis({ id: "msg-2", odKlienta: false, autor: "Biuro" })]);
    expect(screen.getByText("Klient · Allegro")).toBeInTheDocument();
    expect(screen.getByText("Odpowiedź firmy")).toBeInTheDocument();
  });

  it("obie strony rozmowy stoją po dwóch stronach kolumny", () => {
    /* Klient przy lewej krawędzi, my przy prawej. To ta cecha działa, zanim
       wzrok dojdzie do podpisu.

       Do 0.197.4 robiły to stałe wcięcia `mr-10`/`ml-10`. Od 0.198.0 kolumna
       rośnie z monitorem, więc wypowiedzi mają próg czytelności i dosuwają
       się marginesem automatycznym — inaczej obie zaczynałyby się w tym samym
       miejscu, a strona przestałaby cokolwiek znaczyć. */
    const { container } = os([wpis(), wpis({ id: "msg-2", odKlienta: false, autor: "Biuro" })]);
    const karty = container.querySelectorAll("article");
    expect(karty[0].className).toMatch(/\bmr-auto\b/);
    expect(karty[1].className).toMatch(/\bml-auto\b/);
  });

  /* Szeroki monitor nie ma prawa rozciągnąć wypowiedzi na całą kolumnę:
     linijka na sto dwadzieścia znaków gubi początek następnego wiersza. */
  it("wypowiedź ma próg czytelności, nie szerokość okna", () => {
    const { container } = os([wpis()]);
    expect(container.querySelector("article")!.className).toMatch(/max-w-\[75ch\]/);
  });

  it("wpis niesie godzinę — bez niej nie widać, ile trwała cisza", () => {
    /* `at` jechał w kontrakcie od początku, a oś go nie pokazywała wcale. */
    os([wpis()]);
    expect(screen.getByText(/10:00|11:00|12:00/)).toBeInTheDocument();
  });
});
