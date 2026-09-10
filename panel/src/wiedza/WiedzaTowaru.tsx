import React, { useState } from "react";
import type { Pasowanie, PasowaniaTowaru, RodzajDowodu, RodzajIdentyfikatora, TrafieniePasowania, Zastosowanie } from "../api/typy";
import {
  useDodajDowod, useDodajIdentyfikator, useIdentyfikatory, useWiedzaTowaru, useWycofajPasowanie,
  useWycofajZastosowanie, useZaproponujPasowanie,
} from "../api/wiedza";
import { PasowanieForm } from "./PasowanieForm";
import { NaglowekSekcji, Pole, Przycisk, czas } from "../ui";
import { Wyszukiwarka, type Towar } from "../wyszukiwarka";
import {
  DOWODY_DO_WYBORU, NAZWA_DOWODU, NAZWA_RODZAJU_IDENTYFIKATORA, RODZAJE_IDENTYFIKATORA,
} from "../skrzynka/statusy";

/**
 * „Sprawdź kartotekę": co wiemy o części — potwierdzone, negatywne i to, co
 * czeka. Wycofanie negatywu wymaga powodu (§14.2), pozytywu nie; dowody
 * dopisuje się, nigdy nie poprawia (append-only).
 */
export function WiedzaTowaru() {
  const [towar, setTowar] = useState<Towar | null>(null);
  const wiedza = useWiedzaTowaru(towar?.id ?? null);
  return <div className="space-y-3">
    <Wyszukiwarka wybrany={towar} onWybierz={setTowar} etykieta="Kartoteka do sprawdzenia" />
    {towar && wiedza.isLoading && <p className="text-sm text-slate-500">Sprawdzam…</p>}
    {wiedza.error && <p className="text-sm text-red-700">{(wiedza.error as Error).message}</p>}
    {wiedza.data && <>
      <Sekcja tytul="Potwierdzone zastosowania" lista={wiedza.data.potwierdzone} pusto="brak potwierdzonych zastosowań" />
      <Sekcja tytul="Nie pasuje do" lista={wiedza.data.negatywne} pusto="brak negatywnych dopasowań" negatyw />
      <Sekcja tytul="Czeka w kolejce" lista={wiedza.data.propozycje} pusto="nic nie czeka" tylkoOdczyt />
      {wiedza.data.pasowania && <Pasowania towar={{ twId: towar!.id, symbol: towar!.sym, nazwa: towar!.name }} dane={wiedza.data.pasowania} />}
    </>}
    {towar && <Identyfikatory twId={towar.id} />}
  </div>;
}

/**
 * Identyfikatory części (E3): z opisu po imporcie (przebudowa je odtwarza)
 * albo ręczne z katalogu, którego w opisie nie ma (przebudowa je omija).
 * Duplikat serwer odbija 409 — ta sama wartość po zwinięciu spacji i wielkości liter.
 */
function Identyfikatory({ twId }: { twId: number }) {
  const lista = useIdentyfikatory(twId);
  const dodaj = useDodajIdentyfikator();
  const [rodzaj, setRodzaj] = useState<RodzajIdentyfikatora>("oem");
  const [wartosc, setWartosc] = useState("");
  return <section aria-label="Identyfikatory">
    <NaglowekSekcji>Identyfikatory</NaglowekSekcji>
    {lista.data && lista.data.length === 0 && <p className="text-sm text-slate-500">brak identyfikatorów w opisie</p>}
    {lista.data && lista.data.length > 0 && <ul className="mt-1 flex flex-wrap gap-1">
      {lista.data.map((i) => <li key={i.id} title={`${i.nazwaRodzaju} · ${i.zrodlo === "opis" ? "z opisu" : `ręcznie: ${i.dodal}`}`}
        className={`rounded px-1.5 py-0.5 font-mono text-xs ${i.zrodlo === "reczne" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-800"}`}>
        <span className="mr-1 text-[10px] font-semibold text-slate-500">{i.nazwaRodzaju}</span>{i.wartosc}</li>)}
    </ul>}
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <select className="field w-auto" aria-label="Rodzaj identyfikatora" value={rodzaj}
        onChange={(e) => setRodzaj(e.target.value as RodzajIdentyfikatora)}>
        {RODZAJE_IDENTYFIKATORA.map((r) => <option key={r} value={r}>{NAZWA_RODZAJU_IDENTYFIKATORA[r]}</option>)}</select>
      <Pole className="flex-1" aria-label="Wartość identyfikatora" value={wartosc} placeholder="np. 532 16 56-30"
        onChange={(e) => setWartosc(e.target.value)} />
      <Przycisk className="text-xs" disabled={dodaj.isPending || wartosc.trim().length < 4}
        onClick={() => dodaj.mutate({ twId, rodzaj, wartosc: wartosc.trim() }, { onSuccess: () => setWartosc("") })}>
        Dodaj identyfikator</Przycisk>
    </div>
    {dodaj.error && <p className="mt-1 text-xs text-red-700">{(dodaj.error as Error).message}</p>}
  </section>;
}

