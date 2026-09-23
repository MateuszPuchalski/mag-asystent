import React, { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { MapowanieOdsylaczy, RaportImportuOdsylaczy, TrescImportu } from "../api/typy";
import { useHistoriaImportow, useImportOdsylaczy, useWycofajImport } from "../api/wiedza";
import { tabelaZWierszy, wierszeZXlsx } from "../lib/xlsx";
import { Blad, NaglowekSekcji, Pole, Przycisk, czas, ile } from "../ui";
import { Tabela, Td } from "../ui/wglad";
import { Potwierdz } from "../ui/Potwierdz";

/* ── Odsyłacze od dostawców: plik „nasz symbol ↔ numery oryginału" ──────────
   Stoi w zakładce „Z opisów i ofert", bo to kolejne ŹRÓDŁO wiedzy z dokumentu,
   obok opisów kartotek i ofert — siódma zakładka połamałaby rząd, a robota
   ma ten sam rytm: wgrać, przejrzeć, zatwierdzić.

   KOLUMNY WSKAZUJE CZŁOWIEK. Serwer zgaduje je z nagłówków, ale „Numer" w
   jednym cenniku to symbol, a w drugim OEM — więc zgadnięte mapowanie stoi
   na ekranie w listach wyboru, a zapis bierze wyłącznie to, co na nich
   widać. Każda zmiana listy liczy podgląd od nowa: podgląd, który pokazuje
   co innego, niż się zapisze, jest gorszy niż brak podglądu.

   PODGLĄD MÓWI, CO PLIK ZROBI Z KOLEJKĄ. „+12 par ze wspólnym numerem" to
   praca, którą import zostawi biuru — widać ją przed zapisem, nie po.

   Arkusz rozbiera przeglądarka (`lib/xlsx.ts`), CSV jedzie tekstem — parser
   CSV stoi na serwerze i drugi byłby drugim miejscem do poprawiania tego
   samego błędu. */

const BRAK = "—";

/** Po tylu ms od ostatniej litery nazwy dostawcy podgląd liczy się od nowa. */
const ODDECH_DOSTAWCY = 500;

export function Odsylacze() {
  /* DWIE mutacje, nie jedna. Wywołania zwrotne podane do `mutate` TanStack
     odpala wyłącznie dla OSTATNIEGO wywołania — podgląd odpalony w trakcie
     zapisu połknąłby komunikat „Zapisano". Test złapał to przy pierwszym
     przebiegu. */
  const podglad = useImportOdsylaczy();
  const zapis = useImportOdsylaczy();
  const historia = useHistoriaImportow();
  const wycofaj = useWycofajImport();
  const plik = useRef<HTMLInputElement | null>(null);
  const [dostawca, setDostawca] = useState("");
  const [nazwaPliku, setNazwaPliku] = useState<string | null>(null);
  const [tresc, setTresc] = useState<TrescImportu | null>(null);
  const [mapa, setMapa] = useState<MapowanieOdsylaczy | null>(null);
  const [raport, setRaport] = useState<RaportImportuOdsylaczy | null>(null);
  const [blad, setBlad] = useState("");
  const [komunikat, setKomunikat] = useState("");

  const przelicz = (t: TrescImportu, m: MapowanieOdsylaczy | null, d = dostawca) => {
    setBlad("");
    podglad.mutate({ dostawca: d, plik: nazwaPliku, tresc: t, mapowanie: m, zastosuj: false }, {
      onSuccess: (r) => { setRaport(r); if (!m) setMapa(r.mapowanie); },
      onError: (e) => setBlad((e as Error).message),
    });
  };

  const wczytaj = async (f: File) => {
    setRaport(null); setMapa(null); setBlad(""); setKomunikat(""); setNazwaPliku(f.name);
    try {
      const t: TrescImportu = /\.csv$/i.test(f.name) || /\.txt$/i.test(f.name)
        ? { csv: await f.text() }
        : { tabela: tabelaZWierszy(await wierszeZXlsx(await f.arrayBuffer())) };
      setTresc(t);
      /* Bez mapowania: serwer zgaduje je z nagłówków i oddaje w raporcie. */
      podglad.mutate({ dostawca, plik: f.name, tresc: t, mapowanie: null, zastosuj: false }, {
        onSuccess: (r) => { setRaport(r); setMapa(r.mapowanie); },
        onError: (e) => setBlad((e as Error).message),
      });
    } catch (e) {
      setTresc(null); setBlad((e as Error).message);
    }
  };

  const zmien = (m: MapowanieOdsylaczy) => { setMapa(m); if (tresc) przelicz(tresc, m); };

  /* Nazwa dostawcy zmienia „zastąpi" i „już znane", więc podgląd liczy się
     od nowa — ale z oddechem, nie na każdą literę i nie na `onBlur`. Na
     `onBlur` klik „Zapisz" najpierw zdejmował fokus z pola, podgląd
     wyłączał przycisk i klik przepadał. */
  useEffect(() => {
    if (!tresc || !mapa) return;
    const t = setTimeout(() => przelicz(tresc, mapa, dostawca), ODDECH_DOSTAWCY);
    return () => clearTimeout(t);
  }, [dostawca]); // tylko nazwa: plik i kolumny liczą podgląd same, w `wczytaj` i `zmien`
  const mapaDoZmiany: MapowanieOdsylaczy = mapa ?? { symbol: null, ean: null, numery: [], rodzaj: "oem" };
  const kompletna = mapa !== null && (mapa.symbol !== null || mapa.ean !== null) && mapa.numery.length > 0;
  /* Raport liczony z INNYM mapowaniem niż na ekranie to podgląd, który kłamie —
     dlatego zapis czeka, aż podgląd dogoni listy wyboru. */
  const aktualny = raport !== null && JSON.stringify(raport.mapowanie) === JSON.stringify(mapa);
  const moznaZapisac = Boolean(tresc && kompletna && aktualny && dostawca.trim().length >= 2 && raport
    && raport.dopasowanych > 0 && !zapis.isPending);

  const zapisz = () => {
    if (!tresc || !mapa) return;
    setBlad("");
    zapis.mutate({ dostawca, plik: nazwaPliku, tresc, mapowanie: mapa, zastosuj: true }, {
      onSuccess: (r) => {
        setKomunikat(`Zapisano ${ile(r.zapisano?.numerow ?? 0, "numer", "numery", "numerów")} od dostawcy ${dostawca.trim()}.`
          + (r.noweKandydaty > 0 ? ` W kolejce „Wspólny numer oryginału” przybyło ${ile(r.noweKandydaty, "parę", "pary", "par")}.` : ""));
        setTresc(null); setRaport(null); setMapa(null); setNazwaPliku(null);
        if (plik.current) plik.current.value = "";
      },
      onError: (e) => setBlad((e as Error).message),
    });
  };

  return <section className="space-y-3 rounded-lg border border-slate-200 p-3" aria-label="Odsyłacze od dostawców">
    <div>
      <NaglowekSekcji>Odsyłacze od dostawców</NaglowekSekcji>
      <p className="text-sm text-slate-600">
        Plik od dostawcy: nasz symbol albo EAN i numery oryginału. Numery trafią do kartotek — działają w szukaniu,
        w doborze i w kolejce zamienności. Nowy plik tego samego dostawcy zastępuje poprzedni.</p>
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col text-xs font-semibold text-slate-600">Dostawca
        <Pole className="w-56" value={dostawca} placeholder="np. Kramp" aria-label="Dostawca"
          onChange={(e) => setDostawca(e.target.value)} />
      </label>
      <input ref={plik} type="file" accept=".csv,.txt,.xlsx" className="hidden" aria-label="Plik odsyłaczy"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void wczytaj(f); }} />
      <Przycisk onClick={() => plik.current?.click()} disabled={podglad.isPending || zapis.isPending}>
        <Upload size={14} className="mr-1 inline" aria-hidden="true" />Wgraj plik (CSV lub XLSX)</Przycisk>
      {nazwaPliku && <span className="text-sm text-slate-600">{nazwaPliku}</span>}
    </div>
    <Blad>{blad}</Blad>
    {komunikat && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{komunikat}</p>}

    {raport && <>
      <Mapowanie naglowki={raport.naglowki} m={mapaDoZmiany} onZmien={zmien} zgadniete={raport.zgadniete} />
      <Probka naglowki={raport.naglowki} wiersze={raport.probka} m={mapa} />
      {kompletna && <Wynik r={raport} dostawca={dostawca.trim()} />}
      <div className="flex flex-wrap items-center gap-2">
        <Przycisk wariant="glowny" disabled={!moznaZapisac} onClick={zapisz}>
          {raport.numerow.nowych > 0
            ? `Zapisz ${ile(raport.numerow.nowych, "numer", "numery", "numerów")}`
            : "Zapisz import"}</Przycisk>
        {dostawca.trim().length < 2 && <span className="text-xs text-slate-600">Podaj dostawcę — po nim nowy plik zastąpi stary.</span>}
        {(podglad.isPending || zapis.isPending) && <span className="text-xs text-slate-600">Liczę…</span>}
      </div>
    </>}

    <Historia lista={historia.data ?? []} trwa={wycofaj.isPending}
      onWycofaj={(id) => wycofaj.mutate(id, { onError: (e) => setBlad((e as Error).message) })} />
  </section>;
}

