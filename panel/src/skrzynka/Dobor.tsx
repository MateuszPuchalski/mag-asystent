import React, { useState } from "react";
import { AlertTriangle, ChevronRight, FileText, MessageCircleQuestion, Pencil, Ruler, Search } from "lucide-react";
import type {
  DaneDoboru, Dobor as DoborTyp, GrupaKandydata, KandydaciDoboru, KandydatDoboru, PewnoscKandydata,
  PodstawaWyboru, WynikDoboru,
} from "../api/typy";
import { Konflikt } from "../api/klient";
import { useKandydaci, useWynikDoboru, useZapiszDaneDoboru } from "../api/rozmowy";
import { NaglowekSekcji, Przycisk } from "../ui";
import { Wyszukiwarka, type Towar as TowarZWyszukiwarki } from "../wyszukiwarka";
import { Kafel } from "../towar/Kafel";
import { NAZWA_GRUPY, NAZWA_PODSTAWY } from "./statusy";

/**
 * Dobór części przy rozmowie (`docs/dobor-od-zera.md` §6).
 *
 * Ekran prowadzi do jednej z czterech odpowiedzi (§1): ta część, nie mamy,
 * dopytać, nie dotyczy. Wszystko inne jest środkiem i stoi tylko wtedy, gdy
 * do odpowiedzi prowadzi. Po wyniku lista znika, bo decyzja zapadła, a rama
 * wyniku mówi, co pojedzie do klienta.
 *
 * Czego ekran NIE robi: nie układa zdania do szkicu (pisze je serwer, ze
 * źródłem), nie zgaduje maszyny z treści rozmowy i nie wybiera sam. Otwarcie
 * zakładki niczego nie zapisuje; każdy zapis to kliknięcie człowieka.
 */

const POLA: Array<{ klucz: keyof DaneDoboru; nazwa: string; przyklad: string }> = [
  { klucz: "marka", nazwa: "Marka", przyklad: "NAC" },
  { klucz: "model", nazwa: "Model", przyklad: "LS 46-450" },
  { klucz: "wariant", nazwa: "Wariant", przyklad: "HS" },
  { klucz: "rocznik", nazwa: "Rocznik", przyklad: "2019" },
  { klucz: "nrSeryjny", nazwa: "Nr seryjny", przyklad: "pełny, z tabliczki" },
  { klucz: "silnik", nazwa: "Silnik", przyklad: "B&S 450E" },
  { klucz: "oem", nazwa: "Numer części", przyklad: "532 19 93-77" },
  { klucz: "nazwaCzesci", nazwa: "Nazwa części", przyklad: "szarpak rozrusznika" },
];
/* Te pola opisują MASZYNĘ: ich zmiana zdejmuje wybraną część na serwerze
   (§4.1), więc formularz ostrzega przed nią, zanim agent zapisze. */
const POLA_MASZYNY: ReadonlyArray<keyof DaneDoboru> = ["marka", "model", "wariant", "rocznik", "nrSeryjny"];

const PEWNOSC: Record<PewnoscKandydata, { etykieta: string; klasa: string }> = {
  potwierdzone: { etykieta: "potwierdzone", klasa: "bg-emerald-100 text-emerald-800" },
  prawdopodobne: { etykieta: "prawdopodobne", klasa: "bg-amber-100 text-amber-800" },
  do_sprawdzenia: { etykieta: "do sprawdzenia", klasa: "bg-slate-100 text-slate-700" },
};

const GRUPY: GrupaKandydata[] = ["numer", "wiedza", "podobne"];

type Formularz = Record<keyof DaneDoboru, string>;
const naFormularz = (d: DaneDoboru) =>
  Object.fromEntries(POLA.map((p) => [p.klucz, d[p.klucz] ?? ""])) as Formularz;

/** „NAC LS 46-450 HS (2019) · silnik B&S 450E · nr seryjny …" albo `null`. */
function opisMaszyny(d: DaneDoboru): string | null {
  const nazwa = [d.marka, d.model, d.wariant].filter(Boolean).join(" ");
  return [nazwa ? `${nazwa}${d.rocznik ? ` (${d.rocznik})` : ""}` : d.rocznik ? `rocznik ${d.rocznik}` : null,
    d.silnik && `silnik ${d.silnik}`, d.nrSeryjny && `nr seryjny ${d.nrSeryjny}`]
    .filter(Boolean).join(" · ") || null;
}
const opisCzesci = (d: DaneDoboru) => [d.nazwaCzesci, d.oem && `nr ${d.oem}`].filter(Boolean).join(" · ") || null;

