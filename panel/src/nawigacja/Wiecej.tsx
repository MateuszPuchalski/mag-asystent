import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Activity, BarChart3, ChevronDown, FileText, LogOut, Menu, Settings } from "lucide-react";
import { useZdrowie } from "../api/rozmowy";
import { useOkienko } from "../skrzynka/MenuRozmowy";
import { zdanieSynchronizacji } from "./Synchronizacja";

/** Adres ustawień w JEDNYM miejscu: czyta go menu i trasa w `main.tsx`. */
export const USTAWIENIA = "/obsluga/ustawienia";

/* ── MENU „WIĘCEJ" ZAMIAST DOLNEGO RZĘDU (0.538.0) ─────────────────────────
   Decyzja właściciela z 27 września 2026: nagłówek ma jeden rząd. Dolny rząd
   z 0.431.0 niósł wgląd, zębatkę i wyjście, czyli rzeczy otwierane kilka razy
   w miesiącu, i płacił za nie ~50 px wysokości na KAŻDYM ekranie pracy.
   Na laptopie obok Subiekta to dwa wiersze kolejki mniej przez cały dzień.

   Pod jednym przyciskiem stoi wszystko, co nie jest pracą na sprawach: wgląd,
   ustawienia i wyjście. Dekalog p. 1 — mniej decyzji — rozstrzyga na rzecz
   jednego wejścia zamiast trzech ikon, z których każdą trzeba rozpoznać.
   Dostawy do menu NIE zeszły: to praca dzienna, więc stoją ósmą zakładką.

   PRZYCISK ŚWIECI BURSZTYNEM, gdy bieżący ekran leży w menu. Bez tego agent
   w dzienniku widziałby pasek bez żadnej zaznaczonej zakładki i nie wiedziałby,
   gdzie jest. To ta sama barwa co aktywna zakładka, bo znaczy to samo.

   `role="group"`, NIE `role="menu"`: menu ARIA obiecuje strzałki i fokus
   wędrujący po pozycjach, a tu są zwykłe linki z Tabem. Obietnica bez
   obsługi jest gorsza niż jej brak. Ten sam wybór co w `MenuRozmowy`. */
const WGLAD = [
  { do: "/obsluga/stan", etykieta: "Stan systemu", ikona: <Activity size={16} /> },
  { do: "/obsluga/dziennik", etykieta: "Dziennik", ikona: <FileText size={16} /> },
  { do: "/obsluga/analiza", etykieta: "Analiza", ikona: <BarChart3 size={16} /> },
];

const POZYCJA = "flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold";

export function Wiecej({ wyloguj }: { wyloguj: () => void }) {
  const { pathname } = useLocation();
  const { otwarte, setOtwarte, ramka } = useOkienko<HTMLDivElement>();
  const zdrowie = useZdrowie().data;
  const tu = (adres: string) => pathname.startsWith(adres);
  const wMenu = WGLAD.some((p) => tu(p.do)) || tu(USTAWIENIA);
  /* Klik w pozycję zamyka menu: przejście na inny ekran z otwartym okienkiem
     zostawiałoby je nad nową treścią. */
  const zamknij = () => setOtwarte(false);
  const klasaPozycji = (adres: string) =>
    `${POZYCJA} ${tu(adres) ? "bg-slate-100 text-wertis-ink" : "text-slate-800 hover:bg-slate-50"}`;
  return <div ref={ramka} className="relative shrink-0">
    <button type="button" onClick={() => setOtwarte((o) => !o)} aria-expanded={otwarte}
      aria-label="Więcej: stan systemu, dziennik, analiza, ustawienia, wyloguj"
      title="Stan systemu, dziennik, analiza, ustawienia, wyloguj"
      /* bursztyn: przycisk na ciemnym tle jest marką, jak aktywna zakładka */
      className={`flex h-10 items-center gap-0.5 rounded-lg border px-2 ${
        wMenu ? "border-wertis-amber bg-wertis-amber text-wertis-ink"
          : otwarte ? "border-white/30 bg-white/15 text-white"
            : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10"}`}>
      <Menu size={18} /><ChevronDown size={12} /></button>
    {otwarte && <div role="group" aria-label="Więcej"
      /* Własny kolor tekstu, bo okienko rysuje się w pasku bocznym z
         `text-white` — ta sama pułapka co przy oknie szukania. Otwiera się
         w górę i w prawo: menu stoi na dole paska, a pod nim nie ma ekranu. */
      className="absolute bottom-full left-0 z-30 mb-2 flex w-72 flex-col gap-0.5 rounded-xl border border-slate-200 bg-white p-2 text-slate-900 shadow-lg">
      <span className="px-2.5 pb-0.5 pt-1.5 text-podpis font-bold uppercase tracking-wide text-slate-600">Wgląd</span>
      {WGLAD.map((p) => <Link key={p.do} to={p.do} onClick={zamknij}
        aria-current={tu(p.do) ? "page" : undefined} className={klasaPozycji(p.do)}>
        {p.ikona}
        {/* Zdanie o synchronizacji pod stanem systemu: wskaźnik w pasku
            pokazuje samą godzinę, a liczba błędów ma być jeden klik dalej.
            Drugą linią, nie obok — obok łamało oba napisy na pół. */}
        <span className="flex flex-col py-1">{p.etykieta}
          {p.do === "/obsluga/stan" && zdrowie && <span className="text-podpis font-normal text-slate-600">
            {zdanieSynchronizacji(zdrowie.allegroInbox)}</span>}</span>
      </Link>)}
      <span aria-hidden="true" className="mx-1.5 my-1 h-px bg-slate-200" />
      <Link to={USTAWIENIA} onClick={zamknij} aria-current={tu(USTAWIENIA) ? "page" : undefined}
        className={klasaPozycji(USTAWIENIA)}><Settings size={16} />Ustawienia</Link>
      <button type="button" onClick={() => { zamknij(); wyloguj(); }}
        className={`${POZYCJA} text-left text-slate-800 hover:bg-slate-50`}><LogOut size={16} />Wyloguj</button>
    </div>}
  </div>;
}
