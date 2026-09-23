import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Barcode, ChevronRight, CircleCheck, Inbox, ListChecks, MessageSquareReply,
  MessagesSquare, Package, PlugZap, ShieldQuestion, Truck, Undo2,
} from "lucide-react";
import { useDoDecyzji, type Obszar, type PozycjaDecyzji, type ZrodloDecyzji } from "../api/decyzje";
import { Blad, FiltrSegmentowy, Karta, Pusto, wiek } from "../ui";
import { Moje } from "./Moje";
import { Wzmianki } from "./Wzmianki";

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

function Wiersz({ p }: { p: PozycjaDecyzji }) {
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
    <Link to={p.cel.panel} className={klasa}>{tresc}
      <ChevronRight size={18} className="shrink-0 text-slate-400" /></Link>
  </li>;
}

/* ── JEDNA LISTA „DO ZROBIENIA" (23 września 2026) ──────────────────────────
   „Do decyzji", „Moje" i „Wzmianki" odpowiadały na to samo pytanie — co mam
   teraz zrobić — i stały w trzech zakładkach. Agent obchodził je po kolei, a
   prośba kolegi czekała, aż ktoś zajrzy do trzeciej. Tu stoją jedna pod drugą:
   najpierw to, o co prosi człowiek, potem moje sprawy, na końcu decyzje biura.

   TO DALEJ SĄ TRZY ODCZYTY, nie piąta kolejka. Każda sekcja czyta swoją trasę
   i prowadzi na ekran, gdzie sprawę się załatwia; wspólnego statusu nie ma.
   Pusta sekcja zajmuje jedną linijkę, więc nie spycha decyzji pod krawędź. */
export function DoDecyzji() {
  const dane = useDoDecyzji();
  const [filtr, setFiltr] = useState<Filtr>("wszystko");
  const pozycje = (dane.data?.pozycje ?? []).filter((p) => filtr === "wszystko" || p.obszar === filtr);
  const l = dane.data?.liczniki;

  /* Własny scroller — jak w Zadaniach; rama panelu nie przewija za ekrany. */
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <h1 className="text-tytul font-bold">Do zrobienia</h1>
    <Wzmianki />
    <Moje />
    <Karta className="overflow-hidden p-0" role="region" aria-label="Do decyzji biura">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <ListChecks size={16} /><b>Do decyzji biura</b>
        <span className="mr-auto text-xs text-slate-600">najpilniejsze pierwsze</span>
        <FiltrSegmentowy<Filtr> wybrany={filtr} onWybierz={setFiltr} pozycje={[
          { klucz: "wszystko", etykieta: "Wszystko", ile: l?.wszystko },
          { klucz: "magazyn", etykieta: "Magazyn", ile: l?.magazyn },
          { klucz: "obsluga", etykieta: "Obsługa klienta", ile: l?.obsluga },
        ]} />
      </div>
      <Blad>{(dane.error as Error | null)?.message}</Blad>
      {dane.isLoading
        ? <Pusto waga="lista">Wczytuję…</Pusto>
        : pozycje.length === 0
          ? <p className="flex items-center gap-2 px-4 py-2 text-sm text-slate-500">
              <CircleCheck size={16} />Nic nie czeka na biuro.</p>
          : <ul>{pozycje.map((p) => <Wiersz key={p.klucz} p={p} />)}</ul>}
    </Karta>
  </div>;
}