/** Zdanie konfliktu z nazwiskiem z 409. Serwer daje je w `zmienil`. */
const zdanieKonfliktu = (e: Konflikt) =>
  `${String(e.szczegoly.zmienil ?? "Ktoś inny")} zmienił dobór przed Twoim zapisem. `
  + "Twoje wpisy zostały — sprawdź zmianę i zapisz ponownie.";

export function Dobor({ dobor, rozmowaId, onWstawDoSzkicu, onZlecPomiar }: {
  dobor: DoborTyp;
  rozmowaId: number;
  onWstawDoSzkicu: (tresc: string) => void;
  onZlecPomiar: (towar: TowarZWyszukiwarki) => void;
}) {
  /* Kandydatów szuka się tylko przy otwartym doborze: po wyniku lista
     zniknęła z ekranu, a zapytanie o nią byłoby pracą, której nikt nie widzi. */
  const kandydaci = useKandydaci(dobor.wynik === null ? rozmowaId : null);
  const zapisz = useZapiszDaneDoboru();
  const wynik = useWynikDoboru();

  const [edycja, setEdycja] = useState(false);
  const [formularz, setFormularz] = useState<Formularz>(() => naFormularz(dobor.dane));
  const [konflikt, setKonflikt] = useState("");
  const [dopytuje, setDopytuje] = useState(false);
  const [dopytac, setDopytac] = useState(dobor.dopytac ?? "");
  const [szukam, setSzukam] = useState(false);

  const blad = [zapisz.error, wynik.error].find((e) => e && !(e instanceof Konflikt)) as Error | undefined;
  /* 409 NIE kasuje wpisanego: formularz trzyma swój stan, a dobór z nową
     wersją przychodzi odświeżeniem, więc drugi zapis idzie już na niej. */
  const przyKonflikcie = (e: unknown) => { if (e instanceof Konflikt) setKonflikt(zdanieKonfliktu(e)); };

  const otworzFormularz = () => { setFormularz(naFormularz(dobor.dane)); setKonflikt(""); setEdycja(true); };
  const zapiszDane = () => {
    const dane = Object.fromEntries(POLA.map((p) => [p.klucz, formularz[p.klucz].trim() || null])) as DaneDoboru;
    zapisz.mutate({ id: rozmowaId, dane, expectedVersion: dobor.wersja }, {
      onSuccess: () => { setEdycja(false); setKonflikt(""); },
      onError: przyKonflikcie,
    });
  };
  const ustaw = (w: WynikDoboru | null, reszta: { twId?: number; podstawa?: PodstawaWyboru; dopytac?: string } = {}) =>
    wynik.mutate({ id: rozmowaId, wynik: w, expectedVersion: dobor.wersja, ...reszta }, {
      onSuccess: () => { setKonflikt(""); setDopytuje(false); setSzukam(false); },
      onError: przyKonflikcie,
    });

  const maszyna = opisMaszyny(dobor.dane);
  const czesc = opisCzesci(dobor.dane);
  const zmianaMaszyny = dobor.wynik === "czesc"
    && POLA_MASZYNY.some((k) => (formularz[k].trim() || null) !== dobor.dane[k]);

  /* Bez własnych kresek i wcięć: oddech daje treść wiersza „Dobór", a części
     dzieli odstęp i nagłówek sekcji. Kreska wewnątrz bloku czytała się jak
     granica między dwoma blokami kolumny. */
  return <div className="space-y-4 text-sm">
    {/* Bez własnego nagłówka: wiersz „Dobór" w kolumnie kontekstu niesie
        tytuł i stan w streszczeniu, a drugi raz tuż pod nim to szum. */}
    <section aria-label="Czego szuka klient">
      <div className="mb-1.5 flex items-center gap-2">
        {/* Numer wersji w dymku: pilnuje zapisu, a agentowi mówi coś
            dopiero przy konflikcie, który nazywa się wtedy sam. */}
        <span title={`wersja ${dobor.wersja}`}><NaglowekSekcji>Czego szuka klient</NaglowekSekcji></span>
        {!edycja && <button type="button" onClick={otworzFormularz}
          className="ml-auto inline-flex min-h-6 items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
          <Pencil size={12} aria-hidden />{maszyna || czesc ? "Popraw" : "Wpisz dane"}</button>}
      </div>
      {!edycja && (maszyna || czesc
        ? <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-slate-600">Maszyna</dt><dd className="text-slate-900">{maszyna ?? "nie podano"}</dd>
            <dt className="text-slate-600">Część</dt><dd className="text-slate-900">{czesc ?? "nie podano"}</dd>
          </dl>
        : <p className="text-xs text-slate-600">Nie wiadomo jeszcze, o jaką maszynę i część chodzi.
            Wpisz, co podał klient — bez tego nie ma czego szukać.</p>)}
      {edycja && <form className="grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); zapiszDane(); }}>
        {POLA.map((p) => <label key={p.klucz} className="text-podpis text-slate-600">{p.nazwa}
          <input className="field mt-0.5 py-1 text-xs" value={formularz[p.klucz]} placeholder={p.przyklad}
            aria-label={p.nazwa} onChange={(e) => setFormularz({ ...formularz, [p.klucz]: e.target.value })} /></label>)}
        {zmianaMaszyny && <p className="col-span-2 text-xs text-slate-700">
          Zmiana maszyny zdejmie wybraną część {dobor.wybrany?.symbol} — wybór dotyczył innej maszyny.</p>}
        {konflikt && <Ostrzezenie className="col-span-2">{konflikt}</Ostrzezenie>}
        <div className="col-span-2 flex gap-2">
          <Przycisk wariant="glowny" type="submit" disabled={zapisz.isPending}>Zapisz</Przycisk>
          <Przycisk type="button" onClick={() => { setEdycja(false); setKonflikt(""); }}>Anuluj</Przycisk>
        </div>
      </form>}
    </section>

    <div>
      {dobor.wynik === null && <>
        {kandydaci.isLoading && <p className="text-xs text-slate-600">Szukam…</p>}
        {kandydaci.error && <p className="text-xs text-ranga-zle">{(kandydaci.error as Error).message}</p>}
        {kandydaci.data && <Kandydaci dane={kandydaci.data} trwa={wynik.isPending} onPopraw={otworzFormularz}
          onWybierz={(k) => ustaw("czesc", { twId: k.twId, podstawa: k.grupa })} />}

        {/* Cztery odpowiedzi w jednym rzędzie pod listą: trzy bez kandydata
            i wyszukiwarka, gdy lista nie ma właściwej części. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Przycisk className="text-xs" disabled={wynik.isPending} onClick={() => ustaw("brak")}>Nie mamy</Przycisk>
          <Przycisk className="text-xs" aria-expanded={dopytuje} onClick={() => setDopytuje((d) => !d)}>
            <MessageCircleQuestion size={14} aria-hidden />Dopytaj o…</Przycisk>
          <Przycisk className="text-xs" disabled={wynik.isPending} onClick={() => ustaw("nie_dotyczy")}>Nie dotyczy</Przycisk>
          <button type="button" onClick={() => setSzukam((s) => !s)} aria-expanded={szukam}
            className="ml-auto inline-flex min-h-6 items-center gap-1 text-xs text-slate-600 underline underline-offset-2 hover:text-slate-900">
            <Search size={12} aria-hidden />wskaż z wyszukiwarki</button>
        </div>
        {dopytuje && <form className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); if (dopytac.trim()) ustaw("dopytac", { dopytac: dopytac.trim() }); }}>
          <input className="field min-w-0 flex-1 py-1 text-xs" aria-label="O co dopytać klienta" value={dopytac}
            placeholder="np. pełny numer seryjny z tabliczki" onChange={(e) => setDopytac(e.target.value)} />
          <Przycisk className="text-xs" type="submit" disabled={wynik.isPending || !dopytac.trim()}>Zapisz</Przycisk>
        </form>}
        {/* Wskazanie z wyszukiwarki NIE jest kandydatem — to od razu wybór
            z podstawą `reczny`, podpisany agentem. */}
        {szukam && <div className="mt-2"><Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
          onWybierz={(t) => {
            /* Jak przy „Wybierz": drugi strzał w trakcie zapisu dałby 409
               z nazwiskiem samego agenta. */
            if (t && !wynik.isPending) ustaw("czesc", { twId: t.id, podstawa: "reczny" });
          }} /></div>}
      </>}

      {dobor.wynik === "czesc" && dobor.wybrany && <>
        {/* Wniosek ma wyglądać na wniosek: rama oddziela to, co pojedzie do
            klienta, od reszty zakładki. Zdjęcie stoi tu, bo odpowiada na
            pytanie „czy na pewno ten", gdy lista jest już schowana. */}
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-2">
          <div className="flex items-start gap-3">
            <Kafel twId={dobor.wybrany.twId} rozmiar={56} nazwa={dobor.wybrany.symbol} symbol={dobor.wybrany.symbol} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-700">Wybrano <b className="font-mono text-sm text-slate-900">{dobor.wybrany.symbol}</b>
                {" "}· {NAZWA_PODSTAWY[dobor.wybrany.podstawa] ?? dobor.wybrany.podstawa}</p>
              <p className="mt-1 rounded border border-slate-200 bg-white p-2 text-xs italic text-slate-700">
                {dobor.wybrany.zdanieDoSzkicu}</p>
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Przycisk wariant="glowny" className="text-xs" onClick={() => onWstawDoSzkicu(dobor.wybrany!.zdanieDoSzkicu)}>
            <FileText size={14} aria-hidden />Wstaw do odpowiedzi</Przycisk>
          <Przycisk className="text-xs" onClick={() => onZlecPomiar({
            id: dobor.wybrany!.twId, sym: dobor.wybrany!.symbol, name: dobor.wybrany!.symbol, locs: [] })}>
            <Ruler size={14} aria-hidden />Zleć pomiar</Przycisk>
          <Przycisk className="text-xs" disabled={wynik.isPending} onClick={() => ustaw(null)}>Zmień</Przycisk>
        </div>
      </>}

      {dobor.wynik === "dopytac" && <>
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-900">
          Dopytać klienta o: <b>{dobor.dopytac}</b></div>
        <div className="mt-2 flex flex-wrap gap-2">
          {/* Pytanie idzie do szkicu na kliknięcie, nigdy samo. */}
          <Przycisk wariant="glowny" className="text-xs"
            onClick={() => onWstawDoSzkicu(`Proszę o ${dobor.dopytac} — wtedy dobiorę właściwą część.`)}>
            <FileText size={14} aria-hidden />Wstaw pytanie do odpowiedzi</Przycisk>
          <Przycisk className="text-xs" disabled={wynik.isPending} onClick={() => ustaw(null)}>Zmień</Przycisk>
        </div>
      </>}

      {(dobor.wynik === "brak" || dobor.wynik === "nie_dotyczy") && <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-slate-700">{dobor.wynik === "brak"
          ? "Nie mamy tej części. „Nie” jest tu odpowiedzią, nie porażką."
          : "Ta rozmowa nie jest pytaniem o dobór części."}</p>
        <Przycisk className="text-xs" disabled={wynik.isPending} onClick={() => ustaw(null)}>Otwórz ponownie</Przycisk>
      </div>}

      {!edycja && konflikt && <Ostrzezenie className="mt-2">{konflikt}</Ostrzezenie>}
      {blad && <p className="mt-2 text-xs text-ranga-zle">{blad.message}</p>}
    </div>
  </div>;
}

