import React, { useState } from "react";
import { Klawisz } from "../nawigacja/Klawisz";

/* ── Skróty klawiszowe NA EKRANIE ────────────────────────────────────────────
   Kolejka chodzi z klawiatury: strzałki albo `j`/`k` po wierszach, cyfry
   po kubełkach, `m` i `n` po sitach. Dekalog p. 2 mówi to wprost:
   „Rozpoznanie jest tańsze od pamiętania. Nie każ pamiętać tego, co może
   zostać na ekranie". Skrót, o którym nikt nie wie, nie skraca niczyjej
   pracy — jest kodem, nie funkcją.

   POMOC POD ZNAKIEM ZAPYTANIA, bo stały pasek to kolejne pasmo nad pierwszą
   sprawą, a pasm sterowania jest już kilka. Pomoc otwiera się NA NAJECHANIE,
   nie na kliknięcie, więc przypomnienie nic nie kosztuje — a panel obsługi
   chodzi na monitorach biura z myszą pod ręką (§10.5). Klawisz stoi też
   w podpowiedzi każdej pigułki, więc rozpoznanie ma dwie drogi.             */

export function SkrotyKlawiszy({ zMoje, kubelkow, sita = true, zWszystkimi = true,
  dodatkowe = [] }: {
  /** `false` przy nieznanej tożsamości — wtedy `m` nic nie robi i nie kłamiemy. */
  zMoje: boolean;
  /** Ile jest kubełków; ostatnia cyfra to „Wszystkie". */
  kubelkow: number;
  /**
   * Czy ekran ma sita „Moje"/„Niczyje".
   *
   * Zwroty ich nie mają — nie noszą prowadzącego — a pasek obiecujący `m`
   * i `n` na ekranie, który ich nie obsługuje, pokazywałby klawisz
   * widoczny i martwy.
   */
  sita?: boolean;
  /**
   * Czy „Wszystkie" jest DOKLEJONE za kubełkami.
   *
   * Zwroty i reklamacje trzymają je poza tablicą kubełków, więc
   * ostatnią cyfrą jest `kubelkow + 1`. Skrzynka ma je jako kubełek PIERWSZY
   * (§10.1), więc cyfry kończą się na `kubelkow`. Bez tego przełącznika
   * skrzynka musiałaby podać o jeden za mało i pasek kłamałby czytelnikowi
   * kodu zamiast użytkownikowi.
   */
  zWszystkimi?: boolean;
  /** Klawisze WŁASNE ekranu: `[klawisz, co robi]`, w kolejności użycia. */
  dodatkowe?: ReadonlyArray<readonly [string, string]>;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const pozycje: Array<readonly [React.ReactNode, string]> = [
    [<><Klawisz>j</Klawisz><Klawisz>k</Klawisz></>, "ruch po liście"],
    [<><Klawisz>1</Klawisz>–<Klawisz>{zWszystkimi ? kubelkow + 1 : kubelkow}</Klawisz></>, "kubełek"],
    ...(sita && zMoje ? [[<Klawisz>m</Klawisz>, "moje sprawy"] as const] : []),
    ...(sita ? [[<Klawisz>n</Klawisz>, "niczyje sprawy"] as const] : []),
    ...dodatkowe.map(([klawisz, opis]) => [<Klawisz>{klawisz}</Klawisz>, opis] as const),
  ];

  /* NAJECHANIE I FOKUS OTWIERAJĄ, kliknięcie NIE PRZEŁĄCZA — i to nie jest
     drobiazg. Kliknięcie myszą idzie po najechaniu, więc przełącznik zamykałby
     to, co najechanie przed chwilą otworzyło.

     Trzy drogi wejścia dają ten sam skutek: mysz najeżdża, Tab ustawia fokus,
     dotyk ustawia fokus stuknięciem. Zamknięcie to zejście kursora albo utrata
     fokusu — pomoc nie ma w środku niczego do klikania. */
  return <div className="relative shrink-0"
    onMouseEnter={() => setOtwarte(true)} onMouseLeave={() => setOtwarte(false)}>
    <button type="button" aria-label="Skróty klawiszowe tej kolejki"
      aria-expanded={otwarte}
      onFocus={() => setOtwarte(true)} onBlur={() => setOtwarte(false)}
      className="rounded border border-slate-300 px-2 py-1 text-podpis font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900">
      ?</button>
    {otwarte && <div
      className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
      <p className="mb-1 text-podpis font-semibold text-slate-500">Skróty klawiszowe</p>
      <ul className="flex flex-col gap-1">
        {pozycje.map(([klawisz, opis], i) => <li key={i}
          className="flex items-center gap-2 text-podpis text-slate-700">
          <span className="flex w-16 shrink-0 items-center gap-0.5">{klawisz}</span>
          <span className="min-w-0">{opis}</span>
        </li>)}
      </ul>
      {/* Wszystkie skróty panelu stoją w jednej liście pod klawiszem `?`
          (`nawigacja/Klawisze.tsx`); tu zostają klawisze tej kolejki, pod
          ręką przy najechaniu. */}
      <p className="mt-2 border-t border-slate-100 pt-1 text-podpis text-slate-500">
        Wszystkie skróty: <Klawisz>?</Klawisz></p>
    </div>}
  </div>;
}
