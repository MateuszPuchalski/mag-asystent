import React from "react";
import { Link } from "react-router-dom";
import type { Zwrot } from "../api/typy";
import { zlote } from "../api/zwroty";
import { czas } from "../ui";
import { KUBELKI, SYGNALY } from "../zwroty/Kolejka";
import { ODNOSNIK, OdnosnikAllegro } from "./odnosniki";

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
  /* Płasko, bez tła i kreski: zwrot stoi w ramie „Wymaga Ciebie" albo
     w wierszu „Zamknięte sprawy", a kreskę i oddech daje mu tamto miejsce. */
  return <section aria-label="Zwrot" className="space-y-2 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <b className="text-wertis-ink">Zwrot</b>
      {zwrot.numer && <span className="font-mono text-xs text-slate-600">{zwrot.numer}</span>}
      {zwrot.zrodlo === "nieodebrana" && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-podpis font-bold text-slate-700">
        paczka nieodebrana</span>}
      {/* Kubełek i sygnały tymi samymi słowami, co w kolejce zwrotów: agent ma
          rozpoznać stan, nie uczyć się drugiego słownika. */}
      {kubelek && <span className="rounded bg-wertis-ink px-1.5 py-0.5 text-podpis font-bold text-white">
        {kubelek.etykieta}</span>}
      {zwrot.sygnaly.map((s) => <span key={s} title={SYGNALY[s].tytul}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-podpis font-bold ${SYGNALY[s].klasa}`}>
        {SYGNALY[s].ikona}{SYGNALY[s].krotko}</span>)}
    </div>

    {/* ZEGAR PIERWSZY: termin rozstrzyga, czy zwrot czeka na ruch dziś, więc
        stoi tam, gdzie oko czyta na pewno. Datę zgłoszenia mówi linia osi
        „Zwrot zgłoszony", a brak paczki to zdanie, nie pusta komórka. */}
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      <dt className="text-slate-500">Termin</dt>
      {/* Termin rusza dopiero od paczki u nas, więc bywa pusty. */}
      <dd>{zwrot.terminAt === null || zwrot.dniDoTerminu === null
        ? "rusza, gdy paczka wróci"
        : <>{czas(zwrot.terminAt)}
            <span className={zwrot.dniDoTerminu < 0
              ? " font-bold text-ranga-zle" : " text-slate-500"}>
              {zwrot.dniDoTerminu < 0
                ? ` (minął ${-zwrot.dniDoTerminu} dni temu)`
                : ` (za ${zwrot.dniDoTerminu} dni)`}
            </span></>}</dd>
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

    {/* Stała jest tylko cena. Nazwa, symbol i powód skracają się razem, bo
        przy kolumnie 256 px trzy sztywne kawałki zjadały całą nazwę, a cena
        wychodziła na bursztynową ramę i za nią. */}
    <ul className="space-y-0.5">
      {wracaja.map((p) => <li key={p.id} className="flex items-baseline gap-2 text-xs">
        <span className="min-w-0 truncate">{p.nazwa}</span>
        {p.twSymbol && <span className="min-w-0 truncate font-mono text-slate-500">{p.twSymbol}</span>}
        {p.powod && <span className="min-w-0 truncate text-slate-500">{p.powod}</span>}
        <span className="ml-auto shrink-0 tabular-nums">{p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
      </li>)}
    </ul>
    {zwrot.notatka && <p className="text-xs text-slate-600">{zwrot.notatka}</p>}

    {/* ODNOŚNIKI NA STAŁE W OSTATNIEJ LINII. W linii tytułu przy wąskiej
        kolumnie przeskakiwały raz obok numeru, raz pod niego, a cel kliknięcia
        zmieniał miejsce z każdą plakietką. „Otwórz w Zwrotach" jest podkreślony,
        bo prowadzi w głąb panelu; znak Allegro podkreślenia nie ma, bo kreska
        pod znakiem graficznym wygląda jak usterka, a ten wychodzi na zewnątrz. */}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <Link to={`/obsluga/zwroty/${zwrot.id}`} className={ODNOSNIK}>Otwórz w Zwrotach</Link>
      {zwrot.linkZwrotu && <OdnosnikAllegro href={zwrot.linkZwrotu} etykieta="Otwórz w Allegro" />}
    </div>
  </section>;
}
