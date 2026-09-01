import React from "react";
import { AlertTriangle, Bell, Inbox, Ruler, UserCheck } from "lucide-react";
import { Wyszukiwarka, type Towar } from "../wyszukiwarka";
import type { OsRozmowy } from "../api/typy";
import { Przycisk, Pusto } from "../ui";
import { Os } from "./Os";
import { Edytor } from "./Edytor";

export function Rozmowa(p: {
  dane: OsRozmowy | undefined;
  mojeId: number | null;
  nowaWiadomosc: boolean;
  szkic: string;
  zapisuje: boolean;
  zrodloPomiaru: number | null;
  wskazowka: string;
  towar: Towar | null;
  onPrzejmij: () => void;
  onPokazNowa: () => void;
  onSzkic: (v: string) => void;
  onZapiszSzkic: () => void;
  onZrodlo: (id: number | null) => void;
  onWskazowka: (v: string) => void;
  onTowar: (t: Towar | null) => void;
  onZlec: () => void;
}) {
  if (!p.dane) {
    return <section className="card flex max-h-[75vh] flex-col overflow-hidden">
      <Pusto ikona={<Inbox size={38} />}>Wybierz rozmowę z listy</Pusto>
    </section>;
  }
  const { rozmowa, os } = p.dane;
  const moja = rozmowa.wlascicielId !== null && rozmowa.wlascicielId === p.mojeId;
  const cudza = rozmowa.wlascicielId != null && rozmowa.wlascicielId !== p.mojeId;
  /* Pytanie bez numeru oferty mówi o tym wprost. Ekran nie podstawia oferty
     zgadniętej z treści — tak wygrywały kiedyś „zdemontowanym" i „Pozdrawiam". */
  const bezOferty = os.some((w) => w.rodzaj === "wiadomosc" && w.odKlienta && !w.ofertaId);

  return <section className="card flex max-h-[75vh] flex-col overflow-hidden">
    <header className="flex flex-wrap items-center gap-3 border-b p-4">
      <b className="mr-auto">{rozmowa.klient}</b>
      {rozmowa.wlasciciel
        ? <span className={`flex items-center gap-1 text-sm font-semibold ${
            moja ? "text-emerald-700" : "text-slate-600"}`}>
            <UserCheck size={15} />{moja ? "Twoja rozmowa" : `Prowadzi ${rozmowa.wlasciciel}`}</span>
        : <Przycisk wariant="glowny" onClick={p.onPrzejmij}>
            <UserCheck size={16} />PRZEJMIJ ROZMOWĘ</Przycisk>}
    </header>

    {p.nowaWiadomosc && <p className="flex items-center gap-2 border-b bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900">
      <Bell size={16} />Klient dopisał nową wiadomość.
      <button className="underline" onClick={p.onPokazNowa}>Pokaż</button></p>}

    {bezOferty && <p className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-800">
      <AlertTriangle size={16} />Brak powiązania z ofertą — hala nie dostanie numeru kartoteki.</p>}

    <Os wpisy={os} zrodloPomiaru={p.zrodloPomiaru} mozeZlecac={!cudza}
      onZrodlo={p.onZrodlo}
      onWstawDoSzkicu={(t) => p.onSzkic(p.szkic ? `${p.szkic}\n${t}` : t)} />

    {p.zrodloPomiaru && <div className="border-t bg-amber-50 p-4">
      {/* Kartoteki nie wywiedziemy dziś z oferty, więc agent może ją wskazać.
          Zadanie zapisze, że to jego wybór, a nie fakt z Allegro. */}
      <div className="mb-3">
        <div className="mb-1 text-sm font-semibold">Kartoteka dla hali
          <span className="font-normal text-slate-500"> (opcjonalnie)</span></div>
        <Wyszukiwarka wybrany={p.towar} onWybierz={p.onTowar} etykieta="Wskazana przez Ciebie" />
      </div>
      <label className="block text-sm font-semibold">Wskazówka dla hali
        <span className="font-normal text-slate-500"> (opcjonalnie)</span>
        <input className="field mt-1" value={p.wskazowka}
          onChange={(e) => p.onWskazowka(e.target.value)}
          placeholder="Np. podaj wynik w milimetrach" /></label>
      <Przycisk wariant="glowny" className="mt-3" onClick={p.onZlec}>
        <Ruler size={16} />ZLEĆ POMIAR</Przycisk>
    </div>}

    <Edytor szkic={p.szkic} cudza={cudza} wlasciciel={rozmowa.wlasciciel}
      zapisuje={p.zapisuje} onZmiana={p.onSzkic} onZapisz={p.onZapiszSzkic} />
  </section>;
}
