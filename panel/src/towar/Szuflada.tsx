import React, { createContext, useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, Package, Scale, Undo2, X } from "lucide-react";
import { useKartaTowaru } from "../api/rozmowy";
import { useWiedzaTowaru } from "../api/wiedza";
import { usePrzekrojTowaru } from "../api/towar";
import { dopisekDostaw } from "../skrzynka/PasmoOdpowiedzi";
import { Kafel } from "./Kafel";
import { dzien } from "../ui";

/* ── SZUFLADA TOWARU — TRZECI MOSTEK (0.502.0) ──────────────────────────────
   Towar stał na dziewięciu ekranach — w skrzynce, zwrotach, koszach,
   dostawach, zadaniach, wiedzy, stanie, dzienniku i w szukaniu — i nigdzie
   nie był odnośnikiem. „Ten nóż wraca trzeci raz w tym miesiącu" składało
   się z trzech kolejek w głowie agenta. Tu stoi w jednym miejscu: stan,
   dostawy, wiedza, otwarte sprawy i liczby z 90 dni.

   SZUFLADA, NIE EKRAN (§7 celu biura): to wgląd, nie praca. Nie ma w niej
   decyzji — każdy wiersz prowadzi do sprawy, w której ta decyzja zapada.
   Otwiera się nad bieżącym ekranem, więc agent nie traci miejsca w pracy.

   KONTEKST, NIE PROPSY. Przycisk towaru stoi głęboko w komponentach
   dziewięciu ekranów; przekazywanie „otwórz szufladę" przez każdy poziom
   byłoby dziewięcioma łańcuchami propsów. Bez dostawcy kontekstu (testy
   pojedynczych komponentów) przycisk jest zwykłym tekstem. */

const Kontekst = createContext<((twId: number) => void) | null>(null);

export function SzufladaTowaru({ children }: { children: React.ReactNode }) {
  const [twId, setTwId] = useState<number | null>(null);
  return <Kontekst.Provider value={setTwId}>
    {children}
    {twId !== null && <Szuflada twId={twId} onZamknij={() => setTwId(null)} />}
  </Kontekst.Provider>;
}

/** Symbol albo nazwa towaru jako wejście do szuflady; bez kontekstu — sam tekst. */
export function PrzyciskTowaru({ twId, children, className = "" }: {
  twId: number | null; children: React.ReactNode; className?: string;
}) {
  const otworz = useContext(Kontekst);
  if (!otworz || twId === null) return <>{children}</>;
  return <button type="button" onClick={() => otworz(twId)} title="Przekrój towaru: stan, dostawy, zwroty i sprawy"
    className={`underline decoration-dotted underline-offset-2 hover:decoration-solid ${className}`}>
    {children}</button>;
}

const procent = (u: number | null) => (u === null ? "—" : `${Math.round(u * 100)}%`);

