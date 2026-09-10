import React from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Undo2 } from "lucide-react";
import type { Zwrot } from "../api/typy";
import { zlote } from "../api/zwroty";
import { czas } from "../ui";
import { KUBELKI, SYGNALY } from "../zwroty/Kolejka";
import { ZnakAllegro } from "../ui/ZnakAllegro";

/**
 * Zwrot tego zamówienia przy rozmowie (0.221.0).
 *
 * Właściciel: „klienci często pytają pod zamówieniem o zwrot, którego
 * dokonali". Do 0.220.0 agent szedł na ekran Zwroty i szukał zwrotu po
 * loginie — a odpowiedź „paczka doszła wczoraj, pieniądze idą jutro" zna
 * baza od dawna. Blok stoi POD zamówieniem, bo to zwrot tego zakupu; mostkiem
 * jest numer zamówienia, ten sam, którym zwrot znajduje swoje rozmowy od
 * 0.169.0. Po loginie nie dobieramy (blizna 0.56.6).
 *
 * Skład wiersza jest ten sam, co w kolejce zwrotów — kubełek, sygnały,
 * termin, paczka, pozycje, decyzja i kwota — więc agent czyta tu to, co
 * zobaczyłby tam, tylko bez szukania. Praca nad zwrotem (werdykt, wycena,
 * ocena) zostaje na ekranie Zwroty: odnośnik prowadzi prosto do tego zwrotu.
 */
const NAZWA_WERDYKTU: Record<string, string> = { przyjety: "przyjęty", odrzucony: "odrzucony" };
const NAZWA_WARIANTU: Record<string, string> = { pelna: "pełna", bez_wysylki: "bez wysyłki", inna: "inna" };

export function ZwrotRozmowy({ zwrot }: { zwrot: Zwrot }) {
  const kubelek = KUBELKI.find((k) => k.id === zwrot.kubelek);
  const wracaja = zwrot.pozycje;
  return <section className="border-b bg-slate-50 px-4 py-3 text-sm" aria-label="Zwrot">
    <div className="flex flex-wrap items-center gap-2">
      <Undo2 size={15} className="text-slate-500" />
      <b>Zwrot</b>
      {zwrot.numer && <span className="font-mono text-xs text-slate-600">{zwrot.numer}</span>}
      {zwrot.zrodlo === "nieodebrana" && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-700">
        paczka nieodebrana</span>}
      {/* Kubełek i sygnały tymi samymi słowami, co w kolejce zwrotów: agent ma
          rozpoznać stan, nie uczyć się drugiego słownika. */}
      {kubelek && <span className="rounded bg-wertis-ink px-1.5 py-0.5 text-[11px] font-bold text-white">
        {kubelek.etykieta}</span>}
      {zwrot.sygnaly.map((s) => <span key={s} title={SYGNALY[s].tytul}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold ${SYGNALY[s].klasa}`}>
        {SYGNALY[s].ikona}{SYGNALY[s].krotko}</span>)}
      <Link to={`/obsluga/zwroty/${zwrot.id}`}
        className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
        Otwórz w Zwrotach</Link>
      {zwrot.linkZwrotu && <a href={zwrot.linkZwrotu} target="_blank" rel="noopener noreferrer"
        aria-label="Otwórz w Allegro"
        className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900">
        {/* Bez podkreślenia (0.252.0): kreska pod znakiem graficznym wygląda
            jak usterka. Sąsiedni „Otwórz w Zwrotach" ZOSTAJE podkreślony i to
            jest rozróżnienie, nie niekonsekwencja — tamten prowadzi w GŁĄB
            panelu i ma wyglądać jak tekst, ten wychodzi na zewnątrz. */}
        Otwórz w <ZnakAllegro wysokosc={11} /><ExternalLink size={12} /></a>}
    </div>

    {/* Trzy daty, na które klient pyta najczęściej: kiedy zgłosił, czy paczka
        doszła, ile zostało do terminu. Brak paczki to zdanie, nie pusta komórka. */}
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      <dt className="text-slate-500">Zgłoszony</dt>
      <dd>{czas(zwrot.utworzono)} · termin {czas(zwrot.terminAt)}
        <span className={zwrot.dniDoTerminu < 0 ? " font-bold text-ranga-zle" : " text-slate-500"}>
          {zwrot.dniDoTerminu < 0 ? ` (minął ${-zwrot.dniDoTerminu} dni temu)` : ` (za ${zwrot.dniDoTerminu} dni)`}
        </span></dd>
      <dt className="text-slate-500">Paczka</dt>
      <dd>{zwrot.paczkaAt
        ? <>nadana {czas(zwrot.paczkaAt)}{zwrot.przewoznik && <> · {zwrot.przewoznik}</>}
            {zwrot.dostarczonoAt ? <> · dotarła {czas(zwrot.dostarczonoAt)}</>
              : zwrot.przesylkaStatus ? <> · {zwrot.przesylkaStatus}</> : <> · jeszcze nie dotarła</>}</>
        : <span className="text-slate-500">klient jeszcze nie nadał paczki</span>}</dd>
      {(zwrot.werdykt || zwrot.rejectionCode) && <>
        <dt className="text-slate-500">Decyzja</dt>
        <dd>{zwrot.werdykt
          ? <>{NAZWA_WERDYKTU[zwrot.werdykt] ?? zwrot.werdykt}{zwrot.werdyktPowod && <> — {zwrot.werdyktPowod}</>}</>
          : <>odrzucony w Allegro ({zwrot.rejectionCode})</>}</dd>
      </>}
      {zwrot.kwotaGrosze != null && <>
        <dt className="text-slate-500">Kwota</dt>
        <dd>{zlote(zwrot.kwotaGrosze, zwrot.waluta)}
          {zwrot.kwotaWariant && <span className="text-slate-500"> · {NAZWA_WARIANTU[zwrot.kwotaWariant] ?? zwrot.kwotaWariant}</span>}
          {zwrot.korektaNumer && <span className="text-slate-500"> · korekta {zwrot.korektaNumer}</span>}</dd>
      </>}
    </dl>

    <ul className="mt-2 space-y-1">
      {wracaja.map((p) => <li key={p.id} className="flex items-baseline gap-2 rounded bg-white px-2 py-1 text-xs">
        <span className="truncate">{p.nazwa}</span>
        {p.twSymbol && <span className="shrink-0 font-mono text-slate-500">{p.twSymbol}</span>}
        {p.powod && <span className="shrink-0 text-slate-500">{p.powod}</span>}
        <span className="ml-auto shrink-0 tabular-nums">{p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
      </li>)}
    </ul>
    {zwrot.notatka && <p className="mt-1 text-xs text-slate-600">{zwrot.notatka}</p>}
  </section>;
}
