import React from "react";
import { ile } from "../ui";
import type { MiejsceZmiany } from "./roznica";

/**
 * POPRAWKA COPILOTA NAŁOŻONA NA POLE ODPOWIEDZI.
 *
 * Zgłoszenie właściciela: „poprawki powinny być w inteligentny sposób
 * nałożone na szkic, żeby nie tworzyć kolejnego bloku”. Po poleceniu
 * w dopytaniu nowa wersja wchodziła do pola, a pod nim stał drugi raz cały
 * tekst z różnicą słów. Agent czytał więc ten sam szkic dwa razy, w dwóch
 * miejscach, i szukał zmian w tym, którego nie wyśle.
 *
 * Teraz zmiany widać w samym polu. Pod przezroczystym polem leży lustro:
 * ten sam tekst, ta sama typografia i zawijanie, ale litery przezroczyste.
 * Dopisane fragmenty mają w lustrze zielone tło, które prześwituje przez
 * pole. Pole zostaje zwykłym polem: kursor, zaznaczanie i pisanie działają
 * jak zawsze, bo lustro nie łapie myszy i nie ma go w drzewie dostępności.
 *
 * Skreśleń nie wstawiamy do lustra. Każdy znak, którego nie ma w polu,
 * przesunąłby zawijanie i rozjechał podświetlenie z tekstem. Miejsce
 * skreślenia ma cienką czerwoną kreskę z cienia, która nie zajmuje miejsca
 * w linii, a skreślony tekst wymienia lista pod „Pokaż usunięte”.
 */

/** Barwa kreski skreślenia: `red-600`, ta sama co skreślenie w różnicy słów. */
const KRESKA_LEWA = "shadow-[inset_2px_0_0_#dc2626]";
const KRESKA_PRAWA = "shadow-[inset_-2px_0_0_#dc2626]";

const slowa = (t: string) => (t.match(/\S+/g) ?? []).length;
const skreslenie = (m: MiejsceZmiany) => m.usuniete.trim() !== "";

/**
 * Lustro pola: tekst przezroczysty, dopisane na zielonym tle, kreski skreśleń.
 *
 * Klasy odstępów i pisma podaje wołający, bo muszą być TE SAME co w polu.
 * Różnica jednego piksela w dopełnieniu przesuwa zawijanie całego akapitu.
 */
