import React from "react";

/* ── Skróty klawiszowe NA EKRANIE (0.281.0) ──────────────────────────────────
   Kolejka reklamacji i dyskusji chodzi z klawiatury od 0.245.0: strzałki albo
   `j`/`k` po wierszach, cyfry po kubełkach, a od 0.278.0 także `m` i `n` po
   sitach. Do tego wydania NIE BYŁO TEGO NIGDZIE WIDAĆ. Klawisz stał wyłącznie
   w podpowiedzi pod kursorem, czyli tam, gdzie trafia się przypadkiem.

   Dekalog p. 2 mówi to wprost: „Rozpoznanie jest tańsze od pamiętania. Nie
   każ pamiętać tego, co może zostać na ekranie". Skrót, o którym nikt nie wie,
   nie skraca niczyjej pracy — jest kodem, nie funkcją.

   CENA JEST JAWNA: jeden wiersz wysokości kolumny, około 22 px, zabrany
   liście spraw. Bierzemy ją świadomie i raz. Rozwijana pomoc pod znakiem
   zapytania kosztowałaby dwa kliknięcia przy każdym przypomnieniu, a schowane
   przypomnienie to znowu pamiętanie.                                        */

const Klawisz = ({ children }: { children: React.ReactNode }) =>
  <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-podpis text-slate-700">
    {children}</kbd>;

export function SkrotyKlawiszy({ zMoje, kubelkow, sita = true, dodatkowe = [] }: {
  /** `false` przy nieznanej tożsamości — wtedy `m` nic nie robi i nie kłamiemy. */
  zMoje: boolean;
  /** Ile jest kubełków; ostatnia cyfra to „Wszystkie". */
  kubelkow: number;
  /**
   * Czy ekran ma sita „Moje"/„Niczyje" (0.284.0).
   *
   * Zwroty ich nie mają — nie noszą prowadzącego — a pasek obiecujący `m`
   * i `n` na ekranie, który ich nie obsługuje, byłby dokładnie tym błędem,
   * który ten komponent naprawiał: klawiszem widocznym i martwym.
   */
  sita?: boolean;
  /** Klawisze WŁASNE ekranu: `[klawisz, co robi]`, w kolejności użycia. */
  dodatkowe?: ReadonlyArray<readonly [string, string]>;
}) {
  return <p className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 px-2 py-1 text-podpis text-slate-600">
    <span className="flex items-center gap-1">
      <Klawisz>j</Klawisz><Klawisz>k</Klawisz> ruch po liście</span>
    <span className="flex items-center gap-1">
      <Klawisz>1</Klawisz>–<Klawisz>{kubelkow + 1}</Klawisz> kubełek</span>
    {sita && zMoje && <span className="flex items-center gap-1"><Klawisz>m</Klawisz> moje</span>}
    {sita && <span className="flex items-center gap-1"><Klawisz>n</Klawisz> niczyje</span>}
    {dodatkowe.map(([klawisz, opis]) => <span key={klawisz} className="flex items-center gap-1">
      <Klawisz>{klawisz}</Klawisz> {opis}</span>)}
  </p>;
}
