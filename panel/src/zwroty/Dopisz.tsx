import React, { useState } from "react";
import { PackagePlus } from "lucide-react";
import type { DoDopisania } from "../api/typy";
import { zlote } from "../api/zwroty";
import { Blad } from "../ui";

/* ── Produkt, którego klient nie zgłosił (0.184.0) ───────────────────────────
   Klient zgłasza jedną rzecz, a odsyła dwie. Formularz zwrotu wypełnia się na
   ekranie, a paczkę pakuje przy stole — i wtedy dokłada się to, co też nie
   pasowało. Regulamin Allegro tej zgodności nie wymaga: liczy się terminowe
   oświadczenie o odstąpieniu, nie zgodność przesyłki ze zgłoszeniem. Pieniądze
   i tak trzeba oddać, więc biuro musi mieć czym zapisać to, co przyszło.

   ── Dekalog ergonomii, punkty obowiązujące panel biura ─────────────────────

   PUNKT 5 (ograniczaj liczbę decyzji). Lista jest RÓŻNICĄ zamówienia i zwrotu,
   nie całym zamówieniem. Pozycje już zgłoszone kazałyby porównywać dwie listy
   oczami — czyli robić dokładnie tę pracę, którą ekran ma zdjąć. Gdy różnicy
   nie ma, nie ma też przycisku: rozwijanie pustej listy to decyzja bez treści.

   PUNKT 6 (zapobiegaj błędom, zanim zaczniesz je tłumaczyć). Nie ma tu pola
   tekstowego. Klient może odesłać wyłącznie to, co kupił, więc zamówienie jest
   granicą naturalną — a ograniczenie jest tańsze od komunikatu. Cena i waluta
   idą z pozycji zamówienia, więc kwota do oddania dalej liczy się z faktów.

   PUNKT 2 (pokazuj tylko to, co potrzebne teraz). Dopisanie jest WYJĄTKIEM,
   nie codziennością: lista otwiera się na żądanie, tak samo jak potrącenie.
   Stała lista pod każdym zwrotem byłaby ścianą pytań o rzecz, która zdarza się
   raz na kilkanaście paczek.

   PUNKT 1 (najpierw przebieg pracy, potem ekran). Przycisk stoi POD listą
   produktów, bo tam operator zauważa różnicę: przelicza karton, patrzy na
   ekran i widzi o jedną pozycję mniej.                                       */

export function Dopisz({ kandydaci, trwa, blad, onDopisz }: {
  kandydaci: DoDopisania[];
  trwa: boolean;
  blad: string;
  onDopisz: (zamPozycjaId: number) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);

  /* Bez kandydatów nie ma czego dopisać — i to jest jedyny poprawny stan
     „cisza". Zwrot bez pobranego zamówienia też tu trafia: wtedy lista nie ma
     skąd powstać, a przycisk obiecywałby drogę, której nie ma. */
  if (kandydaci.length === 0) return null;

  if (!otwarte) {
    return <button type="button" onClick={() => setOtwarte(true)}
      className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500
        underline underline-offset-2 hover:text-slate-800">
      <PackagePlus size={13} />klient przysłał więcej, niż zgłosił</button>;
  }

  return <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-2">
    <p className="text-xs text-slate-600">
      Z tego zamówienia {kandydaci.length === 1 ? "została" : "zostały"} jeszcze{" "}
      {kandydaci.length === 1 ? "pozycja" : `${kandydaci.length} pozycje`}. Dopisz to,
      co naprawdę przyszło w kartonie.
    </p>
    <ul className="mt-2 space-y-1">
      {kandydaci.map((k) => <li key={k.zamPozycjaId}>
        <button type="button" disabled={trwa}
          onClick={() => onDopisz(k.zamPozycjaId)}
          className="flex w-full items-baseline justify-between gap-2 rounded border
            border-slate-200 bg-white px-2 py-1 text-left text-sm hover:bg-sky-50
            disabled:opacity-50">
          <span>
            <span className="font-semibold">{k.nazwa}</span>
            {k.ilosc !== 1 && <span className="ml-1 text-xs text-slate-500">{k.ilosc} szt.</span>}
          </span>
          <span className="shrink-0 tabular-nums text-slate-600">
            {zlote(k.cenaGrosze, k.waluta)}</span>
        </button>
      </li>)}
    </ul>
    {/* Zdanie o pochodzeniu, nie ozdoba: dopisana pozycja jest zapisem
        człowieka i ekran ma to mówić, zanim ktoś ją doda (§4.3). */}
    <p className="mt-2 text-xs text-slate-500">
      Dopisana pozycja zostaje oznaczona jako zapis biura i wchodzi do kwoty
      do oddania. Cena idzie z zamówienia.
    </p>
    {blad && <div className="mt-2"><Blad>{blad}</Blad></div>}
    <button type="button" onClick={() => setOtwarte(false)}
      className="mt-2 text-xs text-slate-500 underline underline-offset-2">Zwiń</button>
  </div>;
}
