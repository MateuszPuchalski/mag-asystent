import React from "react";
import { Zap } from "lucide-react";
import type { Zwrot } from "../api/typy";
import { zlote } from "../api/zwroty";
import { Przycisk } from "../ui";
import type { SzybkaSciezka } from "./regulaSzybkiej";

/**
 * Przycisk szybkiej ścieżki (0.481.0) — reguła stoi w `regulaSzybkiej.ts`.
 *
 * KWOTA STOI NA PRZYCISKU, bo to jedyna liczba, która wychodzi do klienta.
 * Kto naciska „wszystko w porządku", ma widzieć, ile to jest, zanim naciśnie
 * — tak samo jak przy zapisie kwoty ręcznie.
 */
export function SzybkiZwrot({ zwrot, stan, trwa, blad, onStart }: {
  zwrot: Zwrot;
  stan: SzybkaSciezka;
  trwa: boolean;
  blad: string;
  onStart: () => void;
}) {
  if (!stan.pokaz) return null;
  /* Sama suma pozycji, BEZ dostawy (0.484.5) — ta sama liczba, którą ciąg
     zapisze. Kwota na przycisku i kwota w bazie nie mogą się rozjechać. */
  const suma = zwrot.pozycje.reduce((s, p) => s + Math.round(p.cenaGrosze * p.ilosc), 0);
  const nieocenione = zwrot.pozycje.filter((p) => p.ocena === null).length;

  return <div className="border-b border-emerald-200 bg-emerald-50 p-4">
    <Przycisk wariant="glowny" disabled={trwa || stan.przeszkoda !== null} onClick={onStart}
      className="w-full justify-center py-2 text-base">
      <kbd className="rounded border border-black/20 px-1 text-xs">W</kbd>
      <Zap size={16} aria-hidden="true" />
      {trwa ? "Przyjmuję…" : `Wszystko OK — na półkę i oddaj ${zlote(suma, zwrot.waluta)}`}
    </Przycisk>
    {/* Co przycisk zrobi — jednym zdaniem, bo robi kilka rzeczy naraz,
        a każda z nich zostawia ślad na osi zwrotu. */}
    {stan.przeszkoda
      ? <p className="mt-1 text-xs text-amber-900">{stan.przeszkoda}</p>
      : <p className="mt-1 text-xs text-slate-600">
          {zwrot.werdykt === "przyjety" ? "" : "Przyjmie zwrot, "}
          {nieocenione ? `${nieocenione} poz. na stan, ` : ""}
          zapisze kwotę bez dostawy i otworzy zwrot w Allegro do wypłaty.</p>}
    {blad && <p role="alert" className="mt-1 text-xs text-red-700">{blad}</p>}
  </div>;
}
