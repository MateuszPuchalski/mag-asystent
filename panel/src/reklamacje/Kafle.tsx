import React from "react";
import { ChartColumn, Clock, MessageSquare, SquareCheckBig } from "lucide-react";
import type { LicznikZTrendem, StatystykiReklamacji } from "../api/typy";
import { dniSlowo } from "../ui";
import { KUBELKI } from "./Kolejka";

/* ── Kafle w kolejce: siatka 2×2 zamiast przełącznika kubełków ──────────────
   Cztery liczby, które biuro sprawdza przed pierwszą sprawą dnia: ile czeka
   na decyzję, ile na odpowiedź, ile już po terminie i jak szybko decydujemy.
   Liczy je serwer na CAŁEJ tabeli, więc próg daty kolejki ich nie zmienia.

   KAFEL JEST FILTREM I STOI W KOLEJCE. Liczba „Do decyzji” i lista spraw do
   decyzji to jedno pytanie. Dwa miejsca do jednego wyboru dają więcej decyzji,
   nie mniej (dekalog, punkt 1), więc przełącznik kubełków zszedł z ekranu.

   „PO TERMINIE” TO DO DECYZJI ZAWĘŻONE DO SPÓŹNIONYCH. Serwer liczy kafel
   właśnie tak, więc filtr pokazuje dokładnie te sprawy, które liczba obiecuje.

   WYBRANY KAFEL MA CIEMNĄ RAMKĘ, NIE BURSZTYN. Bursztyn znaczy „coś jest nie
   tak” (`Bursztyn.test.ts`), a wybór nie jest ostrzeżeniem.

   BRAK DANYCH TO KRESKA, NIE ZERO (`panel/CLAUDE.md`). Zero przy awarii
   serwera agent czyta jako „nic nie czeka” i kończy pracę.

   TREND TYLKO PRAWDZIWY. Gdy serwer nie umie odtworzyć stanu sprzed tygodnia,
   kafel mówi, co liczba znaczy, zamiast udawać zmianę od zera. */

/** Który widok kolejki kafel przestawia. */
export type FiltrKafla = "decyzja" | "odpowiedz" | "po_terminie";

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

/** Klawisz skrótu liczy się z `KUBELKI`, jak w nasłuchu ekranu. */
const klawisz = (id: string) => KUBELKI.findIndex((k) => k.id === id) + 1;

interface OpisKafla {
  etykieta: string;
  wartosc: string;
  podpis: string;
  ikona: React.ReactNode;
  /** Tło i barwa kwadratu z ikoną — barwa mówi o randze, nie zdobi. */
  tonIkony: string;
  /** Barwa liczby; czerwień tylko przy pracy po terminie. */
  tonWartosci?: string;
  /** Widok, który kafel przestawia; bez niego kafel tylko mówi. */
  filtr?: FiltrKafla;
  podpowiedz?: string;
}

function Kafel({ k, wybrany, onWybierz }: {
  k: OpisKafla; wybrany: boolean; onWybierz: (f: FiltrKafla) => void;
}) {
  /* Spacje między częściami, bo jsdom i czytnik składają nazwę przycisku
     z tekstu. Bez nich brzmiałaby „18Do decyzji”. Liczba stoi pierwsza,
     bo po niej się wybiera. */
  const tresc = <>
    <span className="flex items-center gap-2">
      <span aria-hidden="true"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${k.tonIkony}`}>
        {k.ikona}</span>
      <span className={`text-naglowek font-bold tabular-nums ${k.tonWartosci ?? "text-slate-900"}`}>
        {k.wartosc}</span>
    </span>{" "}
    <span className="text-xs font-semibold text-slate-800">{k.etykieta}</span>{" "}
    <span className="text-xs text-slate-600">{k.podpis}</span>
  </>;
  /* Ramka dwupikselowa przy KAŻDYM kaflu, zmienia się tylko barwa — wybór
     nie przesuwa treści o piksel, tak jak belka przy wierszu kolejki. */
  const rama = "flex min-w-0 flex-col items-start gap-1 rounded-xl border-2 bg-white px-2.5 py-2 text-left break-words";
  if (!k.filtr) {
    /* Kafel bez filtra nie ma cienia ani podświetlenia: nie obiecuje
       kliknięcia, którego nie ma. */
    return <div className={`${rama} border-slate-200`}>{tresc}</div>;
  }
  const filtr = k.filtr;
  return <button type="button" aria-pressed={wybrany} onClick={() => onWybierz(filtr)}
    title={k.podpowiedz}
    className={`${rama} shadow-sm hover:bg-slate-50 ${wybrany ? "border-wertis-ink" : "border-slate-200"}`}>
    {tresc}</button>;
}

export function Kafle({ statystyki, wybrany, onWybierz }: {
  /** `undefined` = nie wiemy: serwer milczy albo zapytanie padło. */
  statystyki?: StatystykiReklamacji;
  /** Widok kolejki, któremu odpowiada kafel; `null`, gdy żaden kafel nie pasuje. */
  wybrany: FiltrKafla | null;
  onWybierz: (f: FiltrKafla) => void;
}) {
  const s = statystyki;
  const liczba = (l?: LicznikZTrendem) => (l ? String(l.teraz) : "—");
  const kafle: OpisKafla[] = [
    { etykieta: "Do decyzji", wartosc: liczba(s?.doDecyzji), filtr: "decyzja",
      podpowiedz: `Pokaż w kolejce: Do decyzji (klawisz ${klawisz("decyzja")})`,
      podpis: podpisLicznika(s?.doDecyzji, "czekają na uznanie albo odrzucenie"),
      ikona: <SquareCheckBig size={16} />, tonIkony: "bg-slate-100 text-slate-800" },
    { etykieta: "Do odpowiedzi", wartosc: liczba(s?.doOdpowiedzi), filtr: "odpowiedz",
      podpowiedz: `Pokaż w kolejce: Do odpowiedzi (klawisz ${klawisz("odpowiedz")})`,
      podpis: podpisLicznika(s?.doOdpowiedzi, "klient napisał, czeka na nas"),
      ikona: <MessageSquare size={16} />, tonIkony: "bg-sky-50 text-sky-700" },
    { etykieta: "Po terminie", wartosc: liczba(s?.poTerminie), filtr: "po_terminie",
      podpowiedz: "Pokaż w kolejce: Do decyzji po terminie",
      podpis: podpisLicznika(s?.poTerminie, "minął termin decyzji"),
      tonWartosci: s && s.poTerminie.teraz > 0 ? "text-ranga-zle" : undefined,
      ikona: <Clock size={16} />, tonIkony: "bg-red-50 text-ranga-zle" },
    { etykieta: "Średni czas do werdyktu",
      wartosc: s?.sredniDniDoWerdyktu.teraz != null ? dniUlamkiem(s.sredniDniDoWerdyktu.teraz) : "—",
      podpis: podpisSredniej(s?.sredniDniDoWerdyktu),
      ikona: <ChartColumn size={16} />, tonIkony: "bg-emerald-50 text-ranga-ok" },
  ];
  return <div role="group" aria-label="Reklamacje w liczbach" className="grid grid-cols-2 gap-2">
    {kafle.map((k) => <Kafel key={k.etykieta} k={k}
      wybrany={k.filtr !== undefined && k.filtr === wybrany} onWybierz={onWybierz} />)}
  </div>;
}