export const LustroPoprawki = React.forwardRef<HTMLDivElement, {
  tekst: string;
  miejsca: MiejsceZmiany[];
  className: string;
}>(function LustroPoprawki({ tekst, miejsca, className }, ref) {
  const czesci = React.useMemo(() => kawalkiLustra(tekst, miejsca), [tekst, miejsca]);
  return <div ref={ref} aria-hidden="true" data-testid="lustro-poprawki"
    className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent ${className}`}>
    {czesci.map((c, i) => {
      const kreska = c.kreska === "lewa" ? KRESKA_LEWA : c.kreska === "prawa" ? KRESKA_PRAWA : "";
      if (c.dodane) {
        return <mark key={i} data-kreska={c.kreska ?? undefined}
          className={`bg-emerald-100 text-transparent ${kreska}`}>{c.tekst}</mark>;
      }
      if (c.kreska) return <span key={i} data-kreska={c.kreska} className={kreska}>{c.tekst}</span>;
      return <React.Fragment key={i}>{c.tekst}</React.Fragment>;
    })}
    {/* Pusta ostatnia linia pola ma wysokość, a w lustrze bez znaku by jej
        nie było. Przewinięte do końca pole rozjechałoby się wtedy z lustrem. */}
    {tekst.endsWith("\n") && "​"}
  </div>;
});

type KawalekLustra = { tekst: string; dodane: boolean; kreska: "lewa" | "prawa" | null };

/**
 * Tekst pola pocięty na kawałki lustra.
 *
 * Tło dopisanego obejmuje słowa, nie odstępy na brzegach: zielona nowa linia
 * na końcu zakresu wyglądałaby jak pusty pasek. Kreska skreślenia stoi przy
 * pierwszym znaku za skreśleniem, a na końcu tekstu przy ostatnim przed nim.
 */
function kawalkiLustra(tekst: string, miejsca: MiejsceZmiany[]): KawalekLustra[] {
  const dodane = new Uint8Array(tekst.length);
  const kreski = new Map<number, "lewa" | "prawa">();
  for (const m of miejsca) {
    let od = m.od;
    let doo = m.do;
    while (od < doo && /\s/.test(tekst[od])) od++;
    while (doo > od && /\s/.test(tekst[doo - 1])) doo--;
    dodane.fill(1, od, doo);
    if (!skreslenie(m)) continue;
    let z = m.od;
    while (z < tekst.length && /\s/.test(tekst[z])) z++;
    if (z < tekst.length) { kreski.set(z, "lewa"); continue; }
    z = m.od - 1;
    while (z >= 0 && /\s/.test(tekst[z])) z--;
    if (z >= 0) kreski.set(z, "prawa");
  }
  const wynik: KawalekLustra[] = [];
  for (let i = 0; i < tekst.length; i++) {
    const kreska = kreski.get(i) ?? null;
    const d = dodane[i] === 1;
    const ostatni = wynik[wynik.length - 1];
    if (ostatni && !kreska && !ostatni.kreska && ostatni.dodane === d) ostatni.tekst += tekst[i];
    else wynik.push({ tekst: tekst[i], dodane: d, kreska });
  }
  return wynik;
}

/** Zdanie dla czytnika ekranu przy polu: lustro jest dla oczu. */
export function opisPoprawki(tekst: string, miejsca: MiejsceZmiany[]): string {
  const dopisane = miejsca.reduce((s, m) => s + slowa(tekst.slice(m.od, m.do)), 0);
  const skreslone = miejsca.reduce((s, m) => s + slowa(m.usuniete), 0);
  const czesci = [ile(miejsca.length, "zmiana", "zmiany", "zmian")];
  if (dopisane > 0) czesci.push(`dopisane ${ile(dopisane, "słowo", "słowa", "słów")}`);
  if (skreslone > 0) czesci.push(`skreślone ${ile(skreslone, "słowo", "słowa", "słów")}`);
  const lista = miejsca.some(skreslenie) ? " Skreślone fragmenty wymienia przycisk „Pokaż usunięte” nad polem." : "";
  return `W polu jest poprawka Copilota: ${czesci.join(", ")}.${lista}`;
}

/** Skreślenie skrócone do jednej linijki listy: pełny akapit zasłoniłby pole. */
function skrot(t: string): string {
  const jedna = t.replace(/\s+/g, " ").trim();
  return jedna.length > 160 ? `${jedna.slice(0, 159)}…` : jedna;
}

/**
 * „Copilot zmienił N miejsc” i przełącznik listy skreśleń, w pasku nad polem.
 *
 * Kreska w polu mówi GDZIE coś zniknęło, ale nie CO. Podpowiedź na kresce
 * nie wystarcza: nie dojdzie do niej klawiatura ani czytnik. Stąd lista pod
 * przyciskiem, z każdym skreśleniem w `<del>`.
 */
export function LiniaPoprawki({ miejsca, otwarte, onPrzelacz, idListy }: {
  miejsca: MiejsceZmiany[];
  otwarte: boolean;
  onPrzelacz: () => void;
  idListy: string;
}) {
  return <>
    <span className="text-slate-700">Copilot zmienił {ile(miejsca.length, "miejsce", "miejsca", "miejsc")}</span>
    {miejsca.some(skreslenie) && <button type="button" aria-expanded={otwarte} aria-controls={idListy}
      onClick={onPrzelacz}
      className="min-h-6 rounded px-1 font-semibold text-violet-900 hover:bg-violet-100 hover:underline">
      {otwarte ? "Ukryj usunięte" : "Pokaż usunięte"}</button>}
  </>;
}

/** Lista skreśleń, rozwijana z `LiniaPoprawki`. Pełna szerokość paska. */
export function ListaUsunietych({ miejsca, id }: { miejsca: MiejsceZmiany[]; id: string }) {
  return <ul id={id} aria-label="Fragmenty usunięte przez Copilota"
    className="basis-full space-y-0.5 pl-1 text-xs text-red-800">
    {miejsca.filter(skreslenie).map((m, i) => <li key={i}>
      <del className="line-through"><span className="sr-only">usunięto: </span>{skrot(m.usuniete)}</del>
    </li>)}
  </ul>;
}
