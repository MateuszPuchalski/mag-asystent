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
 * Sam tekst różnicy, bez podsumowania.
 *
 * Dopisane słowa stoją na zielonym tle, skreślone przekreślone na czerwonym.
 * Sama barwa nie wystarcza (WCAG 1.4.1), więc skreślenie ma kreskę, a czytnik
 * ekranu dostaje słowo „dodano” albo „usunięto” przed każdym kawałkiem.
 *
 * Dopisanie tuż za skreśleniem, bez odstępu na styku, dostaje margines.
 * Różnica przenosi odstęp na styk, gdy go ma skąd wziąć, ale tekst bez
 * odstępu po obu stronach sklejałby „ogniwami.dziękujemy” w jedno słowo.
 */
export function TekstRoznicy({ przed, po }: { przed: string; po: string }) {
  const kawalki = React.useMemo(() => roznicaSlow(przed, po), [przed, po]);
  return <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800" data-testid="roznica-szkicu">
    {kawalki.map((k, i) => {
      if (k.rodzaj === "wspolne") return <React.Fragment key={i}>{k.tekst}</React.Fragment>;
      if (k.rodzaj === "usuniete") {
        return <del key={i} className="bg-red-50 text-red-800 line-through">
          <span className="sr-only">usunięto: </span>{k.tekst}</del>;
      }
      const poprzedni = kawalki[i - 1];
      const styk = poprzedni?.rodzaj === "usuniete" && !/\s$/.test(poprzedni.tekst) && !/^\s/.test(k.tekst);
      return <ins key={i} className={`bg-emerald-100 text-emerald-900 no-underline${styk ? " ml-1" : ""}`}>
        <span className="sr-only">dodano: </span>{k.tekst}</ins>;
    })}
  </p>;
}

/**
 * Różnica dwóch wersji szkicu z podsumowaniem nad tekstem.
 *
 * `zwinieta` chowa tekst pod podsumowaniem. Czyta się go rzadko, a pięćset
 * rozwiniętych znaków spychałoby resztę bloku w dół.
 */
export function RoznicaSzkicu({ przed, po, zwinieta = false }: {
  przed: string;
  po: string;
  zwinieta?: boolean;
}) {
  const podsumowanie = React.useMemo(() => podsumowanieZmian(przed, po), [przed, po]);
  if (zwinieta) {
    return <details className="mt-1">
      <summary className="cursor-pointer text-xs text-slate-700">Co zmienił · {podsumowanie}</summary>
      <TekstRoznicy przed={przed} po={po} />
    </details>;
  }
  return <div className="mt-1">
    <p className="text-xs text-slate-600">{podsumowanie}</p>
    <TekstRoznicy przed={przed} po={po} />
  </div>;
}
