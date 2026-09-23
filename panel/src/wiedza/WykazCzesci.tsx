import React, { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { ImportWykazu, MapowanieWykazu, ParaWykazu, PoleWykazu, RaportWykazu, TrescImportu } from "../api/typy";
import { useHistoriaWykazow, useImportWykazu, useWycofajWykaz } from "../api/wiedza";
import { tabelaZWierszy, wierszeZXlsx } from "../lib/xlsx";
import { Blad, NaglowekSekcji, Pole, Przycisk, czas, ile } from "../ui";
import { Tabela, Td } from "../ui/wglad";
import { Potwierdz } from "../ui/Potwierdz";

/* ── Wykaz części producenta: „model maszyny → numery OEM części" ───────────
   Stoi pod odsyłaczami, w tej samej zakładce, bo ma ten sam rytm: wgrać,
   wskazać kolumny, przejrzeć podgląd, zapisać. Różnica jest jedna i ważna:
   wykaz rodzi PROPOZYCJE do kolejki, nie wpisy. Numer OEM wskazuje naszą
   kartotekę przez opis albo cennik dostawcy, a to ogniwo sprawdza człowiek
   przy zdjęciu części.

   MARKA, MODEL I WARIANT: KOLUMNA ALBO JEDNA WARTOŚĆ. Wykaz jednej pilarki
   nie ma kolumny „model" — cały plik to MS 250. Lista wyboru ma więc pozycję
   „wpisz dla całego pliku", a pod nią pole.

   PODGLĄD LICZY SIĘ SAM po każdej zmianie kolumn, z oddechem — pola tekstowe
   marki i modelu zmieniają się co literę. Zapis czeka, aż podgląd dogoni to,
   co widać na ekranie: podgląd sprzed zmiany kolumn kłamie o tym, co wejdzie. */

const BRAK = "—";
const TEKST = "tekst";
/** Po tylu ms od ostatniej zmiany kolumn albo liter podgląd liczy się od nowa. */
const ODDECH = 400;

const PUSTA: MapowanieWykazu = {
  marka: { tekst: "" }, model: null, wariant: null, numery: [],
  rokOd: null, rokDo: null, seryjnyOd: null, seryjnyDo: null, rodzaj: "maszyna",
};

const maPole = (p: PoleWykazu) => p !== null && ("kolumna" in p || p.tekst.trim() !== "");

export function WykazCzesci() {
  /* Dwie mutacje z tego samego powodu co w odsyłaczach: TanStack odpala
     wywołania zwrotne `mutate` tylko dla OSTATNIEGO wywołania, więc podgląd
     w trakcie zapisu połknąłby komunikat o zapisie. */
  const podglad = useImportWykazu();
  const zapis = useImportWykazu();
  const historia = useHistoriaWykazow();
  const wycofaj = useWycofajWykaz();
  const plik = useRef<HTMLInputElement | null>(null);
  const [zrodlo, setZrodlo] = useState("");
  const [link, setLink] = useState("");
  const [rodzajDowodu, setRodzajDowodu] = useState<"producent" | "katalog_dostawcy">("producent");
  const [nazwaPliku, setNazwaPliku] = useState<string | null>(null);
  const [tresc, setTresc] = useState<TrescImportu | null>(null);
  const [mapa, setMapa] = useState<MapowanieWykazu | null>(null);
  const [raport, setRaport] = useState<RaportWykazu | null>(null);
  /* Dla JAKIEGO mapowania policzono raport — porównanie z tym, co wysłaliśmy,
     a nie z tym, co serwer oddał po oczyszczeniu spacji. */
  const [policzonoDla, setPoliczonoDla] = useState("");
  const [blad, setBlad] = useState("");
  const [komunikat, setKomunikat] = useState("");

  const liczPodglad = (t: TrescImportu, m: MapowanieWykazu | null) => {
    setBlad("");
    podglad.mutate({ zrodlo, link: null, plik: nazwaPliku, rodzajDowodu, tresc: t, mapowanie: m, zastosuj: false }, {
      onSuccess: (r) => {
        setRaport(r);
        if (!m) {
          /* Zgadnięte: marki zwykle nie ma w wykazie, więc od razu stoi pole
             „dla całego pliku" — człowiek wpisuje „STIHL" raz. */
          const zgadniete = r.mapowanie ? { ...r.mapowanie, marka: r.mapowanie.marka ?? { tekst: "" } } : { ...PUSTA };
          setMapa(zgadniete); setPoliczonoDla(JSON.stringify(zgadniete));
        } else setPoliczonoDla(JSON.stringify(m));
      },
      onError: (e) => setBlad((e as Error).message),
    });
  };

  const wczytaj = async (f: File) => {
    setRaport(null); setMapa(null); setBlad(""); setKomunikat(""); setNazwaPliku(f.name); setPoliczonoDla("");
    try {
      const t: TrescImportu = /\.(csv|txt)$/i.test(f.name)
        ? { csv: await f.text() }
        : { tabela: tabelaZWierszy(await wierszeZXlsx(await f.arrayBuffer())) };
      setTresc(t);
      if (!zrodlo.trim()) setZrodlo(f.name.replace(/\.[^.]+$/, ""));
      liczPodglad(t, null);
    } catch (e) {
      setTresc(null); setBlad((e as Error).message);
    }
  };

  const kompletna = mapa !== null && maPole(mapa.marka) && maPole(mapa.model) && mapa.numery.length > 0;

  /* Jeden oddech dla wszystkich zmian kolumn — listy i pola tekstowe. Tylko
     przy KOMPLETNYM mapowaniu: bez marki serwer odmawia, a czerwony błąd
     przy każdej literze to krzyk o coś, co człowiek właśnie robi. Czego
     brakuje, mówi zdanie pod przyciskiem. */
  useEffect(() => {
    if (!tresc || !mapa || !kompletna || JSON.stringify(mapa) === policzonoDla) return;
    const t = setTimeout(() => liczPodglad(tresc, mapa), ODDECH);
    return () => clearTimeout(t);
  }, [mapa]); // tylko kolumny: plik liczy podgląd sam, w `wczytaj`
  const aktualny = raport !== null && mapa !== null && JSON.stringify(mapa) === policzonoDla && !podglad.isPending;
  const moznaZapisac = Boolean(tresc && kompletna && aktualny && zrodlo.trim().length >= 3 && raport
    && raport.par.nowych > 0 && !zapis.isPending);

  const zapisz = () => {
    if (!tresc || !mapa) return;
    setBlad("");
    zapis.mutate({ zrodlo, link: link.trim() || null, plik: nazwaPliku, rodzajDowodu, tresc, mapowanie: mapa, zastosuj: true }, {
      onSuccess: (r) => {
        setKomunikat(`Do kolejki trafiło ${ile(r.zapisano?.propozycji ?? 0, "propozycja", "propozycje", "propozycji")}`
          + ` z wykazu „${zrodlo.trim()}”. Każdą zatwierdza człowiek w zakładce Kolejka.`);
        setTresc(null); setRaport(null); setMapa(null); setNazwaPliku(null); setPoliczonoDla("");
        setZrodlo(""); setLink("");
        if (plik.current) plik.current.value = "";
      },
      onError: (e) => setBlad((e as Error).message),
    });
  };

  return <section className="space-y-3 rounded-lg border border-slate-200 p-3" aria-label="Wykaz części producenta">
    <div>
      <NaglowekSekcji>Wykaz części producenta</NaglowekSekcji>
      <p className="text-sm text-slate-600">
        Plik „model maszyny → numery części” z katalogu producenta. Numery trafiają w nasze kartoteki przez numery
        OEM z opisów i od dostawców. Każda para idzie do kolejki jako propozycja z dowodem producenta.</p>
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col text-xs font-semibold text-slate-600">Nazwa wykazu — trafia do dowodu
        <Pole className="w-72" value={zrodlo} placeholder="np. IPL STIHL MS 250, wyd. 2024" aria-label="Nazwa wykazu"
          onChange={(e) => setZrodlo(e.target.value)} />
      </label>
      <label className="flex flex-col text-xs font-semibold text-slate-600">Odnośnik (opcjonalnie)
        <Pole className="w-56" value={link} placeholder="https://…" aria-label="Odnośnik do wykazu"
          onChange={(e) => setLink(e.target.value)} />
      </label>
      <label className="flex flex-col text-xs font-semibold text-slate-600">Dowód
        <select className="field w-auto" aria-label="Rodzaj dowodu wykazu" value={rodzajDowodu}
          onChange={(e) => setRodzajDowodu(e.target.value as "producent" | "katalog_dostawcy")}>
          <option value="producent">producent</option>
          <option value="katalog_dostawcy">katalog dostawcy</option>
        </select>
      </label>
      <input ref={plik} type="file" accept=".csv,.txt,.xlsx" className="hidden" aria-label="Plik wykazu"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void wczytaj(f); }} />
      <Przycisk onClick={() => plik.current?.click()} disabled={podglad.isPending || zapis.isPending}>
        <Upload size={14} className="mr-1 inline" aria-hidden="true" />Wgraj wykaz (CSV lub XLSX)</Przycisk>
      {nazwaPliku && <span className="text-sm text-slate-600">{nazwaPliku}</span>}
    </div>
    <Blad>{blad}</Blad>
    {komunikat && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{komunikat}</p>}

    {raport && mapa && <>
      <Mapowanie naglowki={raport.naglowki} m={mapa} onZmien={setMapa} zgadniete={raport.zgadniete} />
      <Probka naglowki={raport.naglowki} wiersze={raport.probka} m={mapa} />
      {kompletna && <Wynik r={raport} />}
      <div className="flex flex-wrap items-center gap-2">
        <Przycisk wariant="glowny" disabled={!moznaZapisac} onClick={zapisz}>
          {raport.par.nowych > 0 && kompletna
            ? `Zaproponuj ${ile(raport.par.nowych, "parę", "pary", "par")}` : "Zaproponuj pary"}</Przycisk>
        {zrodlo.trim().length < 3 && <span className="text-xs text-slate-600">Nazwij wykaz — nazwa trafia do dowodu każdej pary.</span>}
        {!kompletna && <span className="text-xs text-slate-600">Wskaż markę, model i kolumnę z numerami części.</span>}
        {(podglad.isPending || zapis.isPending) && <span className="text-xs text-slate-600">Liczę…</span>}
      </div>
    </>}

    <Historia lista={historia.data ?? []} trwa={wycofaj.isPending}
      onWycofaj={(id) => wycofaj.mutate(id, { onError: (e) => setBlad((e as Error).message) })} />
  </section>;
}

