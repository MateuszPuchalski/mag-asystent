import React from "react";
import { Karta } from "../ui";
import type { PokrycieWiedzy as Pokrycie } from "../api/typy";
import { Liczba } from "./PokrycieSygnatur";

/* ── Pokrycie wiedzy (E3) ────────────────────────────────────────────────────
   Te same liczby, które tłumaczą, DLACZEGO szczebel doboru był pominięty:
   ile kartotek ma w opisie numer OEM, ile sekcji „Modele:" czeka na
   człowieka, czy indeks pełnotekstowy w ogóle stoi. Wzorzec karty sygnatur:
   liczby, nie procent, i lista roboty zamiast ozdoby.                      */

export function PokrycieWiedzy({ dane }: { dane: Pokrycie | undefined }) {
  if (!dane) return null;
  return <Karta className="overflow-hidden">
    <header className="flex items-baseline gap-2 border-b p-4">
      <b className="mr-auto">Wiedza z opisów kartotek</b>
      <span className="text-xs text-slate-400">odbudowa po każdym imporcie</span>
    </header>

    <div className="flex flex-wrap gap-8 p-4">
      <Liczba etykieta="kartotek" ile={dane.kartotek} />
      <Liczba etykieta="z opisem" ile={dane.zOpisem} />
      <Liczba etykieta="z identyfikatorem" ile={dane.zIdentyfikatorem} ton="text-ranga-ok" />
      <Liczba etykieta="identyfikatorów" ile={dane.identyfikatorow} />
      <Liczba etykieta="wpisanych ręcznie" ile={dane.identyfikatorowRecznych} />
    </div>

    <div className="flex flex-wrap gap-8 border-t p-4">
      {/* „Do przerobienia" to lista roboty na ekranie Wiedza → Z opisów. */}
      <Liczba etykieta="sekcji „Modele:” do przerobienia" ile={dane.modeleZOpisu.nowych}
        ton={dane.modeleZOpisu.nowych > 0 ? "text-wertis-amber" : ""} />
      <Liczba etykieta="przerobionych" ile={dane.modeleZOpisu.przerobionych} />
      <Liczba etykieta="odrzuconych" ile={dane.modeleZOpisu.odrzuconych} />
      <Liczba etykieta="zastosowań zatwierdzonych" ile={dane.zastosowania.zatwierdzonych} ton="text-ranga-ok" />
      <Liczba etykieta="negatywnych" ile={dane.zastosowania.negatywnych} />
      <Liczba etykieta="propozycji w kolejce" ile={dane.zastosowania.propozycji} />
    </div>

    <p className="border-t p-4 text-sm text-slate-600">
      {dane.fts.dostepne
        ? <>Pełny tekst: indeks FTS5 ma <b>{dane.fts.wpisow}</b> kartotek.</>
        : <span className="font-bold text-ranga-zle">Pełny tekst niedostępny — SQLite bez FTS5. Szczebel doboru „pełny tekst" jest pomijany.</span>}
    </p>
  </Karta>;
}