function Mapowanie({ naglowki, m, onZmien, zgadniete }: {
  naglowki: string[]; m: MapowanieOdsylaczy; onZmien: (m: MapowanieOdsylaczy) => void; zgadniete: boolean;
}) {
  const opcje = naglowki.map((n, i) => <option key={i} value={i}>{n || `kolumna ${i + 1}`}</option>);
  const wybor = (v: string) => v === "" ? null : Number(v);
  return <fieldset className="space-y-2 text-sm">
    <legend className="text-xs font-semibold text-slate-600">
      Kolumny{zgadniete ? " — zgadnięte z nagłówków, sprawdź przed zapisem" : ""}</legend>
    <div className="flex flex-wrap gap-3">
      <label className="flex items-center gap-2">Nasz symbol
        <select className="field w-auto" aria-label="Kolumna z naszym symbolem" value={m.symbol ?? ""}
          onChange={(e) => onZmien({ ...m, symbol: wybor(e.target.value) })}>
          <option value="">{BRAK}</option>{opcje}</select></label>
      <label className="flex items-center gap-2">EAN
        <select className="field w-auto" aria-label="Kolumna z EAN" value={m.ean ?? ""}
          onChange={(e) => onZmien({ ...m, ean: wybor(e.target.value) })}>
          <option value="">{BRAK}</option>{opcje}</select></label>
    </div>
    <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Kolumny z numerami">
      <span>Numery:</span>
      {naglowki.map((n, i) => i === m.symbol || i === m.ean ? null : <label key={i} className="flex items-center gap-1">
        <input type="checkbox" checked={m.numery.includes(i)}
          onChange={(e) => onZmien({ ...m, numery: e.target.checked ? [...m.numery, i].sort((a, b) => a - b) : m.numery.filter((x) => x !== i) })} />
        {n || `kolumna ${i + 1}`}</label>)}
    </div>
    {/* Dwa rodzaje, bo tylko numer ORYGINAŁU spina zamienniki. Numery innych
        katalogów trafiają do szukania, ale do kolejki zamienności już nie. */}
    <div className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label="Rodzaj numerów">
      <span>To są:</span>
      <label className="flex items-center gap-1"><input type="radio" name="rodzaj" checked={m.rodzaj === "oem"}
        onChange={() => onZmien({ ...m, rodzaj: "oem" })} />numery oryginału (OEM)</label>
      <label className="flex items-center gap-1"><input type="radio" name="rodzaj" checked={m.rodzaj === "katalog_obcy"}
        onChange={() => onZmien({ ...m, rodzaj: "katalog_obcy" })} />numery innych katalogów</label>
    </div>
  </fieldset>;
}