/** Lista: brak, „wpisz dla całego pliku" albo kolumna — plus pole tekstu, gdy wybrano wpis. */
function WyborPola({ etykieta, p, naglowki, zBrakiem, onZmien, placeholder }: {
  etykieta: string; p: PoleWykazu; naglowki: string[]; zBrakiem: boolean;
  onZmien: (p: PoleWykazu) => void; placeholder: string;
}) {
  const wartosc = p === null ? "" : "kolumna" in p ? String(p.kolumna) : TEKST;
  return <div className="flex flex-wrap items-center gap-2">
    <label className="flex items-center gap-2">{etykieta}
      <select className="field w-auto" aria-label={`${etykieta}: skąd`} value={wartosc}
        onChange={(e) => onZmien(e.target.value === "" ? null : e.target.value === TEKST ? { tekst: "" } : { kolumna: Number(e.target.value) })}>
        {zBrakiem && <option value="">{BRAK}</option>}
        <option value={TEKST}>wpisz dla całego pliku</option>
        {naglowki.map((n, i) => <option key={i} value={i}>kolumna: {n || `kolumna ${i + 1}`}</option>)}
      </select></label>
    {p !== null && "tekst" in p && <Pole className="w-44" aria-label={etykieta} value={p.tekst} placeholder={placeholder}
      onChange={(e) => onZmien({ tekst: e.target.value })} />}
  </div>;
}