function Ostrzezenie({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <p role="alert" className={`flex items-center gap-1 text-xs font-semibold text-ranga-zle ${className}`}>
    <AlertTriangle size={13} aria-hidden className="shrink-0" />{children}</p>;
}

/**
 * Kandydaci w trzech grupach (§4.3): co klient wskazał, co wiedza potwierdza,
 * co jest podobne. „Podobne po nazwie" to trafienia bez dowodu, więc stoją
 * zwinięte, gdy jest coś mocniejszego. Nie znikają, ale nie kosztują uwagi.
 * Jako jedyna niepusta grupa stoją otwarte, bo zwinięcie schowałoby wszystko.
 */
function Kandydaci({ dane, trwa, onWybierz, onPopraw }: {
  dane: KandydaciDoboru; trwa: boolean;
  onWybierz: (k: KandydatDoboru) => void; onPopraw: () => void;
}) {
  const wGrupie = (g: GrupaKandydata) => dane.kandydaci.filter((k) => k.grupa === g);
  const niepuste = GRUPY.filter((g) => wGrupie(g).length > 0 || (g === "numer" && dane.bezKartoteki.length > 0));
  /* Kandydaci jak każda lista kolumny: kreska między pozycjami, bez ramek.
     Ramka wokół każdego kandydata była pudełkiem w pudełku wiersza. */
  const lista = (g: GrupaKandydata) => <ul className="mt-1.5 divide-y divide-slate-200">
    {wGrupie(g).map((k) => <Kandydat key={k.twId} k={k} trwa={trwa} onWybierz={() => onWybierz(k)} />)}
    {/* Numer bez kartoteki nie znika, bo „nie mamy" też jest odpowiedzią.
        Nie ma przycisku: nie ma czego wybrać. */}
    {g === "numer" && dane.bezKartoteki.map((b) => <li key={b.numer} className="py-2 text-xs text-slate-700">
      <b className="font-mono">{b.numer}</b> · {b.zdanie}</li>)}
  </ul>;

  return <>
    {niepuste.length === 0 && <div aria-label="Czego brakuje do doboru">
      {dane.brakuje.length > 0
        ? <><p className="text-xs font-semibold text-slate-700">Nic nie znaleziono. Brakuje:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-700">
              {dane.brakuje.map((z) => <li key={z}>{z}</li>)}</ul></>
        : <p className="text-xs text-slate-700">Sprawdzono wszystkie źródła i nic nie pasuje.</p>}
      <Przycisk className="mt-2 text-xs" onClick={onPopraw}><Pencil size={12} aria-hidden />Popraw dane</Przycisk>
    </div>}
    {niepuste.map((g) => g === "podobne" && niepuste.length > 1
      ? <PodobneZwiniete key={g} ile={wGrupie(g).length}>{lista(g)}</PodobneZwiniete>
      : <section key={g} className="mt-3 first:mt-0" aria-label={NAZWA_GRUPY[g]}>
          <NaglowekSekcji jako="h3">{NAZWA_GRUPY[g]}</NaglowekSekcji>
          {lista(g)}
        </section>)}
    {dane.negatywne.length > 0 && <Negatywne lista={dane.negatywne} />}
  </>;
}

/**
 * „Podobne po nazwie" zwinięte, gdy jest coś mocniejszego. Przycisk
 * z `aria-expanded` zamiast `<details>`: kolumna rozwija wszystko jednym
 * idiomem, szewronem przed słowem, a czytnik ekranu słyszy stan tak samo
 * jak przy „Pasuje do".
 */
function PodobneZwiniete({ ile, children }: { ile: number; children: React.ReactNode }) {
  const [otwarte, setOtwarte] = useState(false);
  return <div className="mt-3">
    <button type="button" aria-expanded={otwarte} onClick={() => setOtwarte((o) => !o)}
      className="inline-flex min-h-6 items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900">
      <ChevronRight size={12} aria-hidden className={`transition-transform ${otwarte ? "rotate-90" : ""}`} />
      {NAZWA_GRUPY.podobne} ({ile})</button>
    {otwarte && children}
  </div>;
}

function Kandydat({ k, trwa, onWybierz }: { k: KandydatDoboru; trwa: boolean; onWybierz: () => void }) {
  return <li className="py-2">
    {/* CO CZYTA SIĘ PIERWSZE. Dobór rozstrzyga „czy TO jest ta część", a na
        to odpowiada kształt i nazwa. Zdjęcie idzie więc na lewo, nazwa
        dostaje pierwszy plan, symbol i pewność schodzą do podpisu. Symbol
        zostaje, bo to on jedzie na dokument i na halę.

        `items-start`: kafle stoją w JEDNEJ pionowej linii, bo wzrok jedzie
        po nich w dół. Wyśrodkowane skakałyby z długością nazwy. */}
    <div className="flex items-start gap-2">
      <Kafel twId={k.twId} rozmiar={56} nazwa={k.nazwa} symbol={k.symbol} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {/* Pismo nie większe od tytułu wiersza: nazwa prowadzi kartę
              kandydata wagą, a kafel obok niesie kształt. */}
          <b className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{k.nazwa}</b>
          {/* DOSTĘPNOŚĆ MA BARWĘ W OBIE STRONY: „mamy 28 sztuk" kończy
              rozmowę jednym zdaniem, a zero każe szukać dalej. */}
          {k.stan === null
            ? <span className="shrink-0 text-podpis font-bold text-slate-600">brak stanu</span>
            : <span className={`shrink-0 text-podpis font-bold ${k.stan <= 0 ? "text-ranga-zle" : "text-emerald-700"}`}>
                dostępne {k.stan}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs text-slate-600">{k.symbol}</span>
          <span className={`rounded px-1.5 py-0.5 text-podpis font-bold ${PEWNOSC[k.pewnosc].klasa}`}>
            {PEWNOSC[k.pewnosc].etykieta}</span>
        </div>
        {/* Powód jednym wierszem; inne źródła tej kartoteki w dymku, bo przy
            każdym wierszu czytane przestałyby być trzecim planem. */}
        <p className="mt-0.5 truncate text-podpis text-slate-600"
          title={k.takze.length ? [k.powod, ...k.takze].join("\n") : k.powod}>
          {k.powod}{k.takze.length > 0 && <span className="font-semibold"> · +{k.takze.length} źródła</span>}</p>
      </div>
      {/* OBRYS, NIE PEŁNA ZIELEŃ: kilka pełnych przycisków jeden pod drugim
          byłoby najgłośniejszą rzeczą w kolumnie, a to ruch dostępny, nie zalecany. */}
      <button type="button" disabled={trwa} onClick={onWybierz}
        className="min-h-6 shrink-0 rounded border border-emerald-600 px-2 py-0.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
        Wybierz</button>
    </div>
    {/* Ostrzeżenie w rodzinie „uwaga", bez przerywanej ramki: ikona i barwa
        mówią „sprawdź", a obrys ważył więcej niż sam kandydat. */}
    {k.ostrzezenia.map((o) => <p key={o} className="mt-1 flex items-center gap-1 text-podpis text-ranga-uwaga">
      <AlertTriangle size={12} aria-hidden className="shrink-0" />{o}</p>)}
  </li>;
}

/**
 * „Nie pasuje". Sekcja OSOBNA od kandydatów, bo negatyw dotyczy także
 * kartoteki, której na liście nie ma: to ostrzeżenie, nie brak danych.
 * Kafel jest mniejszy niż przy kandydacie, żeby nie konkurował z częściami,
 * które wolno wybrać.
 */
function Negatywne({ lista }: { lista: KandydaciDoboru["negatywne"] }) {
  return <section className="mt-3 rounded-lg border border-red-200" aria-label="Nie pasuje">
    <p className="flex items-center gap-1 rounded-t-lg bg-red-50 px-2 py-1 text-podpis font-bold text-red-900">
      <AlertTriangle size={12} aria-hidden />Nie pasuje</p>
    <ul className="divide-y divide-red-100">
      {/* Ta sama kartoteka bywa negatywem z maszyny i przez silnik naraz. */}
      {lista.map((n, i) => <li key={`${n.twId}-${i}`} className="flex items-start gap-2 px-2 py-1.5 text-xs">
        <Kafel twId={n.twId} rozmiar={36} nazwa={n.nazwa ?? n.symbol} symbol={n.symbol} />
        <div className="min-w-0 flex-1">
          <b className="font-mono">{n.symbol}</b>{n.nazwa && <span className="text-slate-600"> · {n.nazwa}</span>}
          <p className="text-red-900">{n.powod}</p>
          <p className="text-podpis text-slate-600">{n.zrodlo}</p>
        </div>
      </li>)}
    </ul>
  </section>;
}
