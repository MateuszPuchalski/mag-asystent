import React, { useState } from "react";
import { FileText } from "lucide-react";
import type { ModelZOpisu } from "../api/typy";
import { useModeleZOpisow, useOdrzucModelZOpisu, usePrzerobModelZOpisu } from "../api/wiedza";
import { Blad, Pusto, Przycisk } from "../ui";
import { PolaModelu, type DaneModelu } from "./PolaModelu";

/**
 * „Z opisów" (E3): sekcje „Modele:" wycięte z opisów kartotek po imporcie.
 * Decyzja właściciela: automat NIE proponuje z opisu — `FS350 FS400` nie
 * mówi, czyja to maszyna. Człowiek wskazuje markę i model, dopiero to tworzy
 * propozycję (źródło „z opisu kartoteki", dowód „decyzja biura"). Odrzucony
 * wiersz nie wraca po kolejnym imporcie.
 */
export function ZOpisow() {
  const lista = useModeleZOpisow();
  const przerob = usePrzerobModelZOpisu();
  const odrzuc = useOdrzucModelZOpisu();
  const [blad, setBlad] = useState("");
  const [ostatnie, setOstatnie] = useState("");
  const wiersze = lista.data?.wiersze ?? [];

  return <div className="space-y-3">
    <p className="text-xs text-slate-500">
      Sekcje „Modele:" z opisów kartotek. Wskaż markę i model — powstanie propozycja do kolejki.
      Odrzuć, gdy to nie jest lista modeli; odrzucone nie wracają po imporcie.
    </p>
    <Blad>{blad || (lista.error as Error | null)?.message}</Blad>
    {ostatnie && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{ostatnie}</p>}
    {!lista.isLoading && wiersze.length === 0 &&
      <Pusto ikona={<FileText size={38} />}>Nic do przerobienia. Nowe sekcje pojawią się po imporcie kartotek.</Pusto>}
    {lista.data && lista.data.liczba > wiersze.length && <p className="text-xs text-slate-500">
      Pokazuję {wiersze.length} z {lista.data.liczba} — reszta po przerobieniu tych.</p>}
    <ul className="space-y-3">
      {wiersze.map((m) => <Wiersz key={m.id} m={m} trwa={przerob.isPending || odrzuc.isPending}
        onPrzerob={(model) => { setBlad(""); setOstatnie("");
          przerob.mutate({ id: m.id, model }, {
            onSuccess: (z) => setOstatnie(`Propozycja ${z.symbol} → ${z.model.etykieta} czeka w kolejce.`),
            onError: (e) => setBlad((e as Error).message),
          }); }}
        onOdrzuc={() => { setBlad(""); setOstatnie("");
          odrzuc.mutate({ id: m.id }, { onError: (e) => setBlad((e as Error).message) }); }} />)}
    </ul>
  </div>;
}

function Wiersz({ m, trwa, onPrzerob, onOdrzuc }: {
  m: ModelZOpisu; trwa: boolean;
  onPrzerob: (model: { rodzaj: "maszyna" | "silnik"; marka: string; nazwa: string; wariant: string | null }) => void;
  onOdrzuc: () => void;
}) {
  const [model, setModel] = useState<DaneModelu>({ rodzaj: "maszyna", marka: "", nazwa: "", wariant: "" });
  /* Bez marki i modelu przycisk stoi — pilnuje tego przycisk, nie odmowa z serwera. */
  const gotowe = Boolean(model.marka.trim() && model.nazwa.trim());
  return <li className="rounded-lg border border-slate-200 p-3" aria-label={`Z opisu: ${m.symbol}`}>
    <div className="flex flex-wrap items-baseline gap-2">
      <b className="font-mono">{m.symbol}</b>
      <span className="text-sm text-slate-700">{m.nazwa ?? ""}</span>
    </div>
    <p className="mt-1 rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-800">Modele: {m.tekst}</p>
    <div className="mt-2 space-y-2">
      <PolaModelu dane={model} onZmiana={setModel} zwarte />
      <div className="flex flex-wrap gap-2">
        <Przycisk wariant="glowny" className="text-xs" disabled={!gotowe || trwa}
          onClick={() => onPrzerob({ rodzaj: model.rodzaj, marka: model.marka.trim(), nazwa: model.nazwa.trim(),
            wariant: model.wariant.trim() || null })}>Zaproponuj</Przycisk>
        <Przycisk className="text-xs" disabled={trwa} onClick={onOdrzuc}>Odrzuć</Przycisk>
      </div>
    </div>
  </li>;
}
