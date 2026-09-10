import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ZnakAllegro } from "./ZnakAllegro";

/* ── Znak Allegro (0.252.0) ──────────────────────────────────────────────────
   Testy pilnują trzech rzeczy, bo na każdej z nich ten znak może cicho
   przestać robić to, po co stoi na ekranie: ma NAZYWAĆ się Allegro dla
   czytnika ekranu, ma trzymać proporcje logotypu i ma być znakiem MARKI,
   a nie szarym kleksem w barwie tekstu obok.                                */

describe("znak słowny Allegro", () => {
  it("niesie nazwę marki, bo zastąpił wyraz w odnośniku", () => {
    /* Sedno całej podmiany: wyraz „Allegro" zniknął z czterech odnośników,
       więc dostępna nazwa musi przyjść stąd. Bez tego czytnik ekranu
       przeczytałby „Otwórz w" i urwał w połowie zdania. */
    render(<ZnakAllegro />);
    expect(screen.getByRole("img", { name: "Allegro" })).toBeInTheDocument();
  });

  it("trzyma proporcje logotypu, nie kwadratu ikony", () => {
    /* W kratce 24×24 napis zajmuje pasek 24 × 8,038 — reszta to pustka.
       Kadrowany `viewBox` sprawia, że prop `wysokosc` jest wysokością NAPISU,
       a szerokość dolicza się sama. Kwadrat oznaczałby, że ktoś przywrócił
       surowy plik z `simple-icons` i znak skurczył się trzykrotnie. */
    const { container } = render(<ZnakAllegro wysokosc={12} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 7.981 24 8.038");
    expect(Number(svg.getAttribute("height"))).toBe(12);
    expect(Number(svg.getAttribute("width"))).toBeCloseTo(12 * (24 / 8.038), 2);
  });

  it("jest w barwie MARKI, nie w barwie tekstu obok", () => {
    /* `currentColor` wyglądałby jak ikona interfejsu i nie mówiłby, dokąd
       prowadzi odnośnik — a to jedyny powód, dla którego ten znak tu stoi.
       Barwa z `data/simple-icons.json`, źródło podane tam jako allegro.pl. */
    const { container } = render(<ZnakAllegro />);
    expect(container.querySelector("svg")!.getAttribute("fill")).toBe("#FF5A00");
  });

  it("rysuje ścieżkę z pakietu, a nie pustą atrapę", () => {
    /* Znaku nie wolno odtwarzać z pamięci — tę regułę repo nosi dla kształtu
       Allegro w ogóle. Długość ścieżki jest najtańszym strażnikiem tego, że
       ktoś nie podmienił jej na „narysowane mniej więcej tak samo". */
    const { container } = render(<ZnakAllegro />);
    const d = container.querySelector("path")!.getAttribute("d") ?? "";
    expect(d.length).toBeGreaterThan(2000);
  });
});
