import React, { useState } from "react";
import { Layers, Link2, Unlink } from "lucide-react";
import type { SprawaRozmowy, WierszSprawy } from "../api/typy";
import { Przycisk } from "../ui";

/* Pasek sprawy (§6.1, 0.161.0).
   
   Sprawa stoi PONAD rozmowami i skleja te, które dotyczą jednego problemu
   klienta. Pasek pokazuje rodzeństwo ZANIM agent zacznie pisać — bo druga
   rozmowa o tej samej kosiarce bywa tą, w której odpowiedź już padła.

   Ekran nie ma widoku sprawy i to jest wybór, nie brak. §7 nie zna statusów
   sprawy, a zdarzenia wiszą przy ŹRÓDLE (blizna 0.130.0): osobny ekran
   z własną osią byłby pierwszym krokiem z powrotem ku czterem tabelom
   nakładki, które ten kształt raz już kosztował. */
export function Sprawa({ sprawa, rozmowaId, sprawy, trwa, blad, onZaloz, onDolacz, onOdlacz,
  onOtworz }: {
  sprawa: SprawaRozmowy | null;
  rozmowaId: number;
  sprawy: WierszSprawy[];
  trwa: boolean;
  blad: string;
  onZaloz: (tytul: string) => void;
  onDolacz: (sprawaId: number) => void;
  onOdlacz: () => void;
  onOtworz: (rozmowaId: number) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [tytul, setTytul] = useState("");

  if (sprawa) {
    const rodzenstwo = sprawa.rozmowy.filter((r) => r.id !== rozmowaId);
    return <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-2 text-sm">
      <Layers size={15} className="text-slate-500" />
      <b>{sprawa.tytul}</b>
      {rodzenstwo.length
        ? <span className="flex flex-wrap items-center gap-2 text-slate-600">
            · {rodzenstwo.length === 1 ? "druga rozmowa" : `${rodzenstwo.length} inne rozmowy`}:
            {rodzenstwo.map((r) => <button key={r.id} className="underline hover:text-slate-900"
              onClick={() => onOtworz(r.id)}>{r.klient} #{r.id}</button>)}
          </span>
        /* Sprawa z jedną rozmową nie jest błędem: klamrę zakłada się wtedy,
           gdy problem już widać, a druga rozmowa bywa dopiero jutro. */
        : <span className="text-slate-500">· na razie jedyna rozmowa w tej sprawie</span>}
      <Przycisk className="ml-auto text-xs" disabled={trwa} onClick={onOdlacz}>
        <Unlink size={14} />ODKLEJ</Przycisk>
      {blad && <p className="w-full text-xs font-semibold text-ranga-zle">{blad}</p>}
    </div>;
  }

  return <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm">
    <Layers size={15} className="text-slate-400" />
    <span className="text-slate-500">Rozmowa nie należy do żadnej sprawy</span>
    <Przycisk className="ml-auto text-xs" onClick={() => setOtwarte((o) => !o)}>
      <Link2 size={14} />PRZYPISZ DO SPRAWY</Przycisk>

    {otwarte && <div className="w-full space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-slate-600">Nowa sprawa
          <input className="field mt-1 w-72" value={tytul} onChange={(e) => setTytul(e.target.value)}
            aria-label="Tytuł nowej sprawy"
            placeholder="Np. szarpak do NAC LS 46-450" /></label>
        <Przycisk wariant="glowny" disabled={!tytul.trim() || trwa}
          onClick={() => { onZaloz(tytul.trim()); setTytul(""); setOtwarte(false); }}>
          ZAŁÓŻ</Przycisk>
      </div>

      {/* Dołączenie do istniejącej sprawy niesie liczbę rozmów i datę, bo po
          nich agent poznaje, czy to ta sprawa sprzed miesiąca, czy dzisiejsza.
          Sam tytuł tego nie mówi. */}
      {sprawy.length > 0 && <div className="flex flex-wrap items-end gap-2 border-t pt-2">
        <label className="text-xs font-semibold text-slate-600">albo dołącz do istniejącej
          <select className="field mt-1 w-72" defaultValue="" aria-label="Istniejąca sprawa"
            onChange={(e) => { if (e.target.value) onDolacz(Number(e.target.value)); }}>
            <option value="">— wybierz —</option>
            {sprawy.map((s) => <option key={s.id} value={s.id}>
              {s.tytul} ({s.liczbaRozmow})</option>)}
          </select></label>
      </div>}
      {blad && <p className="text-xs font-semibold text-ranga-zle">{blad}</p>}
    </div>}
  </div>;
}