function Szuflada({ twId, onZamknij }: { twId: number; onZamknij: () => void }) {
  const karta = useKartaTowaru(twId);
  const przekroj = usePrzekrojTowaru(twId);
  const wiedza = useWiedzaTowaru(twId);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") onZamknij(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onZamknij]);
  const k = karta.data;
  const p = przekroj.data;
  const dopisek = k ? dopisekDostaw(k) : null;

  return <aside role="dialog" aria-label={`Towar ${k?.sym ?? twId}`}
    className="fixed inset-y-0 right-0 z-50 flex w-[min(30rem,100vw)] flex-col border-l border-slate-200 bg-white shadow-2xl">
    <div className="flex items-start gap-3 border-b border-slate-200 p-4">
      <Kafel twId={twId} rozmiar={56} nazwa={k?.name ?? "Kartoteka"} symbol={k?.sym ?? null} />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm text-slate-600">{k?.sym ?? `#${twId}`}</p>
        <h2 className="font-bold text-slate-900">{k?.name ?? "Wczytuję kartotekę…"}</h2>
      </div>
      <button type="button" aria-label="Zamknij" onClick={onZamknij} className="rounded p-1 hover:bg-slate-100">
        <X size={18} /></button>
    </div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
      {k && <section aria-label="Stan">
        <p><b className={k.mag.avail > 0 ? "text-ranga-ok" : "text-ranga-zle"}>
          {k.mag.avail > 0 ? `${k.mag.avail} ${k.unit ?? "szt."} wolne` : "brak na stanie"}</b>
          {k.locs.length > 0 && <span className="font-mono text-slate-600"> · {k.locs.join(", ")}</span>}</p>
        {dopisek && <p className="text-slate-700">{dopisek}</p>}
      </section>}

      {/* LICZBY Z 90 DNI: udział zwrotów to sygnał dla zakupów i opisu oferty.
          Bez koloru oceny — przy kilku sztukach sprzedaży jeden zwrot to 50%. */}
      {p && <section aria-label="Ostatnie 90 dni" className="rounded-lg bg-slate-50 p-3">
        <h3 className="mb-1 text-podpis font-bold uppercase tracking-wide text-slate-700">Ostatnie {p.okno.dni} dni</h3>
        <p>sprzedane {p.okno.sprzedanych} · zwrócone {p.okno.zwroconych} ({procent(p.okno.udzialZwrotow)})
          · reklamacje {p.okno.reklamacji}</p>
        <p className="text-podpis text-slate-600">
          {p.oferty.length ? `Z ${p.oferty.length} ofert powiązanych z kartoteką.`
            : "Żadna oferta nie jest powiązana z tą kartoteką — sprzedaży nie znamy."}</p>
      </section>}

      {p && <Lista tytul="Otwarte zwroty" ikona={<Undo2 size={14} />} pusto="brak"
        wiersze={p.otwarteZwroty.map((z) => ({ klucz: `z${z.id}`, do: `/obsluga/zwroty/${z.id}`,
          napis: `${z.numer ?? `#${z.id}`} · ${z.ilosc} szt.`, at: z.at }))} onIdz={onZamknij} />}
      {p && <Lista tytul="Otwarte reklamacje i dyskusje" ikona={<Scale size={14} />} pusto="brak"
        wiersze={p.otwarteSprawy.map((s) => ({ klucz: `s${s.id}`,
          do: `/obsluga/${s.typ === "DISPUTE" ? "dyskusje" : "reklamacje"}/${s.id}`,
          napis: `${s.typ === "DISPUTE" ? "dyskusja" : "reklamacja"} ${s.numer ?? `#${s.id}`}`, at: s.at }))}
        onIdz={onZamknij} />}
      {p && <Lista tytul="Otwarte rozmowy o tym towarze" ikona={<MessageSquare size={14} />} pusto="brak"
        wiersze={p.otwarteRozmowy.map((r) => ({ klucz: `r${r.id}`, do: `/obsluga/skrzynka/${r.id}`,
          napis: r.temat ?? "Rozmowa bez tematu", at: r.at }))} onIdz={onZamknij} />}

      {wiedza.data && <section aria-label="Wiedza">
        <h3 className="mb-1 flex items-center gap-1 text-podpis font-bold uppercase tracking-wide text-slate-700">
          <Package size={14} />Wiedza</h3>
        <p>{wiedza.data.potwierdzone.length} potwierdzonych zastosowań · {wiedza.data.negatywne.length} negatywnych
          {wiedza.data.propozycje.length ? ` · ${wiedza.data.propozycje.length} propozycji` : ""}</p>
      </section>}
    </div>
  </aside>;
}

function Lista({ tytul, ikona, wiersze, pusto, onIdz }: {
  tytul: string; ikona: React.ReactNode; pusto: string; onIdz: () => void;
  wiersze: Array<{ klucz: string; do: string; napis: string; at: string }>;
}) {
  return <section aria-label={tytul}>
    <h3 className="mb-1 flex items-center gap-1 text-podpis font-bold uppercase tracking-wide text-slate-700">
      {ikona}{tytul}</h3>
    {wiersze.length === 0 ? <p className="text-slate-600">{pusto}</p>
      : <ul className="space-y-0.5">{wiersze.map((w) => <li key={w.klucz}>
        {/* Przejście ZAMYKA szufladę: decyzja zapada na ekranie sprawy. */}
        <Link to={w.do} onClick={onIdz} className="text-sky-800 underline underline-offset-2">{w.napis}</Link>
        <span className="ml-2 text-podpis text-slate-600">{dzien(w.at)}</span>
      </li>)}</ul>}
  </section>;
}
