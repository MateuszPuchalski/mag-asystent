import React, { useState } from "react";
import { AlertTriangle, Check, FileText, Pencil, Ruler, Search, X as Krzyzyk } from "lucide-react";
import type { DaneDoboru, Dobor as DoborTyp, DrogaDoboru, KandydatDoboru, StatusDoboru, SzczebelDoboru } from "../api/typy";
import { Konflikt } from "../api/klient";
import { useKandydaci, useStatusDoboru, useWybierzKandydata, useZapiszDaneDoboru } from "../api/rozmowy";
import { Przycisk } from "../ui";
import { Wyszukiwarka, type Towar as TowarZWyszukiwarki } from "../wyszukiwarka";
import { DO_WYBORU_DOBORU, NAZWA_DOBORU } from "./statusy";

/**
 * Dobór części przy rozmowie (§11, etap E1) — trzecia zakładka kolumny
 * kontekstu, wg makiety `docs/projekt-widokow/Dobor.dc.html`.
 *
 * Komponent woła hooki SAM — precedens `TowarRozmowy.tsx` — więc `Rozmowa.tsx`
 * z jego czterdziestoma sześcioma propsami zostaje nietknięty.
 *
 * Trzy rzeczy, których ekran NIE robi, bo zabrania tego projekt:
 * - nie układa zdania do szkicu (§14.3: pisze je serwer, ze źródłem),
 * - nie zgaduje maszyny z treści pytania (dane wpisuje agent; w E1 nie ma
 *   Copilota, więc nie ma też „propozycji Copilota" z makiety),
 * - nie zatwierdza sam: `confirmed` klika człowiek, a serwer odmawia bez wyboru.
 *
 * DWA zatwierdzenia z makiety to jedno. Stopka makiety zatwierdzała
 * ZASTOSOWANIE — „tylko ekspert". Decyzją właściciela roli eksperta nie ma,
 * a zastosowanie idzie w E2 do kolejki propozycji; tu zatwierdza się DOBÓR.
 */

const POLA: Array<{ klucz: keyof Omit<DaneDoboru, "parametry">; nazwa: string; przyklad: string }> = [
  { klucz: "marka", nazwa: "Marka", przyklad: "NAC" },
  { klucz: "model", nazwa: "Model", przyklad: "LS 46-450" },
  { klucz: "wariant", nazwa: "Wariant", przyklad: "HS" },
  { klucz: "rocznik", nazwa: "Rocznik", przyklad: "2019" },
  { klucz: "nrSeryjny", nazwa: "Nr seryjny", przyklad: "pełny, z tabliczki" },
  { klucz: "silnik", nazwa: "Silnik", przyklad: "B&S 450E" },
  { klucz: "oem", nazwa: "Numer OEM / symbol", przyklad: "532 19 93-77" },
  { klucz: "nazwaCzesci", nazwa: "Część", przyklad: "szarpak rozrusznika" },
];

const NAZWA_DROGI: Record<DrogaDoboru, string> = {
  symbol: "symbol", ean: "EAN", oem: "OEM", zastosowanie: "zastosowanie", zamiennik: "zamiennik",
  oferta: "oferta", pelnotekst: "pełny tekst", wyszukiwarka: "wyszukiwarka",
};

const PEWNOSC: Record<KandydatDoboru["pewnosc"], { etykieta: string; klasa: string }> = {
  potwierdzone: { etykieta: "potwierdzone", klasa: "bg-emerald-100 text-emerald-800" },
  prawdopodobne: { etykieta: "prawdopodobne", klasa: "bg-amber-100 text-amber-800" },
  wymaga_danych: { etykieta: "wymaga danych", klasa: "bg-slate-100 text-slate-600" },
};

const KLASA_STATUSU: Partial<Record<StatusDoboru, string>> = {
  confirmed: "bg-emerald-100 text-emerald-800",
  missing_information: "bg-red-100 text-ranga-zle",
  candidates_found: "bg-amber-100 text-amber-800",
  requires_expert: "bg-violet-100 text-violet-800",
  rejected: "bg-slate-200 text-slate-700",
};

/** Parametry jako tekst „klucz: wartość" wiersz po wierszu — lista jest otwarta. */
const parametryNaTekst = (p: Record<string, string>) =>
  Object.entries(p).map(([k, v]) => `${k}: ${v}`).join("\n");
const tekstNaParametry = (t: string): Record<string, string> => {
  const wynik: Record<string, string> = {};
  for (const linia of t.split("\n")) {
    const i = linia.indexOf(":");
    if (i <= 0) continue;
    const k = linia.slice(0, i).trim(); const v = linia.slice(i + 1).trim();
    if (k && v) wynik[k] = v;
  }
  return wynik;
};

