import React, { useState } from "react";
import { Lock, UserX } from "lucide-react";
import type { SzczegolyKonfliktu } from "../api/typy";
import { Przycisk } from "../ui";

/**
 * Przegrany wyścig o przejęcie (§6.2).
 *
 * Przejęcie jest atomowe: zapisze się jedno. Ekran ma powiedzieć TRZY rzeczy,
 * bo bez nich zostaje goły komunikat błędu — kto prowadzi, kiedy przejął
 * i na której wersji stoi rozmowa wobec tej, którą niosło żądanie.
 */
export function KonfliktPrzejecia({ szczegoly, mojaWersja, czasPrzejecia, mozeWymusic,
  wymusza, blad, onPoprosOPrzekazanie, onWymus, onZamknij }: {
  szczegoly: SzczegolyKonfliktu;
  mojaWersja: number;
  czasPrzejecia: string | null;
  mozeWymusic: boolean;
  wymusza: boolean;
  blad: string;
  onPoprosOPrzekazanie: () => void;
  onWymus: (powod: string) => void;
  onZamknij: () => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [powod, setPowod] = useState("");
  const wlasciciel = szczegoly.assignedUserName ?? "inny agent";

  return <div className="shrink-0 border-b border-amber-200 bg-amber-50 p-4">
    <div className="flex items-start gap-3">
      <UserX className="mt-0.5 text-ranga-uwaga" size={18} />
      <div className="flex-1">
        <b className="text-ranga-uwaga">Nie udało się przejąć — rozmowę prowadzi {wlasciciel}</b>
        <p className="mt-1 text-sm text-amber-900">
          Przejęcie jest atomowe: zapisze się jedno. {wlasciciel} był wcześniej, więc Twoje
          żądanie zostało odrzucone, zanim cokolwiek zmieniło.
        </p>
      </div>
      <button className="text-sm text-slate-500 underline" onClick={onZamknij}>Ukryj</button>
    </div>

    <dl className="mt-3 grid gap-2 sm:grid-cols-3">
      {[["Właściciel", wlasciciel],
        ["Przejęcie o", czasPrzejecia ?? "—"],
        ["Wersja rozmowy", `${szczegoly.version ?? "?"} · Twoje żądanie niosło ${mojaWersja}`],
      ].map(([nazwa, wartosc]) => <div key={nazwa} className="rounded-lg border border-amber-200 bg-white p-2">
        <dt className="text-[11px] uppercase tracking-wide text-slate-500">{nazwa}</dt>
        <dd className="text-sm font-semibold">{wartosc}</dd>
      </div>)}
    </dl>

    <div className="mt-3 flex flex-wrap gap-2">
      <Przycisk onClick={onPoprosOPrzekazanie}>Poproś {wlasciciel} o przekazanie</Przycisk>
      {/* Wymuszenie zdejmuje sprawę komuś Z RĄK, więc widzi je wyłącznie
          administrator — i wyłącznie z powodem wpisanym z ręki. */}
      {mozeWymusic && <Przycisk onClick={() => setOtwarte(!otwarte)}>
        <Lock size={14} />{otwarte ? "ANULUJ WYMUSZENIE" : "WYMUŚ PRZEKAZANIE"}</Przycisk>}
    </div>

    {otwarte && <div className="mt-3 rounded-lg border border-amber-300 bg-white p-3">
      <b className="text-sm">Wymuszone przekazanie wymaga powodu</b>
      <p className="mt-1 text-xs text-slate-500">
        Powód trafia do dziennika razem z autorem, czasem oraz wersją rozmowy przed i po.
        Bez powodu operacja nie przejdzie.
      </p>
      <textarea className="field mt-2 min-h-16" value={powod} aria-label="Powód wymuszenia"
        onChange={(e) => setPowod(e.target.value)}
        placeholder="Np. M. Wójcik na urlopie od dziś, klient czeka po terminie" />
      {blad && <p className="mt-2 text-sm text-red-700">{blad}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <Przycisk onClick={() => setOtwarte(false)}>Anuluj</Przycisk>
        <Przycisk wariant="glowny" disabled={!powod.trim() || wymusza}
          onClick={() => onWymus(powod)}>WYMUŚ I ZAPISZ POWÓD</Przycisk>
      </div>
    </div>}
  </div>;
}
