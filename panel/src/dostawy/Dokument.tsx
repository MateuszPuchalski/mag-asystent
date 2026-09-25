import React, { useState } from "react";
import { FileDown, Printer } from "lucide-react";
import type { Dokument as DokumentDostawy, PozycjaDostawy, Wyjatek as WyjatekHali } from "../api/dostawy";
import { ilosc } from "../api/dostawy";
import { pobierzPlik } from "../api/klient";
import { Zdjecie } from "../towar/Zdjecie";
import { useZdrowie } from "../api/rozmowy";
import { Blad, NaglowekSekcji, Plakietka, Przycisk, czas, dzien } from "../ui";
import { Wyjatek } from "./Wyjatek";
import { PrzyciskTowaru } from "../towar/Szuflada";

/* ── Dokument dostawy — środkowa kolumna (0.435.0) ─────────────────────────
   Przeniesiony z `biuro.html` z trzema decyzjami, które tam kosztowały:

   - POZYCJE WYMAGAJĄCE BIURA STOJĄ OSOBNO I NA GÓRZE (0.97.0). Tabela na
     trzydzieści cztery wiersze zawiera zwykle dwa, przy których ktoś czeka
     na decyzję — biuro wchodzi w dokument WŁAŚNIE po nie.
   - TRZY KOLUMNY ZAMIAST PIĘCIU (0.427.0, dekalog pkt 2). Stan idzie pod
     ilość, bo odpowiadają na jedno pytanie: ile i czy skończone. Osoba idzie
     pod adres, bo odpowiadają na drugie: gdzie i kto tam położył.
   - PROTOKÓŁ STOI W NAGŁÓWKU DOKUMENTU, nie w osobnej karcie reklamacji.
     W biurze karta REKLAMACJE listowała wyjątki wszystkich faktur osobno od
     faktur — dwie listy o tym samym. Reklamuje się fakturę, więc druk
     mieszka przy fakturze.

   ── ZDJĘCIE PRZY KAŻDEJ POZYCJI (0.449.0) ──────────────────────────────
   Przeprowadzka zgubiła kolumnę zdjęć: `biuro.html` miało ją w tabeli
   pozycji od 0.36.0, a panel pokazywał zdjęcie tylko przy wyjątku. Zgłosił
   to właściciel na nietkniętej fakturze — czternaście symboli bez jednego
   obrazu, a biuro rozpoznaje towar po wyglądzie szybciej niż po numerze.
   Kolumna stoi wtedy, gdy instalacja MA zdjęcia (pola `zdjecia` albo
   `zdjeciaWlasne` w `/api/health`), jak w biurze: bez źródła byłaby rzędem
   kafli „bez zdjęcia" na każdej fakturze. Pobieranie idzie wspólną kolejką
   `towar/useZdjecie.ts` — trzy naraz, brak zapamiętany. */

const STAN_DOKUMENTU: Record<string, { slowo: string; klasa: string }> = {
  done: { slowo: "rozłożona", klasa: "bg-emerald-100 text-ranga-ok" },
  /* `external` MUSI różnić się od „rozłożona" — to cała różnica między „mamy
     z tego skany" a „ktoś orzekł, że nie trzeba". */
  external: { slowo: "poza WERTIS", klasa: "bg-slate-200 text-slate-700" },
  open: { slowo: "w toku", klasa: "bg-amber-100 text-ranga-uwaga" },
};

const STAN_POZYCJI: Record<string, { slowo: string; klasa: string }> = {
  done: { slowo: "rozłożona", klasa: "bg-emerald-100 text-ranga-ok" },
  partial: { slowo: "częściowo", klasa: "bg-amber-100 text-ranga-uwaga" },
  problem: { slowo: "wyjątek", klasa: "bg-red-100 text-ranga-zle" },
  skipped: { slowo: "pominięta", klasa: "bg-slate-200 text-slate-700" },
};

