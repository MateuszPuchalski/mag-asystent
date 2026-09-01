import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Przycisk } from "../ui";

/**
 * Pytanie bez numeru oferty (§4.3, otwarcie `docs/obsluga-klienta.md`).
 *
 * Ekran mówi o braku wprost, zamiast podstawiać ofertę zgadniętą z treści.
 * Tak wygrywały kiedyś „zdemontowanym" i „Pozdrawiam", bo dobór fraz brał
 * słowa po DŁUGOŚCI, a „szarpaku" wypadało przez limit trzech fraz.
 */
export function BrakOferty({ zapisuje, blad, onWskaz, onDopytaj }: {
  zapisuje: boolean;
  blad: string;
  onWskaz: (ofertaId: string) => void;
  onDopytaj: () => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [numer, setNumer] = useState("");

  return <div className="border-b bg-amber-50 px-4 py-3">
    <p className="flex items-center gap-2 text-sm text-amber-800">
      <AlertTriangle size={16} />
      <b>Brak powiązania z ofertą.</b>
      Ekran mówi to wprost, zamiast podstawiać ofertę zgadniętą z treści.
    </p>

    <div className="mt-2 flex flex-wrap gap-2">
      <Przycisk className="text-xs" onClick={() => setOtwarte(!otwarte)}>Wskaż ofertę ręcznie</Przycisk>
      <Przycisk className="text-xs" onClick={onDopytaj}>Dopytaj klienta o numer oferty</Przycisk>
    </div>

    {otwarte && <div className="mt-2 flex flex-wrap items-center gap-2">
      <input className="field max-w-xs" value={numer} inputMode="numeric"
        aria-label="Numer oferty Allegro"
        onChange={(e) => setNumer(e.target.value)} placeholder="Np. 14892374512" />
      <Przycisk wariant="glowny" disabled={!numer.trim() || zapisuje}
        onClick={() => { onWskaz(numer); setNumer(""); setOtwarte(false); }}>ZAPISZ</Przycisk>
      {/* Wskazanie ręczne zapisuje się jako WYBÓR AGENTA i tak wygląda na osi.
          Zadanie dla hali odróżni je od kartoteki wywiedzionej z oferty. */}
      <span className="text-xs text-slate-500">Zapisze się jako Twój wybór, nie fakt z Allegro.</span>
    </div>}
    {blad && <p className="mt-2 text-sm text-red-700">{blad}</p>}
  </div>;
}
