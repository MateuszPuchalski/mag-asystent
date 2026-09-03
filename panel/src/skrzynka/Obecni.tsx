import React from "react";
import { Eye, PenLine } from "lucide-react";
import type { Obecnosc } from "../api/zdarzenia";

/**
 * Kto jeszcze siedzi przy tej rozmowie (§6.3, makieta `Main.dc.html`).
 *
 * Dane leciały tu od 0.144.0 i nikt ich nie rysował: `useSzynaZdarzen` zwracał
 * `obecnosc`, a `Skrzynka.tsx` brała hook wyłącznie dla efektu ubocznego
 * i wynik wyrzucała. Kolejka pokazywała samego trzymającego (jedna osoba,
 * ikona oka), więc w otwartej rozmowie agent nie widział NIC — a to tutaj
 * pisze się odpowiedź, którą drugi agent właśnie dubluje.
 *
 * OBECNOŚĆ JEST STANEM CHWILOWYM, NIE STATUSEM ROZMOWY — tak mówi makieta
 * i dlatego ten pasek jest cienki, szary i znika sam. Plakietka w wadze
 * statusu kłamałaby o tym, jak długo to trwa: uchwyt gaśnie po 45 s, a „pisze"
 * po 12 s.
 *
 * PISZE, nie „pisze komentarz". Makieta rozróżnia pole, do którego ktoś pisze;
 * sygnał z serwera niesie samo `typing` i nie wie, czy to szkic, czy notatka.
 * Ekran mówi więc tyle, ile wie — dopisanie trybu wymaga zmiany w trasie
 * `presence`, nie zgadywania po stronie panelu.
 */
export function Obecni({ obecni, mojeId }: { obecni: Obecnosc[]; mojeId: number | null }) {
  const inni = obecni.filter((o) => o.userId !== mojeId);
  if (inni.length === 0) return null;

  const pisza = inni.filter((o) => o.typing);
  const patrza = inni.filter((o) => !o.typing);
  const nazwy = (kto: Obecnosc[]) => kto.map((o) => o.name).join(", ");

  return <p className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-slate-50
      px-4 py-1.5 text-xs text-slate-500" aria-live="polite">
    {patrza.length > 0 && <span className="flex items-center gap-1">
      <Eye size={13} />{nazwy(patrza)} {patrza.length === 1 ? "ogląda" : "oglądają"} tę rozmowę
    </span>}
    {pisza.length > 0 && <span className="flex items-center gap-1 font-semibold text-amber-800">
      <PenLine size={13} />{nazwy(pisza)} {pisza.length === 1 ? "pisze" : "piszą"}…
    </span>}
  </p>;
}
