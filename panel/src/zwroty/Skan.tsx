import React, { useState } from "react";
import { ScanLine, Search } from "lucide-react";
import type { WynikSkanu } from "../api/zwroty";

/* ── Pole skanu etykiety zwrotnej (0.163.0) ──────────────────────────────────
   Paczka wraca do biura wcześniej niż wiedza o tym, który to zwrot. Czytnik
   USB pisze prosto w ekran (`useSkaner`), więc typowe użycie NIE WYMAGA nawet
   kliknięcia w to pole — jest tu dla tych, którzy wolą wpisać numer ręcznie,
   i po to, żeby było widać, że skanowanie w ogóle istnieje.

   Komunikaty mówią, CZEGO szukano. „Nie znalazłem" bez tej informacji wygląda
   przy czytniku identycznie jak zepsuty czytnik.                            */

export function Skan({ wynik, kod, szuka, dociaga, blad, onKod, onSzukaj, onDociagnij, onWybierz }: {
  wynik: WynikSkanu | null;
  kod: string;
  szuka: boolean;
  dociaga: boolean;
  blad: string;
  onKod: (v: string) => void;
  onSzukaj: (kod: string) => void;
  onDociagnij: (kod: string) => void;
  onWybierz: (id: number) => void;
}) {
  const [reczne, setReczne] = useState("");
  const brak = wynik?.trafienie === null;
  const wiele = wynik?.trafienie === "wiele";

  return <div className="border-b border-slate-200 p-2">
    <div className="flex items-center gap-2">
      <ScanLine size={16} className="shrink-0 text-slate-400" />
      <input
        className="field h-8 flex-1 text-sm"
        placeholder="Zeskanuj etykietę albo wpisz numer"
        value={reczne}
        onChange={(e) => setReczne(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const v = reczne.trim();
          if (!v) return;
          onKod(v);
          onSzukaj(v);
        }}
      />
      {szuka && <span className="text-xs text-slate-500">Szukam…</span>}
    </div>

    {/* Kod pokazujemy przy KAŻDYM wyniku: operator ma widzieć, co czytnik
        naprawdę wpisał, gdy naklejka jest pomięta albo skan urwany. */}
    {brak && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
      <p>Nie znam kodu <b className="break-all font-mono">{kod}</b>.</p>
      <p className="mt-1 text-amber-800">
        Szukałem po numerze listu, numerze zwrotu i identyfikatorze z Allegro.
        Paczka bywa u nas szybciej niż zwrot.</p>
      <button type="button" disabled={dociaga}
        onClick={() => onDociagnij(kod)}
        className="btn-secondary mt-2 inline-flex items-center gap-1 text-xs">
        <Search size={12} />{dociaga ? "Pytam Allegro…" : "Poszukaj w Allegro"}
      </button>
    </div>}

    {/* Dwa trafienia to brak trafienia — wybiera człowiek, patrząc na oba. */}
    {wiele && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
      <p>Ten kod pasuje do {wynik.zwroty.length} zwrotów. Wskaż właściwy:</p>
      <ul className="mt-1 space-y-1">
        {wynik.zwroty.map((z) => <li key={z.id}>
          <button type="button" onClick={() => onWybierz(z.id)}
            className="font-semibold text-sky-700 underline underline-offset-2">
            {z.numer ?? z.externalId}</button>
        </li>)}
      </ul>
    </div>}

    {blad && <p className="mt-2 text-xs text-red-700">{blad}</p>}
  </div>;
}
