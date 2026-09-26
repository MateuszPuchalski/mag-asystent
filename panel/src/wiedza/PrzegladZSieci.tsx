import React, { useState } from "react";
import { Check, ExternalLink, X as Krzyzyk } from "lucide-react";
import type { PrzegladZSieci as Przeglad } from "../api/typy";
import { Pole, Przycisk, ile } from "../ui";
import { Kafel } from "../towar/Kafel";

/**
 * Przegląd propozycji automatu z sieci dla JEDNEJ kartoteki (0.527.0).
 *
 * DLACZEGO LISTA. Pierwszy dzień na żywo: trzy kartoteki dały szesnaście
 * propozycji, a w kolejce czeka ponad tysiąc kartotek. Karta na każdą maszynę
 * to kilka tysięcy kliknięć. Tu jedna część, jej maszyny w kolumnie, każda
 * z cytatem i odnośnikiem do strony — oko jedzie w dół, ręka odznacza
 * wyjątki. Kształt ten sam co przegląd wykazu (`PrzegladWykazu`), bo to ta
 * sama robota; różni się grupa: tam wykaz, tu kartoteka.
 *
 * ZAZNACZONE DOMYŚLNIE, jak przy wykazie. Wiersz przeszedł sito serwera:
 * cytat stoi dosłownie na przeczytanej stronie, a strona zawiera NASZ numer
 * OEM. „Pasuje" jest więc regułą. Odznaczone NIE jest odrzuceniem — czeka
 * dalej; odrzuca się pojedynczo, z powodem.
 */
export function PrzegladZSieci({ p, trwa, onZatwierdz, onOdrzuc }: {
  p: Przeglad;
  trwa: boolean;
  onZatwierdz: (ids: number[]) => void;
  onOdrzuc: (id: number, powod: string) => void;
}) {
  const [odznaczone, setOdznaczone] = useState<Set<number>>(new Set());
  const [odrzucam, setOdrzucam] = useState<number | null>(null);
  const [powod, setPowod] = useState("");
  const zaznaczone = p.pozycje.filter((x) => !odznaczone.has(x.id)).map((x) => x.id);
  const przelacz = (id: number) => setOdznaczone((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return <section className="rounded-lg border border-slate-200" aria-label={`Z sieci: ${p.symbol}`}>
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <Kafel twId={p.twId} rozmiar={40} nazwa={p.nazwa ?? p.symbol} symbol={p.symbol} />
      <b className="text-naglowek"><span className="font-mono">{p.symbol}</span>{p.nazwa && <span> {p.nazwa}</span>}</b>
      <span className="text-sm text-slate-600">
        automat (siec) · {ile(p.pozycje.length, "maszyna czeka", "maszyny czekają", "maszyn czeka")}</span>
      <span className="ml-auto flex gap-2">
        <Przycisk className="text-xs" disabled={odznaczone.size === 0} onClick={() => setOdznaczone(new Set())}>Zaznacz wszystkie</Przycisk>
        <Przycisk className="text-xs" disabled={zaznaczone.length === 0}
          onClick={() => setOdznaczone(new Set(p.pozycje.map((x) => x.id)))}>Odznacz wszystkie</Przycisk>
      </span>
    </div>
    <p className="px-3 pt-2 text-sm text-slate-600">
      Automat znalazł tę część na stronach spoza Allegro po numerze OEM. Otwórz źródło, gdy cytat budzi wątpliwość.
      Odznaczone zostają w kolejce.</p>
    <ul className="divide-y divide-slate-100">
      {p.pozycje.map((x) => <li key={x.id} className="flex items-start gap-3 px-3 py-2">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={!odznaczone.has(x.id)} onChange={() => przelacz(x.id)}
          aria-label={`Zatwierdź: ${p.symbol} → ${x.maszyna}`} />
        <div className="min-w-0 flex-1 text-sm">
          <p><b>{x.maszyna}</b>
            {x.link && <a className="ml-2 text-xs underline" href={x.link} target="_blank" rel="noreferrer">
              źródło<ExternalLink size={12} className="ml-0.5 inline" aria-hidden="true" /></a>}</p>
          <p className="text-slate-600">{x.cytat}</p>
          {x.warunki && <p className="text-amber-900"><b>Tylko:</b> {x.warunki}</p>}
          {odrzucam === x.id && <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-red-50 p-2">
            <label className="block flex-1 text-xs font-bold text-slate-600">
              Powód odrzucenia
              <Pole className="mt-1" value={powod} autoFocus aria-label={`Powód odrzucenia: ${x.maszyna}`}
                placeholder="np. strona mówi o innym wariancie" onChange={(e) => setPowod(e.target.value)} /></label>
            <Przycisk wariant="glowny" disabled={trwa || powod.trim() === ""}
              onClick={() => { onOdrzuc(x.id, powod.trim()); setOdrzucam(null); setPowod(""); }}>Potwierdź odrzucenie</Przycisk>
            <Przycisk onClick={() => { setOdrzucam(null); setPowod(""); }}>Wróć</Przycisk>
          </div>}
        </div>
        {odrzucam !== x.id && <Przycisk className="text-xs" disabled={trwa} onClick={() => { setOdrzucam(x.id); setPowod(""); }}>
          <Krzyzyk size={14} />Odrzuć…</Przycisk>}
      </li>)}
    </ul>
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2">
      <Przycisk wariant="glowny" disabled={trwa || zaznaczone.length === 0} onClick={() => onZatwierdz(zaznaczone)}>
        <Check size={16} />Zatwierdź zaznaczone ({zaznaczone.length})</Przycisk>
      {odznaczone.size > 0 && <span className="text-xs text-slate-600">
        {ile(odznaczone.size, "odznaczona zostanie", "odznaczone zostaną", "odznaczonych zostanie")} w kolejce</span>}
    </div>
  </section>;
}
