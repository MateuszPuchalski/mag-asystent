import React from "react";
import { Info } from "lucide-react";
import { dzien } from "../ui";
import type { ProgKolejki } from "../api/typy";

/* ── Tło pracy w JEDNYM cienkim wierszu ──────────────────────────────────────
   Próg daty i stan synchronizacji to rzeczy, których biuro nie czyta przy
   każdej sprawie, więc nie zajmują nad kolejką dwóch kart pełnej szerokości.

   To jest TŁO PRACY, nie praca. Dekalog ergonomii, punkt 2: pierwszeństwo ma
   to, co rozstrzyga bieżącą czynność; reszta zostaje wizualnie drugorzędna.

   CISZA JEST CICHA, ALARM ZOSTAJE GŁOŚNY i to jest cała reguła tego pliku.
   Zwinięcie do jednej szarej linii dotyczy stanu normalnego. Gdy próg chowa
   sprawy z ŻYWYM TERMINEM, gdy synchronizacja stoi albo gdy lista jest
   niekompletna — pasek wraca do pełnej, kolorowej karty. Schowanie alarmu
   pod „i" byłoby kupieniem pikseli za pracę, której nikt nie zobaczy.      */

/**
 * Cichy wiersz tła — próg, stan kanału i ich dwie akcje.
 *
 * Rysuje się TYLKO w stanie spokojnym; alarm ma własne, głośne paski
 * i o tym, który narysować, decyduje wołający — dlatego ten komponent nie
 * zna słowa „czerwony".
 */
export function PasekTla({ prog, onPrzelaczProg, stanTekst, onSynchronizuj, trwaSync }: {
  prog?: ProgKolejki | null;
  onPrzelaczProg?: (zdejmij: boolean) => void;
  /** Jedno zdanie o kanale, np. „synchronizacja działa”. Może nieść odnośnik. */
  stanTekst?: React.ReactNode;
  /** Bez niej wiersz nie rysuje przycisku synchronizacji. */
  onSynchronizuj?: () => void;
  trwaSync?: boolean;
}) {
  const mowiOProgu = Boolean(prog?.od && (prog.zdjety || prog.ukrytych > 0));
  if (!mowiOProgu && !stanTekst) return null;

  /* `slate-600`, nie `slate-500`. Wiersz stoi wprost na tle strony
     (`#F1F5F9`), a tam `slate-500` przy 11 px daje 4.34:1, poniżej progu
     4.5:1. Strażnik `Kontrast` tego nie widzi, bo tło przychodzi od rodzica. */
  return <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1
    px-1 text-podpis text-slate-600">
    <Info size={12} className="shrink-0 text-slate-400" aria-hidden="true" />

    {mowiOProgu && prog && <>
      <span>{prog.zdjety
        ? <>wszystkie sprawy, także sprzed {dzien(prog.od)}</>
        : <>od {dzien(prog.od)} · starszych <b className="tabular-nums">{prog.ukrytych}</b></>}
      </span>
      {onPrzelaczProg && <button type="button" onClick={() => onPrzelaczProg(!prog.zdjety)}
        className="font-semibold underline underline-offset-2 hover:text-slate-800">
        {prog.zdjety ? "wróć do progu" : "pokaż starsze"}
      </button>}
    </>}

    {mowiOProgu && stanTekst && <span aria-hidden="true" className="text-slate-300">·</span>}
    {stanTekst && <span>{stanTekst}</span>}

    {onSynchronizuj && <button type="button" disabled={trwaSync} onClick={onSynchronizuj}
      className="ml-auto font-semibold underline underline-offset-2 hover:text-slate-800
        disabled:opacity-50">
      {trwaSync ? "pobieram…" : "synchronizuj"}
    </button>}
  </div>;
}
