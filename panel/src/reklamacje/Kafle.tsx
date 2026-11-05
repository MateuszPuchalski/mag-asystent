import React from "react";
import { ChartColumn, Clock, MessageSquare, SquareCheckBig } from "lucide-react";
import type { LicznikZTrendem, StatystykiReklamacji } from "../api/typy";
import { dniSlowo } from "../ui";

/* ── Reklamacje w liczbach (Analiza, zakres „Obsługa klienta”) ─────────────
   Cztery liczby: ile czeka na decyzję, ile na odpowiedź, ile już po terminie
   i jak szybko decydujemy. Liczy je serwer na CAŁEJ tabeli, więc próg daty
   kolejki ich nie zmienia.

   TO WGLĄD, NIE FILTR. Kolejka wybiera widok jednym rzędem kubełków
   (`Kubelki.tsx`) z liczbą listy, którą pokaże. Trend tygodnia i średni czas
   do werdyktu odpowiadają na pytanie „jak idzie”, więc stoją w Analizie.

   BRAK DANYCH TO KRESKA, NIE ZERO (`panel/CLAUDE.md`). Zero przy awarii
   serwera agent czyta jako „nic nie czeka” i kończy pracę.

   TREND TYLKO PRAWDZIWY. Gdy serwer nie umie odtworzyć stanu sprzed tygodnia,
   kafel mówi, co liczba znaczy, zamiast udawać zmianę od zera. */

/** Minus typograficzny, bo łącznik przy liczbie czyta się jak myślnik. */
const zeZnakiem = (n: number, napis: string) => `${n > 0 ? "+" : "−"}${napis}`;

/** Jedno miejsce po przecinku, po polsku — bez formatera, bo to nie data. */
const ulamek = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** „2,4 dnia”, ale „1 dzień” i „3 dni” — ułamek bierze dopełniacz. */
function dniUlamkiem(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? dniSlowo(r) : `${ulamek(r)} dnia`;
}

/** Trend tygodniowy albo zdanie opisowe, gdy trendu nie da się policzyć. */
function podpisLicznika(l: LicznikZTrendem | undefined, opis: string): string {
  if (!l) return "nie wiemy";
  if (l.tydzienTemu === null) return opis;
  const d = l.teraz - l.tydzienTemu;
  if (d === 0) return "tyle samo co tydzień temu";
  return `${zeZnakiem(d, String(Math.abs(d)))} od zeszłego tygodnia`;
}

function podpisSredniej(s: StatystykiReklamacji["sredniDniDoWerdyktu"] | undefined): string {
  if (!s) return "nie wiemy";
  if (s.teraz === null) return `brak werdyktów w ostatnich ${dniSlowo(s.okresDni)}`;
  if (s.poprzednio === null) return `z ostatnich ${dniSlowo(s.okresDni)}`;
  const d = Math.round((s.teraz - s.poprzednio) * 10) / 10;
  if (d === 0) return `tyle samo co poprzednie ${dniSlowo(s.okresDni)}`;
  return `${zeZnakiem(d, dniUlamkiem(Math.abs(d)))} od poprzednich ${dniSlowo(s.okresDni)}`;
}

interface OpisKafla {
  etykieta: string;
  wartosc: string;
  podpis: string;
  ikona: React.ReactNode;
  /** Tło i barwa kwadratu z ikoną — barwa mówi o randze, nie zdobi. */
  tonIkony: string;
  /** Barwa liczby; czerwień tylko przy pracy po terminie. */
  tonWartosci?: string;
}

function Kafel({ k }: { k: OpisKafla }) {
  /* Spacje między częściami, bo czytnik składa tekst kafla w jedno zdanie.
     Bez nich brzmiałoby „18Do decyzji”. */
  return <div className="flex min-w-0 flex-col items-start gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 break-words">
    <span className="flex items-center gap-2">
      <span aria-hidden="true"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${k.tonIkony}`}>
        {k.ikona}</span>
      <span className={`text-naglowek font-bold tabular-nums ${k.tonWartosci ?? "text-slate-900"}`}>
        {k.wartosc}</span>
    </span>{" "}
    <span className="text-xs font-semibold text-slate-800">{k.etykieta}</span>{" "}
    <span className="text-xs text-slate-600">{k.podpis}</span>
  </div>;
}

export function Kafle({ statystyki }: {
  /** `undefined` = nie wiemy: serwer milczy albo zapytanie padło. */
  statystyki?: StatystykiReklamacji;
}) {
  const s = statystyki;
  const liczba = (l?: LicznikZTrendem) => (l ? String(l.teraz) : "—");
  const kafle: OpisKafla[] = [
    { etykieta: "Do decyzji", wartosc: liczba(s?.doDecyzji),
      podpis: podpisLicznika(s?.doDecyzji, "czekają na uznanie albo odrzucenie"),
      ikona: <SquareCheckBig size={16} />, tonIkony: "bg-slate-100 text-slate-800" },
    { etykieta: "Do odpowiedzi", wartosc: liczba(s?.doOdpowiedzi),
      podpis: podpisLicznika(s?.doOdpowiedzi, "klient napisał, czeka na nas"),
      ikona: <MessageSquare size={16} />, tonIkony: "bg-sky-50 text-sky-700" },
    { etykieta: "Po terminie", wartosc: liczba(s?.poTerminie),
      podpis: podpisLicznika(s?.poTerminie, "minął termin decyzji"),
      tonWartosci: s && s.poTerminie.teraz > 0 ? "text-ranga-zle" : undefined,
      ikona: <Clock size={16} />, tonIkony: "bg-red-50 text-ranga-zle" },
    { etykieta: "Średni czas do werdyktu",
      wartosc: s?.sredniDniDoWerdyktu.teraz != null ? dniUlamkiem(s.sredniDniDoWerdyktu.teraz) : "—",
      podpis: podpisSredniej(s?.sredniDniDoWerdyktu),
      ikona: <ChartColumn size={16} />, tonIkony: "bg-emerald-50 text-ranga-ok" },
  ];
  return <div role="group" aria-label="Reklamacje w liczbach" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {kafle.map((k) => <Kafel key={k.etykieta} k={k} />)}
  </div>;
}
