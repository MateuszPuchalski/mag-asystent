import React from "react";
import { Karta } from "../ui";
import type { PokrycieSygnatur as Pokrycie } from "../api/typy";

/* ── Pokrycie sygnatur (0.169.0) ─────────────────────────────────────────────
   Sygnatura oferty (`offer.external.id`) wiąże ją z kartoteką Subiekta po
   symbolu. Od 0.169.0 pewne trafienie wiąże się SAMO — a ta karta odpowiada
   na pytanie, którego dotąd nie dało się zadać: ILE się wiąże.

   Karta nie jest ozdobą, tylko listą roboty. Sygnatura w kolumnie „pudła"
   znaczy jedno kliknięcie w Allegro albo jedną kartotekę w Subiekcie —
   i o tyle mniej zatwierdzania przy zwrotach.                              */

export const Liczba = ({ etykieta, ile, ton = "" }: { etykieta: string; ile: number; ton?: string }) =>
  <div className="flex flex-col">
    <span className={`text-2xl font-bold ${ton}`}>{ile}</span>
    <span className="text-xs text-slate-500">{etykieta}</span>
  </div>;

const Lista = ({ tytul, opis, wiersze }: {
  tytul: string; opis: string; wiersze: Pokrycie["pudla"];
}) => {
  if (!wiersze.length) return null;
  return <div className="border-t p-4">
    <b className="text-sm">{tytul}</b>
    <p className="mb-2 text-xs text-slate-500">{opis}</p>
    <ul className="space-y-1 text-sm">
      {wiersze.map((w) => <li key={w.sygnatura} className="flex gap-3">
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-bold">{w.sygnatura}</code>
        <span className="mr-auto truncate text-slate-500">{w.nazwa}</span>
        <span className="shrink-0 text-slate-400">{w.pozycji} poz.</span>
      </li>)}
    </ul>
  </div>;
};

export function PokrycieSygnatur({ dane }: { dane: Pokrycie | undefined }) {
  if (!dane) return null;
  const zSygnatura = dane.pozycji - dane.bezSygnatury;

  return <Karta className="overflow-hidden">
    <header className="flex items-baseline gap-2 border-b p-4">
      <b className="mr-auto">Sygnatura → kartoteka Subiekta</b>
      <span className="text-xs text-slate-400">pozycje pobranych zamówień</span>
    </header>

    <div className="flex flex-wrap gap-8 p-4">
      <Liczba etykieta="pozycji zamówień" ile={dane.pozycji} />
      <Liczba etykieta="z sygnaturą" ile={zSygnatura} />
      {/* Trafienie liczy się TYLKO przy jednej kartotece — dokładnie tak, jak
          wiąże automat. Liczba obiecująca więcej, niż wiąże, byłaby gorsza
          od braku liczby. */}
      <Liczba etykieta="wiąże się samo" ile={dane.trafia} ton="text-ranga-ok" />
      <Liczba etykieta="różnych sygnatur" ile={dane.sygnatur} />
    </div>

    {dane.pozycji === 0 && <p className="border-t p-4 text-sm text-slate-500">
      Nie ma jeszcze pobranych zamówień — pokrycie policzy się po pierwszej
      synchronizacji.</p>}

    <Lista tytul="Sygnatury bez kartoteki" wiersze={dane.pudla}
      opis="Takiego symbolu nie ma w Subiekcie — literówka w Allegro albo brak kartoteki." />
    <Lista tytul="Symbol zdublowany w Subiekcie" wiersze={dane.zdublowane}
      opis="Dwie kartoteki o tym samym symbolu. Automat nie wybiera — rozstrzyga człowiek." />
  </Karta>;
}