function Probka({ naglowki, wiersze, m }: { naglowki: string[]; wiersze: string[][]; m: MapowanieOdsylaczy | null }) {
  const rola = (i: number) => i === m?.symbol ? "symbol" : i === m?.ean ? "EAN" : m?.numery.includes(i) ? "numery" : null;
  return <div className="overflow-x-auto">
    <table className="w-full text-sm" aria-label="Próbka pliku">
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

function Wynik({ r, dostawca }: { r: RaportImportuOdsylaczy; dostawca: string }) {
  return <div className="space-y-1 text-sm" aria-label="Wynik podglądu">
    <p><b>{r.dopasowanych}</b> z {ile(r.wierszy, "wiersza", "wierszy", "wierszy")} trafia w kartotekę
      ({ile(r.kartotek, "kartoteka", "kartoteki", "kartotek")}) · nowe numery: <b>{r.numerow.nowych}</b>
      {r.numerow.znanych > 0 && <> · już znane: {r.numerow.znanych}</>}</p>
    {r.noweKandydaty !== 0 && <p className="text-emerald-800">
      Kolejka „Wspólny numer oryginału”: {r.noweKandydaty > 0 ? "+" : "−"}{ile(Math.abs(r.noweKandydaty), "para", "pary", "par")}
      {r.noweKandydaty > 0 ? " do decyzji" : " mniej — stary plik je dawał"}.</p>}
    {r.zastapi > 0 && <p className="text-amber-900">
      Zapis zastąpi {ile(r.zastapi, "numer", "numery", "numerów")} z poprzedniego pliku dostawcy {dostawca}.</p>}
    {r.bezKartoteki.liczba > 0 && <p className="text-slate-600">
      Bez kartoteki: {r.bezKartoteki.liczba} — {r.bezKartoteki.przyklady.slice(0, 8).join(", ")}
      {r.bezKartoteki.liczba > 8 ? "…" : ""}</p>}
    {r.niejednoznaczne.liczba > 0 && <p className="text-red-700">
      Symbol albo EAN zdublowany w Subiekcie: {r.niejednoznaczne.liczba} — {r.niejednoznaczne.przyklady.slice(0, 8).join(", ")}.
      Te wiersze nie wejdą, bo nie wiadomo, której kartoteki dotyczą.</p>}
    {r.bezNumerow > 0 && <p className="text-slate-600">Wiersze bez numeru w wybranych kolumnach: {r.bezNumerow}</p>}
    {r.przyklady.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
      {r.przyklady.slice(0, 6).map((p) => <li key={p.symbol}>
        <b className="font-mono">{p.symbol}</b> {p.nazwa}: <span className="font-mono">{p.numery.join(", ")}</span></li>)}
    </ul>}
  </div>;
}

function Historia({ lista, trwa, onWycofaj }: {
  lista: import("../api/typy").ImportOdsylaczy[]; trwa: boolean; onWycofaj: (id: number) => void;
}) {
  if (lista.length === 0) return null;
  const STAN = { aktywny: "aktywny", zastapiony: "zastąpiony nowszym", wycofany: "wycofany" } as const;
  return <div>
    <p className="mb-1 text-xs font-semibold text-slate-600">Ostatnie importy</p>
    <Tabela naglowki={["Dostawca", "Plik", "Kiedy", "Numery", "Stan", ""]} pusto="Jeszcze nic nie wgrano.">
      {lista.map((i) => <tr key={i.id}>
        <Td>{i.dostawca}</Td>
        <Td className="text-slate-600">{i.plik ?? BRAK}</Td>
        <Td className="tabular-nums">{czas(i.at)}</Td>
        <Td className="tabular-nums">{i.numerow} <span className="text-slate-600">({i.dopasowanych}/{i.wierszy})</span></Td>
        <Td>{STAN[i.stan]}{i.wycofal ? ` · ${i.wycofal}` : ""}</Td>
        <Td>{i.stan === "aktywny" && <Potwierdz maly etykieta="Wycofaj" pytanie={`Usunąć ${i.numerow} numerów od ${i.dostawca}?`}
          tak="Wycofaj import" trwa={trwa} onTak={() => onWycofaj(i.id)} />}</Td>
      </tr>)}
    </Tabela>
  </div>;
}
