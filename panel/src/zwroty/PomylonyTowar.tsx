import { useState } from "react";
import { PackageX } from "lucide-react";
import type { PozycjaZwrotu } from "../api/typy";
import { Przycisk, Pole } from "../ui";

/* ── Pomylony towar w kartonie ───────────────────────────────────────────────
   Klient odsyła co innego, niż kupił: inny model, inny kolor, cudzy produkt.
   Wiedzę ma biuro, które otwiera paczkę, więc to ono zaznacza pozycję.

   Znacznik jest FAKTEM o pozycji, nie oceną: kwoty i koszyka nie rusza. Stoi
   jednak w czerwonej ramce nad decyzją, bo „na stan" pod kartoteką
   zamówionego towaru wpisałoby na półkę coś, czego tam nie ma.

   Zgłoszenie otwiera się na żądanie i opis jest dobrowolny: typowy zwrot
   wraca zgodny, a zaznaczenie nie może kosztować pisania przy otwartym
   kartonie.                                                                  */

export function PomylonyTowar({ p, trwa, edytowalny, onZapisz }: {
  p: PozycjaZwrotu;
  trwa: boolean;
  /** Przed przyjęciem albo po korekcie serwer odmówi, więc przycisku nie ma. */
  edytowalny: boolean;
  onZapisz: (pomylony: boolean, opis: string) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [opis, setOpis] = useState("");

  if (p.pomylonyTowar) {
    return <div role="alert" className="mt-2 w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
      <p className="flex flex-wrap items-center gap-1.5 font-bold">
        <PackageX size={14} aria-hidden="true" className="shrink-0" />
        <span>Pomylony towar — w kartonie jest co innego</span>
        {edytowalny && <button type="button" disabled={trwa} onClick={() => onZapisz(false, "")}
          className="ml-1 font-normal underline underline-offset-2 hover:text-red-950">
          cofnij</button>}
      </p>
      {p.pomylonyOpis && <p className="mt-1 break-words text-tresc">
        <span className="sr-only">Przyjechało: </span>{p.pomylonyOpis}</p>}
      {/* Ocena zapadła przed zauważeniem pomyłki albo mimo niej. */}
      {p.ocena === "stan" && <p className="mt-1 font-semibold">
        Oceniono „na stan”, a to nie jest zamówiony towar — cofnij ocenę.</p>}
    </div>;
  }

  if (!edytowalny) return null;

  if (!otwarte) {
    return <button type="button" disabled={trwa} onClick={() => setOtwarte(true)}
      className="mt-2 flex items-center gap-1 text-xs text-slate-500 underline
        underline-offset-2 hover:text-slate-800">
      <PackageX size={12} aria-hidden="true" /> to nie ten towar</button>;
  }

  return <div className="mt-2 w-full space-y-1 rounded-lg border border-red-300 bg-white p-2">
    <label className="block text-xs font-bold text-slate-600" htmlFor={`pomylony-${p.id}`}>
      Co przyjechało w kartonie (nieobowiązkowe)</label>
    <div className="flex flex-wrap items-center gap-2">
      <Pole id={`pomylony-${p.id}`} className="min-w-48 flex-1" value={opis} autoFocus maxLength={300}
        placeholder="np. kosa spalinowa zamiast podkaszarki"
        onChange={(e) => setOpis(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onZapisz(true, opis);
          if (e.key === "Escape") { e.preventDefault(); setOtwarte(false); setOpis(""); }
        }} />
      <Przycisk wariant="glowny" className="text-xs" disabled={trwa}
        onClick={() => onZapisz(true, opis)}>Zaznacz</Przycisk>
      <Przycisk className="text-xs" onClick={() => { setOtwarte(false); setOpis(""); }}>
        Wróć</Przycisk>
    </div>
  </div>;
}
