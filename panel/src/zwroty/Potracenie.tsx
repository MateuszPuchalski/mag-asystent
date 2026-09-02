import React, { useState } from "react";
import { BadgeMinus } from "lucide-react";
import type { PozycjaZwrotu } from "../api/typy";
import { zlote } from "../api/zwroty";
import { Przycisk, Pole } from "../ui";

/* ── Potrącenie za utratę wartości (0.170.0) ─────────────────────────────────
   Do tego wydania kwota była BINARNA per pozycja: cała cena albo nic. Towar
   wracający używany nie miał jak zjechać w dół, a to codzienność biura zwrotów.

   Kwota, nie procent — decyzja właściciela. Klient widzi złotówki, a procent
   przy każdej pozycji zostawiałby końcówki, których nikt nie umie wytłumaczyć.

   Powód jest OBOWIĄZKOWY i pole go pilnuje: to jego treść tłumaczy klientowi,
   czemu dostał mniej. Bez niego potrącenie byłoby liczbą bez uzasadnienia.

   Formularz otwiera się DOPIERO NA ŻĄDANIE — ta sama zasada co przy ręcznym
   wskazaniu kartoteki. Typowy zwrot wraca w porządku i pole pod każdą pozycją
   byłoby ścianą pytań o wyjątek.                                            */

/** „30,00" albo „30" → grosze. `null`, gdy to nie jest kwota. */
export function naGrosze(tekst: string): number | null {
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(tekst.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

export function Potracenie({ p, trwa, blad, onZapisz }: {
  p: PozycjaZwrotu;
  trwa: boolean;
  blad: string;
  onZapisz: (grosze: number | null, powod: string) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [kwota, setKwota] = useState("");
  const [powod, setPowod] = useState("");

  const wartosc = Math.round(p.cenaGrosze * p.ilosc);
  const grosze = naGrosze(kwota);
  const zaDuze = grosze !== null && grosze > wartosc;
  const gotowe = grosze !== null && !zaDuze && powod.trim() !== "";

  /* Zapisane potrącenie jest FAKTEM o pozycji, więc widać je w każdym kubełku
     — tak samo jak ocenę hali. Obok stoi kwota, która naprawdę wyjdzie. */
  if (p.potracenieGrosze != null) {
    return <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">
      <span className="font-bold">Potrącenie −{zlote(p.potracenieGrosze, p.waluta)}</span>
      <span className="ml-2">
        do oddania {zlote(wartosc - p.potracenieGrosze, p.waluta)}</span>
      <p className="mt-0.5 italic">„{p.potraceniePowod}"</p>
      <button type="button" disabled={trwa} onClick={() => onZapisz(null, "")}
        className="mt-1 text-amber-800 underline underline-offset-2 hover:text-amber-950">
        cofnij potrącenie</button>
      {blad && <p className="mt-1 text-red-700">{blad}</p>}
    </div>;
  }

  if (!otwarte) {
    return <button type="button" onClick={() => setOtwarte(true)}
      className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500
        underline underline-offset-2 hover:text-slate-800">
      <BadgeMinus size={12} />oddaj mniej za ten towar</button>;
  }

  return <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1">
        Potrąć
        <Pole className="h-7 w-24 text-xs" value={kwota} inputMode="decimal"
          aria-label={`Potrącenie: ${p.nazwa}`} placeholder="np. 30,00"
          onChange={(e) => setKwota(e.target.value)} />
      </label>
      <span className="text-slate-500">z {zlote(wartosc, p.waluta)}</span>
    </div>
    {/* Powód pilnuje POLE, nie dopiero serwer: odmowa po kliknięciu uczy, że
        przycisk bywa zepsuty, a tu po prostu brakuje zdania dla klienta. */}
    <Pole className="mt-1 h-7 text-xs" value={powod}
      aria-label={`Powód potrącenia: ${p.nazwa}`}
      placeholder="Powód — zobaczy go klient" onChange={(e) => setPowod(e.target.value)} />
    {zaDuze && <p className="mt-1 text-red-700">
      Więcej niż wart jest ten towar — wtedy to klient dopłacałby nam za zwrot.</p>}
    {blad && <p className="mt-1 text-red-700">{blad}</p>}
    <div className="mt-2 flex gap-2">
      <Przycisk wariant="glowny" className="text-xs" disabled={trwa || !gotowe}
        onClick={() => onZapisz(grosze, powod.trim())}>Zapisz potrącenie</Przycisk>
      <Przycisk className="text-xs"
        onClick={() => { setOtwarte(false); setKwota(""); setPowod(""); }}>Wróć</Przycisk>
    </div>
  </div>;
}
