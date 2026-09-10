import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { Pusto } from "./index";

/* Źródła przez `?raw`, jak w pozostałych strażnikach — `tsconfig.json` zapisuje,
   że panel jest aplikacją przeglądarki, więc żadnego `node:fs`. `ui/index.tsx`
   wykluczone: tam ten kształt MA stać. */
const ZRODLA = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx", "!../ui/index.tsx"],
  { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── PUSTY STAN MA JEDNO ŹRÓDŁO KSZTAŁTU (0.267.0) ─────────────────────────────
   Ustalenie 10 z audytu. `Pusto` obsługiwał dziesięć miejsc, a obok stało
   dziewiętnaście akapitów sklejonych ręcznie w dwóch wariantach: `p-4 text-sm
   text-slate-500` i `p-6 text-center text-sm text-slate-500`. Trzy zapisy
   jednej roli — ten sam wzór, co przy nagłówku sekcji w 0.256.0 i przy filtrze
   segmentowym w 0.262.0.

   CO PILNUJE — dwie rzeczy:

     1. Ręczny pusty stan listy nie odradza się poza `ui/index.tsx`.
     2. Ikona idzie REFERENCJĄ komponentu, nie gotowym elementem. Element
        pozwalał podać własny `size` i tak rozmiar rozjechał się na 32, 38
        i 40 px, a `text-slate-300` trafiło na trzy ikony z dziesięciu.

   CZEGO NIE PILNUJE. Nie wie, czy pusty stan w ogóle powstał: da się dołożyć
   listę, która przy zerze wierszy nie mówi nic, i bramka tego nie zobaczy.
   Nie rozpoznaje też ROLI — drobne podpisy w kartach („brak identyfikatorów
   w opisie") to etykiety WARTOŚCI, nie puste stany, i mają zostać tam, gdzie
   są. Pierwsze podejście do tego wydania wciągnęło je tutaj wzorcem po
   klasach i dało czterdzieści sześć zamian zamiast dziewiętnastu.

   ZWOLNIENIA SĄ JAWNE. Komentarz `pustka: <powód>` w linii albo do sześciu
   linii nad nią, powód co najmniej trzy wyrazy — ten sam mechanizm i próg co
   `kontrast:`, `skala:`, `segment:`, `bursztyn:` i `ergonomia:`.           */

/** Powód zwolnienia — co najmniej trzy wyrazy po dwukropku. */
const ZWOLNIENIE = /pustka:\s*\S+(?:\s+\S+){2,}/;

/** Kod bez komentarzy, z zachowanymi numerami linii — patrz `Kontrast.test.ts`. */
function bezKomentarzy(tekst: string): string {
  return tekst
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

function znajdz(wzorzec: RegExp): string[] {
  const winne: string[] = [];
  for (const [plik, zrodlo] of Object.entries(ZRODLA)) {
    const linie = bezKomentarzy(zrodlo).split("\n");
    const surowe = zrodlo.split("\n");
    linie.forEach((l, i) => {
      if (!wzorzec.test(l)) return;
      /* Zwolnienie stoi w komentarzu, więc szukamy go w tekście ORYGINALNYM. */
      if (surowe.slice(Math.max(0, i - 6), i + 1).some((x) => ZWOLNIENIE.test(x))) return;
      winne.push(`${plik}:${i + 1} → ${l.trim().slice(0, 72)}`);
    });
  }
  return winne;
}

describe("Pusty stan listy ma jeden kształt", () => {
  it("nikt nie skleja go ręcznie poza `ui/index.tsx`", () => {
    /* Oba warianty, które stały w panelu do 0.265.0. Wzorzec celuje w akapit
       z paddingiem i szarością — czyli w pasmo zajmujące miejsce listy,
       a nie w dowolny drobny podpis. */
    expect(znajdz(/<p className="p-[46] [^"]*text-sm text-slate-500">/)).toEqual([]);
  });

  it("ikona idzie referencją komponentu, nie gotowym elementem", () => {
    /* `ikona={<Inbox size={40} />}` pozwalał podać własny rozmiar i barwę.
       `ikona={Inbox}` tego nie pozwala — i to jest cała różnica.

       Reguła celuje WYŁĄCZNIE w `Pusto`. `NaglowekSekcji` i `Sekcja` też mają
       prop `ikona` i też biorą gotowy element — słusznie, bo ich ikona stoi
       w rzędzie z tekstem i ma 13 albo 14 px, czyli rozmiar dobierany do
       sąsiada. Pierwsza wersja tej reguły nie robiła tego rozróżnienia
       i zgłaszała osiem miejsc, w których wszystko jest w porządku. */
    const winne: string[] = [];
    for (const [plik, zrodlo] of Object.entries(ZRODLA)) {
      const linie = bezKomentarzy(zrodlo).split("\n");
      linie.forEach((l, i) => {
        if (!/ikona=\{</.test(l)) return;
        if (!/<Pusto/.test(linie.slice(Math.max(0, i - 1), i + 1).join(" "))) return;
        winne.push(`${plik}:${i + 1} → ${l.trim().slice(0, 72)}`);
      });
    }
    expect(winne).toEqual([]);
  });
});

describe("Pusto: dwie wagi, dwa kształty", () => {
  it('waga „ekran” wypełnia kolumnę i stoi na drabinie', () => {
    /* Do 0.265.0 komponent NIE MIAŁ klasy rozmiaru i dziedziczył 16 px z `body`
       — jedyny taki w panelu po 0.258.0, czyli po wydaniu, które drabinę
       zakładało. `text-tresc`, bo to jest zdanie, które się czyta. */
    const { container } = render(<Pusto ikona={Inbox}>Wybierz rozmowę z listy</Pusto>);
    const k = container.firstElementChild!.className;
    expect(k).toContain("text-tresc");
    expect(k).toContain("flex-1");
    expect(k).toContain("place-items-center");
  });

  it('waga „lista” NIE wypełnia kolumny', () => {
    /* Pusta lista siedzi pod nagłówkiem, filtrami i polem szukania, które
       dalej stoją. `flex-1` zrobiłby z niej drugi ekran powitalny. */
    const { container } = render(
      <Pusto waga="lista">Ten kubełek jest pusty — zajrzyj do „Wszystkie".</Pusto>);
    const k = container.firstElementChild!.className;
    expect(k).toContain("text-sm");
    expect(k).not.toContain("flex-1");
    expect(k).not.toContain("p-16");
  });

  it("ikona dostaje jeden rozmiar i jedną barwę, cokolwiek poda wywołujący", () => {
    const { container } = render(<Pusto ikona={Inbox}>Nic tu nie ma</Pusto>);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("38");
    expect(svg.getAttribute("class")).toContain("text-slate-300");
  });

  it("bez ikony nie zostaje po niej odstęp", () => {
    /* `mt-3` odsuwa zdanie OD IKONY. Bez ikony byłby odstępem od niczego. */
    const { container } = render(<Pusto waga="lista">Wczytuję…</Pusto>);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("p")!.className).not.toContain("mt-3");
  });

  it("treść zostaje treścią, także z przyciskiem w środku", () => {
    /* Pusty wynik szukania cytuje frazę i daje „Wyczyść szukanie" — pusty stan
       bywa MIEJSCEM DZIAŁANIA, nie tylko zdaniem. */
    render(<Pusto waga="lista">
      Nic nie pasuje do „szarpak".{" "}<button type="button">Wyczyść szukanie</button>
    </Pusto>);
    expect(screen.getByRole("button", { name: "Wyczyść szukanie" })).toBeInTheDocument();
    expect(screen.getByText(/Nic nie pasuje do/)).toBeInTheDocument();
  });
});
