import React from "react";
import { UserRound } from "lucide-react";

/**
 * Prowadzący rozmowę jako kółko w nagłówku (23 września 2026).
 *
 * Wspólny `sprawy/Prowadzi.tsx` zostaje w reklamacjach i dyskusjach, bo tam
 * niesie przycisk wzięcia sprawy. W skrzynce przycisku nie ma od 0.395.0 —
 * rozmowę przypisuje pierwsza odpowiedź — więc zostawał sam napis na całą
 * linię. Kółko mówi to samo jednym znakiem: przerywane i puste, gdy nikt;
 * z inicjałem, gdy ktoś; w zieleni, gdy patrzący.
 */
export function ProwadziZnak({ prowadzi, ja }: { prowadzi: string | null; ja: boolean }) {
  const zdanie = prowadzi
    ? `Prowadzi ${ja ? "Ty" : prowadzi}`
    : "Prowadzi nikt — przypisze pierwsza odpowiedź";
  const inicjal = prowadzi ? (ja ? "Ty" : prowadzi.trim().charAt(0).toUpperCase()) : null;
  return <span title={zdanie}
    className={`inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-1 text-xs font-bold ${
      !prowadzi ? "border-2 border-dashed border-slate-300 text-slate-500"
        : ja ? "bg-emerald-100 text-ranga-ok" : "bg-slate-200 text-slate-800"}`}>
    {inicjal ?? <UserRound size={14} aria-hidden="true" />}
    <span className="sr-only">{zdanie}</span>
  </span>;
}
