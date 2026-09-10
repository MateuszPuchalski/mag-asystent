import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FiltrSegmentowy, Zakladki } from "./index";

/* Źródła przez `?raw`, jak w trzech pozostałych strażnikach — `tsconfig.json`
   zapisuje, że panel jest aplikacją przeglądarki, więc żadnego `node:fs`.
   `ui/index.tsx` wykluczone: tam ten łańcuch MA stać. */
const ZRODLA = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx", "!../ui/index.tsx"],
  { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── JEDEN KSZTAŁT WYBORU (0.262.0) ────────────────────────────────────────────
   Rząd pigułek, z których jedna jest wybrana, stał w panelu SZEŚĆ RAZY
   w TRZECH kształtach: atrament na szarej bieżni, atrament bez tła na własnej
   białej bieżni i bursztyn bez tła. Trzy z sześciu miejsc to był ten sam kod
   przepisany znak w znak. Cztery z sześciu nie miały `aria-pressed`.

   CO PILNUJE — dwie rzeczy, obie wąskie:

     1. Para `bg-wertis-ink` + `bg-slate-100` w jednej linii poza
        `ui/index.tsx`. To jest DOKŁADNIE łańcuch wybranej i niewybranej
        pigułki; nigdzie indziej te dwie klasy nie stoją obok siebie.
     2. Bursztyn jako stan wybrany, rozpoznany po sąsiedztwie z `text-slate-600`
        — czyli po kształcie, który miały kubełki zwrotów, reklamacji
        i dyskusji.

   CZEGO NIE PILNUJE. Nie wie, czy nowy filtr w ogóle powstał: da się dołożyć
   rząd przycisków w zupełnie nowych barwach i bramka tego nie zobaczy. Nie
   rozpoznaje też ról — pasek nawigacji w `main.tsx` ma bursztynową zakładkę
   aktywną i ma prawo ją mieć, bo to nawigacja MIĘDZY ekranami, a nie sito
   wewnątrz jednego. Zielony wynik znaczy „te dwa kształty nie wróciły",
   a nie „panel ma jeden filtr".

   ZWOLNIENIA SĄ JAWNE. Komentarz `segment: <powód>` w linii albo do sześciu
   linii nad nią, powód co najmniej trzy wyrazy — ten sam mechanizm i próg co
   `kontrast:`, `skala:` i `ergonomia:`.                                      */

/** Powód zwolnienia — co najmniej trzy wyrazy po dwukropku. */
const ZWOLNIENIE = /segment:\s*\S+(?:\s+\S+){2,}/;

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

describe("Filtr segmentowy ma jeden kształt w całym panelu", () => {
  it("nikt nie skleja pigułki atramentowej ręcznie poza `ui/index.tsx`", () => {
    /* BEZ ograniczenia „bez cudzysłowu w środku", które ma `NaglowekSekcji`.
       Tam obie klasy stoją w JEDNYM łańcuchu, tu w dwóch gałęziach warunku:
       `? "bg-wertis-ink …" : "bg-slate-100 …"`. Cudzysłów stoi dokładnie
       między nimi, więc tamten wzorzec przepuszczał wszystko — sprawdzone,
       wstawiając łańcuch z powrotem. */
    expect(znajdz(/bg-wertis-ink.*bg-slate-100|bg-slate-100.*bg-wertis-ink/)).toEqual([]);
  });

  it("bursztyn nie wraca jako stan WYBRANY", () => {
    /* Bursztyn niesie już markę, akcję główną, kropkę nieprzeczytanego i pasmo
       ostrzeżenia. Piąte znaczenie — „zaznaczone" — zdjęło mu to wydanie i ma
       nie wrócić. Kształt rozpoznajemy po sąsiedztwie z `text-slate-600`, bo
       tak wyglądała niewybrana pigułka kubełków. */
    expect(znajdz(/bg-wertis-amber.*text-slate-600|text-slate-600.*bg-wertis-amber/))
      .toEqual([]);
  });
});

const POZYCJE = [
  { klucz: "a", etykieta: "Do decyzji", ile: 3, podpowiedz: "Przyjąć czy odrzucić? (klawisz 1)" },
  { klucz: "b", etykieta: "Do oceny", ile: 12 },
];

describe("Filtr segmentowy: zachowanie pigułki", () => {
  it("wybrana pigułka mówi o tym czytnikowi ekranu", () => {
    /* Cztery miejsca na sześć nie miały żadnej informacji o stanie. Barwa
       nie jest informacją dla kogoś, kto ekranu nie widzi. */
    render(<FiltrSegmentowy wybrany="a" onWybierz={() => {}} pozycje={POZYCJE} />);
    expect(screen.getByRole("button", { name: /Do decyzji/ }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Do oceny/ }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("licznik jest ODDZIELONY SPACJĄ, nie marginesem", () => {
    /* `ml-1` rysuje odstęp, ale nie wchodzi do nazwy dostępnej — czytnik
       przeczytałby „Do decyzji3". Kubełki zwrotów robiły tak od 0.209.0. */
    render(<FiltrSegmentowy wybrany="a" onWybierz={() => {}} pozycje={POZYCJE} />);
    expect(screen.getByRole("button", { name: "Do decyzji 3" })).toBeInTheDocument();
  });

  it("licznik ma `tabular-nums` — dwie cyfry to zawsze ta sama szerokość", () => {
    /* Barlow ma cyfry proporcjonalne: bez tej klasy „11" mierzy 8,44 px,
       a „44" — 13,23 px przy 12 px pisma. Rząd kubełków przesuwałby się
       o prawie pięć pikseli przy samej zmianie liczby, nie jej długości.
       Pomiar robi się w przeglądarce Z WCZYTANYM fontem: serwer deweloperski
       nie serwuje `/biuro/fonty/`, więc bez podstawienia pliku wynik kłamie. */
    const { container } = render(
      <FiltrSegmentowy wybrany="a" onWybierz={() => {}} pozycje={POZYCJE} />);
    expect(container.querySelector("span")?.className).toContain("tabular-nums");
  });

  it("brak `ile` znaczy brak licznika, a zero znaczy zero", () => {
    /* `0` musi się wyświetlić: pusty kubełek to informacja, nie brak danych. */
    render(<FiltrSegmentowy wybrany="x" onWybierz={() => {}} pozycje={[
      { klucz: "x", etykieta: "Bez licznika" },
      { klucz: "y", etykieta: "Pusty", ile: 0 },
    ]} />);
    expect(screen.getByRole("button", { name: "Bez licznika" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pusty 0" })).toBeInTheDocument();
  });

  it("`podpowiedz` ląduje w `title`, a jej brak nie zostawia pustego", () => {
    render(<FiltrSegmentowy wybrany="a" onWybierz={() => {}} pozycje={POZYCJE} />);
    expect(screen.getByRole("button", { name: /Do decyzji/ }))
      .toHaveAttribute("title", "Przyjąć czy odrzucić? (klawisz 1)");
    expect(screen.getByRole("button", { name: /Do oceny/ })).not.toHaveAttribute("title");
  });

  it("kliknięcie oddaje KLUCZ, nie etykietę", () => {
    const wybierz = vi.fn();
    render(<FiltrSegmentowy wybrany="a" onWybierz={wybierz} pozycje={POZYCJE} />);
    fireEvent.click(screen.getByRole("button", { name: /Do oceny/ }));
    expect(wybierz).toHaveBeenCalledWith("b");
  });

  it("cel dotyku ma 24 px, bo `py-1` mieszka w komponencie", () => {
    /* To jest cała stawka przeniesienia progu do jednego miejsca. `py-1` przy
       interlinii 16 px daje 24 px, czyli próg 2.5.8 z WCAG 2.2 AA. Bramka
       `Kontrast.test.ts` tu nie sięga: filtruje pliki po nazwie kolejki.
       Wysokość w pikselach mierzy się w przeglądarce, nie w jsdomie. */
    const { container } = render(
      <FiltrSegmentowy wybrany="a" onWybierz={() => {}} pozycje={POZYCJE} />);
    const k = container.querySelector("button")!.className;
    expect(k).toContain("py-1");
    expect(k).not.toContain("py-0.5");
  });
});

describe("Filtr segmentowy: wyjątek barwy", () => {
  it("`ton` podmienia SAME barwy, kształt i próg zostają", () => {
    /* Fiolet kategorii Copilota jest wyjątkiem znaczenia — to przypuszczenie
       maszyny, a nie fakt. Nie jest wyjątkiem kształtu ani wysokości. */
    const { container } = render(<FiltrSegmentowy wybrany="a" onWybierz={() => {}}
      ton={["bg-violet-700 text-white", "bg-violet-50 text-violet-800"]} pozycje={POZYCJE} />);
    const k = container.querySelector("button")!.className;
    expect(k).toContain("bg-violet-700");
    expect(k).not.toContain("bg-wertis-ink");
    expect(k).toContain("px-2");
    expect(k).toContain("py-1");
    expect(k).toContain("text-xs");
  });
});

describe("Zakładki biorą pigułkę z filtra", () => {
  it("różnią się JEDNYM: równą szerokością", () => {
    const { container } = render(<Zakladki wybrana="of" onWybierz={() => {}} pozycje={[
      { klucz: "of", etykieta: "Oferta" }, { klucz: "tw", etykieta: "Towar" },
    ]} />);
    const k = container.querySelector("button")!.className;
    expect(k).toContain("flex-1");
    expect(k).toContain("bg-wertis-ink");
  });

  it("dalej mówią czytnikowi ekranu, która jest wybrana", () => {
    render(<Zakladki wybrana="of" onWybierz={() => {}} pozycje={[
      { klucz: "of", etykieta: "Oferta" }, { klucz: "tw", etykieta: "Towar" },
    ]} />);
    expect(screen.getByRole("button", { name: "Oferta" }))
      .toHaveAttribute("aria-pressed", "true");
  });
});