function Mapowanie({ naglowki, m, onZmien, zgadniete }: {
  naglowki: string[]; m: MapowanieWykazu; onZmien: (m: MapowanieWykazu) => void; zgadniete: boolean;
}) {
  const kolumna = (etykieta: string, v: number | null, pole: "rokOd" | "rokDo" | "seryjnyOd" | "seryjnyDo") =>
    <label className="flex items-center gap-2">{etykieta}
      <select className="field w-auto" aria-label={`Kolumna: ${etykieta}`} value={v ?? ""}
        onChange={(e) => onZmien({ ...m, [pole]: e.target.value === "" ? null : Number(e.target.value) })}>
        <option value="">{BRAK}</option>
        {naglowki.map((n, i) => <option key={i} value={i}>{n || `kolumna ${i + 1}`}</option>)}
      </select></label>;
  /* Kolumna wskazana jako marka, model albo zakres nie jest kolumną numerów
     — „2016" w roku zaznaczony jako numer części trafiałby w przypadkowe
     kartoteki. */
  const zajete = [...[m.marka, m.model, m.wariant].flatMap((p) => (p && "kolumna" in p ? [p.kolumna] : [])),
    ...[m.rokOd, m.rokDo, m.seryjnyOd, m.seryjnyDo].filter((i): i is number => i !== null)];
  return <fieldset className="space-y-2 text-sm">
    <legend className="text-xs font-semibold text-slate-600">
      Kolumny{zgadniete ? " — zgadnięte z nagłówków, sprawdź przed zapisem" : ""}</legend>
    <div className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label="Wykaz dotyczy">
      <span>Wykaz:</span>
      <label className="flex items-center gap-1"><input type="radio" name="rodzaj-wykazu" checked={m.rodzaj === "maszyna"}
        onChange={() => onZmien({ ...m, rodzaj: "maszyna" })} />maszyny</label>
      {/* Wykaz silnika karmi szczebel „przez silnik": jeden wpis obsługuje
          każdą kosiarkę z zatwierdzoną zabudową tego silnika. */}
      <label className="flex items-center gap-1"><input type="radio" name="rodzaj-wykazu" checked={m.rodzaj === "silnik"}
        onChange={() => onZmien({ ...m, rodzaj: "silnik" })} />silnika</label>
    </div>
    <div className="flex flex-wrap gap-3">
      <WyborPola etykieta="Marka" p={m.marka} naglowki={naglowki} zBrakiem={false} placeholder="np. STIHL"
        onZmien={(p) => onZmien({ ...m, marka: p })} />
      <WyborPola etykieta="Model" p={m.model} naglowki={naglowki} zBrakiem placeholder="np. MS 250"
        onZmien={(p) => onZmien({ ...m, model: p })} />
      <WyborPola etykieta="Wariant" p={m.wariant} naglowki={naglowki} zBrakiem placeholder="opcjonalnie"
        onZmien={(p) => onZmien({ ...m, wariant: p })} />
    </div>
    <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Kolumny z numerami części">
      <span>Numery części:</span>
      {naglowki.map((n, i) => zajete.includes(i) ? null : <label key={i} className="flex items-center gap-1">
        <input type="checkbox" checked={m.numery.includes(i)}
          onChange={(e) => onZmien({ ...m, numery: e.target.checked ? [...m.numery, i].sort((a, b) => a - b) : m.numery.filter((x) => x !== i) })} />
        {n || `kolumna ${i + 1}`}</label>)}
    </div>
    <div className="flex flex-wrap gap-3">
      {kolumna("Rocznik od", m.rokOd, "rokOd")}
      {kolumna("Rocznik do", m.rokDo, "rokDo")}
      {kolumna("Nr seryjny od", m.seryjnyOd, "seryjnyOd")}
      {kolumna("Nr seryjny do", m.seryjnyDo, "seryjnyDo")}
    </div>
  </fieldset>;
}

