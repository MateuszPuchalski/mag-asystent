import { dzienSkrot, liczbaPl } from "./liczby";

/* ── Porównanie tygodnia z poprzednim (0.497.0) ──────────────────────────
   Różnica w SZTUKACH, nie w procentach. Przy liczbach tej hali — trzy
   reklamacje, dwie zamknięte dostawy — „+50%" znaczy „o jedną więcej",
   a brzmi jak alarm. Sztuka mówi dokładnie tyle, ile się stało.

   Bez barw dobrze-źle. Więcej pozycji jest dobrze, więcej odrzuceń źle,
   a mediana czasu rozłożenia rośnie też wtedy, gdy przyszła jedna wielka
   dostawa. Ocenę zostawiamy człowiekowi, który wie, co to był za tydzień —
   ta sama zasada co zdanie o szczycie w `liczby.ts`: fakty, nie wniosek. */

/** „+12", „−3", „bez zmian"; „—", gdy któregoś tygodnia nie policzono. */
export function zmiana(teraz: number | null | undefined, przed: number | null | undefined): string {
  if (teraz == null || przed == null) return "—";
  const r = Math.round((teraz - przed) * 100) / 100;
  if (r === 0) return "bez zmian";
  return `${r > 0 ? "+" : "−"}${liczbaPl(Math.abs(r))}`;
}

/** „t38 · 14.09–20.09.2026" — z dat lokalnych serwera, bez strefy przeglądarki. */
export function podpisTygodnia(r: { tydzien: string; dni: string[] }): string {
  const ost = r.dni[r.dni.length - 1];
  return `t${Number(r.tydzien.slice(-2))} · ${dzienSkrot(r.dni[0])}–${dzienSkrot(ost)}.${ost.slice(0, 4)}`;
}