function Sekcja({ tytul, lista, pusto, negatyw = false, tylkoOdczyt = false }: {
  tytul: string; lista: Zastosowanie[]; pusto: string; negatyw?: boolean; tylkoOdczyt?: boolean;
}) {
  return <section aria-label={tytul}>
    <NaglowekSekcji ton={negatyw ? "text-red-800" : "text-slate-500"}>{tytul}</NaglowekSekcji>
    {lista.length === 0
      ? <p className="text-sm text-slate-500">{pusto}</p>
      : <ul className="mt-1 space-y-2">{lista.map((z) => <Wpis key={z.id} z={z} tylkoOdczyt={tylkoOdczyt} />)}</ul>}
  </section>;
}

function Wpis({ z, tylkoOdczyt }: { z: Zastosowanie; tylkoOdczyt: boolean }) {
  const wycofaj = useWycofajZastosowanie();
  const dowod = useDodajDowod();
  const [cofam, setCofam] = useState(false);
  const [powod, setPowod] = useState("");
  const [dopisuje, setDopisuje] = useState(false);
  const [rodzaj, setRodzaj] = useState<RodzajDowodu>("katalog_dostawcy");
  const [tresc, setTresc] = useState("");
  const negatyw = z.polaryzacja === "nie_pasuje";
  const blad = (wycofaj.error ?? dowod.error) as Error | null;

  return <li className={`rounded-lg border p-3 text-sm ${negatyw ? "border-red-200" : "border-slate-200"}`}>
    <div className="flex flex-wrap items-center gap-2">
      <b>{z.model.etykieta}</b>
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${z.pewnosc === "potwierdzone"
        ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{z.pewnosc}</span>
      <span className="ml-auto text-xs text-slate-500">{z.zdanieZrodla}</span>
    </div>
    {z.zdaniePowodu && <p className="text-red-900">{z.zdaniePowodu}</p>}
    <ul className="mt-1 text-xs text-slate-600">
      {z.dowody.map((d) => <li key={d.id}>· {d.nazwaRodzaju}, {czas(d.at)}, {d.autor}: {d.tresc}</li>)}
    </ul>
    {!tylkoOdczyt && <div className="mt-2 flex flex-wrap items-end gap-2">
      {!cofam && !dopisuje && <>
        <Przycisk className="text-xs" onClick={() => setDopisuje(true)}>Dopisz dowód</Przycisk>
        <Przycisk className="text-xs" onClick={() => setCofam(true)}>Wycofaj</Przycisk>
      </>}
      {cofam && <>
        <label className="flex-1 text-xs font-bold text-slate-600">
          {negatyw ? "Powód wycofania — negatyw nie schodzi bez powodu" : "Powód wycofania (opcjonalnie)"}
          <Pole className="mt-1" aria-label={`Powód wycofania: ${z.model.etykieta}`} value={powod}
            onChange={(e) => setPowod(e.target.value)} /></label>
        <Przycisk wariant="glowny" disabled={wycofaj.isPending || (negatyw && powod.trim() === "")}
          onClick={() => wycofaj.mutate({ id: z.id, powod: powod.trim() || null }, { onSuccess: () => setCofam(false) })}>
          Potwierdź wycofanie</Przycisk>
        <Przycisk onClick={() => { setCofam(false); setPowod(""); }}>Wróć</Przycisk>
      </>}
      {dopisuje && <>
        <select className="field w-auto" aria-label="Rodzaj dowodu" value={rodzaj}
          onChange={(e) => setRodzaj(e.target.value as RodzajDowodu)}>
          {DOWODY_DO_WYBORU.map((r) => <option key={r} value={r}>{NAZWA_DOWODU[r]}</option>)}</select>
        <Pole className="flex-1" aria-label="Treść dowodu" value={tresc} placeholder="treść dowodu"
          onChange={(e) => setTresc(e.target.value)} />
        <Przycisk wariant="glowny" disabled={dowod.isPending || tresc.trim() === ""}
          onClick={() => dowod.mutate({ id: z.id, rodzaj, tresc: tresc.trim() }, { onSuccess: () => { setDopisuje(false); setTresc(""); } })}>
          Zapisz dowód</Przycisk>
        <Przycisk onClick={() => setDopisuje(false)}>Wróć</Przycisk>
      </>}
    </div>}
    {blad && <p className="mt-1 text-xs text-red-700">{blad.message}</p>}
  </li>;
}

/**
 * Pasowania część↔część (§11.2): do czego ta część pasuje i co pasuje do
 * niej — wprost i przez zamiennik (z dopiskiem, bo przechodnie nigdy nie jest
 * „potwierdzone"), negatywy i to, co czeka. Tu też dopisuje się nową parę,
 * z radiem kierunku, bo ekran nie wie, czy patrzy na uszczelkę, czy na gaźnik.
 */
function Pasowania({ towar, dane }: { towar: { twId: number; symbol: string; nazwa: string }; dane: PasowaniaTowaru }) {
  const zaproponuj = useZaproponujPasowanie();
  const [dopisuje, setDopisuje] = useState(false);
  const [ok, setOk] = useState("");
  return <section aria-label="Pasowania">
    <NaglowekSekcji>Pasowania części</NaglowekSekcji>
    <Trafienia tytul="Ta część pasuje do" lista={dane.pasujeDo} pusto="nie wiemy, do czego pasuje" strona="doCzego" />
    <Trafienia tytul="Do tej części pasują" lista={dane.pasujace} pusto="nie wiemy, co do niej pasuje" strona="czesc" />
    {dane.negatywne.length > 0 && <ul className="mt-1 space-y-1">
      {dane.negatywne.map((p) => <WpisPasowania key={p.id} p={p} negatyw />)}
    </ul>}
    {dane.propozycje.length > 0 && <p className="mt-1 text-xs text-slate-500">
      Czeka w kolejce: {dane.propozycje.map((p) => `${p.czesc.symbol} → ${p.doCzego.symbol}`).join(" · ")}</p>}
    <div className="mt-2">
      {ok && <p className="mb-1 text-xs text-emerald-800">{ok}</p>}
      {!dopisuje
        ? <Przycisk className="text-xs" onClick={() => { setDopisuje(true); setOk(""); }}>Dopisz pasowanie</Przycisk>
        : <PasowanieForm kartoteka={towar} trwa={zaproponuj.isPending} blad={(zaproponuj.error as Error | null)?.message}
            onAnuluj={() => setDopisuje(false)}
            onWyslij={(v) => zaproponuj.mutate(v, { onSuccess: (z) => { setDopisuje(false);
              setOk(`Propozycja ${z.czesc.symbol} → ${z.doCzego.symbol} czeka w kolejce.`); } })} />}
    </div>
  </section>;
}

function Trafienia({ tytul, lista, pusto, strona }: {
  tytul: string; lista: TrafieniePasowania[]; pusto: string; strona: "czesc" | "doCzego";
}) {
  return <div className="mt-1">
    <span className="text-xs font-semibold text-slate-600">{tytul}</span>
    {lista.length === 0
      ? <p className="text-sm text-slate-500">{pusto}</p>
      : <ul className="mt-1 space-y-1">{lista.map((t) => <li key={`${t.czesc.twId}-${t.doCzego.twId}`}
          className="flex flex-wrap items-center gap-2 rounded border border-slate-200 px-2 py-1 text-sm">
          <b className="font-mono">{t[strona].symbol}</b>
          <span className="text-slate-600">{t[strona].nazwa}</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{t.pasowanie.nazwaRoli}{t.pasowanie.pozycja ? ` · ${t.pasowanie.pozycja}` : ""}</span>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${t.pewnosc === "potwierdzone"
            ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{t.pewnosc}</span>
          {t.przezZamiennik && <span className="text-[11px] text-slate-500">przez zamiennik</span>}
          <span className="basis-full text-[11px] text-slate-500">{t.zdanie}</span>
          {!t.przezZamiennik && <Wycofanie p={t.pasowanie} />}
        </li>)}</ul>}
  </div>;
}

function WpisPasowania({ p, negatyw }: { p: Pasowanie; negatyw: boolean }) {
  return <li className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-sm ${negatyw ? "border-red-200" : "border-slate-200"}`}>
    <b className="font-mono">{p.czesc.symbol}</b><span className="text-slate-500">⇏</span><b className="font-mono">{p.doCzego.symbol}</b>
    {p.zdaniePowodu && <span className="text-red-900">{p.zdaniePowodu}</span>}
    <span className="basis-full text-[11px] text-slate-500">{p.zdanieZrodla}</span>
    <Wycofanie p={p} />
  </li>;
}

/** Wycofanie ZATWIERDZONEGO pasowania: negatyw wyłącznie z powodem (§14.2). */
function Wycofanie({ p }: { p: Pasowanie }) {
  const wycofaj = useWycofajPasowanie();
  const [cofam, setCofam] = useState(false);
  const [powod, setPowod] = useState("");
  const negatyw = p.polaryzacja === "nie_pasuje";
  if (!cofam) return <Przycisk className="ml-auto text-xs" onClick={() => setCofam(true)}>Wycofaj</Przycisk>;
  return <span className="flex basis-full flex-wrap items-center gap-2">
    <Pole className="w-64" aria-label={`Powód wycofania: ${p.czesc.symbol} → ${p.doCzego.symbol}`} value={powod}
      placeholder={negatyw ? "powód — negatyw nie schodzi bez powodu" : "powód (opcjonalnie)"} onChange={(e) => setPowod(e.target.value)} />
    <Przycisk wariant="glowny" className="text-xs" disabled={wycofaj.isPending || (negatyw && !powod.trim())}
      onClick={() => wycofaj.mutate({ id: p.id, powod: powod.trim() || null }, { onSuccess: () => setCofam(false) })}>Potwierdź wycofanie</Przycisk>
    <Przycisk className="text-xs" onClick={() => setCofam(false)}>Wróć</Przycisk>
    {wycofaj.error && <span className="text-xs text-red-700">{(wycofaj.error as Error).message}</span>}
  </span>;
}
