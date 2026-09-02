import React, { useState } from "react";
import { AlarmClock, Clock, Flame } from "lucide-react";
import type { Rozmowa, StatusRozmowy } from "../api/typy";
import { Plakietka, Przycisk, czas } from "../ui";
import { DO_WYBORU, NAZWA } from "./statusy";

/* Status rozmowy (§7, 0.158.0). Nagłówek rozmowy pokazuje go ZAWSZE, także
   gdy nikt go nie ruszył — „Nowa" znaczy, że sprawy nie tknięto, a to jest
   informacja, nie brak informacji.

   ODŁOŻENIE MA WŁASNY KROK. Serwer odrzuca `snoozed` bez terminu (§7 nie zna
   rozmowy odłożonej na zawsze), więc ekran pyta o datę PRZED wysłaniem, a nie
   pokazuje potem błędu z serwera — agent nie ma się dowiadywać o regule
   z komunikatu odmowy. */
export function Status({ rozmowa, zapisuje, blad, onZmien, onPriorytet, zapisujePriorytet }: {
  rozmowa: Rozmowa;
  zapisuje: boolean;
  blad: string;
  onZmien: (status: StatusRozmowy, doKiedy: string | null) => void;
  onPriorytet: (priorytet: "normalny" | "pilny") => void;
  zapisujePriorytet: boolean;
}) {
  const [odkladanie, setOdkladanie] = useState(false);
  const [termin, setTermin] = useState("");

  return <div className="flex w-full flex-wrap items-center gap-2">
    <Plakietka status={rozmowa.status}>{NAZWA[rozmowa.status]}</Plakietka>

    {/* Termin minął, a rozmowa wróciła do otwartych. Bez tego zdania wiersz
        wygląda jak każdy inny otwarty — a to ten, o którym zapomniano. */}
    {rozmowa.poTerminie && <span className="flex items-center gap-1 text-xs font-bold text-ranga-uwaga">
      <AlarmClock size={13} />termin odłożenia minął {czas(rozmowa.odlozoneDo)}</span>}
    {!rozmowa.poTerminie && rozmowa.status === "snoozed" &&
      <span className="flex items-center gap-1 text-xs text-slate-500">
        <Clock size={13} />do {czas(rozmowa.odlozoneDo)}</span>}

    {/* Priorytet stoi PRZY statusie, nie w kolejce: „to się pali" mówi się
        o rozmowie, którą się właśnie czyta. Przełącznik jest jeden i widać po
        nim stan — flaga podniesiona wygląda inaczej niż opuszczona. */}
    <button type="button" disabled={zapisujePriorytet}
      aria-pressed={rozmowa.priorytet === "pilny"}
      onClick={() => onPriorytet(rozmowa.priorytet === "pilny" ? "normalny" : "pilny")}
      className={`ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-bold disabled:opacity-50 ${
        rozmowa.priorytet === "pilny"
          ? "bg-red-100 text-ranga-zle hover:bg-red-200"
          : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
      <Flame size={13} />{rozmowa.priorytet === "pilny" ? "PILNE" : "Oznacz jako pilne"}
    </button>

    <label className="flex items-center gap-2 text-xs text-slate-500">
      Status
      <select className="field w-auto py-1 text-sm" aria-label="Status rozmowy"
        value={rozmowa.status} disabled={zapisuje}
        onChange={(e) => {
          const wybrany = e.target.value as StatusRozmowy;
          if (wybrany === "snoozed") { setOdkladanie(true); return; }
          setOdkladanie(false);
          onZmien(wybrany, null);
        }}>
        {/* `new` bywa stanem BIEŻĄCYM, choć nie da się go wybrać: pole musi
            mieć opcję dla wartości, którą pokazuje, inaczej przeglądarka
            wybrałaby pierwszą z listy i ekran skłamałby o stanie sprawy. */}
        {rozmowa.status === "new" && <option value="new">{NAZWA.new}</option>}
        {DO_WYBORU.map((s) => <option key={s} value={s}>{NAZWA[s]}</option>)}
      </select>
    </label>

    {odkladanie && <div className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
      <label className="text-sm font-semibold">Odłóż do
        <input className="field ml-2 w-auto py-1" type="datetime-local" value={termin}
          aria-label="Termin odłożenia" onChange={(e) => setTermin(e.target.value)} /></label>
      <Przycisk wariant="glowny" disabled={!termin || zapisuje}
        onClick={() => {
          /* `datetime-local` oddaje czas LOKALNY bez strefy. Serwer trzyma
             wszystko w ISO ze strefą, więc konwersja idzie tutaj — inaczej
             odłożenie do 8:00 wypadałoby o dwie godziny obok. */
          onZmien("snoozed", new Date(termin).toISOString());
          setOdkladanie(false);
        }}>ODŁÓŻ</Przycisk>
      <Przycisk onClick={() => setOdkladanie(false)}>Anuluj</Przycisk>
    </div>}

    {blad && <p className="w-full text-xs font-semibold text-ranga-zle">{blad}</p>}
  </div>;
}
