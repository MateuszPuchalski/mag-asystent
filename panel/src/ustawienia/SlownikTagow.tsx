import React, { useState } from "react";
import type { Tag } from "../api/typy";
import { Przycisk } from "../ui";
import { KartaWgladu } from "../ui/wglad";

/* ── Słownik tagów spraw (0.279.0) ───────────────────────────────────────────
   Właściciel wybrał słownik EDYTOWALNY, więc nazwy dopisuje biuro, a nie
   wydanie. Dopisywanie stoi przy sprawie — tam, gdzie rodzi się potrzeba.
   Tutaj zostaje to, czego przy jednej sprawie robić nie wolno: zmiana nazwy
   dla wszystkich spraw naraz i wyłączenie tagu z użycia.

   KASOWANIA NIE MA I NIE BĘDZIE. Skasowany tag zniknąłby po cichu ze spraw
   historycznych, a wtedy pytanie „dlaczego ta sprawa stała trzy tygodnie"
   traci odpowiedź. Wyłączony nie podpowiada się przy nowej sprawie, na
   starych zostaje — i to jest cała różnica.

   SUFIT DWUDZIESTU AKTYWNYCH jest tu WIDOCZNY, a nie tylko pilnowany przez
   serwer. Odmowa przy dwudziestym pierwszym tagu, wpisanym w biegu przy
   sprawie, byłaby ścianą w połowie czynności; licznik w tym miejscu mówi
   o niej wcześniej. Dekalog p. 6: ograniczenie jest tańsze od komunikatu.

   KARTA JAK SĄSIEDNIE (@wydanie). Jako jedyna na ekranie miała gołą kartę,
   własny nagłówek i podkreślone napisy zamiast przycisków — inny kształt
   tej samej rangi kazał czytać, czy to coś innego. Teraz `KartaWgladu`
   i `Przycisk`, jak konta i logo obok. */

const MALY = "!px-2.5 !py-1 !text-xs";

export const MAKS_AKTYWNYCH = 20;

export function SlownikTagow({ tagi, trwa, blad, onNazwa, onAktywny }: {
  tagi: Tag[];
  trwa: boolean;
  blad: string;
  onNazwa: (id: number, nazwa: string) => void;
  onAktywny: (id: number, aktywny: boolean) => void;
}) {
  const [zmieniany, setZmieniany] = useState<number | null>(null);
  const [nazwa, setNazwa] = useState("");
  const aktywnych = tagi.filter((t) => t.aktywny).length;

  const zapisz = (id: number) => {
    const n = nazwa.trim();
    if (n) onNazwa(id, n);
    setZmieniany(null);
  };

  return <KartaWgladu tytul="Tagi spraw"
    opis="Tag zawęża kolejkę reklamacji i dyskusji. Kolejności nie przestawia: o niej rozstrzyga termin i czas czekania.">
    {!tagi.length && <p className="text-sm text-slate-600">Słownik jest pusty.</p>}

    <ul className="divide-y divide-slate-200">
      {tagi.map((t) => <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
        {zmieniany === t.id
          ? <>
            <label className="sr-only" htmlFor={`tag-${t.id}`}>Nowa nazwa tagu</label>
            <input id={`tag-${t.id}`} autoFocus value={nazwa} maxLength={30}
              onChange={(e) => setNazwa(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); zapisz(t.id); }
                if (e.key === "Escape") setZmieniany(null);
              }}
              className="field min-w-0 flex-1 py-1 text-sm" />
            <Przycisk wariant="glowny" type="button" className={MALY} disabled={trwa} onClick={() => zapisz(t.id)}>
              Zapisz</Przycisk>
            <Przycisk type="button" className={MALY} onClick={() => setZmieniany(null)}>Anuluj</Przycisk>
          </>
          : <>
            <span className={`mr-auto text-sm font-semibold ${
              t.aktywny ? "text-slate-800" : "text-slate-600 line-through"}`}>{t.nazwa}</span>
            {!t.aktywny && <span className="rounded bg-slate-100 px-1.5 py-1 text-xs font-bold text-slate-700">
              wyłączony</span>}
            <Przycisk type="button" className={MALY} disabled={trwa}
              onClick={() => { setNazwa(t.nazwa); setZmieniany(t.id); }}>
              Zmień nazwę</Przycisk>
            {/* Wyłączenie i włączenie to JEDEN przycisk, bo to jeden stan
                z dwiema wartościami — dwa przyciski kazałyby czytać, który
                z nich jest teraz martwy. */}
            <Przycisk type="button" className={MALY} disabled={trwa}
              onClick={() => onAktywny(t.id, !t.aktywny)}>
              {t.aktywny ? "Wyłącz z użycia" : "Włącz z powrotem"}</Przycisk>
          </>}
      </li>)}
    </ul>

    <p className="mt-3 text-podpis text-slate-600">
      Aktywnych: <b className="tabular-nums">{aktywnych}</b> z {MAKS_AKTYWNYCH}.
      {" "}Wyłączony tag zostaje na sprawach, przy których już stoi — dlatego
      nie ma kasowania.
    </p>

    {blad && <p className="mt-2 text-podpis text-red-700">{blad}</p>}
  </KartaWgladu>;
}