function StanPozycji({ s }: { s: string }) {
  const st = STAN_POZYCJI[s] ?? { slowo: "do zrobienia", klasa: "bg-slate-200 text-slate-700" };
  /* `nowrap`: pastylka to JEDNO słowo znaczeniowe. Na zrzucie właściciela
     „DO / ZROBIENIA" łamało się pod „0/100" i przestawało wyglądać na stan. */
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-podpis font-bold uppercase tracking-wide ${st.klasa}`}>
    {st.slowo}</span>;
}

/** Gdzie leży i kto położył — rozjazd z kartoteką mówi to wprost, bo to jedyna zmiana w Subiekcie. */
function Gdzie({ l }: { l: PozycjaDostawy }) {
  return <>
    {l.mismatch
      ? <><span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">{l.locActual}</span>
          <div className="text-xs text-slate-600">zamiast {l.locExpected}</div></>
      : l.bezLokalizacji
        ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">bez lokalizacji</span>
        : <b>{l.locActual || l.locExpected || "—"}</b>}
    {l.doneBy && <div className="text-xs text-slate-600">{l.doneBy} · {czas(l.doneAt)}</div>}
  </>;
}

function PozycjaZWyjatkiem({ l, rozwiaz }: { l: PozycjaDostawy; rozwiaz: RozwiazProps }) {
  return <div className="flex gap-3 border-b border-slate-200 py-3 last:border-b-0">
    <Zdjecie twId={l.twId} rozmiar={44} nazwa={l.name} />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <b>{l.sym}</b>
        <span className="text-sm tabular-nums text-slate-600">{ilosc(l.qtyDone)}/{ilosc(l.qtyDoc)}</span>
        <span className="ml-auto text-right text-sm"><Gdzie l={l} /></span>
      </div>
      <div className="text-sm text-slate-700">{l.name}</div>
      {l.problemy.map((p) => <Wyjatek key={p.id} p={p} {...rozwiaz} />)}
    </div>
  </div>;
}

type RozwiazProps = { trwa: boolean; blad: string; onRozwiaz: (id: number, note: string) => void };

export function Dokument({ d, rozwiaz }: { d: DokumentDostawy; rozwiaz: RozwiazProps }) {
  const [bladCsv, setBladCsv] = useState("");
  const zdrowie = useZdrowie();
  const zdjecia = zdrowie.data?.zdjecia != null || zdrowie.data?.zdjeciaWlasne != null;
  const wyjatkowe = d.lines.filter((l) => l.status === "problem");
  const reszta = d.lines.filter((l) => l.status !== "problem");
  const stan = STAN_DOKUMENTU[d.status ?? ""] ?? { slowo: "nietknięta", klasa: "bg-slate-200 text-slate-700" };
  /* Protokół ma sens, gdy jest co reklamować — otwarte albo zamknięte, bo
     zamknięty wyjątek z notatką to dalej rozbieżność, o której dostawca ma
     wiedzieć. Bez `deliveryId` wyjątków nie ma skąd wziąć. */
  const maWyjatki = d.lines.some((l) => l.problemy.length > 0) || d.problemyBezLinii.length > 0;
  const nrPliku = d.nrPelny.replace(/[^\w-]+/g, "_");

  return <>
    <div className="shrink-0 border-b border-slate-200 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Numer dokumentu JEST tytułem sprawy — dostaje stopień tytułu. */}
        <h2 className="text-tytul font-bold">{d.nrPelny}</h2>
        <span className={`rounded px-1.5 py-0.5 text-podpis font-bold uppercase tracking-wide ${stan.klasa}`}>
          {stan.slowo}</span>
        {d.wBuforze && <Plakietka status="new">bufor</Plakietka>}
        {d.wPrzyjeciach && <Plakietka status="new">w przyjęciach</Plakietka>}
        <span className="ml-auto" />
        {d.deliveryId != null && maWyjatki && <>
          <Przycisk onClick={() => { setBladCsv(""); void pobierzPlik(
            `/api/delivery/${d.deliveryId}/problems.csv`, `reklamacja-${nrPliku}.csv`)
            .catch((e) => setBladCsv((e as Error).message)); }}>
            <FileDown size={16} />CSV</Przycisk>
          {/* Druk w NOWEJ KARCIE, jak dotąd: biuro drukuje protokół i wraca do
              listy, a karta z drukiem nie ma prawa zabrać mu miejsca w pracy. */}
          <a className="btn-primary" target="_blank" rel="noopener"
            href={`/obsluga/druk/protokol/${d.dokId}`}>
            <Printer size={16} />Protokół dla dostawcy</a>
        </>}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {d.dostawca} · wystawiona {dzien(d.dataWyst)} · odłożone {d.progress.done}/{d.progress.total} poz.
        {d.progress.problems ? ` · z wyjątkiem ${d.progress.problems}` : ""}
      </p>
      {/* Dwa zdania osobno, bo mówią o czym innym: jedno CZY ktoś to
          rozkładał, drugie SKĄD są liczby. */}
      {d.archiwalny && <p className="mt-1 text-sm text-ranga-uwaga">
        Dokument wypadł z okna importu — poniżej NASZ zapis z chwili rozkładania, nie dzisiejsza faktura.</p>}
      {d.zamkniecie
        ? <p className="mt-1 text-sm text-slate-600">
            Zdjęta z listy — poniżej pozycje z faktury, bo w WERTIS nikt tego nie rozkładał.</p>
        : d.zrodlo === "podglad" && <p className="mt-1 text-sm text-slate-600">
            Nikt jeszcze nie otwierał tego dokumentu — to pozycje z faktury, tak jak zobaczy je kolektor.</p>}
      <Blad>{bladCsv}</Blad>
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
      {wyjatkowe.length > 0 && <section className="mb-4">
        <NaglowekSekcji jako="h3">Pozycje z wyjątkiem · {wyjatkowe.length}</NaglowekSekcji>
        {wyjatkowe.map((l) => <PozycjaZWyjatkiem key={l.lineId ?? l.twId} l={l} rozwiaz={rozwiaz} />)}
      </section>}

      {/* Wyjątki bez linii to towar SPOZA dokumentu — schowanie ich byłoby
          zgubieniem zgłoszenia. */}
      {d.problemyBezLinii.length > 0 && <section className="mb-4">
        <NaglowekSekcji jako="h3">Wyjątki poza pozycjami dokumentu · {d.problemyBezLinii.length}</NaglowekSekcji>
        {d.problemyBezLinii.map((p) => <Wyjatek key={p.id} p={p} {...rozwiaz} />)}
      </section>}

      <NaglowekSekcji jako="h3">
        {wyjatkowe.length ? "Pozostałe pozycje" : "Pozycje"} · {reszta.length}</NaglowekSekcji>
      {reszta.length
        ? <table className="mt-1 w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-600">
              {zdjecia && <th className="w-12 py-1.5 pr-2"><span className="sr-only">Zdjęcie</span></th>}
              <th className="py-1.5 pr-2 font-bold">Towar</th>
              <th className="w-32 py-1.5 pr-2 font-bold">Ilość · stan</th>
              <th className="w-44 py-1.5 font-bold">Gdzie · kto odłożył</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {reszta.map((l) => <tr key={l.lineId ?? `t${l.twId}`} className="align-top">
                {zdjecia && <td className="py-2 pr-2"><Zdjecie twId={l.twId} rozmiar={40} nazwa={l.name} /></td>}
                {/* Symbol w jednej linii: przy 1180 px kolumna zdjęć zabiera Towarowi
                    miejsce, a symbol łamany na łącznikach („TEST- / JEDNA- / POZ")
                    przestaje być tym, co hala ma na etykiecie. Łamie się nazwa. */}
                <td className="py-2 pr-2"><b className="whitespace-nowrap"><PrzyciskTowaru twId={l.twId}>{l.sym}</PrzyciskTowaru></b><div className="text-xs text-slate-600">{l.name}</div></td>
                <td className="py-2 pr-2 tabular-nums"><b>{ilosc(l.qtyDone)}/{ilosc(l.qtyDoc)}</b>{" "}
                  <StanPozycji s={l.status} /></td>
                <td className="py-2"><Gdzie l={l} /></td>
              </tr>)}
            </tbody>
          </table>
        : <p className="py-2 text-sm text-slate-600">
            {wyjatkowe.length ? "Poza wyjątkami nie ma pozycji." : "Dokument nie ma pozycji do rozłożenia."}</p>}
    </div>
  </>;
}

/**
 * Otwarte wyjątki bez dokumentu na liście — spoza okna importu albo bez
 * dostawy. Środkowa kolumna pokazuje je tak samo jak w dokumencie, żeby
 * ROZWIĄŻ działało wszędzie, gdzie wyjątek widać.
 */
export function WyjatkiLuzem({ tytul, podtytul, lista, rozwiaz }: {
  tytul: string; podtytul: string; lista: WyjatekHali[]; rozwiaz: RozwiazProps;
}) {
  return <>
    <div className="shrink-0 border-b border-slate-200 px-5 py-4">
      <h2 className="text-tytul font-bold">{tytul}</h2>
      <p className="mt-1 text-sm text-slate-600">{podtytul}</p>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
      {lista.map((p) => <div key={p.id} className="border-b border-slate-200 py-2 last:border-b-0">
        <b>{p.sym || p.symObcy || "towar bez kartoteki"}</b>
        {p.name && <span className="ml-2 text-sm text-slate-700">{p.name}</span>}
        <Wyjatek p={p} {...rozwiaz} />
      </div>)}
    </div>
  </>;
}
