import React, { useState } from "react";
import { Archive, Undo2 } from "lucide-react";
import type { Zwrot } from "../api/typy";
import { Blad, Pole, Przycisk, dzien } from "../ui";
import { useOkno } from "../nawigacja/fokus";

/** Tyle przyjmuje serwer; pole nie pozwala wpisać więcej, więc 400 nie wróci z tego powodu. */
const MAKS_POWODU = 250;

/**
 * Ręczne zamknięcie zwrotu bez korekty i jego cofnięcie.
 *
 * Są zwroty, których nic nie domknie: pieniądze poszły poza aplikacją albo
 * sprawa jest sprzed panelu. Bez tego stoją w kolejce bez końca. Zamknięcie
 * dotyczy tylko nas, więc okno mówi to wprost, zanim ktoś kliknie.
 *
 * Przycisk stoi przy decyzjach o całym zwrocie, nie w „Pieniądzach”: zamknięcie
 * nie rusza żadnych pieniędzy. Cofnięcie jest bez potwierdzenia, bo jest
 * odwracalne i niczego nie wysyła na zewnątrz.
 */
export function ZamkniecieReczne({ zwrot, pieniadzeCzekaja, trwa, blad, onZamknij, onOtworz }: {
  zwrot: Zwrot;
  /** Kwota ustalona, pieniądze jeszcze nie wyszły. */
  pieniadzeCzekaja: boolean;
  trwa: boolean;
  /** Treść błędu serwera wprost, już przypisana do TEGO zwrotu. */
  blad: string;
  /** `poSukcesie` zamyka okno; po błędzie okno zostaje z wpisanym powodem. */
  onZamknij: (powod: string | undefined, poSukcesie: () => void) => void;
  onOtworz: () => void;
}) {
  const [okno, setOkno] = useState(false);
  const r = zwrot.zamknietyRecznie;

  if (r) {
    return <div className="border-b border-slate-200 bg-slate-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Archive size={16} aria-hidden="true" />
        Zamknięty ręcznie{r.przez ? ` przez ${r.przez}` : ""}, {dzien(r.kiedy)}</p>
      {r.powod && <p className="mt-1 text-sm text-slate-700">Powód: {r.powod}</p>}
      <Przycisk disabled={trwa} onClick={onOtworz} className="mt-2">
        <Undo2 size={16} aria-hidden="true" />Otwórz ponownie</Przycisk>
      {blad && <div className="mt-2"><Blad>{blad}</Blad></div>}
    </div>;
  }

  if (zwrot.kubelek === "zamkniety" || zwrot.kubelek === "odrzucony") return null;

  return <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
    <Przycisk disabled={trwa} onClick={() => setOkno(true)}>
      <Archive size={16} aria-hidden="true" />Zamknij ręcznie</Przycisk>
    {!okno && blad && <div className="mt-2"><Blad>{blad}</Blad></div>}
    {okno && <OknoZamkniecia pieniadzeCzekaja={pieniadzeCzekaja} trwa={trwa} blad={blad}
      onAnuluj={() => setOkno(false)}
      onZamknij={(powod) => onZamknij(powod, () => setOkno(false))} />}
  </div>;
}

function OknoZamkniecia({ pieniadzeCzekaja, trwa, blad, onAnuluj, onZamknij }: {
  pieniadzeCzekaja: boolean; trwa: boolean; blad: string;
  onAnuluj: () => void; onZamknij: (powod: string | undefined) => void;
}) {
  const [powod, setPowod] = useState("");
  const okno = useOkno<HTMLDivElement>({ onZamknij: onAnuluj });
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
    onClick={onAnuluj}>
    <div role="dialog" {...okno} aria-labelledby="zamkniecie-tytul"
      onClick={(e) => e.stopPropagation()} className="card w-full max-w-md p-6">
      <form onSubmit={(e) => {
        e.preventDefault();
        if (!trwa) onZamknij(powod.trim() || undefined);
      }}>
        <h2 id="zamkniecie-tytul" className="text-naglowek font-bold">Zamknąć zwrot ręcznie?</h2>
        <p className="mt-2 text-sm text-slate-700">Zamyka tylko u nas. Allegro i Subiekt bez zmian.</p>
        {pieniadzeCzekaja &&
          <p className="mt-2 text-sm font-semibold text-ranga-uwaga">
            Pieniądze za ten zwrot jeszcze nie wyszły.</p>}
        <label className="mt-4 block text-sm font-semibold">Powód (opcjonalnie)
          <Pole className="mt-1" value={powod} maxLength={MAKS_POWODU} data-fokus-startowy
            onChange={(e) => setPowod(e.target.value)} /></label>
        <div className="mt-3"><Blad>{blad}</Blad></div>
        <div className="mt-5 flex justify-end gap-2">
          <Przycisk type="button" onClick={onAnuluj}>Anuluj</Przycisk>
          <Przycisk type="submit" wariant="glowny" disabled={trwa}>
            {trwa ? "Zamykam…" : "Zamknij"}</Przycisk>
        </div>
      </form>
    </div>
  </div>;
}
