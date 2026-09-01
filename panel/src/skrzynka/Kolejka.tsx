import React from "react";
import { Inbox, RefreshCw, UserCheck } from "lucide-react";
import type { Rozmowa, StanSkrzynki } from "../api/typy";
import { czas } from "../ui";

/* Kolejka pokazuje moment ostatniej synchronizacji, bo pusta lista o 9:00
   znaczy co innego, gdy synchronizator stanął o 6:00, a co innego, gdy
   przebiegł minutę temu. Bez tej daty ekran kłamałby ciszą. */
export function Kolejka({ rozmowy, stan, wybranaId, onWybierz, onOdswiez, laduje }: {
  rozmowy: Rozmowa[];
  stan: StanSkrzynki;
  wybranaId: number | null;
  onWybierz: (id: number) => void;
  onOdswiez: () => void;
  laduje: boolean;
}) {
  return <section className="card flex max-h-[75vh] flex-col overflow-hidden">
    <header className="flex items-center gap-2 border-b p-4">
      <Inbox size={18} /><b className="mr-auto">Rozmowy</b>
      <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onOdswiez}
        title="Odśwież" aria-label="Odśwież"><RefreshCw size={16} /></button>
    </header>
    <p className="border-b bg-slate-50 px-4 py-2 text-xs text-slate-500">
      Ostatnia synchronizacja: {czas(stan.ostatniaSynchronizacja)}
      {stan.bledy > 0 && <span className="ml-2 font-bold text-amber-700">błędów: {stan.bledy}</span>}
    </p>
    <div className="flex-1 overflow-y-auto">
      {laduje && <p className="p-4 text-sm text-slate-500">Wczytuję…</p>}
      {!laduje && !rozmowy.length &&
        <p className="p-4 text-sm text-slate-500">Brak rozmów w zsynchronizowanej skrzynce.</p>}
      {rozmowy.map((r) => <button key={r.id} onClick={() => onWybierz(r.id)}
        aria-current={wybranaId === r.id}
        className={`block w-full border-b p-4 text-left hover:bg-slate-50 ${
          wybranaId === r.id ? "border-l-[3px] border-l-wertis-amber bg-amber-50" : ""}`}>
        <div className="flex items-center gap-2">
          <b className="truncate">{r.klient}</b>
          {r.nieprzeczytana &&
            <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-bold">NOWE</span>}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{r.ostatniaWiadomosc}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
          <span>{czas(r.ostatniaWiadomoscAt)}</span>
          {r.wlasciciel && <span className="flex items-center gap-1 font-semibold text-slate-600">
            <UserCheck size={12} />{r.wlasciciel}</span>}
        </div>
      </button>)}
    </div>
  </section>;
}
