import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import type { Pasowanie } from "../api/typy";
import { Pole, Przycisk, czas } from "../ui";
import { Kafel } from "../towar/Kafel";

/**
 * Karta propozycji pasowania w kolejce wiedzy. Kopia `PropozycjaPary`
 * z `Silniki.tsx`: dwa kafle, „LC170430140-0001 → W09-0211", rola i pozycja,
 * dowód, zatwierdź / odrzuć z powodem. Odrzucenie bez powodu nie mówi
 * autorowi, co poprawić — przycisk pilnuje tego przed serwerem.
 */
export function PropozycjaPasowania({ p, trwa, onDecyzja }: {
  p: Pasowanie; trwa: boolean; onDecyzja: (decyzja: "zatwierdz" | "odrzuc", powod: string | null) => void;
}) {
  const [odrzuca, setOdrzuca] = useState(false);
  const [powod, setPowod] = useState("");
  const negatyw = p.polaryzacja === "nie_pasuje";
  return <article className={`rounded-lg border p-3 ${negatyw ? "border-red-200" : "border-slate-200"}`}
    aria-label={`Pasowanie: ${p.czesc.symbol} → ${p.doCzego.symbol}`}>
    <div className="flex items-start gap-3">
      <Kafel twId={p.czesc.twId} rozmiar={44} nazwa={p.czesc.nazwa} symbol={p.czesc.symbol} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <b className="font-mono">{p.czesc.symbol}</b>
          <span className="text-slate-500">{negatyw ? "⇏" : "→"}</span>
          <b className="font-mono">{p.doCzego.symbol}</b>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-podpis">{p.nazwaRoli}{p.pozycja ? ` · ${p.pozycja}` : ""}</span>
          {/* Tylko dla `copilot` (przyrost czwarty): `reczne` i `dobor` to para
              wpisana przez człowieka. Tu parę nazwał model, agent ją tylko
              potwierdził — rozstrzygający ma czytać dowód uważniej. */}
          {p.zrodlo === "copilot" && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-podpis font-semibold text-violet-800">
            <Sparkles size={11} className="inline" /> z Copilota</span>}
          <span className="ml-auto text-xs text-slate-500">{p.zaproponowal} · {czas(p.zaproponowanoAt)}</span>
        </div>
        <p className="text-xs text-slate-600">{p.czesc.nazwa} → {p.doCzego.nazwa}</p>
        {p.zdaniePowodu && <p className="text-xs text-red-900">{p.zdaniePowodu}</p>}
        <p className="mt-1 text-xs text-slate-600">{p.nazwaRodzajuDowodu}: {p.dowodTresc}
          {p.conversationId !== null && <> · <Link className="underline" to={`/obsluga/skrzynka/${p.conversationId}`}>rozmowa #{p.conversationId}</Link></>}</p>
      </div>
      <Kafel twId={p.doCzego.twId} rozmiar={44} nazwa={p.doCzego.nazwa} symbol={p.doCzego.symbol} />
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Przycisk wariant="glowny" className="text-xs" disabled={trwa} onClick={() => onDecyzja("zatwierdz", null)}>Zatwierdź</Przycisk>
      {!odrzuca && <Przycisk className="text-xs" disabled={trwa} onClick={() => setOdrzuca(true)}>Odrzuć</Przycisk>}
      {odrzuca && <>
        <Pole className="w-64" aria-label="Powód odrzucenia" value={powod} placeholder="Dlaczego?"
          onChange={(e) => setPowod(e.target.value)} />
        <Przycisk className="text-xs" disabled={trwa || !powod.trim()} onClick={() => onDecyzja("odrzuc", powod.trim())}>Odrzuć</Przycisk>
      </>}
    </div>
  </article>;
}
