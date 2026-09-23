import React, { useState } from "react";
import {
  AlarmClock, CircleDashed, CircleHelp, HeartHandshake, MessageSquare, Ruler, UserRound, Wrench, X,
} from "lucide-react";
import type { Kategoria } from "../api/typy";
import { IKONA_KATEGORII } from "./Copilot";
import { NAZWA_KATEGORII } from "./statusy";
import { Czekanie } from "./Czekanie";

/* ── SŁOWNIK ZNAKÓW POD „?" (23 września 2026) ───────────────────────────────
   Cena zamiany słów na znaki jest znana: znak trzeba raz poznać. Dekalog
   ergonomii (punkt 2) każe rozpoznawać zamiast pamiętać, więc pełna lista
   stoi JEDNO kliknięcie od kolejki, a każdy znak ma dodatkowo swój dymek.

   Słownik jest PANELEM, nie oknem modalnym: agent patrzy na niego i na wiersz
   jednocześnie, a okno zasłoniłoby wiersz, o który pyta. Otwarcie niczego nie
   zapisuje — to stan tego jednego komponentu. */

const G = 3_600_000;

export function SlownikZnakow() {
  const [otwarty, setOtwarty] = useState(false);
  const kategorie = Object.keys(NAZWA_KATEGORII) as Kategoria[];
  return <span className="relative shrink-0">
    <button type="button" aria-expanded={otwarty} aria-label="Co znaczą znaki"
      title="Co znaczą znaki" onClick={() => setOtwarty(!otwarty)}
      className="rounded p-1 text-slate-500 hover:bg-slate-100"><CircleHelp size={16} /></button>
    {otwarty && <section aria-label="Co znaczą znaki"
      className="absolute left-0 top-9 z-20 w-[34rem] rounded-xl border bg-white p-4 shadow-lg">
      <header className="mb-3 flex items-center gap-2">
        <b className="flex-1 text-naglowek">Co znaczą znaki</b>
        <button type="button" aria-label="Zamknij słownik" onClick={() => setOtwarty(false)}
          className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={16} /></button>
      </header>
      <div className="grid grid-cols-2 gap-6 text-sm">
        <div>
          <p className="mb-2 text-podpis font-bold uppercase tracking-wide text-violet-800">O czym pisze klient</p>
          <ul className="flex flex-col gap-1.5">
            {kategorie.map((k) => {
              const Ikona = IKONA_KATEGORII[k];
              return <li key={k} className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-violet-200 bg-violet-50 text-violet-800">
                  <Ikona size={15} aria-hidden="true" /></span>{NAZWA_KATEGORII[k]}</li>;
            })}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-podpis font-bold uppercase tracking-wide text-slate-600">Co z tym zrobić</p>
          <ul className="flex flex-col gap-2">
            <li className="flex items-center gap-2"><span className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-violet-200 bg-violet-50 text-violet-800">
              <IkonaDobor /><span aria-hidden="true" className="absolute -right-1 -top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white bg-ranga-zle text-white"><UserRound size={8} /></span></span>
              czerwona kropka — wymaga człowieka</li>
            <li className="flex items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-600"><CircleDashed size={15} aria-hidden="true" /></span>
              nierozpoznana</li>
            <li className="flex items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600"><HeartHandshake size={15} aria-hidden="true" /></span>
              podziękowanie — nie czeka na nas</li>
            <li className="flex items-center gap-2"><span className="w-16"><Czekanie ms={0.5 * G} /></span>krócej niż godzina</li>
            <li className="flex items-center gap-2"><span className="w-16"><Czekanie ms={2 * G} /></span>1–4 godziny</li>
            <li className="flex items-center gap-2"><span className="w-16"><Czekanie ms={5 * G} /></span>4–8 godzin</li>
            <li className="flex items-center gap-2"><span className="w-16"><Czekanie ms={14 * G} /></span>ponad 8 godzin</li>
            <li className="flex items-center gap-2"><span className="inline-flex w-7 items-center gap-0.5 font-bold text-slate-600"><MessageSquare size={13} aria-hidden="true" />3</span>
              wiadomości klienta od naszej odpowiedzi</li>
            <li className="flex items-center gap-2"><span className="inline-flex w-7 text-amber-700"><Wrench size={14} aria-hidden="true" /></span>
              dobór w toku (zieleń — zatwierdzony)</li>
            <li className="flex items-center gap-2"><span className="inline-flex w-7 text-slate-600"><Ruler size={14} aria-hidden="true" /></span>
              zadanie dla hali w toku</li>
            <li className="flex items-center gap-2"><span className="inline-flex w-7 text-ranga-uwaga"><AlarmClock size={14} aria-hidden="true" /></span>
              termin odłożenia minął</li>
          </ul>
        </div>
      </div>
      <p className="mt-3 text-podpis text-slate-600">Każdy znak ma podpis po najechaniu myszą.</p>
    </section>}
  </span>;
}

function IkonaDobor() {
  const Ikona = IKONA_KATEGORII.PRODUCT_COMPATIBILITY;
  return <Ikona size={15} aria-hidden="true" />;
}
