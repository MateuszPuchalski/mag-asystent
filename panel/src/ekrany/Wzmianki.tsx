import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AtSign, Check, Lock } from "lucide-react";
import { useOdhaczWzmianke, useWzmianki } from "../api/rozmowy";
import { Blad, Karta, Przycisk, Pusto, czas } from "../ui";

/* Skrzynka wzmianek — „wspomniano o mnie" (§6.4, 0.160.0).
   
   Do tego wydania wzmianka docierała wyłącznie do tego, kto sam otworzył
   właściwą rozmowę. Ekran jest tu po to, żeby prośba kolegi nie zależała od
   zgadywania, w którym wątku ją zostawił.

   ODHACZENIE JEST JAWNE. Otwarcie tej listy niczego nie kasuje — reguła „zero
   zapisu przy patrzeniu" obowiązuje też tutaj, a wzmianka gasnąca od samego
   spojrzenia ginęłaby dokładnie wtedy, gdy agent przewija listę w biegu. */
export function Wzmianki() {
  const nawiguj = useNavigate();
  const dane = useWzmianki();
  const odhacz = useOdhaczWzmianke();
  const [blad, setBlad] = useState("");
  /* Odhaczone zostają na liście jako dowód „pisałam ci o tym w środę", ale
     domyślnie schodzą z oczu: robotą do zrobienia są te nieodhaczone. */
  const [zHistoria, setZHistoria] = useState(false);

  const wszystkie = dane.data?.wzmianki ?? [];
  const widoczne = zHistoria ? wszystkie : wszystkie.filter((w) => !w.odhaczona);

  /* Własny scroller — patrz `Zadania`; rama panelu nie przewija za ekrany. */
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <Karta className="flex flex-wrap items-center gap-3 p-4">
      <AtSign size={18} /><b className="mr-auto">Wspomniano o mnie</b>
      <span className="text-sm text-slate-500">
        {dane.data ? `${dane.data.nowe} do zajęcia się` : "Wczytuję…"}</span>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={zHistoria}
          onChange={(e) => setZHistoria(e.target.checked)} />
        Pokaż odhaczone</label>
    </Karta>

    <Blad>{blad || (dane.error as Error | null)?.message}</Blad>

    {!dane.isLoading && !widoczne.length && <Karta className="flex">
      <Pusto ikona={<AtSign size={38} />}>
        {wszystkie.length ? "Wszystko odhaczone." : "Nikt Cię jeszcze nie wzmiankował."}
      </Pusto></Karta>}

    {widoczne.map((w) => <Karta key={w.commentId}
      className={`p-4 ${w.odhaczona ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {/* Kłódka jak na osi: to jest notatka wewnętrzna, nie głos klienta. */}
        <Lock size={12} /><b className="text-slate-700">{w.autor}</b>
        <span>· rozmowa z {w.klient}</span>
        <span>· {czas(w.at)}</span>
        {w.odhaczona && <span className="font-semibold text-ranga-ok">
          odhaczone {czas(w.odhaczonaAt)}</span>}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{w.fragment}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Przycisk wariant="glowny"
          onClick={() => nawiguj(`/obsluga/skrzynka/${w.conversationId}`)}>
          OTWÓRZ ROZMOWĘ</Przycisk>
        {/* Przejście do rozmowy NIE odhacza. Agent bywa w niej po to, żeby
            dopiero zobaczyć, czy sprawa jest jego. */}
        {!w.odhaczona && <Przycisk disabled={odhacz.isPending}
          onClick={() => { setBlad(""); odhacz.mutate({ commentId: w.commentId },
            { onError: (e) => setBlad((e as Error).message) }); }}>
          <Check size={16} />ODHACZ</Przycisk>}
      </div>
    </Karta>)}
  </div>;
}
