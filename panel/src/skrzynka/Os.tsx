import React from "react";
import type { WpisOsi } from "../api/typy";
import { Przycisk } from "../ui";

/* §10.3: każdy rodzaj wpisu ma wyglądać inaczej. Dziś rodzaje są dwa —
   wiadomość kanału i wynik z hali. Komentarze, zdarzenia systemowe i wpisy
   wysyłki dochodzą w kolejnych etapach i mają tu DOŁOŻYĆ gałąź, a nie
   przepisać tę. Barwy idą z tokenów `os.*`, nie z klas Tailwinda wprost. */
export function Os({ wpisy, zrodloPomiaru, mozeZlecac, onZrodlo, onWstawDoSzkicu }: {
  wpisy: WpisOsi[];
  zrodloPomiaru: number | null;
  mozeZlecac: boolean;
  onZrodlo: (messageId: number | null) => void;
  onWstawDoSzkicu: (tresc: string) => void;
}) {
  return <div className="flex-1 space-y-3 overflow-y-auto p-4">
    {wpisy.map((w) => w.rodzaj === "wynik_zadania"
      ? <article key={w.id} className="rounded-lg border border-os-wynik-ramka bg-os-wynik p-3">
          <div className="text-xs font-bold uppercase text-ranga-ok">Wynik z magazynu · {w.autor}</div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{w.tresc}</p>
          {/* Wynik nie staje się odpowiedzią sam — do szkicu trafia wyłącznie
              na jawne kliknięcie agenta. */}
          <Przycisk className="mt-2 text-xs" onClick={() => onWstawDoSzkicu(w.tresc)}>
            Wstaw wynik do szkicu</Przycisk>
        </article>
      : <article key={w.id} className={`rounded-lg border p-3 ${w.odKlienta
          ? "border-os-klient-ramka bg-os-klient" : "border-os-firma-ramka bg-os-firma"}`}>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <b>{w.autor}</b>{w.ofertaId && <span>· oferta {w.ofertaId}</span>}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{w.tresc}</p>
          {w.odKlienta && mozeZlecac && <button
            className={`mt-2 text-xs font-bold ${
              zrodloPomiaru === w.messageId ? "text-amber-700" : "text-slate-500"}`}
            onClick={() => onZrodlo(zrodloPomiaru === w.messageId ? null : w.messageId!)}>
            {zrodloPomiaru === w.messageId ? "✓ źródło pomiaru" : "Zleć z tej wiadomości"}</button>}
        </article>)}
  </div>;
}
