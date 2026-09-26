import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, ExternalLink, Square } from "lucide-react";
import type { RozjazdOferty, WynikPartiiPasujeDo } from "../api/typy";
import { usePasujeDo, useSpiszOferty, useZbierzPasujeDo } from "../api/wiedza";
import { PrzerwaAllegro } from "../api/klient";
import { Blad, NaglowekSekcji, Przycisk, czas, ile } from "../ui";

/* ── „Pasuje do" ze wszystkich ofert Allegro ────────────────────────────────
   Dwie rzeczy na jednej karcie, bo to jedna robota. ZBIÓRKA czyta listy
   „Pasuje do" wszystkich naszych ofert i przepisuje je do wiedzy. SPRAWDZENIE
   kładzie każdą listę obok zatwierdzonej wiedzy o kartotece i mówi, gdzie
   się rozjeżdżają.

   TYLKO CZYTANIE ALLEGRO. Właściciel wybrał wersję bez publikacji: rozjazd
   poprawia się na Allegro, a karta daje do tego odnośnik.

   ZBIÓRKĘ PROWADZI EKRAN, partia po partii, bo serwer nie ma przebiegów
   w tle i nie ma ich mieć. Stąd przycisk „Zatrzymaj" i licznik „zostało":
   kilkaset ofert to kilkanaście minut, a człowiek ma widzieć, że to idzie,
   i móc przerwać bez szkody — następna zbiórka zacznie tam, gdzie ta
   skończyła, bo miejsce zna baza. */

type Faza = "spoczynek" | "lista" | "tresc" | "przerwa";
const ZERO = { przejrzano: 0, numerow: 0, wpisanych: 0, wKolejce: 0, znanych: 0, sprzecznych: 0 };
/** Tyle ofert z rozjazdem naraz — reszta pod „Pokaż wszystkie". */
const NA_START = 20;

