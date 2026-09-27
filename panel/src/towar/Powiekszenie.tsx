import React from "react";
import { X } from "lucide-react";
import { useOkno } from "../nawigacja/fokus";

/* Powiększenie służy JEDNEMU pytaniu: czy to ten sam wariant, który wrócił.
   Dlatego nie ma tu galerii ani zoomu — jest obraz, podpis i wyjście.

   OBRAZ WCHODZI PROPSEM, nie hakiem po `twId` (0.213.0). Od tego wydania
   źródła są dwa — kartoteka Subiekta i oferta Allegro — a okno powiększenia
   jest dla obu takie samo. Wybór źródła należy do kafla, który je otworzył. */

export function Powiekszenie({ url, nazwa, symbol, zamknij }: {
  /** `undefined` = jeszcze się ładuje, `null` = obrazu nie ma. */
  url: string | null | undefined;
  nazwa: string; symbol: string | null; zamknij: () => void;
}) {

  /* Escape zamyka, jak każdy dialog w tym panelu. Bez tego operator
     szukałby myszką krzyżyka w rogu. Modalne od @wydanie także dla
     klawiatury: skróty strony pod nakładką milkną (`nawigacja/fokus.ts`). */
  const okno = useOkno<HTMLDivElement>({ onZamknij: zamknij });

  return <div role="dialog" {...okno} aria-label={`Zdjęcie: ${nazwa}`}
    className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" onClick={zamknij}>
    <div className="max-h-full w-full max-w-2xl overflow-auto rounded-xl bg-white p-4"
      onClick={(e) => e.stopPropagation()}>
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-bold">{nazwa}</h2>
          {symbol && <p className="text-sm text-slate-500">{symbol}</p>}
        </div>
        <button onClick={zamknij} aria-label="Zamknij"
          className="ml-auto rounded-lg p-1 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
      </div>
      {url
        ? <img src={url} alt={nazwa} className="mx-auto max-h-[70vh] rounded-lg" />
        : <p className="p-10 text-center text-sm text-slate-500">
            {url === null ? "Ta kartoteka nie ma zdjęcia." : "Wczytuję…"}</p>}
    </div>
  </div>;
}