type Formularz = Record<keyof Omit<DaneDoboru, "parametry">, string> & { parametry: string };
const naFormularz = (d: DaneDoboru): Formularz => ({
  marka: d.marka ?? "", model: d.model ?? "", wariant: d.wariant ?? "", rocznik: d.rocznik ?? "",
  nrSeryjny: d.nrSeryjny ?? "", silnik: d.silnik ?? "", oem: d.oem ?? "", nazwaCzesci: d.nazwaCzesci ?? "",
  parametry: parametryNaTekst(d.parametry),
});

export function Dobor({ dobor, rozmowaId, onWstawDoSzkicu, onZlecPomiar }: {
  dobor: DoborTyp;
  rozmowaId: number;
  onWstawDoSzkicu: (tresc: string) => void;
  onZlecPomiar: (towar: TowarZWyszukiwarki) => void;
}) {
  const kandydaci = useKandydaci(rozmowaId);
  const zapisz = useZapiszDaneDoboru();
  const status = useStatusDoboru();
  const wybierz = useWybierzKandydata();

  const [edycja, setEdycja] = useState(false);
  const [formularz, setFormularz] = useState<Formularz>(() => naFormularz(dobor.dane));
  const [konflikt, setKonflikt] = useState<string>("");
  const [brakuje, setBrakuje] = useState(dobor.brakuje ?? "");
  const [pytamOBrak, setPytamOBrak] = useState(false);
  const [szukam, setSzukam] = useState(false);

  const blad = [zapisz.error, status.error, wybierz.error].find((e) => e && !(e instanceof Konflikt)) as Error | undefined;

  const zapiszDane = () => {
    const dane: Partial<DaneDoboru> = { parametry: tekstNaParametry(formularz.parametry) };
    for (const p of POLA) dane[p.klucz] = formularz[p.klucz].trim() || null;
    zapisz.mutate({ id: rozmowaId, dane, expectedVersion: dobor.wersja }, {
      onSuccess: () => { setEdycja(false); setKonflikt(""); },
      /* 409 NIE kasuje wpisanego: agent widzi, kto zmienił dane, i sam decyduje,
         czy wczytać cudze, czy nadpisać po odświeżeniu. */
      onError: (e) => {
        if (e instanceof Konflikt) {
          setKonflikt(`Ktoś zmienił dane doboru (${String(e.szczegoly.updatedBy ?? "inny agent")}) — odśwież i wpisz ponownie`);
        }
      },
    });
  };

  const ustawStatus = (s: StatusDoboru, notatka: string | null = null) =>
    status.mutate({ id: rozmowaId, status: s, brakuje: notatka }, { onSuccess: () => setPytamOBrak(false) });

  const wybierzTowar = (twId: number | null, droga: DrogaDoboru) =>
    wybierz.mutate({ id: rozmowaId, twId, droga, expectedVersion: dobor.wersja },
      { onSuccess: () => setSzukam(false) });

  const wypelnione = POLA.filter((p) => dobor.dane[p.klucz]);

  return <div className="flex min-h-0 flex-col text-sm">
    {/* ── Status ─────────────────────────────────────────────────────────── */}
    <div className="flex flex-wrap items-center gap-2 border-b p-3">
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        KLASA_STATUSU[dobor.status] ?? "bg-slate-100 text-slate-600"}`}>{NAZWA_DOBORU[dobor.status]}</span>
      {dobor.updatedBy && <span className="text-xs text-slate-500">· {dobor.updatedBy}</span>}
      <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
        Status
        <select className="field w-auto py-1 text-xs" aria-label="Status doboru" value={dobor.status}
          disabled={status.isPending}
          onChange={(e) => {
            const s = e.target.value as StatusDoboru;
            if (s === "missing_information") { setPytamOBrak(true); return; }
            ustawStatus(s);
          }}>
          {/* Stan bieżący bywa spoza listy ręcznej (`extracting_data` z F):
              pole musi mieć opcję dla wartości, którą pokazuje. */}
          {!DO_WYBORU_DOBORU.includes(dobor.status) &&
            <option value={dobor.status}>{NAZWA_DOBORU[dobor.status]}</option>}
          {DO_WYBORU_DOBORU.map((s) => <option key={s} value={s}>{NAZWA_DOBORU[s]}</option>)}
        </select>
      </label>
      {(pytamOBrak || dobor.status === "missing_information") &&
        <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-900">
          <AlertTriangle size={14} className="shrink-0" />
          <input className="field min-w-0 flex-1 py-1 text-xs" aria-label="Czego brakuje" value={brakuje}
            placeholder="Czego dopytać klienta, np. pełny numer seryjny"
            onChange={(e) => setBrakuje(e.target.value)} />
          <Przycisk className="text-xs" disabled={status.isPending}
            onClick={() => ustawStatus("missing_information", brakuje.trim() || null)}>Zapisz</Przycisk>
          {/* Pytanie doprecyzowujące idzie do szkicu na kliknięcie, nigdy samo. */}
          {dobor.brakuje && <button type="button" className="underline underline-offset-2"
            onClick={() => onWstawDoSzkicu(`Proszę o ${dobor.brakuje} — wtedy dobiorę właściwą część.`)}>
            wstaw pytanie do szkicu</button>}
        </div>}
    </div>

    {/* ── Dane wejściowe (§11.1) ─────────────────────────────────────────── */}
    <section className="border-b p-3" aria-label="Dane wejściowe">
      <div className="mb-2 flex items-center gap-2">
        <b className="text-xs uppercase tracking-wide text-slate-500">Dane wejściowe</b>
        <span className="text-[11px] text-slate-400">wersja {dobor.wersja}</span>
        {!edycja && <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
          onClick={() => { setFormularz(naFormularz(dobor.dane)); setKonflikt(""); setEdycja(true); }}>
          <Pencil size={12} />{wypelnione.length ? "Popraw" : "Wpisz dane"}</button>}
      </div>

      {!edycja && (wypelnione.length === 0 && Object.keys(dobor.dane.parametry).length === 0
        ? <p className="text-xs text-slate-500">Nie wiadomo jeszcze, o jaką maszynę i część chodzi.
            Wpisz, co podał klient — bez tego automat nie ma czego szukać.</p>
        : <div className="flex flex-wrap gap-1.5">
            {wypelnione.map((p) => <span key={p.klucz} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
              <span className="text-slate-500">{p.nazwa}: </span><b>{dobor.dane[p.klucz]}</b></span>)}
            {Object.entries(dobor.dane.parametry).map(([k, v]) =>
              <span key={`p-${k}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
                <span className="text-slate-500">{k}: </span><b>{v}</b></span>)}
          </div>)}

      {edycja && <form className="grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); zapiszDane(); }}>
        {POLA.map((p) => <label key={p.klucz} className="text-[11px] text-slate-500">{p.nazwa}
          <input className="field mt-0.5 py-1 text-xs" value={formularz[p.klucz]} placeholder={p.przyklad}
            aria-label={p.nazwa}
            onChange={(e) => setFormularz({ ...formularz, [p.klucz]: e.target.value })} /></label>)}
        <label className="col-span-2 text-[11px] text-slate-500">Parametry i wymiary (wiersz: nazwa: wartość)
          <textarea className="field mt-0.5 py-1 text-xs" rows={2} value={formularz.parametry}
            aria-label="Parametry" placeholder={"rozstaw: 82 mm\nśrednica: 148 mm"}
            onChange={(e) => setFormularz({ ...formularz, parametry: e.target.value })} /></label>
        {konflikt && <p className="col-span-2 flex items-center gap-1 text-xs font-semibold text-ranga-zle">
          <AlertTriangle size={13} />{konflikt}</p>}
        <div className="col-span-2 flex gap-2">
          <Przycisk wariant="glowny" type="submit" disabled={zapisz.isPending}>ZAPISZ</Przycisk>
          <Przycisk type="button" onClick={() => { setEdycja(false); setKonflikt(""); }}>Anuluj</Przycisk>
        </div>
      </form>}
    </section>

    {/* ── Kandydaci (§11.2) ──────────────────────────────────────────────── */}
    <section className="border-b p-3" aria-label="Kandydaci">
      <b className="text-xs uppercase tracking-wide text-slate-500">Kandydaci</b>
      {kandydaci.data && <Szczeble drogi={kandydaci.data.drogi} />}
      {kandydaci.isLoading && <p className="mt-2 text-xs text-slate-500">Szukam…</p>}
      {kandydaci.error && <p className="mt-2 text-xs text-red-700">{(kandydaci.error as Error).message}</p>}
      {kandydaci.data && kandydaci.data.kandydaci.length === 0 &&
        <p className="mt-2 text-xs text-slate-500">Żadna sprawdzona droga nic nie dała. Uzupełnij dane
          wejściowe albo wskaż kartotekę z wyszukiwarki.</p>}
      <ul className="mt-2 space-y-2">
        {kandydaci.data?.kandydaci.map((k) => {
          const wybrany = dobor.wybrany?.twId === k.twId;
          return <li key={k.twId} className={`rounded-lg border p-2 ${wybrany
            ? "border-wertis-amber bg-amber-50" : "border-slate-200"}`}>
            <div className="flex items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded bg-slate-100 text-[10px] font-bold text-slate-600">{k.nr}</span>
              <b className="font-mono text-xs">{k.symbol}</b>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${PEWNOSC[k.pewnosc].klasa}`}>
                {PEWNOSC[k.pewnosc].etykieta}</span>
              <span className={`ml-auto text-[11px] ${k.stan <= 0 ? "font-bold text-ranga-zle" : "text-slate-500"}`}>
                dostępne {k.stan}</span>
            </div>
            <p className="mt-1 text-xs text-slate-700">{k.nazwa}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              <span className="rounded bg-slate-100 px-1 py-0.5 font-semibold text-slate-600">droga: {NAZWA_DROGI[k.droga]}</span>
              {" "}{k.zrodlo}</p>
            {k.ostrzezenia.map((o) => <p key={o} className="mt-1 flex items-center gap-1 rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
              <AlertTriangle size={12} />{o}</p>)}
            {!wybrany && <button type="button" disabled={wybierz.isPending}
              onClick={() => wybierzTowar(k.twId, k.droga)}
              className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              <Check size={12} />Wybierz</button>}
          </li>;
        })}
      </ul>
      {/* Wyszukiwarka klikana ręcznie NIE jest kandydatem — to od razu wybór
          z drogą `wyszukiwarka`, podpisany agentem. */}
      {szukam
        ? <div className="mt-2"><Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
            onWybierz={(t) => t && wybierzTowar(t.id, "wyszukiwarka")} /></div>
        : <button type="button" onClick={() => setSzukam(true)}
            className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
            <Search size={12} />wskaż kartotekę z wyszukiwarki</button>}
    </section>

    {/* ── Wybrano ────────────────────────────────────────────────────────── */}
    <section className="p-3" aria-label="Wybrano">
      {dobor.wybrany
        ? <>
            <p className="text-xs text-slate-500">Wybrano: <b className="font-mono text-slate-900">{dobor.wybrany.symbol}</b>
              {" "}· droga: {NAZWA_DROGI[dobor.wybrany.droga]} · {dobor.wybrany.przez}
              <button type="button" title="Zdejmij wybór" disabled={wybierz.isPending}
                onClick={() => wybierzTowar(null, dobor.wybrany!.droga)}
                className="ml-1 rounded p-0.5 align-middle text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                <Krzyzyk size={12} /></button></p>
            <p className="mt-1 rounded border border-slate-200 bg-slate-50 p-2 text-xs italic text-slate-700">
              {dobor.wybrany.zdanieDoSzkicu}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Przycisk className="text-xs" onClick={() => onZlecPomiar({
                id: dobor.wybrany!.twId, sym: dobor.wybrany!.symbol, name: dobor.wybrany!.symbol, locs: [] })}>
                <Ruler size={14} />Zleć pomiar</Przycisk>
              <Przycisk className="text-xs" onClick={() => onWstawDoSzkicu(dobor.wybrany!.zdanieDoSzkicu)}>
                <FileText size={14} />Wstaw do szkicu ze źródłem</Przycisk>
              {dobor.status !== "confirmed" && <Przycisk wariant="glowny" className="text-xs"
                disabled={status.isPending} onClick={() => ustawStatus("confirmed")}>
                <Check size={14} />ZATWIERDŹ DOBÓR</Przycisk>}
            </div>
          </>
        : <p className="text-xs text-slate-500">Nic jeszcze nie wybrano. Zatwierdzenie doboru wymaga
            wybranej kartoteki.</p>}
      {blad && <p className="mt-2 text-xs text-red-700">{blad.message}</p>}
    </section>
  </div>;
}

/**
 * Pasek szczebli §11.2. Szczebel POMINIĘTY mówi dlaczego — blizna 0.153.1:
 * milczący ekran każe zgadywać, czy automat szukał i nie znalazł, czy nie
 * miał czego szukać.
 */
function Szczeble({ drogi }: { drogi: SzczebelDoboru[] }) {
  return <div className="mt-1 flex flex-wrap gap-1" aria-label="Sprawdzone drogi">
    {drogi.map((d) => <span key={d.droga} title={d.sprawdzona ? `${d.wynikow} wyników` : `pominięty: ${d.powod ?? ""}`}
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${d.sprawdzona
        ? "bg-slate-200 text-slate-700" : "bg-slate-50 text-slate-400 line-through"}`}>
      {NAZWA_DROGI[d.droga]}{d.sprawdzona ? ` ${d.wynikow}` : ""}</span>)}
  </div>;
}
