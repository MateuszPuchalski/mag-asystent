import React from "react";
import type { StanMm } from "../api/kosze";

/* ── Cykl kosza jako pasek kroków (0.438.0, z `biuro.html` 0.427.0) ───────
   Wiersz kosza niósł kiedyś dwie pastylki — stan kosza i stan jego MM —
   i żeby odpowiedzieć „gdzie ten kosz jest", trzeba było złożyć je w głowie
   (dekalog pkt 2 i 5). Pasek pokazuje MIEJSCE w cyklu: co za nim (zielone),
   gdzie stoi (grafit), co przed nim (przerywane).

   MM zostaje DOPISKIEM obok, bo to osobny tor — kosz bywa rozłożony, zanim
   Subiekt wystawi dokument, i pasek nie ma prawa udawać, że to jeden krok.
   Anulowany nie jest krokiem, tylko wyjściem z cyklu: czerwona pastylka.
   MM w błędzie barwi bieżący krok na czerwono — to jedyny stan, w którym
   kosz stoi z powodu, który ma naprawić biuro. */

const KROKI: Array<[string, string]> = [["otwarty", "otwarty"], ["zamkniety", "na hali"], ["rozlozony", "rozłożony"]];

export function CyklKosza({ status, mmBlad = false }: { status: string; mmBlad?: boolean }) {
  if (status === "anulowany") {
    return <span className="rounded bg-red-100 px-1.5 py-0.5 text-podpis font-bold uppercase tracking-wide text-ranga-zle">
      anulowany</span>;
  }
  const idx = KROKI.findIndex(([st]) => st === status);
  const teraz = idx < 0 ? KROKI.length - 1 : idx;
  return <span className="inline-flex items-center gap-0.5" title={`Kosz: ${KROKI[teraz][1]}`}>
    {KROKI.map(([st, slowo], n) => <React.Fragment key={st}>
      {n > 0 && <i aria-hidden="true" className="h-0.5 w-2 bg-slate-300" />}
      <span className={`rounded-full px-2 py-0.5 text-podpis font-bold uppercase tracking-wide ${
        n < teraz ? "bg-emerald-100 text-ranga-ok"
          : n === teraz ? (mmBlad ? "bg-red-700 text-white" : "bg-wertis-ink text-white")
            : "border border-dashed border-slate-300 text-slate-600"}`}>{slowo}</span>
    </React.Fragment>)}
  </span>;
}

/**
 * Na czym stoi dokument MM (0.333.0). Kosz zamknięty, bez numeru, wyglądał
 * na awarię — i tak został zgłoszony — a czekał z powodu, który aplikacja
 * zna: towar wraca na magazyn główny dopiero korektą.
 */
export function StanMmKosza({ mmStan, mmNumer, brakujeKorekt, karton }: {
  mmStan: StanMm; mmNumer: string | null; brakujeKorekt: number; karton: boolean;
}) {
  if (karton) return null;
  if (mmNumer) return <span className="text-xs text-slate-600">MM {mmNumer}</span>;
  if (mmStan === "czeka_na_korekte") {
    return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">
      czeka na korektę{brakujeKorekt ? ` — ${brakujeKorekt} zwr.` : ""}</span>;
  }
  if (mmStan === "zamowiona") return <span className="text-xs text-slate-600">MM zamówiona</span>;
  if (mmStan === "blad") {
    return <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">
      MM w błędzie — sprawdź kolejkę</span>;
  }
  return null;
}