function Probka({ naglowki, wiersze, m }: { naglowki: string[]; wiersze: string[][]; m: MapowanieWykazu }) {
  const jest = (p: PoleWykazu, i: number) => p !== null && "kolumna" in p && p.kolumna === i;
  const rola = (i: number) => jest(m.marka, i) ? "marka" : jest(m.model, i) ? "model" : jest(m.wariant, i) ? "wariant"
    : m.numery.includes(i) ? "numery" : i === m.rokOd ? "rok od" : i === m.rokDo ? "rok do"
      : i === m.seryjnyOd ? "nr od" : i === m.seryjnyDo ? "nr do" : null;
  return <div className="overflow-x-auto">
    <table className="w-full text-sm" aria-label="Próbka wykazu">
      <thead><tr className="border-b text-left text-xs text-slate-600">
        {naglowki.map((n, i) => <th key={i} className="py-1.5 pr-3 font-bold">{n || `kolumna ${i + 1}`}
          {rola(i) && <span className="ml-1 rounded bg-emerald-50 px-1 font-semibold text-emerald-900">{rola(i)}</span>}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-slate-100">
        {wiersze.map((w, r) => <tr key={r}>{naglowki.map((_, i) =>
          <td key={i} className={`py-1 pr-3 align-top ${rola(i) ? "font-mono" : "text-slate-600"}`}>{w[i] ?? ""}</td>)}</tr>)}
      </tbody>
    </table>
  </div>;
}

function Para({ p }: { p: ParaWykazu }) {
  return <li><b className="font-mono">{p.symbol}</b> {p.nazwa} → <b>{p.maszyna}</b>
    <span className="font-mono text-slate-600"> ({p.numery.join(", ")})</span>
    {p.warunki && <span className="text-amber-900"> · tylko: {p.warunki}</span>}</li>;
}

function Wynik({ r }: { r: RaportWykazu }) {
  return <div className="space-y-1 text-sm" aria-label="Wynik podglądu wykazu">
    <p><b>{r.dopasowanych}</b> z {ile(r.wierszy, "wiersza", "wierszy", "wierszy")} trafia w nasze kartoteki · nowe pary:{" "}
      <b>{r.par.nowych}</b>{r.par.znanych > 0 && <> · już znane: {r.par.znanych}</>}
      {" "}· modeli: {r.maszyn.nowych + r.maszyn.znanych}{r.maszyn.nowych > 0 && <> (nowych w słowniku: {r.maszyn.nowych})</>}</p>
    {r.par.nowych > 0 && <p className="text-emerald-800">
      Kolejka zastosowań: +{ile(r.par.nowych, "propozycja", "propozycje", "propozycji")} do zatwierdzenia.</p>}
    {r.przyklady.length > 0 && <ul className="space-y-0.5 text-xs text-slate-700">
      {r.przyklady.slice(0, 8).map((p, i) => <Para key={i} p={p} />)}
      {r.przyklady.length > 8 && <li className="text-slate-600">… i dalsze w kolejce</li>}
    </ul>}
    {/* Wykaz mówi coś innego niż baza: wpis stoi, ale z innymi granicami.
        Import go nie nadpisuje — od tego jest „Popraw warunki" z dowodem. */}
    {r.par.znanychInneWarunki > 0 && <div className="text-amber-900">
      <p>Wykaz daje inne warunki niż wpis w bazie: {r.par.znanychInneWarunki}. Import ich nie zmienia — popraw je
        w „Sprawdź kartotekę” przyciskiem „Popraw warunki”.</p>
      <ul className="text-xs">{r.inneWarunki.slice(0, 6).map((p, i) => <Para key={i} p={p} />)}</ul>
    </div>}
    {r.bezKartoteki.liczba > 0 && <p className="text-slate-600">
      Numery, których nie ma przy żadnej kartotece: {r.bezKartoteki.liczba} — {r.bezKartoteki.przyklady.slice(0, 8).join(", ")}
      {r.bezKartoteki.liczba > 8 ? "…" : ""}</p>}
    {r.bledneWarunki.liczba > 0 && <div className="text-red-700">
      <p>Wiersze z zepsutym zakresem nie wejdą: {r.bledneWarunki.liczba}. Wpis bez granicy twierdziłby więcej niż wykaz.</p>
      <ul className="text-xs">{r.bledneWarunki.przyklady.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul>
    </div>}
    {r.bezMaszyny > 0 && <p className="text-slate-600">Wiersze bez marki albo modelu: {r.bezMaszyny}</p>}
    {r.bezNumerow > 0 && <p className="text-slate-600">
      Wiersze bez numeru części (albo z numerem krótszym niż 6 znaków i 5 cyfr): {r.bezNumerow}</p>}
  </div>;
}

function Historia({ lista, trwa, onWycofaj }: { lista: ImportWykazu[]; trwa: boolean; onWycofaj: (id: number) => void }) {
  if (lista.length === 0) return null;
  return <div>
    <p className="mb-1 text-xs font-semibold text-slate-600">Ostatnie wykazy</p>
    <Tabela naglowki={["Wykaz", "Kiedy", "Pary", "Czeka", "Zatwierdzone", "Stan", ""]} pusto="Jeszcze nic nie wgrano.">
      {lista.map((i) => <tr key={i.id}>
        <Td>{i.link ? <a className="underline" href={i.link} target="_blank" rel="noreferrer">{i.zrodlo}</a> : i.zrodlo}
          <span className="text-slate-600"> · {i.rodzaj === "silnik" ? "silnik" : "maszyna"}</span></Td>
        <Td className="tabular-nums">{czas(i.at)}</Td>
        <Td className="tabular-nums">{i.propozycji}</Td>
        <Td className="tabular-nums">{i.czeka}</Td>
        <Td className="tabular-nums">{i.zatwierdzonych}</Td>
        <Td>{i.stan === "aktywny" ? "aktywny" : `wycofany${i.wycofal ? ` · ${i.wycofal}` : ""}`}</Td>
        {/* Wycofanie zdejmuje tylko to, co czeka — pytanie mówi to wprost,
            żeby nikt nie liczył, że cofnie też zatwierdzone. */}
        <Td>{i.stan === "aktywny" && i.czeka > 0 && <Potwierdz maly etykieta="Wycofaj"
          pytanie={`Zdjąć ${ile(i.czeka, "czekającą propozycję", "czekające propozycje", "czekających propozycji")} z kolejki?`
            + (i.zatwierdzonych > 0 ? ` Zatwierdzone (${i.zatwierdzonych}) zostają.` : "")}
          tak="Wycofaj wykaz" trwa={trwa} onTak={() => onWycofaj(i.id)} />}</Td>
      </tr>)}
    </Tabela>
  </div>;
}
