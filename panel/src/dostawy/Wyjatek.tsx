import React, { useState } from "react";
import type { Wyjatek as WyjatekHali } from "../api/dostawy";
import { ilosc } from "../api/dostawy";
import { Pole, Przycisk, czas } from "../ui";

/* ── Wyjątek zgłoszony przez halę ──────────────────────────────────────────
   „OTWARTY" pisany WPROST: brak czegoś nie jest komunikatem.

   ROZWIĄZANIE W MIEJSCU, NIE W OKNIE. Pole otwiera się pod wyjątkiem,
   którego dotyczy — oko nie skacze na środek ekranu i z powrotem, a przy
   kilku wyjątkach jednej faktury widać, który się właśnie zamyka
   (dekalog pkt 5: mniej ruchu). Notatka jest opcjonalna i trafia do
   protokołu dla dostawcy. */

/**
 * Co policzyła hala — zdaniem, które znaczy jedno.
 *
 * BŁĘDNY ARTYKUŁ CZYTA SIĘ JAKO ZAMIANA. „6 z 6 szt." przy pozycji 0/6
 * wyglądałoby na komplet zamówionego towaru, a chodzi o coś odwrotnego:
 * przyszło sześć sztuk CZEGO INNEGO w miejsce zamówionych.
 */
function Policzone({ p }: { p: WyjatekHali }) {
  const j = p.unit ? ` ${p.unit}` : "";
  if (p.typ === "wrong_item") {
    const zamiast = p.zamiastIlosc ?? p.qtyDok;
    return <span>przyszło {p.qty != null ? `${ilosc(p.qty)}${j} ` : ""}<b>{p.symObcy ?? "innego towaru"}</b>
      {zamiast != null && <> zamiast {ilosc(zamiast)}{j} {p.sym ?? "zamówionego"}</>}</span>;
  }
  return <>
    {p.symObcy && <b>{p.symObcy}</b>}
    {p.qty != null && <span>policzone: {ilosc(p.qty)}{p.qtyDok != null ? ` z ${ilosc(p.qtyDok)}` : ""}{j}</span>}
    {p.zamiastIlosc != null && <span>· zamiast {ilosc(p.zamiastIlosc)}</span>}
  </>;
}

export function Wyjatek({ p, trwa, blad, onRozwiaz }: {
  p: WyjatekHali;
  trwa: boolean;
  blad: string;
  onRozwiaz: (id: number, note: string) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [nota, setNota] = useState("");
  /* Zgłoszenie bez żadnego wskazania towaru — ani pozycji, ani symbolu,
     np. zrobione na całą dostawę. Brak mówimy wprost: pusty wiersz wyglądałby,
     jakby ekran zgubił nazwę, a nie jakby jej nigdy nie było — a protokół
     dla dostawcy wyjdzie z takiego wiersza bez towaru. */
  const bezTowaru = p.lineId == null && !p.sym && !p.symObcy;
  /* STATUS I PRZYCISK W STAŁEJ KOLUMNIE Z PRAWEJ. We wspólnym zawijanym
     wierszu plakietka „rozwiązany" spadałaby pod treść przy dłuższym opisie,
     a „otwarty" z przyciskiem zostawałby z prawej — dwa stany w dwóch
     miejscach. */
  return <div className="border-t border-slate-100 py-1.5 text-sm first:border-t-0">
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">{p.typLabel || p.typ}</span>
        {bezTowaru && <span className="text-xs italic text-slate-600">bez wskazania towaru</span>}
        <Policzone p={p} />
        {p.opis && <span>{p.opis}</span>}
        <span className="text-xs text-slate-600">{p.createdBy ?? ""} · {czas(p.createdAt)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {p.resolvedAt
          ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-ranga-ok">rozwiązany</span>
          : !otwarte && <>
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">otwarty</span>
              <Przycisk className="!px-2.5 !py-1 !text-xs" onClick={() => setOtwarte(true)}>Rozwiąż</Przycisk>
            </>}
      </div>
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
