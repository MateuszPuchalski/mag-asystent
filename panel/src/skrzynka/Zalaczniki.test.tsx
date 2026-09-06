import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Os } from "./Os";
import type { WpisOsi } from "../api/typy";

/* ── Załączniki na osi (0.155.0) ─────────────────────────────────────────────
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
      status: "SAFE", doPobrania: true, podglad: true }]));

    const link = screen.getByRole("link", { name: /szarpak\.jpeg/ });
    expect(link.getAttribute("href")).toBe("/api/obsluga/zalaczniki/7");
    expect(link.getAttribute("href")).not.toContain("allegro.pl");
  });

  it("załącznik niebezpieczny jest WIDOCZNY, ale nie do pobrania", () => {
    /* Ukrycie kłamałoby, że klient nic nie przysłał. Allegro uznało plik za
       niebezpieczny i nie mamy powodu wiedzieć lepiej. */
    os(wiadomosc([{ id: 8, nazwa: "faktura.exe", typ: null,
      status: "UNSAFE", doPobrania: false, podglad: false }]));

    expect(screen.getByText(/faktura\.exe/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /faktura\.exe/ })).toBeNull();
    expect(screen.getByText(/UNSAFE|niebezpieczn/i)).toBeTruthy();
  });

  it("wiadomość bez załączników wygląda jak dotąd", () => {
    const { container } = os(wiadomosc(undefined));
    expect(container.querySelectorAll("a").length).toBe(0);
  });

  /* ── Zdjęcie widać, nie trzeba klikać (0.218.0) ────────────────────────────
     Właściciel: „gdy klient wysyła zdjęcie, wyświetlaj w czacie, nie każ mi
     w nie klikać". W sklepie z częściami zdjęcie pękniętego elementu bywa całą
     treścią pytania — nazwa pliku mówi o niej tyle, co nic.               */
  it("zdjęcie klienta rysuje się na osi, a nazwa dalej pobiera plik", () => {
    os(wiadomosc([{ id: 7, nazwa: "szarpak.jpeg", typ: "image/jpeg",
      status: "SAFE", doPobrania: true, podglad: true }]));

    /* `alt` to nazwa pliku: czytnik ekranu i zepsute łącze mają powiedzieć,
       co tu miało być. */
    const obraz = screen.getByRole("img", { name: "szarpak.jpeg" });
    expect(obraz.getAttribute("src")).toBe("/api/obsluga/zalaczniki/7/podglad");

    /* PODGLĄD I POBRANIE TO DWA RÓŻNE ADRESY. Odnośnik z nazwą prowadzi na
       trasę pobrania, żeby plik zszedł na dysk pod własną nazwą. */
    expect(screen.getByRole("link", { name: /szarpak\.jpeg/ })
      .getAttribute("href")).toBe("/api/obsluga/zalaczniki/7");
  });

  it("plik, którego nie umiemy pokazać, zostaje samą nazwą", () => {
    /* `podglad` liczy SERWER — panel nie zgaduje po typie i nie rysuje
       zepsutego obrazka dla PDF-a czy SVG. */
    os(wiadomosc([{ id: 9, nazwa: "gwarancja.pdf", typ: "application/pdf",
      status: "SAFE", doPobrania: true, podglad: false }]));

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("link", { name: /gwarancja\.pdf/ })).toBeTruthy();
  });
});
