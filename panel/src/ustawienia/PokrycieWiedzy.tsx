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
      <b className="text-naglowek mr-auto">Wiedza z opisów kartotek i ofert</b>
      {/* „poza wpisami z ofert", bo one przebudowy NIE przeżywają jako
          odtwarzane — one ją przeżywają jako nieruszane, i to jest różnica
          warta jednego słowa: nie ma z czego ich odtworzyć. */}
      <span className="text-xs text-slate-500">odbudowa po każdym imporcie, poza wpisami z ofert</span>
    </header>

    <div className="flex flex-wrap gap-8 p-4">
      <Liczba etykieta="kartotek" ile={dane.kartotek} />
      <Liczba etykieta="z opisem" ile={dane.zOpisem} />
      <Liczba etykieta="z identyfikatorem" ile={dane.zIdentyfikatorem} ton="text-ranga-ok" />
      <Liczba etykieta="identyfikatorów" ile={dane.identyfikatorow} />
      <Liczba etykieta="wpisanych ręcznie" ile={dane.identyfikatorowRecznych} />
      {/* Osobno od ręcznych, bo mierzy CO INNEGO: ile wiedzy odzyskaliśmy
          z miejsca, które do 0.264.0 kończyło się na akapicie pod szkicem. */}
      <Liczba etykieta="odzyskanych z ofert" ile={dane.identyfikatorowZOfert} ton="text-ranga-ok" />
    </div>

    <div className="flex flex-wrap gap-8 border-t p-4">
      {/* „Do przerobienia" to lista roboty na ekranie Wiedza → Z opisów i ofert.
          Od 0.264.0 liczy OBA źródła, bo kolejka jest jedna: robota człowieka
          jest ta sama, a rozdzielenie licznika kazałoby patrzeć w dwa miejsca. */}
      <Liczba etykieta="tekstów do przerobienia" ile={dane.modeleZOpisu.nowych}
        ton={dane.modeleZOpisu.nowych > 0 ? "text-ranga-uwaga" : ""} />
      <Liczba etykieta="przerobionych" ile={dane.modeleZOpisu.przerobionych} />
      <Liczba etykieta="odrzuconych" ile={dane.modeleZOpisu.odrzuconych} />
      <Liczba etykieta="zastosowań zatwierdzonych" ile={dane.zastosowania.zatwierdzonych} ton="text-ranga-ok" />
      <Liczba etykieta="negatywnych" ile={dane.zastosowania.negatywnych} />
      <Liczba etykieta="propozycji w kolejce" ile={dane.zastosowania.propozycji} />
    </div>

    <div className="flex flex-wrap gap-8 border-t p-4">
      {/* Tokeny silników (0.239.0): „do decyzji" to lista na ekranie Wiedza → Z opisów i ofert. */}
      <Liczba etykieta="tokenów silników w nazwach" ile={dane.tokeny.tokenow} />
      <Liczba etykieta="kartotek z tokenem do decyzji" ile={dane.tokeny.nowych}
        ton={dane.tokeny.nowych > 0 ? "text-ranga-uwaga" : ""} />
      <Liczba etykieta="zatwierdzonych z tokenu" ile={dane.tokeny.zatwierdzonych} ton="text-ranga-ok" />
    </div>

    <div className="flex flex-wrap gap-8 border-t p-4">
      {/* Wymiary z nazw i opisów: paliwo szczebla „zgodne wymiary" w doborze. */}
      <Liczba etykieta="kartotek z wymiarem w nazwie lub opisie" ile={dane.wymiary.kartotek} />
      <Liczba etykieta="wymiarów" ile={dane.wymiary.wymiarow} />
    </div>

    <p className="border-t p-4 text-sm text-slate-600">
      {dane.fts.dostepne
        ? <>Pełny tekst: indeks FTS5 ma <b>{dane.fts.wpisow}</b> kartotek.</>
        : <span className="font-bold text-ranga-zle">Pełny tekst niedostępny — SQLite bez FTS5. Szczebel doboru „pełny tekst" jest pomijany.</span>}
    </p>
  </Karta>;
}
