import React, { useState } from "react";
import type { Wyjatek as WyjatekHali } from "../api/dostawy";
import { ilosc } from "../api/dostawy";
import { Pole, Przycisk, czas } from "../ui";

/* ── Wyjątek zgłoszony przez halę (0.435.0) ────────────────────────────────
   „OTWARTY" pisany WPROST — w biurze brak plakietki „rozwiązany" trzeba było
   kiedyś zinterpretować jako otwarty, a brak czegoś nie jest komunikatem.

   ROZWIĄZANIE W MIEJSCU, NIE W OKNIE. Biuro pytało oknem dialogowym, bo
   `biuro.html` nie miało innego sposobu. Tu pole otwiera się pod wyjątkiem,
   którego dotyczy — oko nie skacze na środek ekranu i z powrotem, a przy
   kilku wyjątkach jednej faktury widać, który się właśnie zamyka
   (dekalog pkt 5: mniej ruchu). Notatka jest opcjonalna i trafia do
   protokołu dla dostawcy. */

export function Wyjatek({ p, trwa, blad, onRozwiaz }: {
  p: WyjatekHali;
  trwa: boolean;
  blad: string;
  onRozwiaz: (id: number, note: string) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [nota, setNota] = useState("");
  return <div className="border-t border-slate-100 py-1.5 text-sm first:border-t-0">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">{p.typLabel || p.typ}</span>
      {p.symObcy && <b>{p.symObcy}</b>}
      {p.qty != null && <span>policzone: {ilosc(p.qty)}{p.qtyDok != null ? ` z ${ilosc(p.qtyDok)}` : ""} {p.unit}</span>}
      {p.zamiastIlosc != null && <span>· zamiast {ilosc(p.zamiastIlosc)}</span>}
      {p.opis && <span>{p.opis}</span>}
      <span className="text-xs text-slate-600">{p.createdBy ?? ""} · {czas(p.createdAt)}</span>
      <span className="ml-auto" />
      {p.resolvedAt
        ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-ranga-ok">rozwiązany</span>
        : !otwarte && <>
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">otwarty</span>
            <Przycisk className="!px-2.5 !py-1 !text-xs" onClick={() => setOtwarte(true)}>Rozwiąż</Przycisk>
          </>}
    </div>
    {p.resolvedAt && p.resolvedNote &&
      <p className="mt-0.5 text-xs text-slate-600">{p.resolvedBy ? `${p.resolvedBy}: ` : ""}{p.resolvedNote}</p>}
    {otwarte && !p.resolvedAt &&
      <form className="mt-1.5 flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); onRozwiaz(p.id, nota.trim()); }}>
        <Pole className="min-w-0 flex-1" autoFocus value={nota} onChange={(e) => setNota(e.target.value)}
          placeholder="Jak to załatwiono? Opcjonalnie — trafi do protokołu"
          aria-label="Jak załatwiono wyjątek" />
        <Przycisk wariant="glowny" type="submit" disabled={trwa}>Zamknij wyjątek</Przycisk>
        <Przycisk type="button" onClick={() => { setOtwarte(false); setNota(""); }}>Anuluj</Przycisk>
        {blad && <span className="w-full text-xs text-ranga-zle">{blad}</span>}
      </form>}
  </div>;
}
