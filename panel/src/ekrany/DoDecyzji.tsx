import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowUpRight, Barcode, ChevronRight, CircleCheck, Inbox, MessageSquareReply,
  MessagesSquare, Package, PlugZap, ShieldQuestion, Truck, Undo2,
} from "lucide-react";
import { useDoDecyzji, type Obszar, type PozycjaDecyzji, type ZrodloDecyzji } from "../api/decyzje";
import { useJa } from "../api/rozmowy";
import { doBiura } from "../mostBiura";
import { Blad, FiltrSegmentowy, Karta, Pusto, wiek } from "../ui";

/* ── DO DECYZJI — ekran startowy biura (0.435.0) ───────────────────────────
   Cel biura z `docs/obsluga-klienta.md` §7: rozstrzyga to, czego hala nie
   rozstrzygnie sama. Ten ekran jest tym celem w jednym widoku — dlatego
   stoi pod `/obsluga/`, a Zadania poszły pod `/obsluga/zadania`.

   WIERSZ PROWADZI TAM, GDZIE SPRAWĘ SIĘ ROZSTRZYGA. Tu nie ma przycisków
   decyzji: wyjątek dostawy rozstrzyga się przy fakturze i jej zdjęciach,
   reklamację przy czacie z kupującym. Przycisk „uznaj" na tej liście
   kazałby decydować bez dowodów — a to jest dokładnie to, czego biuro
   robić nie powinno. Ta sama zasada co w „Moje".

   Ekran, który jeszcze mieszka w `biuro.html`, otwiera się mostem — jak
   drugi rząd nagłówka. Strzałka „na zewnątrz" mówi to przed kliknięciem. */

const IKONY: Record<ZrodloDecyzji, React.ComponentType<{ size?: number; className?: string }>> = {
  dostawy: Truck, odpowiedzi: MessageSquareReply, kosze: Package, zapisy: AlertTriangle,
  kody: Barcode, allegro: PlugZap, reklamacje: ShieldQuestion, zwroty: Undo2,
  skrzynka: Inbox, dyskusje: MessagesSquare,
};

const NAZWY: Record<ZrodloDecyzji, string> = {
  dostawy: "Dostawy", odpowiedzi: "Odpowiedź z hali", kosze: "Kosze", zapisy: "Zapis do Subiekta",
  kody: "Kody kreskowe", allegro: "Konto Allegro", reklamacje: "Reklamacje", zwroty: "Zwroty",
  skrzynka: "Skrzynka", dyskusje: "Dyskusje",
};

type Filtr = "wszystko" | Obszar;

function Wiek({ p }: { p: PozycjaDecyzji }) {
  if (!p.od) return p.pilne
    ? <span className="shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-ranga-zle">pilne</span>
    : null;
  const ms = Math.max(0, Date.now() - Date.parse(p.od));
  /* Czerwień TYLKO przy pilnym — kolor zapalany zawsze uczy go ignorować
     (ta sama reguła co przy terminie w „Moje"). */
  return <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold tabular-nums ${
    p.pilne ? "bg-red-100 text-ranga-zle" : "bg-slate-100 text-slate-600"}`}
    title={p.pilne ? "Termin minął albo mija" : "Od kiedy czeka"}>{wiek(ms)}</span>;
}

function Wiersz({ p, kto }: { p: PozycjaDecyzji; kto: string }) {
  const Ikona = IKONY[p.zrodlo];
  const tresc = <>
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
      <Ikona size={18} /></span>
    <span className="w-36 shrink-0 text-xs font-bold text-slate-700">{NAZWY[p.zrodlo]}</span>
    <span className="min-w-0 flex-1">
      <b className="block truncate">{p.pytanie}</b>
      <span className="block truncate text-sm text-slate-600">{p.co}</span>
    </span>
    <Wiek p={p} />
  </>;
  const klasa = "flex items-center gap-3 px-4 py-3 hover:bg-slate-50";
  return <li className="border-t border-slate-200 first:border-t-0">
    {"panel" in p.cel
      ? <Link to={p.cel.panel} className={klasa}>{tresc}
          <ChevronRight size={18} className="shrink-0 text-slate-400" /></Link>
      : <a href="/biuro" className={klasa} title="Otwiera się w dawnym biurze"
          onClick={() => doBiura((p.cel as { biuro: "magazyn" | "nadzor" }).biuro, kto)}>{tresc}
          <ArrowUpRight size={18} className="shrink-0 text-slate-400" /></a>}
  </li>;
}

export function DoDecyzji() {
  const dane = useDoDecyzji();
  const ja = useJa();
  const [filtr, setFiltr] = useState<Filtr>("wszystko");
  const pozycje = (dane.data?.pozycje ?? []).filter((p) => filtr === "wszystko" || p.obszar === filtr);
  const l = dane.data?.liczniki;

  /* Własny scroller — jak w Zadaniach i „Moje"; rama panelu nie przewija za
     ekrany. */
  return <div className="lg:h-full lg:overflow-y-auto">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-tytul font-bold">Do decyzji</h1>
        {/* slate-600 na tle strony — powód przy tym samym akapicie w Zadaniach. */}
        <p className="text-sm text-slate-600">
          Sprawy, w których rozstrzyga biuro. Każda otwiera się tam, gdzie są jej dowody.</p>
      </div>
      <div className="flex gap-1">
        <FiltrSegmentowy<Filtr> wybrany={filtr} onWybierz={setFiltr} pozycje={[
          { klucz: "wszystko", etykieta: "Wszystko", ile: l?.wszystko },
          { klucz: "magazyn", etykieta: "Magazyn", ile: l?.magazyn },
          { klucz: "obsluga", etykieta: "Obsługa klienta", ile: l?.obsluga },
        ]} />
      </div>
    </div>
    <div className="mb-4"><Blad>{(dane.error as Error | null)?.message}</Blad></div>
    <Karta className="overflow-hidden p-0">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-600">
        Najpilniejsze pierwsze — termin, potem wiek</div>
      {dane.isLoading
        ? <Pusto waga="lista">Wczytuję…</Pusto>
        : pozycje.length === 0
          ? <Pusto ikona={CircleCheck}>Nic nie czeka na biuro.</Pusto>
          : <ul>{pozycje.map((p) => <Wiersz key={p.klucz} p={p} kto={ja.data?.user.name ?? ""} />)}</ul>}
    </Karta>
  </div>;
}
