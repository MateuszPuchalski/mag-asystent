import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Os } from "./Os";
import type { WpisOsi } from "../api/typy";

/* ── Załączniki na osi (0.154.0) ─────────────────────────────────────────────
   Sonda z żywego konta: 7 z 39 wiadomości ma załącznik, a agent go nie
   widział. W sklepie z częściami do maszyn ogrodniczych zdjęcie pękniętego
   elementu bywa całą treścią pytania. */

const wiadomosc = (zalaczniki: WpisOsi["zalaczniki"]): WpisOsi => ({
  id: "msg-1", rodzaj: "wiadomosc", autor: "klient", odKlienta: true,
  tresc: "Załączam zdjęcie", at: "2026-09-01T10:00:00Z", ofertaId: null,
  messageId: 1, zalaczniki,
});

const os = (w: WpisOsi) => render(<Os wpisy={[w]} zrodloPomiaru={null} mozeZlecac={false}
  onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);

describe("Załączniki na osi rozmowy", () => {
  it("pokazuje nazwę pliku i prowadzi przez NASZ serwer, nie do Allegro", () => {
    /* Adres Allegro nie ma prawa trafić do przeglądarki: pobranie wymaga
       tokena konta firmy, a ten zostaje po stronie serwera. */
    os(wiadomosc([{ id: 7, nazwa: "szarpak.jpeg", typ: "image/jpeg",
      status: "SAFE", doPobrania: true }]));

    const link = screen.getByRole("link", { name: /szarpak\.jpeg/ });
    expect(link.getAttribute("href")).toBe("/api/obsluga/zalaczniki/7");
    expect(link.getAttribute("href")).not.toContain("allegro.pl");
  });

  it("załącznik niebezpieczny jest WIDOCZNY, ale nie do pobrania", () => {
    /* Ukrycie kłamałoby, że klient nic nie przysłał. Allegro uznało plik za
       niebezpieczny i nie mamy powodu wiedzieć lepiej. */
    os(wiadomosc([{ id: 8, nazwa: "faktura.exe", typ: null,
      status: "UNSAFE", doPobrania: false }]));

    expect(screen.getByText(/faktura\.exe/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /faktura\.exe/ })).toBeNull();
    expect(screen.getByText(/UNSAFE|niebezpieczn/i)).toBeTruthy();
  });

  it("wiadomość bez załączników wygląda jak dotąd", () => {
    const { container } = os(wiadomosc(undefined));
    expect(container.querySelectorAll("a").length).toBe(0);
  });
});
