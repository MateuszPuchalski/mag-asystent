import React, { useState } from "react";
import { Link } from "react-router-dom";
import { PackageX, Undo2 } from "lucide-react";
import type { SzczegolKosza } from "../api/kosze";
import { Blad, NaglowekSekcji, Pole, Przycisk } from "../ui";

/* ── Kontekst kosza — prawa kolumna (0.438.0) ─────────────────────────────
   Dwie rzeczy, po które biuro wchodzi w kosz, i obie są DROGĄ DALEJ:

   - ZWROTY W KOSZU prowadzą do swoich kart. Druga strona tego wiązania stoi
     na karcie zwrotu („Towar w koszach"); razem dają wiązanie w obie strony,
     bo jednostronne to wiązanie, którego nie ma (`CLAUDE.md`).
   - POMINIĘTE czekają na ZAŁATWIONE. W biurze stały na osobnej karcie pod
     listą koszy; tu stoją przy swoim koszu, obok reszty jego zawartości —
     a lista wszystkich pominiętych jest kubełkiem w kolejce po lewej. */

function Zalatw({ pozycjaId, trwa, onZalatw }: {
  pozycjaId: number; trwa: boolean; onZalatw: (pozycjaId: number, notatka: string) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [notatka, setNotatka] = useState("");
  if (!otwarte) {
    return <Przycisk className="!px-2.5 !py-1 !text-xs" onClick={() => setOtwarte(true)}>Załatwione</Przycisk>;
  }
  return <form className="mt-1.5 flex flex-wrap gap-2"
    onSubmit={(e) => { e.preventDefault(); onZalatw(pozycjaId, notatka.trim()); }}>
    <Pole className="min-w-0 flex-1" autoFocus value={notatka} onChange={(e) => setNotatka(e.target.value)}
      placeholder="np. znalazło się na regale — opcjonalnie" aria-label="Jak załatwiono" />
    <Przycisk wariant="glowny" type="submit" disabled={trwa}>Załatwione</Przycisk>
    <Przycisk type="button" onClick={() => { setOtwarte(false); setNotatka(""); }}>Anuluj</Przycisk>
  </form>;
}

export function KontekstKosza({ k, zalatw }: {
  k: SzczegolKosza;
  zalatw: { trwa: boolean; blad: string; onZalatw: (pozycjaId: number, notatka: string) => void };
}) {
  const czekajace = k.pozycje.filter((p) => p.status === "skipped" && !p.zalatwioneAt);
  return <div className="p-4">
    <NaglowekSekcji jako="h3" ikona={<Undo2 size={14} />}>Zwroty w tym koszu</NaglowekSekcji>
    {k.zwroty.length
      ? <ul className="mt-1.5 space-y-1 text-sm">
          {k.zwroty.map((z) => <li key={z.id} className="flex items-baseline gap-2">
            <Link to={`/obsluga/zwroty/${z.id}`} className="font-semibold underline">{z.numer}</Link>
            <span className="text-xs text-slate-600">{z.korektaNumer ? `korekta ${z.korektaNumer}` : "bez korekty"}</span>
          </li>)}
        </ul>
      : <p className="mt-1 text-sm text-slate-600">{k.mmNumer
          ? "Kosz z dokumentu MM Subiektu — zwroty przyszły papierem, nie z panelu."
          : "Żaden zwrot nie wniósł tu towaru."}</p>}

    <NaglowekSekcji jako="h3" ikona={<PackageX size={14} />} className="mt-5">
      Pominięte do załatwienia · {czekajace.length}</NaglowekSekcji>
    {czekajace.length
      ? <ul className="mt-1.5 space-y-3 text-sm">
          {czekajace.map((p) => <li key={p.id}>
            <b>{p.symbol || p.nazwa}</b> <span className="text-slate-600">· {p.ilosc} szt.</span>
            <div className="text-xs text-slate-600">„{p.powod || "bez powodu"}”</div>
            <div className="mt-1"><Zalatw pozycjaId={p.id} trwa={zalatw.trwa} onZalatw={zalatw.onZalatw} /></div>
          </li>)}
        </ul>
      : <p className="mt-1 text-sm text-slate-600">Nic tu nie czeka.</p>}
    <Blad>{zalatw.blad}</Blad>
  </div>;
}
