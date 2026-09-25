import React, { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

/* ── „⋯" — NARZĘDZIA ROZMOWY W JEDNYM MIEJSCU (@wydanie) ───────────────────
   Zgłoszenie agenta: „aplikacja przytłacza". Nagłówek rozmowy niósł siedem
   rzeczy w jednej wadze: prowadzącego, kategorię z trzema narzędziami,
   pilne, reklamacyjną, status i Zakończ. Większość z nich to NARZĘDZIA,
   po które sięga się raz na kilka rozmów, a patrzy się na nie przy każdej.

   ZASADA: na wierzchu stoi to, co mówi o STANIE sprawy albo jest
   najczęstszym ruchem — status, Zakończ, podniesiona flaga. Przełącznik
   w pozycji spoczynku i poprawka kategorii schodzą tutaj. Nic nie znika:
   jedno kliknięcie dalej, a flaga podniesiona dalej krzyczy z nagłówka.

   Okienko, nie osobny ekran: zamyka się Escape'em i kliknięciem obok, bo
   to ruch w trakcie czytania rozmowy, a nie przejście gdzie indziej. */
/**
 * Okienko otwierane przyciskiem: stan i zamykanie Escape'em albo kliknięciem
 * obok. Wspólne dla „⋯" rozmowy i „▾" wysyłki — dwa okienka z dwiema
 * różnymi regułami zamykania to dwa nawyki do nauczenia zamiast jednego.
 */
export function useOkienko<T extends HTMLElement>() {
  const [otwarte, setOtwarte] = useState(false);
  const ramka = useRef<T>(null);
  useEffect(() => {
    if (!otwarte) return;
    const obok = (e: MouseEvent) => {
      if (ramka.current && !ramka.current.contains(e.target as Node)) setOtwarte(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOtwarte(false); };
    document.addEventListener("mousedown", obok);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", obok);
      document.removeEventListener("keydown", esc);
    };
  }, [otwarte]);
  return { otwarte, setOtwarte, ramka };
}

export function MenuRozmowy({ children }: { children: React.ReactNode }) {
  const { otwarte, setOtwarte, ramka } = useOkienko<HTMLDivElement>();
  return <div ref={ramka} className="relative">
    <button type="button" aria-label="Więcej czynności rozmowy" aria-expanded={otwarte}
      title="Prowadzący, kategoria, pilne, reklamacyjna"
      onClick={() => setOtwarte((o) => !o)}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
      <MoreHorizontal size={18} /></button>
    {otwarte && <div role="group" aria-label="Czynności rozmowy"
      className="absolute right-0 top-full z-30 mt-1 flex w-80 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg">
      {children}
    </div>}
  </div>;
}

/** Jeden wiersz menu: podpis po lewej, treść po prawej — ten sam rytm w każdym. */
export function WierszMenu({ etykieta, children }: { etykieta: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1">
    <span className="text-podpis font-bold uppercase tracking-wide text-slate-600">{etykieta}</span>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>;
}
