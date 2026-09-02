import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Check, X as Krzyzyk } from "lucide-react";
import type { Zastosowanie } from "../api/typy";
import { Pole, Przycisk, czas } from "../ui";

/**
 * Karta propozycji w kolejce wiedzy (E2). Niesie to, po czym biuro rozstrzyga:
 * kartotekę, maszynę, polaryzację z powodem i DOWODY (ranga, data, treść,
 * źródło — jak w makiecie). Odrzucenie wymaga powodu — przycisk jest
 * nieaktywny bez niego, wzór `zwroty/Decyzje.tsx`: pole pilnuje reguły, nie
 * dopiero serwer.
 *
 * Zatwierdzić może każdy z biura, także autor propozycji — decyzja
 * właściciela. Karta pokazuje autora, więc widać, gdy to ta sama osoba.
 */
export function Propozycja({ z, trwa, onRozstrzygnij }: {
  z: Zastosowanie;
  trwa: boolean;
  onRozstrzygnij: (id: number, decyzja: "zatwierdz" | "odrzuc", powod: string | null) => void;
}) {
  const [odmowa, setOdmowa] = useState(false);
  const [powod, setPowod] = useState("");
  const negatyw = z.polaryzacja === "nie_pasuje";

  return <article className={`rounded-lg border p-4 ${negatyw ? "border-red-200" : "border-slate-200"}`}
    aria-label={`Propozycja: ${z.symbol} – ${z.model.etykieta}`}>
    <div className="flex flex-wrap items-center gap-2">
      <b className="font-mono">{z.symbol}</b>
      <span className="text-slate-500">→</span>
      <b>{z.model.etykieta}</b>
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${negatyw
        ? "bg-red-100 text-ranga-zle" : "bg-emerald-100 text-emerald-800"}`}>
        {negatyw ? "nie pasuje" : "pasuje"}</span>
      <span className="ml-auto text-xs text-slate-500">
        {z.zaproponowal} · {czas(z.zaproponowanoAt)} · źródło: {z.zrodlo}</span>
    </div>
    {z.zdaniePowodu && <p className="mt-1 text-sm text-red-900">{z.zdaniePowodu}</p>}
    {z.komentarz && <p className="mt-1 text-sm text-slate-700">{z.komentarz}</p>}
    {z.conversationId !== null && <Link className="mt-1 inline-block text-xs text-slate-500 underline underline-offset-2"
      to={`/obsluga/skrzynka/${z.conversationId}`}>z rozmowy #{z.conversationId}</Link>}

    <ul className="mt-2 space-y-1">
      {z.dowody.map((d) => <li key={d.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
        <span className="rounded bg-white px-1 font-semibold text-slate-700">{d.nazwaRodzaju}</span>
        <span className="ml-1 text-slate-400">{czas(d.at)}</span>
        <p className="mt-0.5 text-slate-800">{d.tresc}</p>
        <p className="text-slate-500">{d.autor}{d.link && <> · <a className="underline" href={d.link} target="_blank" rel="noreferrer">źródło</a></>}</p>
      </li>)}
    </ul>
    <p className="mt-1 text-[11px] text-slate-500">
      Po zatwierdzeniu pewność: <b>{z.pewnosc}</b>
      {z.pewnosc === "prawdopodobne" && " — sam ślad rozmowy to nie dowód techniczny; dopisz katalog albo pomiar"}
    </p>

    {!odmowa
      ? <div className="mt-3 flex flex-wrap gap-2">
          <Przycisk wariant="glowny" disabled={trwa} onClick={() => onRozstrzygnij(z.id, "zatwierdz", null)}>
            <Check size={16} />ZATWIERDŹ</Przycisk>
          <Przycisk disabled={trwa} onClick={() => setOdmowa(true)}><Krzyzyk size={16} />ODRZUĆ</Przycisk>
        </div>
      : <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-red-50 p-2">
          <label className="block flex-1 text-xs font-bold text-slate-600" htmlFor={`powod-${z.id}`}>
            Powód odrzucenia — zobaczy go autor propozycji
            <Pole id={`powod-${z.id}`} className="mt-1" value={powod} autoFocus
              onChange={(e) => setPowod(e.target.value)} placeholder="np. to LS 51, nie LS 46" /></label>
          <Przycisk wariant="glowny" disabled={trwa || powod.trim() === ""}
            onClick={() => onRozstrzygnij(z.id, "odrzuc", powod.trim())}>Potwierdź odrzucenie</Przycisk>
          <Przycisk onClick={() => { setOdmowa(false); setPowod(""); }}>Wróć</Przycisk>
        </div>}
  </article>;
}
