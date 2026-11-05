import React, { useId, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquarePlus } from "lucide-react";
import { useJa } from "../api/rozmowy";
import {
  NAZWA_RODZAJU, NAZWA_STATUSU, PLAKIETKA_STATUSU, useZgloszenia, useZmienStatusZgloszenia,
  type FiltrZgloszen, type StatusZgloszenia, type Zgloszenie,
} from "../api/zgloszenia";
import { useOkno } from "../nawigacja/fokus";
import { useZdjecieZgloszenia } from "../towar/useZdjecie";
import { Blad, FiltrSegmentowy, Karta, Plakietka, Przycisk, Pusto, czas } from "../ui";

/* ── ZGŁOSZENIA PRACOWNIKÓW — ekran właściciela ───────────────────────────
   Wgląd, nie praca dzienna, więc mieszka w menu „Więcej”, a nie w zakładkach.
   Czyta go wyłącznie `admin`. Uwaga o koledze albo o szefie ma być bezpieczna,
   więc biuro widzi tylko własne zgłoszenia, w oknie zgłoszenia.

   Domyślny filtr to „Nowe”: właściciel wchodzi tu po to, co czeka na jego
   słowo (dekalog p. 2). Decyzja stoi przy samym zgłoszeniu, z polem na krótką
   odpowiedź. Autor zobaczy ją pod swoim formularzem, więc wie, że go czytano. */

const FILTRY: Array<{ klucz: FiltrZgloszen; etykieta: string }> = [
  { klucz: "nowe", etykieta: "Nowe" },
  { klucz: "przyjete", etykieta: "Przyjęte" },
  { klucz: "zrobione", etykieta: "Zrobione" },
  { klucz: "odrzucone", etykieta: "Odrzucone" },
  { klucz: "wszystkie", etykieta: "Wszystkie" },
];

/** Decyzje w kolejności, w jakiej właściciel po nie sięga. */
const DECYZJE: Array<{ status: StatusZgloszenia; napis: string }> = [
  { status: "przyjete", napis: "Przyjmij" },
  { status: "zrobione", napis: "Zrobione" },
  { status: "odrzucone", napis: "Odrzuć" },
  { status: "nowe", napis: "Wróć do nowych" },
];

export function Zgloszenia() {
  const ja = useJa();
  const admin = ja.data?.user.role === "admin";
  const [filtr, setFiltr] = useState<FiltrZgloszen>("nowe");
  const lista = useZgloszenia(filtr, admin);

  /* Własny scroller — rama panelu nie przewija za ekrany (patrz `main.tsx`). */
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <h1 className="text-naglowek font-bold">Zgłoszenia pracowników</h1>
    {ja.isError ? <Blad>{(ja.error as Error).message}</Blad>
      : !ja.data ? <p className="text-sm text-slate-600">Wczytuję…</p>
        : !admin ? <p className="text-sm">Zgłoszenia czyta tylko właściciel. Swoje widzisz w oknie
          „Zgłoś uwagę lub pomysł” na pasku menu.</p>
          : <>
            <div role="group" aria-label="Status zgłoszeń" className="flex flex-wrap gap-1">
              <FiltrSegmentowy<FiltrZgloszen> wybrany={filtr} onWybierz={setFiltr}
                pozycje={FILTRY.map((f) => ({ ...f, ile: licznik(lista.data?.liczniki, f.klucz, lista.isError) }))} />
            </div>
            {/* Błąd zamiast listy: pusta lista przy awarii czytałaby się jak „nic nie czeka". */}
            {lista.isError ? <Blad>{(lista.error as Error).message}</Blad>
              : !lista.data || lista.isPlaceholderData ? <p className="text-sm text-slate-600">Wczytuję…</p>
                : lista.data.zgloszenia.length === 0
                  ? <Pusto waga="lista" ikona={MessageSquarePlus}>Brak zgłoszeń z tym statusem.</Pusto>
                  : <ul className="flex flex-col gap-3">
                    {lista.data.zgloszenia.map((z) => <li key={z.id}><KartaZgloszenia z={z} /></li>)}
                  </ul>}
          </>}
  </div>;
}

/** Licznik pigułki. Bez danych „—”, bo zero przy awarii czytałoby się jak koniec pracy. */
function licznik(l: Record<StatusZgloszenia, number> | undefined, f: FiltrZgloszen, blad: boolean): number | "—" | undefined {
  if (!l) return blad ? "—" : undefined;
  return f === "wszystkie" ? l.nowe + l.przyjete + l.zrobione + l.odrzucone : l[f];
}

