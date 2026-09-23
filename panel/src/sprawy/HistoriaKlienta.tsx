import React, { useEffect, useState } from "react";
import { History, UserRound, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useHistoriaSprawy } from "../api/spoiwo";
import { WidokHistorii } from "../skrzynka/Klient";
import { Blad, Pusto } from "../ui";

/* ── Historia klienta jednym kliknięciem z każdej sprawy (23 września 2026) ──
   Punkt 1 dekalogu obsługi: klient ma JEDNĄ drogę, a kolejki są nasze. Do tego
   wydania całą historię kupującego widziała wyłącznie skrzynka, w zakładce
   KLIENT. Agent przy zwrocie nie wiedział, że ten sam kupujący pisał tydzień
   temu o tej samej części — chyba że poszedł jej szukać.

   SZUFLADA, NIE ZAKŁADKA. Kolumny zwrotu, reklamacji i dyskusji są już pełne,
   a historia jest pytaniem zadawanym czasem, nie przy każdej sprawie.
   Szuflada zasłania ekran tylko na czas czytania i zamyka się Esc.

   Pobiera się DOPIERO po kliknięciu. Otwarcie sprawy niczego tu nie woła,
   więc liczniki żądań w testach ekranów się nie zmieniają. Widok jest ten sam
   co w skrzynce (`WidokHistorii`), żeby klienta czytało się tak samo. */

export function PrzyciskHistorii({ rodzaj, id, tutaj }: {
  rodzaj: "zwrot" | "sprawa";
  id: number;
  /** „tym zwrotem", „tą reklamacją" — o czym mówi pusta oś. */
  tutaj: string;
}) {
  const [otwarta, setOtwarta] = useState(false);
  /* Inna sprawa to inna szuflada — przejście do rodzeństwa zamyka starą,
     inaczej pokazywałaby historię sprawy, z której agent już wyszedł. */
  useEffect(() => { setOtwarta(false); }, [rodzaj, id]);
  return <>
    <button type="button" onClick={() => setOtwarta(true)} aria-haspopup="dialog"
      title="Cała historia tego kupującego u nas"
      className="inline-flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
      <History size={13} />Historia</button>
    {otwarta && <Szuflada rodzaj={rodzaj} id={id} tutaj={tutaj} onZamknij={() => setOtwarta(false)} />}
  </>;
}

function Szuflada({ rodzaj, id, tutaj, onZamknij }: {
  rodzaj: "zwrot" | "sprawa"; id: number; tutaj: string; onZamknij: () => void;
}) {
  const h = useHistoriaSprawy(rodzaj, id, true);
  const nawiguj = useNavigate();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onZamknij(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onZamknij]);

  return <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onZamknij}>
    <aside role="dialog" aria-label="Historia klienta" onClick={(e) => e.stopPropagation()}
      className="flex h-full w-full max-w-md flex-col bg-white shadow-xl">
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <UserRound size={16} /><b className="mr-auto">Historia klienta</b>
        <button type="button" onClick={onZamknij} aria-label="Zamknij historię"
          className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {h.isLoading && <Pusto waga="lista">Szukam historii klienta…</Pusto>}
        <Blad>{(h.error as Error | null)?.message}</Blad>
        {h.data && (h.data.login
          ? <WidokHistorii historia={{ ...h.data, login: h.data.login }} tutaj={tutaj}
              onOtworzRozmowe={(r) => nawiguj(`/obsluga/skrzynka/${r}`)} />
          : <Pusto waga="lista" ikona={UserRound}>
              Allegro nie podało loginu kupującego, więc nie wiemy, czyja to historia.</Pusto>)}
      </div>
    </aside>
  </div>;
}
