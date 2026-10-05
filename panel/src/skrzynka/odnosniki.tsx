import React from "react";
import { ExternalLink } from "lucide-react";
import { ZnakAllegro } from "../ui/ZnakAllegro";

/* ── TRZY KSZTAŁTY ODNOŚNIKA W KOLUMNIE KONTEKSTU ───────────────────────────
   W kolumnie stało siedem zapisów odnośnika: błękit z podkreśleniem i bez,
   ciemniejszy błękit, atrament z podkreśleniem, szarość. Agent nie miał jak
   odróżnić ruchu w panelu od poprawki i od wyjścia na zewnątrz.

   Teraz kształt mówi, dokąd prowadzi klik. Błękit z podkreśleniem znaczy
   pracę w panelu. Szarość z podkreśleniem znaczy poprawkę albo rozwinięcie
   tekstu. Znak Allegro znaczy wyjście poza panel. Wyjście cichnie, bo to
   nawigacja, a nie treść, i nie ma ciągnąć wzroku mocniej niż nazwa towaru. */

/** Ruch w panelu: „to ta paczka", „Wskaż jako ofertę rozmowy", „Otwórz w Zwrotach". */
export const ODNOSNIK = "font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900 disabled:opacity-50";

/** Poprawka i rozwinięcie tekstu: „wskaż inną kartotekę", „pokaż cały opis", „to nie ta paczka?". */
export const ODNOSNIK_CICHY = "text-slate-500 underline underline-offset-2 hover:text-slate-800";

/**
 * Wyjście do Allegro. Znak zastępuje wyraz „Allegro", bo to logotyp słowny,
 * a dostępną nazwę niesie `aria-label`. Bez podkreślenia, bo kreska pod
 * znakiem graficznym wygląda jak usterka.
 */
export function OdnosnikAllegro({ href, etykieta }: { href: string; etykieta: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={etykieta}
    className="inline-flex items-center gap-1 text-podpis font-semibold text-slate-500 hover:text-slate-800">
    Otwórz w <ZnakAllegro wysokosc={10} /><ExternalLink size={11} aria-hidden /></a>;
}
