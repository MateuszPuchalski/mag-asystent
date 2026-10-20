import React from "react";
import { ile } from "../ui";
import { liczbaZmian, roznicaSlow } from "./roznica";

/** „+12 słów, −3 słowa”. Strona bez zmian znika, a same odstępy mówią to wprost. */
export function podsumowanieZmian(przed: string, po: string): string {
  const { dodane, usuniete } = liczbaZmian(roznicaSlow(przed, po));
  const czesci = [
    dodane > 0 ? `+${ile(dodane, "słowo", "słowa", "słów")}` : "",
    usuniete > 0 ? `−${ile(usuniete, "słowo", "słowa", "słów")}` : "",
  ].filter(Boolean);
  return czesci.length ? czesci.join(", ") : "zmienione tylko odstępy";
}

/**
 * Różnica dwóch wersji szkicu, w jednym tekście.
 *
 * Dopisane słowa stoją na zielonym tle, skreślone przekreślone na czerwonym.
 * Sama barwa nie wystarcza (WCAG 1.4.1), więc skreślenie ma kreskę, a czytnik
 * ekranu dostaje słowo „dodano” albo „usunięto” przed każdym kawałkiem.
 *
 * `zwinieta` chowa tekst pod podsumowaniem. Starsze wersje czyta się rzadko,
 * a pięćset rozwiniętych znaków każdej z nich spychałoby najnowszą w dół.
 */
export function RoznicaSzkicu({ przed, po, zwinieta = false }: {
  przed: string;
  po: string;
  zwinieta?: boolean;
}) {
  const kawalki = React.useMemo(() => roznicaSlow(przed, po), [przed, po]);
  const podsumowanie = React.useMemo(() => podsumowanieZmian(przed, po), [przed, po]);
  const tekst = <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800" data-testid="roznica-szkicu">
    {kawalki.map((k, i) => k.rodzaj === "wspolne"
      ? <React.Fragment key={i}>{k.tekst}</React.Fragment>
      : k.rodzaj === "dodane"
        ? <ins key={i} className="bg-emerald-100 text-emerald-900 no-underline">
            <span className="sr-only">dodano: </span>{k.tekst}</ins>
        : <del key={i} className="bg-red-50 text-red-800 line-through">
            <span className="sr-only">usunięto: </span>{k.tekst}</del>)}
  </p>;
  if (zwinieta) {
    return <details className="mt-1">
      <summary className="cursor-pointer text-xs text-slate-700">Co zmienił · {podsumowanie}</summary>
      {tekst}
    </details>;
  }
  return <div className="mt-1">
    <p className="text-xs text-slate-600">{podsumowanie}</p>
    {tekst}
  </div>;
}
