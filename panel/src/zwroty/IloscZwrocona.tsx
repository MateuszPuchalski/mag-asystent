import React, { useState } from "react";
import { Sigma } from "lucide-react";
import type { PozycjaZwrotu } from "../api/typy";
import { Przycisk, Pole } from "../ui";

/* ── Ile sztuk naprawdę wróciło (0.212.0) ────────────────────────────────────
   Klient zgłasza w Allegro dwie sztuki, w kartonie przyjeżdża jedna. Do
   0.211.0 nie było tego gdzie zapisać: pozycji z Allegro nie da się poprawić,
   a kwota liczyła się z DEKLARACJI. Zostawało odznaczyć całą pozycję albo
   zapłacić za dwie — „wróciła jedna z dwóch" nie mieściło się w bazie.

   LICZY BIURO — decyzja właściciela: to ono otwiera i procesuje zwroty.

   Pole otwiera się DOPIERO NA ŻĄDANIE, tak samo jak potrącenie. Typowy zwrot
   wraca w komplecie; pole pod każdą pozycją byłoby ścianą pytań o wyjątek.
   Pokazuje się tylko przy pozycjach z więcej niż jedną sztuką — przy jednej
   „wróciło zero" znaczy to samo co odznaczenie, a dwie drogi do tej samej
   rzeczy kosztują namysł przy każdym wierszu.                                */

export function IloscZwrocona({ p, trwa, blad, onZapisz }: {
  p: PozycjaZwrotu;
  trwa: boolean;
  blad: string;
  onZapisz: (ilosc: number | null) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [ile, setIle] = useState("");

  const liczba = /^\d+$/.test(ile.trim()) ? Number(ile.trim()) : null;
  const zaDuzo = liczba !== null && liczba > p.ilosc;
  const gotowe = liczba !== null && !zaDuzo;

  /* Zapisana liczba jest FAKTEM o pozycji, więc widać ją w każdym kubełku —
     tak samo jak ocenę i potrącenie. Po zamknięciu zwrotu to ona tłumaczy,
     czemu wypłata była niższa, niż wynikałoby ze zgłoszenia. */
  if (p.iloscZwrocona != null && p.iloscZwrocona !== p.ilosc) {
    return <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">
      <span className="font-bold">
        Wróciło {p.iloscZwrocona} z {p.ilosc} szt.</span>
      <span className="ml-2">kwota liczy się z tego, co wróciło</span>
      <button type="button" disabled={trwa} onClick={() => onZapisz(null)}
        className="ml-2 text-amber-800 underline underline-offset-2 hover:text-amber-950">
        cofnij</button>
      {blad && <p className="mt-1 text-red-700">{blad}</p>}
    </div>;
  }

  /* Zgodne ze zgłoszeniem mówi o sobie JEDNYM zdaniem, nie ramką: to stan
     typowy i nie ma o czym rozmawiać. */
  if (p.iloscZwrocona != null) {
    return <p className="mt-2 text-xs text-slate-500">
      Policzone — wróciło {p.iloscZwrocona} z {p.ilosc} szt.
      <button type="button" disabled={trwa} onClick={() => onZapisz(null)}
        className="ml-2 underline underline-offset-2">cofnij</button>
    </p>;
  }

  if (p.ilosc <= 1) return null;

  if (!otwarte) {
    return <button type="button" disabled={trwa} onClick={() => setOtwarte(true)}
      className="mt-2 flex items-center gap-1 text-xs text-slate-500 underline
        underline-offset-2 hover:text-slate-800">
      <Sigma size={12} /> wróciło mniej, niż zgłosił</button>;
  }

  return <div className="mt-2 space-y-1 rounded-lg border border-slate-300 bg-white p-2">
    <label className="block text-xs font-bold text-slate-600" htmlFor={`ilosc-${p.id}`}>
      Ile sztuk wróciło w kartonie — zgłoszono {p.ilosc}
    </label>
    <div className="flex flex-wrap items-center gap-2">
      <Pole id={`ilosc-${p.id}`} className="w-20" value={ile} autoFocus inputMode="numeric"
        placeholder={String(p.ilosc)} onChange={(e) => setIle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && gotowe) onZapisz(liczba); }} />
      <Przycisk wariant="glowny" className="text-xs" disabled={trwa || !gotowe}
        onClick={() => onZapisz(liczba)}>Zapisz</Przycisk>
      <Przycisk className="text-xs"
        onClick={() => { setOtwarte(false); setIle(""); }}>Wróć</Przycisk>
    </div>
    {/* Więcej niż zgłoszono odpada po stronie serwera; ekran mówi to WCZEŚNIEJ,
        żeby nie kosztowało kliknięcia i odmowy. */}
    {zaDuzo && <p className="text-xs text-red-700">
      Klient zgłosił {p.ilosc} szt. Nadmiar z kartonu dopisz jako osobną pozycję.</p>}
    {blad && <p className="text-xs text-red-700">{blad}</p>}
  </div>;
}
