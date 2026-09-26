import React, { useState } from "react";
import { Klawisz } from "../nawigacja/Klawisz";

/* ── Skróty klawiszowe NA EKRANIE (0.281.0) ──────────────────────────────────
   Kolejka reklamacji i dyskusji chodzi z klawiatury od 0.245.0: strzałki albo
   `j`/`k` po wierszach, cyfry po kubełkach, a od 0.278.0 także `m` i `n` po
   sitach. Do tego wydania NIE BYŁO TEGO NIGDZIE WIDAĆ. Klawisz stał wyłącznie
   w podpowiedzi pod kursorem, czyli tam, gdzie trafia się przypadkiem.

   Dekalog p. 2 mówi to wprost: „Rozpoznanie jest tańsze od pamiętania. Nie
   każ pamiętać tego, co może zostać na ekranie". Skrót, o którym nikt nie wie,
   nie skraca niczyjej pracy — jest kodem, nie funkcją.

   CENA BYŁA JAWNA: jeden wiersz wysokości kolumny, około 22 px, zabrany
   liście spraw. 0.281.0 wzięło ją świadomie i odrzuciło pomoc pod znakiem
   zapytania zdaniem: „kosztowałaby dwa kliknięcia przy każdym przypomnieniu,
   a schowane przypomnienie to znowu pamiętanie".

   TA CENA PODWOIŁA SIĘ PO CICHU (audyt, 15 września 2026). Pomiar na żywym
   ekranie zwrotów: pasek zawijał się na dwa rzędy i kosztował 49 px, nie 22 —
   odkąd doszły klawisze kubełka (0.284.0) i `Z` od pieniędzy. Wtedy skróciły
   się opisy.

   ── ZNAK ZAPYTANIA JEDNAK WYGRYWA (0.402.0) ─────────────────────────────────
   Zgłoszenie właściciela ze zrzutem: „panel wygląda chaotycznie". Policzone na
   ekranie reklamacji: SIEDEM pasm sterowania nad pierwszą sprawą, 268 px
   w kolumnie szerokiej na 280. Ten pasek jest jednym z nich, a trzy sąsiednie
   odpowiadają na to samo pytanie „co pokazać". Rachunek z 0.281.0 był robiony
   przy dwóch pasmach i przy nich był słuszny; przy siedmiu przestał.

   ZARZUT Z 0.281.0 ZOSTAJE ODPOWIEDZIANY, nie zignorowany: pomoc otwiera się
   NA NAJECHANIE, nie na kliknięcie. Dwa kliknięcia, których tamta decyzja nie
   chciała płacić, kosztują teraz zero — a panel obsługi chodzi na monitorach
   biura z myszą pod ręką (§10.5, decyzja o zdjęciu widoku mobilnego). Klawisz
   dalej stoi też w podpowiedzi każdej pigułki, więc rozpoznanie ma dwie drogi.

   Nazwa komponentu zostaje, bo to dalej ten sam byt: „gdzie agent widzi, czym
   chodzi się po tej kolejce".                                              */

export function SkrotyKlawiszy({ zMoje, kubelkow, sita = true, zWszystkimi = true,
  dodatkowe = [] }: {
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
  /**
   * Czy „Wszystkie" jest DOKLEJONE za kubełkami (0.383.0).
   *
   * Zwroty, reklamacje i dyskusje trzymają je poza tablicą kubełków, więc
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
     to, co najechanie przed chwilą otworzyło; pierwsza wersja tej poprawki
     miała dokładnie tę usterkę i złapały ją testy czterech ekranów.

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
      {/* Od 23 września 2026 wszystkie skróty panelu stoją w jednej liście
          pod klawiszem `?` (`nawigacja/Klawisze.tsx`); tu zostają klawisze
          tej kolejki, pod ręką przy najechaniu. */}
      <p className="mt-2 border-t border-slate-100 pt-1 text-podpis text-slate-500">
        Wszystkie skróty: <Klawisz>?</Klawisz></p>
    </div>}
  </div>;
}
