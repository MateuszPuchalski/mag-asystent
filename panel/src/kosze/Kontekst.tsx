import React from "react";
import { Link } from "react-router-dom";
import { Undo2 } from "lucide-react";
import type { SzczegolKosza } from "../api/kosze";
import { NaglowekSekcji } from "../ui";

/* ── Kontekst kosza — prawa kolumna ───────────────────────────────────────
   ZWROTY W KOSZU prowadzą do swoich kart i to jest DROGA DALEJ. Druga strona
   tego wiązania stoi na karcie zwrotu („Towar w koszach"); razem dają
   wiązanie w obie strony, bo jednostronne to wiązanie, którego nie ma
   (`CLAUDE.md`).

   Pominięte pozycje stoją w środkowej kolumnie, przy zawartości kosza —
   powód w `kosze/Kosz.tsx`. Tu jest wyłącznie to, dokąd z kosza się idzie. */

export function KontekstKosza({ k }: { k: SzczegolKosza }) {
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
  </div>;
}
