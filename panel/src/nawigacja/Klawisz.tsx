import React from "react";

/* ── JEDEN ZNACZEK KLAWISZA W PANELU (0.515.0) ───────────────────────────────
   Ta sama kopia stała w `nawigacja/Klawisze.tsx` i w `sprawy/Skroty.tsx`.
   Lista pod `?` i pomoc kolejki pokazują te same klawisze, więc mają wyglądać
   identycznie, a dwie kopie rozjeżdżają się przy pierwszej poprawce jednej.

   Osobny plik, nie eksport z `Klawisze.tsx`: tamten ciągnie okno szukania
   z jego zapytaniami, a kolejka potrzebuje samego znaczka. */
export const Klawisz = ({ children }: { children: React.ReactNode }) =>
  <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-podpis text-slate-700">
    {children}</kbd>;
