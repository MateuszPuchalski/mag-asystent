import React from "react";
import { Undo2, X } from "lucide-react";

/* ── „COFNIJ" ZAMIAST PYTANIA „CZY NA PEWNO" (0.500.0) ──────────────────────
   Czynność jednym kliknięciem, której skutek znika z oczu — rozmowa
   zakończona schodzi z listy, a ekran przeskakuje do następnej — dostaje
   pasek z „Cofnij" na kilka sekund. Nie okno potwierdzenia: badanie
   Anderson i in. (CHI 2015, fMRI) pokazało gwałtowny spadek uwagi mózgu na
   ostrzeżenie już przy DRUGIM jego zobaczeniu, więc pytanie „czy na pewno"
   klika się z przyzwyczajenia. Cofnięcie kosztuje tylko tego, kto się pomylił.

   Ten sam kształt co pasek odłożonej wysyłki (`Odlozone.tsx`), stąd ta sama
   barwa i ten sam przycisk — jedno „Cofnij" w panelu, nie dwa różne. */

export interface DoCofniecia {
  klucz: number;
  opis: React.ReactNode;
  cofnij: () => void;
}

/** Ile pasek czeka na „Cofnij" — tyle, żeby dało się przeczytać zdanie i sięgnąć myszą. */
export const OKNO_COFNIECIA_CZYNNOSCI_MS = 8_000;

export function Cofniecie({ wpis, onZamknij }: { wpis: DoCofniecia | null; onZamknij: () => void }) {
  /* Zegar liczy się od KLUCZA, nie od każdego przerysowania — inaczej
     odświeżenie listy odsuwałoby zniknięcie paska bez końca. */
  React.useEffect(() => {
    if (!wpis) return;
    const t = setTimeout(onZamknij, OKNO_COFNIECIA_CZYNNOSCI_MS);
    return () => clearTimeout(t);
    /* Celowo tylko klucz: `onZamknij` bywa nową funkcją przy każdym
       przerysowaniu rodzica, a zegar ma ruszyć raz na wpis. */
  }, [wpis?.klucz]);
  if (!wpis) return null;
  return <div role="status" aria-live="polite"
    className="fixed bottom-4 left-4 z-40 flex w-[min(28rem,calc(100vw-2rem))] items-center gap-3 rounded-xl bg-wertis-ink px-4 py-3 text-sm text-white shadow-lg">
    <span className="min-w-0 flex-1">{wpis.opis}</span>
    <button type="button" onClick={() => { wpis.cofnij(); onZamknij(); }}
      className="inline-flex items-center gap-1 rounded-lg bg-wertis-amber px-3 py-1.5 font-bold text-wertis-ink">
      <Undo2 size={15} />Cofnij</button>
    <button type="button" aria-label="Zamknij" onClick={onZamknij}
      className="rounded p-1 opacity-80 hover:opacity-100"><X size={15} /></button>
  </div>;
}