function KartaZgloszenia({ z }: { z: Zgloszenie }) {
  const id = useId();
  const [odpowiedz, setOdpowiedz] = useState(z.odpowiedz ?? "");
  const zmien = useZmienStatusZgloszenia();
  const tresc = odpowiedz.trim();
  const nowaOdpowiedz = tresc !== (z.odpowiedz ?? "").trim();
  /* Puste pole przy zapisanej odpowiedzi to jej skasowanie, więc jedzie
     pusty napis. Puste pole bez odpowiedzi nie niesie niczego. */
  const decyzja = (status: StatusZgloszenia) => zmien.mutate({
    id: z.id, status, odpowiedz: tresc !== "" || z.odpowiedz ? tresc : undefined });
  const zaDluga = tresc.length > 1000;

  return <Karta className="flex flex-col gap-3 p-4" aria-labelledby={`${id}-tytul`} role="article">
    <div className="flex flex-wrap items-center gap-2">
      <Plakietka status={PLAKIETKA_STATUSU[z.status]}>{NAZWA_STATUSU[z.status]}</Plakietka>
      <h2 id={`${id}-tytul`} className="text-sm font-bold">{NAZWA_RODZAJU[z.rodzaj]} · {z.autor}</h2>
      <span className="text-sm text-slate-600">{czas(z.at)}</span>
    </div>
    <p className="whitespace-pre-wrap text-tresc">{z.opis}</p>
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      <div className="flex gap-1.5"><dt className="text-slate-600">Ekran</dt>
        <dd className="font-semibold">{z.ekran.startsWith("/obsluga/") && !z.ekran.includes(":")
          ? <Link to={z.ekran} className="underline">{z.ekran}</Link> : z.ekran}</dd></div>
      <div className="flex gap-1.5"><dt className="text-slate-600">Źródło</dt>
        <dd className="font-semibold">{z.zrodlo === "kolektor"
          ? `Kolektor${z.urzadzenie ? ` ${z.urzadzenie}` : ""}` : "Panel"}</dd></div>
      <div className="flex gap-1.5"><dt className="text-slate-600">Wersja</dt>
        <dd className="font-semibold">{z.wersja ?? "—"}</dd></div>
    </dl>
    {z.zdjecia.length > 0 && <ul aria-label="Zdjęcia zgłoszenia" className="flex flex-wrap gap-2">
      {z.zdjecia.map((f, i) => <li key={f.id}><Miniatura zgloszenieId={z.id} zdjecieId={f.id} nr={i + 1} /></li>)}
    </ul>}
    {z.statusAt && <p className="text-xs text-slate-600">
      {NAZWA_STATUSU[z.status]} {czas(z.statusAt)}{z.statusPrzez ? `, ${z.statusPrzez}` : ""}</p>}

    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
      <label className="flex flex-col gap-1 text-sm font-semibold">Odpowiedź dla autora (nieobowiązkowa)
        <textarea value={odpowiedz} rows={2} onChange={(e) => setOdpowiedz(e.target.value)}
          className="field font-normal" /></label>
      {zaDluga && <p className="text-sm text-ranga-zle">Odpowiedź mieści się w 1000 znakach.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {DECYZJE.filter((d) => d.status !== z.status).map((d) =>
          <Przycisk key={d.status} type="button" disabled={zmien.isPending || zaDluga}
            onClick={() => decyzja(d.status)}>{d.napis}</Przycisk>)}
        {/* Sama odpowiedź bez zmiany statusu, np. dopytanie przy przyjętym. */}
        {nowaOdpowiedz && <Przycisk type="button" disabled={zmien.isPending || zaDluga}
          onClick={() => decyzja(z.status)}>Zapisz odpowiedź</Przycisk>}
      </div>
      <Blad>{zmien.error ? (zmien.error as Error).message : null}</Blad>
    </div>
  </Karta>;
}

function Miniatura({ zgloszenieId, zdjecieId, nr }: { zgloszenieId: number; zdjecieId: number; nr: number }) {
  const { url, blad, ponow } = useZdjecieZgloszenia(zgloszenieId, zdjecieId);
  const [duze, setDuze] = useState(false);
  if (blad) return <button type="button" onClick={ponow} title={blad}
    className="grid h-24 w-24 place-items-center rounded-lg border border-slate-200 p-1 text-center text-xs text-ranga-zle">
    Zdjęcie {nr} nie doszło. Spróbuj ponownie</button>;
  if (!url) return <span className="grid h-24 w-24 place-items-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-600">
    {url === null ? `Brak zdjęcia ${nr}` : "Wczytuję…"}</span>;
  return <>
    <button type="button" onClick={() => setDuze(true)} aria-label={`Powiększ zdjęcie ${nr}`}>
      <img src={url} alt={`Zdjęcie ${nr} ze zgłoszenia`} className="h-24 w-24 rounded-lg border border-slate-200 object-cover" />
    </button>
    {duze && <Lupa src={url} nr={nr} onZamknij={() => setDuze(false)} />}
  </>;
}

/* Powiększenie zamyka każde kliknięcie, Enter i Escape — jak lupa dowodu
   w dostawach. Zdjęcie ogląda się chwilę, a okno bez przycisku nie wymaga
   celowania w krzyżyk. */
function Lupa({ src, nr, onZamknij }: { src: string; nr: number; onZamknij: () => void }) {
  const okno = useOkno<HTMLDivElement>({ onZamknij });
  return <div role="dialog" {...okno} aria-label={`Zdjęcie ${nr} — powiększenie`} className="fixed inset-0 z-50">
    <button type="button" onClick={onZamknij} aria-label="Zamknij powiększenie" data-fokus-startowy
      className="grid h-full w-full place-items-center bg-black/70 p-8">
      <img src={src} alt={`Zdjęcie ${nr} — powiększenie`} className="max-h-full max-w-full rounded-lg" />
    </button>
  </div>;
}
