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

  /* ── ZABLOKOWANA ŚCIEŻKA TO JEDNA LINIA, NIE PRZYCISK ───────────────────
     Wyłączony zielony przycisk na całą szerokość zajmował około 85 px nad
     jedyną realną drogą („Przyjmij", która w tym stanie jest główna) i wyglądał
     jak coś do kliknięcia. Wyłączony przycisk nie jest drogą — to samo mówi
     komentarz w `Decyzje.tsx` o „Przyjmij". Zostaje powód, bo bez niego
     operator nie wiedziałby, czemu skrót nie działa.

     Sama WYKONALNOŚĆ się nie zmienia: ciąg odmawia przy przeszkodzie w
     `szybkiZwrot` (ekran), a skrót `W` przechodzi przez tę samą odmowę.
     Błąd z przerwanego ciągu zostaje widoczny także tutaj: po częściowym
     zapisie reguła potrafi przejść w „zablokowane" i zdanie o tym, co się
     zatrzymało, nie ma prawa zniknąć razem z przyciskiem. */
  if (stan.przeszkoda !== null) {
    return <div data-szybka-zablokowana=""
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
      <p className="flex items-start gap-2">
        <Zap size={14} aria-hidden="true" className="mt-px shrink-0" />
        <span><b>Wszystko OK niedostępne:</b> {stan.przeszkoda}</span>
      </p>
      {blad && <p role="alert" className="mt-1 text-red-700">{blad}</p>}
    </div>;
  }

  return <div className="border-b border-emerald-200 bg-emerald-50 p-4">
    <Przycisk wariant="glowny" disabled={trwa} onClick={onStart}
      className="w-full justify-center py-2 text-base">
      <kbd className="rounded border border-black/20 px-1 text-xs">W</kbd>
      <Zap size={16} aria-hidden="true" />
      {trwa ? "Przyjmuję…" : `Wszystko OK — na półkę i oddaj ${zlote(suma, zwrot.waluta)}`}
    </Przycisk>
    {/* Co przycisk zrobi — jednym zdaniem, bo robi kilka rzeczy naraz,
        a każda z nich zostawia ślad na osi zwrotu. */}
    <p className="mt-1 text-xs text-slate-600">
      {zwrot.werdykt === "przyjety" ? "" : "Przyjmie zwrot, "}
      {nieocenione ? `${nieocenione} poz. na stan, ` : ""}
      zapisze kwotę bez dostawy i otworzy zwrot w Allegro do wypłaty.</p>
    {blad && <p role="alert" className="mt-1 text-xs text-red-700">{blad}</p>}
  </div>;
}
