import React from "react";
import type { WarunkiDoZapisu, WarunkiZastosowania } from "../api/typy";
import { Pole } from "../ui";

/**
 * Warunki wpisu — lata, zakres numerów seryjnych, warunek słowny.
 *
 * Pola trzymają TEKST, a liczbę robi z nich dopiero `naWarunki`. Pole
 * liczbowe przeglądarki połyka „2014 r." bez słowa i wysyła pustkę, więc
 * człowiek widziałby rok, którego serwer nie dostał. Zły rok ma wrócić
 * zdaniem z serwera, a nie zniknąć po drodze.
 *
 * Wspólne dla nowej propozycji i poprawki warunków przy kartotece: dwie
 * kopie tych pól rozjechałyby się przy pierwszym nowym warunku.
 */
export type TekstWarunkow = Record<keyof WarunkiZastosowania, string>;

export const PUSTE_WARUNKI: TekstWarunkow = { rokOd: "", rokDo: "", seryjnyOd: "", seryjnyDo: "", warunek: "" };

export const tekstWarunkow = (w: WarunkiZastosowania): TekstWarunkow => ({
  rokOd: w.rokOd === null ? "" : String(w.rokOd), rokDo: w.rokDo === null ? "" : String(w.rokDo),
  seryjnyOd: w.seryjnyOd ?? "", seryjnyDo: w.seryjnyDo ?? "", warunek: w.warunek ?? "",
});

/* Rok, który nie jest liczbą, jedzie DALEJ jako tekst — serwer odpowie
   „Rok od to rok z czterech cyfr" zamiast przyjąć wpis bez granicy. */
const rok = (t: string): number | string | null => {
  const s = t.trim();
  if (!s) return null;
  return /^\d+$/.test(s) ? Number(s) : s;
};

export function naWarunki(t: TekstWarunkow): WarunkiDoZapisu | null {
  const w: WarunkiDoZapisu = {
    rokOd: rok(t.rokOd), rokDo: rok(t.rokDo),
    seryjnyOd: t.seryjnyOd.trim() || null, seryjnyDo: t.seryjnyDo.trim() || null, warunek: t.warunek.trim() || null,
  };
  return Object.values(w).some((v) => v !== null) ? w : null;
}

export function PolaWarunkow({ dane, onZmiana }: { dane: TekstWarunkow; onZmiana: (d: TekstWarunkow) => void }) {
  const ustaw = (p: Partial<TekstWarunkow>) => onZmiana({ ...dane, ...p });
  const etykieta = "text-xs font-bold text-slate-600";
  return <div className="space-y-2">
    <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
      <label className={etykieta}>Rocznik od
        <Pole className="mt-1" aria-label="Rocznik od" inputMode="numeric" value={dane.rokOd} placeholder="np. 2014"
          onChange={(e) => ustaw({ rokOd: e.target.value })} /></label>
      <label className={etykieta}>Rocznik do
        <Pole className="mt-1" aria-label="Rocznik do" inputMode="numeric" value={dane.rokDo} placeholder="np. 2018"
          onChange={(e) => ustaw({ rokDo: e.target.value })} /></label>
      <label className={etykieta}>Nr seryjny od
        <Pole className="mt-1" aria-label="Nr seryjny od" value={dane.seryjnyOd} placeholder="np. 175000000"
          onChange={(e) => ustaw({ seryjnyOd: e.target.value })} /></label>
      <label className={etykieta}>Nr seryjny do
        <Pole className="mt-1" aria-label="Nr seryjny do" value={dane.seryjnyDo} placeholder="z tabliczki"
          onChange={(e) => ustaw({ seryjnyDo: e.target.value })} /></label>
    </div>
    <label className={`block ${etykieta}`}>Warunek słowny — sprawdza go agent z klientem
      <Pole className="mt-1" aria-label="Warunek słowny" value={dane.warunek} placeholder="np. tylko wersja z gaźnikiem Zama"
        onChange={(e) => ustaw({ warunek: e.target.value })} /></label>
    <p className="text-podpis text-slate-500">
      Puste pole to brak granicy. Rocznik i numer z doboru sprawdza serwer; bez nich kandydat dostaje „wymaga danych”.
    </p>
  </div>;
}