export function PasujeDoOfert() {
  const qc = useQueryClient();
  const dane = usePasujeDo();
  const spisz = useSpiszOferty();
  const zbierz = useZbierzPasujeDo();
  const stop = useRef(false);
  const [faza, setFaza] = useState<Faza>("spoczynek");
  const [postep, setPostep] = useState("");
  const [sumy, setSumy] = useState(ZERO);
  const [blad, setBlad] = useState("");
  const [komunikat, setKomunikat] = useState("");

  /* Zejście z ekranu zatrzymuje zbiórkę — pętla nie ma prawa pytać
     Allegro za plecami człowieka, który poszedł gdzie indziej. */
  useEffect(() => () => { stop.current = true; }, []);

  /* Czekanie, które da się przerwać „Zatrzymaj" — odlicza w sekundach. */
  const czekaj = async (ms: number, powod: string) => {
    const koniec = Date.now() + ms;
    while (!stop.current && Date.now() < koniec) {
      if (powod) setPostep(`${powod} — wracam za ${Math.ceil((koniec - Date.now()) / 1000)} s`);
      await new Promise((r) => setTimeout(r, Math.min(1000, koniec - Date.now())));
    }
  };

  /* Limit z Allegro nie kończy zbiórki: czekamy tyle, ile prosi, i próbujemy
     jeszcze raz. Bez podanego czasu — minuta. */
  const zPrzerwa = async <T,>(krok: () => Promise<T>): Promise<T | null> => {
    for (;;) {
      try { return await krok(); } catch (e) {
        if (!(e instanceof PrzerwaAllegro) || stop.current) throw e;
        setFaza("przerwa");
        await czekaj(e.poIluMs ?? 60_000, "Allegro prosi o przerwę");
        if (stop.current) return null;
      }
    }
  };

  const uruchom = async () => {
    stop.current = false;
    setBlad(""); setKomunikat(""); setSumy(ZERO);
    let razem = { ...ZERO };
    try {
      setFaza("lista");
      let offset: number | null = 0; let pobrane = 0;
      while (offset !== null && !stop.current) {
        const od: number = offset;
        setPostep(`Pobieram listę ofert z Allegro… ${pobrane}`);
        const r = await zPrzerwa(() => spisz.mutateAsync(od));
        if (!r) break;
        pobrane += r.zapisano;
        setPostep(`Pobieram listę ofert z Allegro… ${pobrane}${r.razem !== null ? ` z ${r.razem}` : ""}`);
        offset = r.nastepny;
      }
      while (!stop.current) {
        setFaza("tresc");
        const r: WynikPartiiPasujeDo | null = await zPrzerwa(() => zbierz.mutateAsync());
        if (!r) break;
        razem = { przejrzano: razem.przejrzano + r.przejrzano, numerow: razem.numerow + r.numerow,
          wpisanych: razem.wpisanych + r.wpisanych, wKolejce: razem.wKolejce + r.wKolejce, znanych: razem.znanych + r.znanych,
          sprzecznych: razem.sprzecznych + r.sprzecznych };
        setSumy(razem);
        setPostep(`Zbieram „Pasuje do"… zostało ${ile(r.pozostalo, "oferta", "oferty", "ofert")}`);
        qc.invalidateQueries({ queryKey: ["wiedza", "pasuje-do"] });
        if (r.przerwano) { setFaza("przerwa"); await czekaj(r.przerwano.poIluMs ?? 60_000, "Allegro prosi o przerwę"); continue; }
        if (r.pozostalo === 0 || r.przejrzano === 0) break;
        /* Między partiami półtorej do dwóch i pół sekundy, z rozrzutem —
           ten sam powód co odstęp na serwerze: rytm człowieka, nie zegara. */
        await czekaj(1500 + Math.random() * 1000, "");
      }
      setKomunikat(stop.current
        ? `Zatrzymano. Przejrzano ${ile(razem.przejrzano, "ofertę", "oferty", "ofert")} — następna zbiórka zacznie od reszty.`
        : `Gotowe. Przejrzano ${ile(razem.przejrzano, "ofertę", "oferty", "ofert")}.`);
    } catch (e) {
      setBlad((e as Error).message);
    } finally {
      setFaza("spoczynek"); setPostep("");
      /* Zbiórka dopisała wiedzę i kolejkę — odświeżamy wszystko, co z nich czyta. */
      qc.invalidateQueries({ queryKey: ["wiedza"] });
      qc.invalidateQueries({ queryKey: ["kandydaci"] });
    }
  };

  const trwa = faza !== "spoczynek";
  const s = dane.data?.stan;
  const spr = dane.data?.sprawdzenie;

  return <section className="space-y-3 rounded-lg border border-slate-200 p-3" aria-label="Pasuje do z ofert Allegro">
    <div>
      <NaglowekSekcji>„Pasuje do” z ofert Allegro</NaglowekSekcji>
      <p className="text-sm text-slate-600">
        Czyta listy „Pasuje do” wszystkich naszych aktywnych ofert i przepisuje je do wiedzy, a potem porównuje
        z tym, co wiedza zatwierdziła. Niczego nie zmienia na Allegro.</p>
    </div>
    {s && <p className="text-sm" aria-label="Stan zbiórki">
      Aktywnych ofert: <b>{s.ofert}</b> · z pewną kartoteką: <b>{s.zKartoteka}</b> · z pobraną treścią: {s.zTresca}
      {" "}· z listą „Pasuje do”: {s.zListe} ({ile(s.pozycji, "pozycja", "pozycje", "pozycji")}) · do zebrania: <b>{s.doZebrania}</b>
      {s.listaAt && <span className="text-slate-600"> · lista ofert pobrana {czas(s.listaAt)}</span>}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {!trwa
        /* Drugorzędny (@wydanie) z powodu opisanego przy „Sprawdź teraz"
           w `PasowanieZSieci`: jeden główny przycisk na zakładkę. */
        ? <Przycisk onClick={() => void uruchom()}><Download size={16} />Zbierz z wszystkich ofert</Przycisk>
        : <Przycisk onClick={() => { stop.current = true; }}><Square size={14} />Zatrzymaj</Przycisk>}
      {postep && <span className="text-sm text-slate-600" role="status">{postep}</span>}
    </div>
    {(trwa || sumy.przejrzano > 0) && <p className="text-sm text-slate-700" aria-label="Wynik zbiórki">
      Przejrzano {ile(sumy.przejrzano, "ofertę", "oferty", "ofert")} · numerów do kartotek: {sumy.numerow}
      {" "}· zastosowań zapisanych od razu: {sumy.wpisanych} · do kolejki „Z opisów i ofert”: {sumy.wKolejce}
      {" "}· już znanych: {sumy.znanych}
      {sumy.sprzecznych > 0 && <span className="text-red-800"> · pominiętych, bo wiedza mówi „nie pasuje”: {sumy.sprzecznych}</span>}</p>}
    <Blad>{blad || (dane.error as Error | null)?.message}</Blad>
    {komunikat && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{komunikat}</p>}

    {spr && <Sprawdzenie s={spr} />}
  </section>;
}

function Sprawdzenie({ s }: { s: NonNullable<ReturnType<typeof usePasujeDo>["data"]>["sprawdzenie"] }) {
  const [wszystkie, setWszystkie] = useState(false);
  const widoczne = wszystkie ? s.oferty : s.oferty.slice(0, NA_START);
  return <div className="space-y-2" aria-label="Sprawdzenie ofert">
    <p className="text-sm font-semibold">Oferty a wiedza</p>
    <p className="text-sm text-slate-700">
      Sprawdzono {ile(s.sprawdzonych, "ofertę", "oferty", "ofert")} · sprzeczności: <b className={s.sprzecznych ? "text-red-800" : ""}>{s.sprzecznych}</b>
      {" "}· brakujących maszyn: <b>{s.brakujacych}</b>
      {s.bezTresci > 0 && <span className="text-slate-600"> · bez pobranej treści: {s.bezTresci} — zbierz, żeby je sprawdzić</span>}</p>
    {s.oferty.length > 0 && <p className="text-xs text-slate-600">
      Sprzeczność to maszyna na liście oferty, do której wiedza mówi „nie pasuje” — zwrot, który czeka. Brak to maszyna,
      do której część pasuje, a lista jej nie wymienia — kupujący jej nie znajdzie. Poprawiasz na Allegro.</p>}
    <ul className="space-y-2">{widoczne.map((o) => <Oferta key={`${o.konto}:${o.ofertaId}`} o={o} />)}</ul>
    {!wszystkie && s.oferty.length > NA_START &&
      <Przycisk className="text-xs" onClick={() => setWszystkie(true)}>Pokaż wszystkie ({s.oferty.length})</Przycisk>}
  </div>;
}

function Oferta({ o }: { o: RozjazdOferty }) {
  return <li className={`rounded-lg border p-2 text-sm ${o.sprzeczne.length ? "border-red-200" : "border-slate-200"}`}
    aria-label={`Oferta ${o.ofertaId}`}>
    <p>
      {o.link ? <a className="font-semibold underline" href={o.link} target="_blank" rel="noreferrer">{o.nazwa}
        <ExternalLink size={12} className="ml-1 inline" aria-hidden="true" /></a> : <b>{o.nazwa}</b>}
      <span className="text-slate-600"> · <span className="font-mono">{o.symbol}</span> · {ile(o.pozycji, "pozycja", "pozycje", "pozycji")} na liście</span>
    </p>
    {o.sprzeczne.length > 0 && <ul className="mt-1 space-y-0.5 text-red-900">
      {o.sprzeczne.map((x, i) => <li key={i}>
        <AlertTriangle size={12} className="mr-1 inline" aria-hidden="true" />
        Lista wymienia „{x.pozycja}”, a wiedza: {x.maszyna} — {x.powod}{x.warunki ? ` (tylko: ${x.warunki})` : ""}
        <span className="block text-podpis text-slate-600">{x.zrodlo}</span></li>)}
    </ul>}
    {o.brakujace.length > 0 && <ul className="mt-1 space-y-0.5 text-slate-800">
      {o.brakujace.map((x, i) => <li key={i}>
        Brakuje na liście: <b>{x.maszyna}</b>{x.warunki ? <span className="text-amber-900"> (tylko: {x.warunki})</span> : null}
        <span className="block text-podpis text-slate-600">{x.zrodlo}</span></li>)}
    </ul>}
  </li>;
}
