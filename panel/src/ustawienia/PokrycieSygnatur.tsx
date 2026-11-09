import React from "react";
import { KartaWgladu } from "../ui/wglad";
import type { PokrycieSygnatur as Pokrycie } from "../api/typy";

/* ── Pokrycie sygnatur ───────────────────────────────────────────────────────
   Sygnatura oferty (`offer.external.id`) wiąże ją z kartoteką Subiekta po
   symbolu. Pewne trafienie wiąże się SAMO, a ta karta mówi, ILE się wiąże.

   Karta nie jest ozdobą, tylko listą roboty. Sygnatura w kolumnie „pudła"
   znaczy jedno kliknięcie w Allegro albo jedną kartotekę w Subiekcie —
   i o tyle mniej zatwierdzania przy zwrotach.                              */

/* ── TON OSTRZEGAWCZY TO `ranga-uwaga`, NIE BARWA MARKI ──────────────────────
   Barwa marki (#FF9100) przy 24 px i wadze 700 daje na bieli 2.26:1, przy
   progu 3:1 dla tekstu tej wielkości. Ta barwa jest tłem pod ciemnym pismem
   (tak działa `.btn-primary`) i nie nadaje się na samo pismo.

   `ranga-uwaga` (#92400e) daje 7.09:1 i znaczy dokładnie „uwaga" — sąsiednie
   liczby biorą już `ranga-ok` z tej samej rodziny. Barwa MARKI i barwa
   OSTRZEŻENIA są rozdzielone decyzją właściciela. */
import { Liczba } from "../ui/wykres";

const Lista = ({ tytul, opis, wiersze }: {
  tytul: string; opis: string; wiersze: Pokrycie["pudla"];
}) => {
  if (!wiersze.length) return null;
  return <div className="mt-4 border-t pt-4">
    <b className="text-naglowek">{tytul}</b>
    <p className="mb-2 text-xs text-slate-500">{opis}</p>
    <ul className="space-y-1 text-sm">
      {wiersze.map((w) => <li key={w.sygnatura} className="flex gap-3">
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-bold">{w.sygnatura}</code>
        <span className="mr-auto truncate text-slate-500">{w.nazwa}</span>
        <span className="shrink-0 text-slate-500">{w.pozycji} poz.</span>
      </li>)}
    </ul>
  </div>;
};

export function PokrycieSygnatur({ dane }: { dane: Pokrycie | undefined }) {
  if (!dane) return null;
  const zSygnatura = dane.pozycji - dane.bezSygnatury;

  /* Rama wspólna z resztą analizy, żeby karty obsługi nie czytały się jak
     sześć aplikacji. */
  /* Bez zamówień karta jest jednym zdaniem: cztery zera nad zdaniem
     „jeszcze nie ma" mówiłyby to samo dwa razy. */
  if (dane.pozycji === 0) return <KartaWgladu tytul="Sygnatura → kartoteka Subiekta"
    pusta="Nie ma jeszcze pobranych zamówień — pokrycie policzy się po pierwszej synchronizacji." />;
  return <KartaWgladu tytul="Sygnatura → kartoteka Subiekta"
    opis="Pozycje pobranych zamówień.">
    <div className="flex flex-wrap gap-8">
      <Liczba etykieta="pozycji zamówień" ile={dane.pozycji} />
      <Liczba etykieta="z sygnaturą" ile={zSygnatura} />
      {/* Trafienie liczy się TYLKO przy jednej kartotece — dokładnie tak, jak
          wiąże automat. Liczba obiecująca więcej, niż wiąże, byłaby gorsza
          od braku liczby. */}
      <Liczba etykieta="wiąże się samo" ile={dane.trafia} ton="text-ranga-ok" />
      <Liczba etykieta="różnych sygnatur" ile={dane.sygnatur} />
    </div>

    {/* Obie listy zostają na wierzchu: to lista roboty, nie szczegół. */}
    <Lista tytul="Sygnatury bez kartoteki" wiersze={dane.pudla}
      opis="Takiego symbolu nie ma w Subiekcie — literówka w Allegro albo brak kartoteki." />
    <Lista tytul="Symbol zdublowany w Subiekcie" wiersze={dane.zdublowane}
      opis="Dwie kartoteki o tym samym symbolu. Automat nie wybiera — rozstrzyga człowiek." />
  </KartaWgladu>;
}
