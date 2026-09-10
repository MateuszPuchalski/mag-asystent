import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NaglowekSekcji } from "./index";

/* Źródła przez `?raw`, tak jak w `RamaOkna.test.ts` i `Kontrast.test.ts`:
   `tsconfig.json` zapisuje, że panel jest aplikacją przeglądarki, więc żadnego
   `node:fs`. Wykluczamy `ui/index.tsx`, bo tam ten łańcuch klas MA stać — to
   jest jego jedyne prawowite miejsce. */
const ZRODLA = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx", "!../ui/index.tsx"],
  { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── Jedna ranga, jeden kształt (0.256.0) ────────────────────────────────────
   `NaglowekSekcji` powstał w 0.249.0 i do 0.255.0 używały go TRZY pliki.
   Obok stało siedemnaście ręcznie sklejonych nagłówków tej samej rangi:
   w pięciu wagach (`font-bold`, `font-semibold`, gołe `<b>`) i dwóch
   rozmiarach (11 px i 12 px). Pięć zapisów jednej roli to nie wariant, tylko
   brak decyzji — a czytelnik nie ma jak poznać, że to jeden poziom.

   CO PILNUJE. Że łańcuch „wersaliki + rozstrzelenie + szarość" nie odradza się
   poza komponentem. Nie zabrania wersalików w ogóle: plakietka (`Plakietka`),
   etykieta w liście definicji i podpis na osi rozmowy to INNE role i mają
   własne kształty. Reguła celuje w parę `uppercase` + `tracking-wide`
   ALBO `tracking-wider` przy szarości nagłówka.

   CZEGO NIE PILNUJE. Nie wie, czy nowy nagłówek w ogóle powstał — da się
   dołożyć sekcję bez nagłówka i bramka tego nie zobaczy. Nie sprawdza też
   doboru znacznika: `jako="h3"` tam, gdzie to naprawdę nagłówek dokumentu,
   zostaje decyzją człowieka.                                               */
const RECZNY = /uppercase[^"`]*tracking-wide[r]?[^"`]*text-slate-500|text-slate-500[^"`]*uppercase[^"`]*tracking-wide/;

describe("Nagłówek sekcji ma jeden kształt w całym panelu", () => {
  it("nikt nie skleja go ręcznie poza `ui/index.tsx`", () => {
    const winne: string[] = [];
    for (const [plik, zrodlo] of Object.entries(ZRODLA)) {
      /* Komentarze zerujemy, bo uzasadnienie zakazu zawiera zakazany łańcuch —
         ta sama pułapka, o którą potknął się strażnik ramy okna. */
      const czysty = zrodlo
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
      czysty.split("\n").forEach((l, i) => {
        if (RECZNY.test(l)) winne.push(`${plik}:${i + 1} → ${l.trim().slice(0, 70)}`);
      });
    }
    expect(winne).toEqual([]);
  });
});

describe("Nagłówek sekcji: znacznik i barwa", () => {
  it("domyślnie jest `span`, bo bywa sąsiadem numeru i plakietek", () => {
    const { container } = render(<NaglowekSekcji>Oferta</NaglowekSekcji>);
    expect(container.querySelector("span")).toBeInTheDocument();
  });

  it("`jako=„h3”` zachowuje nagłówek dla czytnika ekranu", () => {
    /* Znacznik niesie ZNACZENIE, nie tylko wygląd. Cztery miejsca miały `<h3>`
       i po ujednoliceniu kształtu nie wolno im było zejść do `<span>` — czytnik
       ekranu straciłby wtedy punkt zaczepienia w kolumnie dowodów. */
    render(<NaglowekSekcji jako="h3">Zgłoszenie</NaglowekSekcji>);
    expect(screen.getByRole("heading", { name: "Zgłoszenie" })).toBeInTheDocument();
  });

  it("`ton` bierze samą barwę, reszta łańcucha zostaje", () => {
    /* Zielony nagłówek mówi o INNYM ŹRÓDLE danych, a nie o wyższej randze —
       dlatego wolno podmienić wyłącznie barwę. */
    const { container } = render(
      <NaglowekSekcji ton="text-emerald-800">Wiedza: pasowania</NaglowekSekcji>);
    const k = container.querySelector("span")!.className;
    expect(k).toContain("text-emerald-800");
    expect(k).not.toContain("text-slate-500");
    expect(k).toContain("uppercase");
    expect(k).toContain("text-[11px]");
  });

  it("ikona jest opcjonalna — większość nagłówków jej nie ma", () => {
    const { container } = render(<NaglowekSekcji>Kandydaci</NaglowekSekcji>);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("Kandydaci")).toBeInTheDocument();
  });
});
