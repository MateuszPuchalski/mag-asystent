import React, { useState } from "react";
import { Check, X as Krzyzyk } from "lucide-react";
import type { PrzegladWykazu as Przeglad } from "../api/typy";
import { Pole, Przycisk, ile } from "../ui";
import { Kafel } from "../towar/Kafel";
import { ZnakPewnosci } from "./ZnakPewnosci";

/**
 * Przegląd jednego wykazu części w kolejce: wszystkie jego czekające
 * propozycje na jednej liście, zatwierdzane zaznaczonymi.
 *
 * DLACZEGO LISTA, NIE KARTY. Wykaz silnika daje kilkadziesiąt propozycji
 * naraz, a decyzja przy każdej jest ta sama: „czy ta nasza część to ten
 * numer". Osobne karty kazały przewijać ekran za ekranem i klikać dwa razy
 * na wiersz. Tu oko jedzie w dół kolumny zdjęć i nazw, a ręka odznacza
 * tylko to, co nie pasuje.
 *
 * ZAZNACZONE DOMYŚLNIE — i to jest świadoma decyzja. Wiersz przyszedł
 * z wykazu producenta przez numer, który kartoteka sama deklaruje, więc
 * „pasuje" jest regułą, a odstępstwo wyjątkiem. Pusta lista kazałaby klikać
 * każdy wiersz, żeby powiedzieć to samo, co mówi wykaz. Odznaczone NIE jest
 * odrzuceniem: czeka dalej, bo odrzucenie wymaga powodu, a tego lista nie
 * ma skąd wziąć. Odrzuca się wiersz osobno, z powodem.
 */
export function PrzegladWykazu({ w, trwa, onZatwierdz, onOdrzuc }: {
  w: Przeglad;
  trwa: boolean;
  onZatwierdz: (ids: number[]) => void;
  onOdrzuc: (id: number, powod: string) => void;
}) {
  const [odznaczone, setOdznaczone] = useState<Set<number>>(new Set());
  const [odrzucam, setOdrzucam] = useState<number | null>(null);
  const [powod, setPowod] = useState("");
  const zaznaczone = w.pozycje.filter((p) => !odznaczone.has(p.id)).map((p) => p.id);
  const przelacz = (id: number) => setOdznaczone((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return <section className="rounded-lg border border-slate-200" aria-label={`Wykaz: ${w.zrodlo}`}>
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <b className="text-naglowek">{w.link ? <a className="underline" href={w.link} target="_blank" rel="noreferrer">{w.zrodlo}</a> : w.zrodlo}</b>
      <span className="text-sm text-slate-600">
        wykaz {w.rodzaj === "silnik" ? "silnika" : "maszyny"} · {ile(w.pozycje.length, "propozycja czeka", "propozycje czekają", "propozycji czeka")}</span>
      <span className="ml-auto flex gap-2">
        <Przycisk className="text-xs" disabled={odznaczone.size === 0} onClick={() => setOdznaczone(new Set())}>Zaznacz wszystkie</Przycisk>
        <Przycisk className="text-xs" disabled={zaznaczone.length === 0}
          onClick={() => setOdznaczone(new Set(w.pozycje.map((p) => p.id)))}>Odznacz wszystkie</Przycisk>
      </span>
    </div>
    <p className="px-3 pt-2 text-sm text-slate-600">
      Sprawdź przy zdjęciu i nazwie, czy nasza część to ten numer z wykazu. Odznaczone zostają w kolejce.</p>
    <ul className="divide-y divide-slate-100">
      {w.pozycje.map((p) => <li key={p.id} className="flex items-start gap-3 px-3 py-2">
        <input type="checkbox" className="mt-3 h-4 w-4" checked={!odznaczone.has(p.id)} onChange={() => przelacz(p.id)}
          aria-label={`Zatwierdź: ${p.symbol} → ${p.maszyna}`} />
        <Kafel twId={p.twId} rozmiar={40} nazwa={p.nazwa ?? p.symbol} symbol={p.symbol} />
        <div className="min-w-0 flex-1 text-sm">
          <p><b className="font-mono">{p.symbol}</b>{p.nazwa && <span> {p.nazwa}</span>}</p>
          <p className="text-slate-600">{p.dowod}
            {p.link && <a className="ml-2 text-xs underline" href={p.link} target="_blank" rel="noreferrer">źródło</a>}
            <ZnakPewnosci pewnosc={p.pewnosc} zrodel={p.zrodel} /></p>
          {p.warunki && <p className="text-amber-900"><b>Tylko:</b> {p.warunki}</p>}
          {odrzucam === p.id && <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-red-50 p-2">
            <label className="block flex-1 text-xs font-bold text-slate-600">
              Powód odrzucenia — zobaczy go autor wykazu
              <Pole className="mt-1" value={powod} autoFocus aria-label={`Powód odrzucenia: ${p.symbol}`}
                placeholder="np. to gaźnik GX200, nie GX160" onChange={(e) => setPowod(e.target.value)} /></label>
            <Przycisk wariant="glowny" disabled={trwa || powod.trim() === ""}
              onClick={() => { onOdrzuc(p.id, powod.trim()); setOdrzucam(null); setPowod(""); }}>Potwierdź odrzucenie</Przycisk>
            <Przycisk onClick={() => { setOdrzucam(null); setPowod(""); }}>Wróć</Przycisk>
          </div>}
        </div>
        {odrzucam !== p.id && <Przycisk className="text-xs" disabled={trwa} onClick={() => { setOdrzucam(p.id); setPowod(""); }}>
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
