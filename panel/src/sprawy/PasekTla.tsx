import React from "react";
import { Info } from "lucide-react";
import { dzien } from "../ui";
import { sprawSlowo } from "./Moje";
import type { ProgKolejki } from "../api/typy";

/* ── Tło pracy w JEDNYM cienkim wierszu (0.392.0) ────────────────────────────
   Zgłoszenie właściciela ze zrzutem: „schowaj to gdzieś, zajmuje dużo
   miejsca". Nad kolejką stały DWIE karty pełnej szerokości — próg daty
   i stan synchronizacji — czyli około dziewięćdziesięciu pikseli na rzeczy,
   których biuro nie czyta przy każdej sprawie.

   To jest TŁO PRACY, nie praca. Dekalog ergonomii, punkt 2: pierwszeństwo ma
   to, co rozstrzyga bieżącą czynność; reszta zostaje wizualnie drugorzędna.

   CISZA JEST CICHA, ALARM ZOSTAJE GŁOŚNY i to jest cała reguła tego pliku.
   Zwinięcie do jednej szarej linii dotyczy stanu normalnego. Gdy próg chowa
   sprawy z ŻYWYM TERMINEM, gdy synchronizacja stoi albo gdy lista jest
   niekompletna — pasek wraca do pełnej, kolorowej karty. Schowanie alarmu
   pod „i" byłoby kupieniem pikseli za pracę, której nikt nie zobaczy;
   `PasekProgu` zapłacił za tę regułę w 0.385.0, a zwroty w 0.339.0.        */

/** Czy cokolwiek w tle woła o uwagę — wtedy pasek zostaje kartą. */
export function tloAlarmuje(p: {
  prog?: ProgKolejki | null;
  zlaSynchronizacja?: boolean;
  pozostaloDoPobrania?: number | null;
}): boolean {
  return Boolean(
    (p.prog && !p.prog.zdjety && p.prog.ukrytychZTerminem > 0)
    || p.zlaSynchronizacja
    || (p.pozostaloDoPobrania && p.pozostaloDoPobrania > 0),
  );
}

/**
 * Cichy wiersz tła — próg, stan kanału i ich dwie akcje.
 *
 * Rysuje się TYLKO w stanie spokojnym; alarm ma własne, głośne paski i one
 * zostają bez zmian. Wołający sprawdza to `tloAlarmuje` i wybiera jedno
 * z dwóch — dlatego ten komponent nie zna słowa „czerwony".
 */
export function PasekTla({ prog, onPrzelaczProg, stanTekst, onSynchronizuj, trwaSync }: {
  prog?: ProgKolejki | null;
  onPrzelaczProg?: (zdejmij: boolean) => void;
  /** Jedno zdanie o kanale, np. „synchronizacja działa”. */
  stanTekst?: string;
  /** Bez niej wiersz nie rysuje przycisku — ekran dyskusji go nie ma. */
  onSynchronizuj?: () => void;
  trwaSync?: boolean;
}) {
  const mowiOProgu = Boolean(prog?.od && (prog.zdjety || prog.ukrytych > 0));
  if (!mowiOProgu && !stanTekst) return null;

  return <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1
    px-1 text-podpis text-slate-500">
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
