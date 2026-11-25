import { ListChecks } from "lucide-react";
import type { WynikSprawdzeniaWszystkich } from "../api/zwroty";

/* Hurtowe „Sprawdź wszystkie w Allegro” przy kolejce zwrotów.

   Przycisk stoi w rzędzie tytułu kolumny (jedna ikona), a wynik pod polem
   szukania, bo zdanie o wyniku jest dłuższe niż rząd tytułu.

   Wynik żyje w mutacji EKRANU, nie tutaj: ten komponent odmontowuje się razem
   z paskiem szukania, a agent przełącza kubełki, patrząc na wynik. Zostaje na
   ekranie, dopóki agent go nie zamknie albo nie kliknie ponownie — zdanie,
   które znika samo, nie da się doczytać.

   Powody z serwera są gotowymi zdaniami i idą na ekran dosłownie: tłumaczenie
   ich tutaj rozjeżdżałoby panel z serwerem przy każdym nowym powodzie. */

export function PrzyciskSprawdzenia({ trwa, onSprawdz }: { trwa: boolean; onSprawdz: () => void }) {
  return <button type="button" disabled={trwa} onClick={onSprawdz}
    aria-label={trwa ? "Sprawdzam w Allegro…" : "Sprawdź wszystkie w Allegro"}
    title="Zapytaj Allegro o zwroty płatności wszystkich zwrotów w pracy"
    className="btn-secondary h-8 w-8 shrink-0 justify-center p-0">
    <ListChecks size={16} aria-hidden="true" className={trwa ? "motion-safe:animate-pulse" : ""} />
  </button>;
}

export function WynikSprawdzenia({ blad, wynik, onZamknij }: {
  blad: string;
  wynik: WynikSprawdzeniaWszystkich | null;
  onZamknij: () => void;
}) {
  if (!blad && !wynik) return null;
  return <div className="mt-1">
    {blad && <p role="alert" className="text-xs text-red-700">{blad}</p>}
    {wynik && <div role="status" className="text-xs text-slate-700">
      {wynik.sprawdzonych === 0
        ? <p>Nie ma zwrotów do sprawdzenia.</p>
        : <>
          <p>Sprawdzono {wynik.sprawdzonych} zwrotów.
            {" "}Przypięto wypłatę z Allegro przy {wynik.zatrzasniete}.</p>
          {wynik.bezZwrotuPlatnosci > 0 && <p>
            Allegro nie zna zwrotu płatności dla {wynik.bezZwrotuPlatnosci} zwrotów.</p>}
          {wynik.zPowodem.map((p) => <p key={p.powod}>
            {p.ile} zwrotów nie przypięto: {p.powod}.</p>)}
        </>}
      {wynik.urwane && <p>
        Lista Allegro jest dłuższa, niż bierzemy naraz — kliknij jeszcze raz, żeby dojść dalej.</p>}
      <button type="button" onClick={onZamknij}
        className="mt-1 text-slate-500 underline underline-offset-2">Zamknij</button>
    </div>}
  </div>;
}
