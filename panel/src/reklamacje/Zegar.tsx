import { FiltrSegmentowy } from "../ui";
import type { LicznikiTerminow, Pilnosc, Reklamacja } from "../api/typy";

/* ── Zegar zbiorczo nad kolejką reklamacji ───────────────────────────────────
   Wybór właściciela: „ostrzeżenie PRZED terminem".

   NAJPIERW SPROSTOWANIE, BO POSTAWIŁEM PYTANIE BŁĘDNIE. Ostrzeżenie przed
   terminem w tym panelu ISTNIEJE od 0.222.0: `PROG_TERMINU_DNI = 3` zapala
   sygnał `termin`, a pastylka na wierszu czerwienieje i pisze „dziś" albo
   „N dni po". Brakowało czego innego — żeby DOSTAĆ liczbę „ile przeterminuje
   się dziś", trzeba było policzyć czerwone pastylki okiem, przewijając całą
   kolejkę. Zegar był, alarmu nie było.

   PASEK JEST TEŻ SITEM, nie samą tablicą wyników. Liczba, przy której nie da
   się kliknąć, każe szukać tych spraw ręcznie — czyli zostawia dokładnie tę
   pracę, którą miała zdjąć. Dekalog p. 5: jedno pytanie, jedna odpowiedź.

   MILCZY PRZY SAMYCH ZERACH. Pasek „po terminie 0, dziś 0, jutro 0" zajmuje
   wiersz ekranu i nie mówi nic, czego nie mówi pusta kolejka.               */

const POZYCJE: Array<{ klucz: Pilnosc; etykieta: string; podpowiedz: string }> = [
  { klucz: "poTerminie", etykieta: "Po terminie",
    podpowiedz: "Termin decyzji już minął" },
  { klucz: "dzis", etykieta: "Dziś",
    podpowiedz: "Termin decyzji wypada dzisiaj" },
  { klucz: "jutro", etykieta: "Jutro",
    podpowiedz: "Termin decyzji wypada jutro" },
];

/**
 * Czy sprawa należy do wybranej pilności.
 *
 * REGUŁA STOI PO STRONIE SERWERA i tutaj jest tylko odczytana z `kubelek`
 * oraz `dniDoTerminu`. Druga, własna definicja „dziś" w panelu rozjechałaby się
 * z liczbą na pasku — a rozjazd między liczbą a listą pod nią jest gorszy niż
 * brak paska.
 */
export function wPilnosci(r: Reklamacja, p: Pilnosc): boolean {
  if (r.kubelek !== "decyzja" || r.dniDoTerminu === null) return false;
  if (p === "poTerminie") return r.dniDoTerminu < 0;
  if (p === "dzis") return r.dniDoTerminu === 0;
  return r.dniDoTerminu === 1;
}

/** Pasek zegara: trzy liczby, każda zawęża kolejkę do swoich spraw. */
export function PasekZegara({ terminy, wybrana, onWybierz }: {
  terminy: LicznikiTerminow;
  wybrana: Pilnosc | null;
  onWybierz: (p: Pilnosc | null) => void;
}) {
  if (!terminy.poTerminie && !terminy.dzis && !terminy.jutro) return null;
  return <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-1">
    <span className="text-podpis text-slate-500">Termin decyzji:</span>
    <FiltrSegmentowy<Pilnosc | null>
      wybrany={wybrana}
      /* Kliknięcie w WYBRANĄ pozycję ją zdejmuje — to zawężenie listy, a nie
         kubełek. `FiltrSegmentowy` oddaje zawsze klucz klikniętej pozycji,
         więc `null` musi wyliczyć wołający (blizna sita „Moje" z 0.281.0). */
      onWybierz={(k) => onWybierz(wybrana === k ? null : k as Pilnosc)}
      pozycje={POZYCJE.map((p) => ({ ...p, ile: terminy[p.klucz] }))} />
  </div>;
}
