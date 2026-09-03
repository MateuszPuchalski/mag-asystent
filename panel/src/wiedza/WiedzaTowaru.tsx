import React, { useState } from "react";
import type { RodzajDowodu, Zastosowanie } from "../api/typy";
import { useDodajDowod, useWiedzaTowaru, useWycofajZastosowanie } from "../api/wiedza";
import { Pole, Przycisk, czas } from "../ui";
import { Wyszukiwarka, type Towar } from "../wyszukiwarka";
import { DOWODY_DO_WYBORU, NAZWA_DOWODU } from "../skrzynka/statusy";

/**
 * „Sprawdź kartotekę": co wiemy o części — potwierdzone, negatywne i to, co
 * czeka. Wycofanie negatywu wymaga powodu (§14.2), pozytywu nie; dowody
 * dopisuje się, nigdy nie poprawia (append-only).
 */
export function WiedzaTowaru() {
  const [towar, setTowar] = useState<Towar | null>(null);
  const wiedza = useWiedzaTowaru(towar?.id ?? null);
  return <div className="space-y-3">
    <Wyszukiwarka wybrany={towar} onWybierz={setTowar} etykieta="Kartoteka do sprawdzenia" />
    {towar && wiedza.isLoading && <p className="text-sm text-slate-500">Sprawdzam…</p>}
    {wiedza.error && <p className="text-sm text-red-700">{(wiedza.error as Error).message}</p>}
    {wiedza.data && <>
      <Sekcja tytul="Potwierdzone zastosowania" lista={wiedza.data.potwierdzone} pusto="brak potwierdzonych zastosowań" />
      <Sekcja tytul="Nie pasuje do" lista={wiedza.data.negatywne} pusto="brak negatywnych dopasowań" negatyw />
      <Sekcja tytul="Czeka w kolejce" lista={wiedza.data.propozycje} pusto="nic nie czeka" tylkoOdczyt />
    </>}
  </div>;
}

function Sekcja({ tytul, lista, pusto, negatyw = false, tylkoOdczyt = false }: {
  tytul: string; lista: Zastosowanie[]; pusto: string; negatyw?: boolean; tylkoOdczyt?: boolean;
}) {
  return <section aria-label={tytul}>
    <b className={`text-xs uppercase tracking-wide ${negatyw ? "text-red-800" : "text-slate-500"}`}>{tytul}</b>
    {lista.length === 0
      ? <p className="text-sm text-slate-500">{pusto}</p>
      : <ul className="mt-1 space-y-2">{lista.map((z) => <Wpis key={z.id} z={z} tylkoOdczyt={tylkoOdczyt} />)}</ul>}
  </section>;
}

function Wpis({ z, tylkoOdczyt }: { z: Zastosowanie; tylkoOdczyt: boolean }) {
  const wycofaj = useWycofajZastosowanie();
  const dowod = useDodajDowod();
  const [cofam, setCofam] = useState(false);
  const [powod, setPowod] = useState("");
  const [dopisuje, setDopisuje] = useState(false);
  const [rodzaj, setRodzaj] = useState<RodzajDowodu>("katalog_dostawcy");
  const [tresc, setTresc] = useState("");
  const negatyw = z.polaryzacja === "nie_pasuje";
  const blad = (wycofaj.error ?? dowod.error) as Error | null;

  return <li className={`rounded-lg border p-3 text-sm ${negatyw ? "border-red-200" : "border-slate-200"}`}>
    <div className="flex flex-wrap items-center gap-2">
      <b>{z.model.etykieta}</b>
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${z.pewnosc === "potwierdzone"
        ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{z.pewnosc}</span>
      <span className="ml-auto text-xs text-slate-500">{z.zdanieZrodla}</span>
    </div>
    {z.zdaniePowodu && <p className="text-red-900">{z.zdaniePowodu}</p>}
    <ul className="mt-1 text-xs text-slate-600">
      {z.dowody.map((d) => <li key={d.id}>· {d.nazwaRodzaju}, {czas(d.at)}, {d.autor}: {d.tresc}</li>)}
    </ul>
    {!tylkoOdczyt && <div className="mt-2 flex flex-wrap items-end gap-2">
      {!cofam && !dopisuje && <>
        <Przycisk className="text-xs" onClick={() => setDopisuje(true)}>Dopisz dowód</Przycisk>
        <Przycisk className="text-xs" onClick={() => setCofam(true)}>Wycofaj</Przycisk>
      </>}
      {cofam && <>
        <label className="flex-1 text-xs font-bold text-slate-600">
          {negatyw ? "Powód wycofania — negatyw nie schodzi bez powodu" : "Powód wycofania (opcjonalnie)"}
          <Pole className="mt-1" aria-label={`Powód wycofania: ${z.model.etykieta}`} value={powod}
            onChange={(e) => setPowod(e.target.value)} /></label>
        <Przycisk wariant="glowny" disabled={wycofaj.isPending || (negatyw && powod.trim() === "")}
          onClick={() => wycofaj.mutate({ id: z.id, powod: powod.trim() || null }, { onSuccess: () => setCofam(false) })}>
          Potwierdź wycofanie</Przycisk>
        <Przycisk onClick={() => { setCofam(false); setPowod(""); }}>Wróć</Przycisk>
      </>}
      {dopisuje && <>
        <select className="field w-auto" aria-label="Rodzaj dowodu" value={rodzaj}
          onChange={(e) => setRodzaj(e.target.value as RodzajDowodu)}>
          {DOWODY_DO_WYBORU.map((r) => <option key={r} value={r}>{NAZWA_DOWODU[r]}</option>)}</select>
        <Pole className="flex-1" aria-label="Treść dowodu" value={tresc} placeholder="treść dowodu"
          onChange={(e) => setTresc(e.target.value)} />
        <Przycisk wariant="glowny" disabled={dowod.isPending || tresc.trim() === ""}
          onClick={() => dowod.mutate({ id: z.id, rodzaj, tresc: tresc.trim() }, { onSuccess: () => { setDopisuje(false); setTresc(""); } })}>
          Zapisz dowód</Przycisk>
        <Przycisk onClick={() => setDopisuje(false)}>Wróć</Przycisk>
      </>}
    </div>}
    {blad && <p className="mt-1 text-xs text-red-700">{blad.message}</p>}
  </li>;
}
