import React from "react";
import type { WynikSprawdzeniaWszystkich } from "../api/zwroty";

/* Hurtowe „Sprawdź wszystkie w Allegro” nad kolejką zwrotów.

   Wynik żyje w stanie EKRANU, nie tutaj: ten komponent odmontowuje się razem
   z paskiem szukania, a agent przełącza kubełki, patrząc na wynik. Zostaje na
   ekranie, dopóki agent go nie zamknie albo nie kliknie ponownie — zdanie,
   które znika samo, nie da się doczytać.

   Powody z serwera są gotowymi zdaniami i idą na ekran dosłownie: tłumaczenie
   ich tutaj rozjeżdżałoby panel z serwerem przy każdym nowym powodzie. */

export function SprawdzWszystkie({ trwa, blad, wynik, onSprawdz, onZamknij }: {
  trwa: boolean;
  blad: string;
  wynik: WynikSprawdzeniaWszystkich | null;
  onSprawdz: () => void;
  onZamknij: () => void;
}) {
  return <div className="mt-1">
    <button type="button" disabled={trwa} onClick={onSprawdz}
      title="Zapytaj Allegro o zwroty płatności wszystkich zwrotów w pracy"
      className="btn-secondary h-8 px-3 text-xs">
      {trwa ? "Sprawdzam…" : "Sprawdź wszystkie w Allegro"}
    </button>
    {blad && <p role="alert" className="mt-1 text-xs text-red-700">{blad}</p>}
    {wynik && <div role="status" className="mt-1 text-xs text-slate-700">
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
