import React from "react";
import { KartaWgladu } from "../ui/wglad";
import type { PokrycieWiedzy as Pokrycie } from "../api/typy";
import { Liczba } from "./PokrycieSygnatur";

/* ── Pokrycie wiedzy (E3) ────────────────────────────────────────────────────
   Te same liczby, które tłumaczą, DLACZEGO szczebel doboru był pominięty:
   ile kartotek ma w opisie numer OEM, ile sekcji „Modele:" czeka na
   człowieka, czy indeks pełnotekstowy w ogóle stoi. Wzorzec karty sygnatur:
   liczby, nie procent, i lista roboty zamiast ozdoby.

   SIEDEMNAŚCIE KAFELKÓW TO ZA DUŻO NA JEDNO SPOJRZENIE (@wydanie). Na
   wierzchu został pierwszy rząd — ile wiedzy mamy. Kolejka, tokeny silników,
   wymiary i stan indeksu zwinęły się pod „Szczegóły", bo czyta się je
   rzadko, a lista roboty mieszka w Wiedzy. Liczba czekająca na człowieka
   nie chowa się jednak w ciszy: stoi przy przełączniku.                     */

const Rzad = ({ children }: { children: React.ReactNode }) =>
  <div className="mt-4 flex flex-wrap gap-8 border-t pt-4">{children}</div>;

export function PokrycieWiedzy({ dane }: { dane: Pokrycie | undefined }) {
  if (!dane) return null;
  /* Dwie kolejki na decyzję człowieka — te same, które w szczegółach dostają
     ton „uwaga". Zwinięte bez śladu przestałyby wołać o reakcję. */
  const czeka = [
    dane.modeleZOpisu.nowych > 0 && `${dane.modeleZOpisu.nowych} tekstów`,
    dane.tokeny.nowych > 0 && `${dane.tokeny.nowych} kartotek`,
  ].filter(Boolean).join(" i ");
  return <KartaWgladu tytul="Wiedza z opisów kartotek i ofert"
    /* „poza wpisami z ofert", bo one przebudowy NIE przeżywają jako
       odtwarzane — one ją przeżywają jako nieruszane, i to jest różnica
       warta jednego słowa: nie ma z czego ich odtworzyć. */
    opis="Odbudowa po każdym imporcie, poza wpisami z ofert.">
    <div className="flex flex-wrap gap-8">
      <Liczba etykieta="kartotek" ile={dane.kartotek} />
      <Liczba etykieta="z opisem" ile={dane.zOpisem} />
      <Liczba etykieta="z identyfikatorem" ile={dane.zIdentyfikatorem} ton="text-ranga-ok" />
      <Liczba etykieta="identyfikatorów" ile={dane.identyfikatorow} />
      <Liczba etykieta="wpisanych ręcznie" ile={dane.identyfikatorowRecznych} />
      {/* Osobno od ręcznych, bo mierzy CO INNEGO: ile wiedzy odzyskaliśmy
          z miejsca, które do 0.264.0 kończyło się na akapicie pod szkicem. */}
      <Liczba etykieta="odzyskanych z ofert" ile={dane.identyfikatorowZOfert} ton="text-ranga-ok" />
    </div>

    {/* Brak pełnego tekstu to awaria, nie szczegół — zostaje na wierzchu.
        Przyczyna techniczna (SQLite zbudowany bez FTS5) zeszła z ekranu
        (@wydanie): agent nic z nią nie zrobi, a administrator zna ją
        z dziennika serwera. */}
    {!dane.fts.dostepne && <p className="mt-4 border-t pt-4 text-sm font-bold text-ranga-zle">
      Wyszukiwanie pełnym tekstem nie działa — dobór go teraz pomija.</p>}

    <details className="mt-4 border-t pt-4 text-sm">
      <summary className="cursor-pointer text-slate-600">
        Szczegóły{czeka && <span className="font-semibold text-ranga-uwaga"> · do decyzji: {czeka}</span>}
      </summary>
      <Rzad>
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
      </Rzad>

      <Rzad>
        {/* Tokeny silników (0.239.0): „do decyzji" to lista na ekranie Wiedza → Z opisów i ofert. */}
        <Liczba etykieta="tokenów silników w nazwach" ile={dane.tokeny.tokenow} />
        <Liczba etykieta="kartotek z tokenem do decyzji" ile={dane.tokeny.nowych}
          ton={dane.tokeny.nowych > 0 ? "text-ranga-uwaga" : ""} />
        <Liczba etykieta="zatwierdzonych z tokenu" ile={dane.tokeny.zatwierdzonych} ton="text-ranga-ok" />
      </Rzad>

      <Rzad>
        {/* Wymiary z nazw i opisów: paliwo szczebla „zgodne wymiary" w doborze. */}
        <Liczba etykieta="kartotek z wymiarem w nazwie lub opisie" ile={dane.wymiary.kartotek} />
        <Liczba etykieta="wymiarów" ile={dane.wymiary.wymiarow} />
      </Rzad>

      {/* Nazwa indeksu (FTS5) zeszła z ekranu (@wydanie) — agentowi mówi
          tyle, ile „działa" i liczba kartotek. */}
      {dane.fts.dostepne && <p className="mt-4 border-t pt-4 text-slate-600">
        Wyszukiwanie pełnym tekstem obejmuje <b>{dane.fts.wpisow}</b> kartotek.</p>}
    </details>
  </KartaWgladu>;
}
