import React from "react";
import { MessageSquare, Scale, Undo2, MessagesSquare } from "lucide-react";
import { Link } from "react-router-dom";
import { czas } from "../ui";
import type { PrzystanekDrogi, SprawaZakupu } from "../api/typy";

/* ── Spoiwo kolejek na ekranie (`docs/obsluga-klienta-calosc.md`) ────────────
   JEDEN komponent dla czterech ekranów, nie cztery podobne. Agent czyta ten
   sam blok w skrzynce, w zwrocie, w reklamacji i w dyskusji, więc rozpoznaje
   go bez uczenia się drugiego układu — to punkt 3 dekalogu: kontekst wchodzi
   za sprawą, nie za ekranem.

   Odnośniki idą przez `Link`, nie przez `<a href>`, i to jest różnica
   widoczna w pracy: gołe `href` przeładowuje stronę, więc wspólny cache
   zapytań startuje od zera i cała skrzynka dociąga się drugi raz. Kupiliśmy
   ten cache ośmioma zależnościami (`docs/obsluga-klienta.md`, pytanie 7)
   i nie ma powodu wyrzucać go przy przejściu między kolejkami.

   Blok jest CZYTANIEM, nigdy pracą. Werdykt, kwota i ocena zostają na ekranie
   właściwej kolejki, bo tam stoją ich bramki; stąd prowadzi wyłącznie
   odnośnik. Praca rozlana po czterech ekranach byłaby piątą kolejką. */

/** Jak nazywa się przystanek i dokąd prowadzi — jedno miejsce na cztery. */
const KOLEJKI = {
  rozmowa: { nazwa: "pytanie", ikona: MessageSquare, sciezka: "/obsluga/skrzynka" },
  dyskusja: { nazwa: "dyskusja", ikona: MessagesSquare, sciezka: "/obsluga/dyskusje" },
  reklamacja: { nazwa: "reklamacja", ikona: Scale, sciezka: "/obsluga/reklamacje" },
  zwrot: { nazwa: "zwrot", ikona: Undo2, sciezka: "/obsluga/zwroty" },
} as const;

/** Dyskusja czy reklamacja — rozstrzyga kolumna `typ`, nigdy jedna plakietka. */
const rodzajSprawy = (typ: string): "dyskusja" | "reklamacja" =>
  (typ === "DISPUTE" ? "dyskusja" : "reklamacja");

/**
 * Reklamacje i dyskusje tego zakupu.
 *
 * Sprawa OTWARTA dostaje mocniejszy wiersz, bo o nią chodzi: zamknięta jest
 * tłem, a otwarta znaczy, że klient czeka gdzie indziej na ruch. Sygnał jest
 * JEDEN — kolor zapalany zawsze uczy go ignorować.
 */
export function SprawyZakupu({ sprawy }: { sprawy: SprawaZakupu[] }) {
  if (sprawy.length === 0) return null;
  return <section className="border-b bg-slate-50 px-4 py-3 text-sm"
    aria-label="Sprawy posprzedażowe tego zakupu">
    <div className="flex items-center gap-2">
      <Scale size={15} className="text-slate-500" />
      <b>Sprawy tego zakupu</b>
      <span className="text-xs text-slate-500">{sprawy.length}</span>
    </div>
    <ul className="mt-2 space-y-1">
      {sprawy.map((s) => {
        const rodzaj = rodzajSprawy(s.typ);
        const { nazwa, sciezka } = KOLEJKI[rodzaj];
        return <li key={s.id}
          className={`flex flex-wrap items-baseline gap-2 rounded px-2 py-1 text-xs ${
            s.otwarta ? "bg-white font-semibold" : "bg-transparent text-slate-500"}`}>
          <span className="rounded bg-wertis-ink px-1.5 py-0.5 text-podpis font-bold text-white">
            {nazwa}</span>
          {s.numer && <span className="font-mono text-slate-600">{s.numer}</span>}
          <span className="truncate">{s.temat ?? "bez tematu"}</span>
          {/* Termin mówi tylko wtedy, gdy jest: dyskusja go nie ma z definicji
              (§25c.1), a wymyślony zegar kazałby gonić pracę bez terminu. */}
          {s.decyzjaDo && <span className="shrink-0 text-ranga-zle">termin {czas(s.decyzjaDo)}</span>}
          {s.prowadzi && <span className="shrink-0 text-slate-500">{s.prowadzi}</span>}
          {!s.otwarta && <span className="shrink-0">zamknięta</span>}
          <Link to={`${sciezka}/${s.id}`}
            className="ml-auto shrink-0 font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
            Otwórz</Link>
        </li>;
      })}
    </ul>
  </section>;
}

/**
 * Droga zakupu przez kolejki — pytanie, dyskusja, reklamacja, zwrot.
 *
 * JEDEN WIERSZ, nie druga oś czasu. Oś sprawy wisi przy źródle (blizna
 * 0.130.0), a ten pasek odpowiada na jedno pytanie: którędy ta sprawa już
 * szła. Przy jednym przystanku nie pokazuje się wcale — droga z jednego
 * punktu nie jest drogą.
 */
export function DrogaZakupu({ droga, tutaj }: {
  droga: PrzystanekDrogi[];
  /** Przystanek, na którym stoi agent — podświetlony jako „jesteś tutaj". */
  tutaj?: { rodzaj: PrzystanekDrogi["rodzaj"]; id: number };
}) {
  if (droga.length < 2) return null;
  return <section className="border-b bg-white px-4 py-2" aria-label="Droga tego zakupu">
    <ol className="flex flex-wrap items-center gap-1 text-xs">
      {droga.map((p, i) => {
        const { nazwa, ikona: Ikona, sciezka } = KOLEJKI[p.rodzaj];
        const jestem = tutaj?.rodzaj === p.rodzaj && tutaj.id === p.id;
        return <li key={`${p.rodzaj}-${p.id}`} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden className="text-slate-300">→</span>}
          {jestem
            ? <span className="inline-flex items-center gap-1 rounded bg-wertis-ink px-1.5 py-0.5 font-bold text-white">
                <Ikona size={12} />{nazwa}<span className="font-normal">{czas(p.at)}</span></span>
            : <Link to={`${sciezka}/${p.id}`}
                className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 hover:bg-slate-200">
                <Ikona size={12} />{nazwa}<span className="text-slate-500">{czas(p.at)}</span></Link>}
        </li>;
      })}
    </ol>
  </section>;
}
