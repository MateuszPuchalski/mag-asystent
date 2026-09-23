import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AtSign, Check, Lock } from "lucide-react";
import { useOdhaczWzmianke, useWzmianki } from "../api/rozmowy";
import { Blad, Karta, Przycisk, czas } from "../ui";

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

  /* ── SEKCJA „DO ZROBIENIA" (23 września 2026) ─────────────────────────────
     Powód przy `Moje` — trzy zakładki z jednym pytaniem stały się jednym
     ekranem. Wzmianka idzie WIERSZEM, nie kartą: na wspólnym ekranie karta
     na każdą prośbę spychała decyzje biura pod krawędź. */
  return <Karta className="overflow-hidden p-0" aria-label="Wspomniano o mnie" role="region">
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
      <AtSign size={16} /><b className="mr-auto">Wspomniano o mnie</b>
      <span className="text-sm text-slate-600">
        {dane.data ? `${dane.data.nowe} do zajęcia się` : "Wczytuję…"}</span>
      {/* Cel klikalny to CAŁA etykieta (0.255.0). Sam kwadracik miał 13×13 px
          przy progu 24×24 z WCAG 2.2 AA — ta sama usterka co w pasku zwrotów
          i ta sama naprawa, żeby nie było dwóch wzorców na jedno. */}
      <label className="flex min-h-6 cursor-pointer items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={zHistoria} className="h-4 w-4 shrink-0"
          onChange={(e) => setZHistoria(e.target.checked)} />
        Pokaż odhaczone</label>
    </div>

    <Blad>{blad || (dane.error as Error | null)?.message}</Blad>

    {!dane.isLoading && !widoczne.length && <p className="px-4 py-2 text-sm text-slate-500">
      {wszystkie.length ? "Wszystko odhaczone." : "Nikt Cię jeszcze nie wzmiankował."}</p>}

    {widoczne.length > 0 && <ul>
      {widoczne.map((w) => <li key={w.commentId}
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 first:border-t-0 ${
          w.odhaczona ? "opacity-60" : ""}`}>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
          {/* Kłódka jak na osi: to jest notatka wewnętrzna, nie głos klienta. */}
          <Lock size={12} /><b className="text-slate-700">{w.autor}</b>
          <span>· rozmowa z {w.klient}</span><span>· {czas(w.at)}</span>
          {w.odhaczona && <span className="font-semibold text-ranga-ok">
            odhaczone {czas(w.odhaczonaAt)}</span>}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm" title={w.fragment}>{w.fragment}</span>
        <span className="flex shrink-0 gap-2">
          <Przycisk className="px-2 py-1 text-xs"
            onClick={() => nawiguj(`/obsluga/skrzynka/${w.conversationId}`)}>
            OTWÓRZ ROZMOWĘ</Przycisk>
          {/* Przejście do rozmowy NIE odhacza. Agent bywa w niej po to, żeby
              dopiero zobaczyć, czy sprawa jest jego. */}
          {!w.odhaczona && <Przycisk className="px-2 py-1 text-xs" disabled={odhacz.isPending}
            onClick={() => { setBlad(""); odhacz.mutate({ commentId: w.commentId },
              { onError: (e) => setBlad((e as Error).message) }); }}>
            <Check size={14} />ODHACZ</Przycisk>}
        </span>
      </li>)}
    </ul>}
  </Karta>;
}
