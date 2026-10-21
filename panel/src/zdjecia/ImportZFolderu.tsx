import React, { useEffect, useRef, useState } from "react";
import { FolderInput, X } from "lucide-react";
import { BrakPolaczenia, Konflikt } from "../api/klient";
import { useDopasujSymbole, useImportGotowych, type ZapisanieZdjecia } from "../api/zdjecia";
import { useOkno } from "../nawigacja/fokus";
import { Blad, Przycisk, ile } from "../ui";
import { pngZrodla, wczytajPlik, zlozGotowy } from "./obraz";
import {
  MALY_BOK, WSPOLBIEZNOSC, jedenNaTowar, klasyfikuj, paczki, poKolei, przypiszSymbole, rozbierz, wybierzWariant,
  type Klasa, type Wariant,
} from "./import";

/* ── IMPORT ZDJĘĆ Z FOLDERU ────────────────────────────────────────────────
   Trzy kroki, w każdym jedno główne działanie (ergonomia, punkt 2):
   wybór plików, podsumowanie z liczbami, przebieg importu.

   Ekran liczy za agenta, zamiast pytać o każdy plik (punkt 5). Klasy
   policzone przed startem odsiewają towary ze zdjęciem i z kolejką, więc
   import nie nadpisze niczego, czego nie powinien (punkt 6).

   Każdy plik idzie jako biały kwadrat bez usuwania tła i bez powiększania,
   decyzją właściciela. Małe zdjęcia tylko liczymy, bo małe jest lepsze
   niż żadne. */

interface DoImportu extends Wariant { symbol: string; twId: number; plik: File }

type Wynik = { stan: "dodane"; wSubiekcie: boolean } | { stan: "pominiete" | "blad"; powod: string };

interface Sprawdzenie {
  wszystkich: number;
  odrzucone: number;
  niesymbole: string[];
  klasy: Record<Exclude<Klasa, "do_importu">, string[]>;
  /** Symbol → nazwy plików, dla listy nieznanych symboli. */
  plikiSymbolu: Map<string, string[]>;
  lista: DoImportu[];
  nieczytelne: Array<{ nazwa: string; powod: string }>;
  duplikaty: number;
}

const opisBledu = (e: unknown): string =>
  e instanceof BrakPolaczenia ? "Brak połączenia z serwerem. Kliknij „Ponów nieudane”, gdy wróci."
    : e instanceof Error && e.message ? e.message : "Nieznany błąd. Kliknij „Ponów nieudane”.";

const zdjec = (n: number) => ile(n, "zdjęcie", "zdjęcia", "zdjęć");
const towarow = (n: number) => ile(n, "towar", "towary", "towarów");
const plikow = (n: number) => ile(n, "plik", "pliki", "plików");

/** Rozwijana lista nazw: liczba zawsze widoczna, nazwy dopiero na żądanie (punkt 2). */
function Nazwy({ nazwy }: { nazwy: string[] }) {
  if (nazwy.length === 0) return null;
  return <details className="mt-1 text-sm text-slate-700">
    <summary className="cursor-pointer text-slate-600">Pokaż nazwy</summary>
    <ul className="mt-1 max-h-40 overflow-y-auto font-mono">
      {nazwy.map((n) => <li key={n}>{n}</li>)}</ul>
  </details>;
}

function Wiersz({ etykieta, liczba, children }: { etykieta: string; liczba: number; children?: React.ReactNode }) {
  return <li className="py-1.5">
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-slate-700">{etykieta}</span>
      <span className="font-semibold tabular-nums text-slate-900">{liczba}</span>
    </div>
    {children}
  </li>;
}

export function ImportZFolderu({ onZamknij }: { onZamknij: () => void }) {
  const dopasuj = useDopasujSymbole();
  const { wyslij, zakoncz } = useImportGotowych();
  const [sprawdzam, setSprawdzam] = useState<{ z: number; ile: number } | null>(null);
  const [blad, setBlad] = useState("");
  const [wylaczone, setWylaczone] = useState<string | null>(null);
  const [spr, setSpr] = useState<Sprawdzenie | null>(null);
  const [wyniki, setWyniki] = useState<ReadonlyMap<string, Wynik>>(() => new Map());
  const [biezace, setBiezace] = useState<readonly string[]>([]);
  const [trwa, setTrwa] = useState(false);
  const [zatrzymuje, setZatrzymuje] = useState(false);
  const [pytanie, setPytanie] = useState(false);

  /* Refy, bo pętla importu żyje dłużej niż jeden render i czyta stan „teraz”. */
  const stop = useRef(false);
  const trwaRef = useRef(false);
  const zamknijPo = useRef(false);
  const zywy = useRef(true);
  const koniec = useRef(zakoncz);
  koniec.current = zakoncz;
  const zamknijRef = useRef(onZamknij);
  zamknijRef.current = onZamknij;

  /* Okno znika w trakcie (zmiana zakładki): nowych zdjęć nie zaczynamy.
     Listę odświeży koniec pętli, gdy dojdą zdjęcia już wysłane. */
  useEffect(() => {
    /* Ustawiane i tu, bo `StrictMode` odmontowuje efekt na próbę. */
    zywy.current = true;
    return () => { zywy.current = false; stop.current = true; };
  }, []);

  /* Zamknięcie w trakcie importu pyta, zamiast gubić postęp po cichu. */
  const zamknij = () => {
    if (trwaRef.current) { setPytanie(true); return; }
    onZamknij();
  };
  const okno = useOkno<HTMLDivElement>({ onZamknij: zamknij });

  async function sprawdz(pliki: File[]) {
    setBlad(""); setWylaczone(null); setSpr(null); setWyniki(new Map());
    const r = rozbierz(pliki);
    /* Ścieżka z folderem, bo przy `miniaturka.jpg` sama nazwa nic nie mówi. */
    const nazwa = (p: File) => p.webkitRelativePath || p.name;
    let plikiSymbolu = new Map<string, string[]>();
    const klasy: Sprawdzenie["klasy"] = { ma_zdjecie: [], czeka: [], zablokowany: [], niejednoznaczny: [], nieznany_symbol: [] };
    const trafione: Array<{ symbol: string; twId: number; pliki: File[] }> = [];
    if (r.pliki.length > 0) {
      setSprawdzam({ z: 0, ile: 0 });
      let d;
      try {
        /* Pytamy o wszystkich kandydatów naraz: który jest symbolem, wie Subiekt. */
        d = await dopasuj.mutateAsync(paczki(r.pliki.flatMap((x) => x.kandydaci)));
      } catch (e) {
        if (!zywy.current) return;
        setSprawdzam(null);
        setBlad(`${opisBledu(e)} Nic nie zostało dodane — wybierz pliki jeszcze raz.`);
        return;
      }
      if (!zywy.current) return;
      if (!d.wlaczone) {
        setSprawdzam(null);
        setWylaczone(d.powod ?? "Dodawanie zdjęć jest w tej instalacji wyłączone.");
        return;
      }
      const mapa = new Map(d.pozycje.map((p) => [p.symbol.toUpperCase(), p]));
      const grupy = przypiszSymbole(r.pliki, mapa);
      plikiSymbolu = new Map(grupy.map((g) => [g.symbol, g.pliki.map(nazwa)]));
      for (const g of grupy) {
        const p = mapa.get(g.symbol);
        const k = klasyfikuj(p);
        if (k === "do_importu" && p?.twId != null) trafione.push({ symbol: g.symbol, twId: p.twId, pliki: g.pliki });
        else if (k !== "do_importu") klasy[k].push(g.symbol);
      }
    }

    const wybrane = jedenNaTowar(trafione);

    /* Wymiary znamy dopiero z płótna. Czytamy tylko pliki do dodania,
       bo reszta i tak nie pójdzie, a każdy odczyt kosztuje pamięć. */
    const plikiDoCzytania = wybrane.flatMap((w) => w.pliki);
    setSprawdzam({ z: 0, ile: plikiDoCzytania.length });
    const wymiary = new Map<File, Wariant | string>();
    let przeczytane = 0;
    await poKolei(plikiDoCzytania, 4, async (p) => {
      try {
        const z = await wczytajPlik(p);
        wymiary.set(p, { nazwa: p.name, typ: p.type, bajtow: p.size, szer: z.szer, wys: z.wys });
      } catch (e) {
        wymiary.set(p, opisBledu(e));
      }
      przeczytane++;
      if (zywy.current) setSprawdzam({ z: przeczytane, ile: plikiDoCzytania.length });
    });
    if (!zywy.current) return;

    const lista: DoImportu[] = [];
    const nieczytelne: Sprawdzenie["nieczytelne"] = [];
    for (const w of wybrane) {
      const dobre: Array<Wariant & { plik: File }> = [];
      for (const p of w.pliki) {
        const x = wymiary.get(p);
        if (typeof x === "string" || !x) nieczytelne.push({ nazwa: p.name, powod: x ?? "Nie udało się odczytać." });
        else dobre.push({ ...x, plik: p });
      }
      if (dobre.length) lista.push({ ...wybierzWariant(dobre), symbol: w.symbol, twId: w.twId });
    }
    setSprawdzam(null);
    setSpr({
      wszystkich: pliki.length, odrzucone: r.odrzucone.length, niesymbole: r.niesymbole.map(nazwa),
      klasy, plikiSymbolu, lista, nieczytelne, duplikaty: wybrane.filter((w) => w.pliki.length > 1).length,
    });
  }

  async function importuj(lista: DoImportu[]) {
    stop.current = false;
    zamknijPo.current = false;
    trwaRef.current = true;
    setTrwa(true); setZatrzymuje(false); setPytanie(false);
    const zapisz = (symbol: string, w: Wynik) => {
      if (zywy.current) setWyniki((m) => new Map(m).set(symbol, w));
    };
    await poKolei(lista, WSPOLBIEZNOSC, async (poz) => {
      if (zywy.current) setBiezace((b) => [...b, poz.symbol]);
      try {
        const z = await wczytajPlik(poz.plik);
        const g = await zlozGotowy(pngZrodla(z), "image/png");
        const w: ZapisanieZdjecia = await wyslij({ twId: poz.twId, gotowy: g.base64, plik: poz.plik.name });
        zapisz(poz.symbol, { stan: "dodane", wSubiekcie: w.wSubiekcie });
      } catch (e) {
        /* 409: zdjęcie już czeka albo funkcję wyłączono. Nic do naprawienia
           w pliku, więc to pominięcie, a nie błąd całego importu. */
        zapisz(poz.symbol, e instanceof Konflikt
          ? { stan: "pominiete", powod: e.message }
          : { stan: "blad", powod: opisBledu(e) });
      } finally {
        if (zywy.current) setBiezace((b) => b.filter((s) => s !== poz.symbol));
      }
    }, () => stop.current);
    trwaRef.current = false;
    koniec.current();
    if (!zywy.current) return;
    setTrwa(false); setZatrzymuje(false);
    if (zamknijPo.current) zamknijRef.current();
  }

  const zatrzymaj = (iZamknij: boolean) => {
    stop.current = true;
    zamknijPo.current = iZamknij;
    setZatrzymuje(true);
    setPytanie(false);
  };

  const przyjmij = (pliki: FileList | null | undefined) => {
    const lista = pliki ? [...pliki] : [];
    if (lista.length) void sprawdz(lista);
  };

  const lista = spr?.lista ?? [];
  const zrobione = lista.filter((p) => wyniki.has(p.symbol)).length;
  const policz = (stan: Wynik["stan"]) => [...wyniki.values()].filter((w) => w.stan === stan).length;
  const dodane = policz("dodane");
  const pominiete = policz("pominiete");
  const bledy = lista.filter((p) => wyniki.get(p.symbol)?.stan === "blad");
  const niewyslane = lista.filter((p) => !wyniki.has(p.symbol));
  const doPonowienia = [...bledy, ...niewyslane];
  const poImporcie = wyniki.size > 0 && !trwa;
  const tylkoWWertis = [...wyniki.values()].some((w) => w.stan === "dodane" && !w.wSubiekcie);
  const male = lista.filter((p) => Math.max(p.szer, p.wys) < MALY_BOK).length;

  let tresc: React.ReactNode;
  if (sprawdzam) {
    tresc = <p role="status" className="text-sm text-slate-700">
      {sprawdzam.ile ? `Sprawdzam zdjęcia: ${sprawdzam.z} z ${sprawdzam.ile}…` : "Szukam symboli w Subiekcie…"}</p>;
  } else if (wylaczone) {
    tresc = <Blad>{wylaczone}</Blad>;
  } else if (!spr) {
    /* Krok 1: wybór. Folder i pliki obok siebie, bo folder nie każdemu
       systemowi da się upuścić, a pliki — tak. */
    tresc = <div onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); przyjmij(e.dataTransfer.files); }}
      className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <FolderInput size={38} className="text-slate-500" aria-hidden="true" />
      <p className="text-tresc font-semibold text-slate-800">Upuść tutaj zdjęcia nazwane symbolem towaru</p>
      <p className="text-sm text-slate-600">Nazwa pliku to symbol, np. W08-0501.jpg. Tła nie usuwamy.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <label className="btn-primary cursor-pointer">
          Wybierz folder
          <input type="file" multiple accept="image/*" className="sr-only"
            ref={(el) => { el?.setAttribute("webkitdirectory", ""); }}
            onChange={(e) => { przyjmij(e.target.files); e.target.value = ""; }} />
        </label>
        <label className="btn-secondary cursor-pointer">
          Wybierz pliki
          <input type="file" multiple accept="image/*" className="sr-only"
            onChange={(e) => { przyjmij(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      <Blad>{blad}</Blad>
    </div>;
  } else if (!trwa && !poImporcie) {
    /* Krok 2: podsumowanie. Same liczby, a jedna decyzja to przycisk na dole. */
    const nieznane = spr.klasy.nieznany_symbol.flatMap((s) => spr.plikiSymbolu.get(s) ?? [s]);
    tresc = <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-700">Wybrano {plikow(spr.wszystkich)}.</p>
      <ul className="divide-y divide-slate-100">
        <Wiersz etykieta="Do dodania" liczba={lista.length} />
        <Wiersz etykieta="Mają już zdjęcie" liczba={spr.klasy.ma_zdjecie.length} />
        <Wiersz etykieta="Zdjęcie czeka w kolejce do Subiekta" liczba={spr.klasy.czeka.length} />
        <Wiersz etykieta="Zablokowane w Subiekcie" liczba={spr.klasy.zablokowany.length} />
        <Wiersz etykieta="Kilka kartotek z tym symbolem — dodaj ręcznie w edytorze" liczba={spr.klasy.niejednoznaczny.length}>
          <Nazwy nazwy={spr.klasy.niejednoznaczny.flatMap((s) => spr.plikiSymbolu.get(s) ?? [s])} /></Wiersz>
        <Wiersz etykieta="Nie ma takiego symbolu w Subiekcie" liczba={spr.klasy.nieznany_symbol.length}>
          <Nazwy nazwy={nieznane} /></Wiersz>
        <Wiersz etykieta="Nazwa pliku nie jest symbolem" liczba={spr.niesymbole.length}>
          <Nazwy nazwy={spr.niesymbole} /></Wiersz>
        {spr.nieczytelne.length > 0 && <Wiersz etykieta="Pliki, których nie da się odczytać" liczba={spr.nieczytelne.length}>
          <Nazwy nazwy={spr.nieczytelne.map((n) => `${n.nazwa} — ${n.powod}`)} /></Wiersz>}
        {spr.odrzucone > 0 && <Wiersz etykieta="Pliki, które nie są zdjęciami" liczba={spr.odrzucone} />}
      </ul>
      {spr.duplikaty > 0 && <p className="text-sm text-slate-700">
        {towarow(spr.duplikaty)} ma po kilka plików. Biorę ten z większą liczbą pikseli.</p>}
      {male > 0 && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        {zdjec(male)} z {lista.length} ma poniżej {MALY_BOK} px. Pójdą bez powiększania, więc na
        Allegro mogą wyglądać słabo. Lepsze zdjęcie podmienisz później w edytorze.</p>}
    </div>;
  } else {
    /* Krok 3: przebieg i wynik. */
    const procent = lista.length ? Math.round((zrobione / lista.length) * 100) : 0;
    tresc = <div className="flex flex-col gap-3">
      <div role="progressbar" aria-label="Postęp importu" aria-valuemin={0} aria-valuemax={lista.length}
        aria-valuenow={zrobione} aria-valuetext={`${zrobione} z ${lista.length}`}
        className="h-2 overflow-hidden rounded bg-slate-200">
        <div className="h-full bg-slate-700" style={{ width: `${procent}%` }} />
      </div>
      <p className="text-sm font-semibold text-slate-900">{zrobione} z {lista.length}
        {trwa && biezace.length > 0 && <span className="font-normal text-slate-700">
          {" · "}teraz <span className="font-mono">{biezace.join(", ")}</span></span>}</p>
      {zatrzymuje && trwa && <p role="status" className="text-sm text-slate-700">
        Kończę bieżące zdjęcia, nowych nie zaczynam…</p>}
      {poImporcie && <p role="status" className="text-sm text-slate-800">
        Dodano {dodane}, pominięto {pominiete}, błędy {bledy.length}
        {niewyslane.length > 0 ? `, nie wysłano ${niewyslane.length}` : ""}.
        {tylkoWWertis ? " Ta instalacja nie wysyła zdjęć do Subiekta, więc zostały w WERTIS." : ""}</p>}
      {pominiete > 0 && <details className="text-sm text-slate-700">
        <summary className="cursor-pointer text-slate-600">Pominięte: {pominiete}</summary>
        <ul className="mt-1 max-h-40 overflow-y-auto">
          {lista.map((p) => { const w = wyniki.get(p.symbol);
            return w?.stan === "pominiete" && <li key={p.symbol}><span className="font-mono">{p.symbol}</span> — {w.powod}</li>; })}
        </ul></details>}
      {bledy.length > 0 && <div>
        <p className="text-sm font-semibold text-red-700">Błędy: {bledy.length}</p>
        <ul className="mt-1 max-h-48 overflow-y-auto text-sm text-slate-800">
          {bledy.map((p) => { const w = wyniki.get(p.symbol);
            return <li key={p.symbol} className="py-0.5">
              <span className="font-mono">{p.symbol}</span> ({p.plik.name}) — {w && w.stan === "blad" ? w.powod : ""}</li>; })}
        </ul>
        {!trwa && <p className="mt-1 text-sm text-slate-600">
          Plik, który dalej nie przechodzi, dodaj ręcznie w edytorze obok.</p>}
      </div>}
    </div>;
  }

  /* Jedno główne działanie na krok — przycisk na dole okna zmienia się z krokiem. */
  let glowny: React.ReactNode = null;
  if (spr && !trwa && !poImporcie && !sprawdzam) {
    glowny = <Przycisk wariant="glowny" disabled={lista.length === 0} onClick={() => void importuj(lista)}>
      {lista.length ? `Dodaj ${zdjec(lista.length)}` : "Nie ma czego dodać"}</Przycisk>;
  } else if (trwa) {
    glowny = <Przycisk onClick={() => zatrzymaj(false)} disabled={zatrzymuje}>
      {zatrzymuje ? "Zatrzymuję…" : "Zatrzymaj"}</Przycisk>;
  } else if (poImporcie && doPonowienia.length > 0) {
    glowny = <Przycisk wariant="glowny" onClick={() => void importuj(doPonowienia)}>
      {niewyslane.length ? `Dokończ: ${zdjec(doPonowienia.length)}` : `Ponów nieudane (${bledy.length})`}</Przycisk>;
  } else if (poImporcie) {
    glowny = <Przycisk wariant="glowny" onClick={onZamknij}>Zamknij</Przycisk>;
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={zamknij}>
    <div role="dialog" {...okno} aria-labelledby="import-tytul" onClick={(e) => e.stopPropagation()}
      className="card flex max-h-full w-full max-w-xl flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <h2 id="import-tytul" className="text-naglowek font-bold text-slate-900">Import zdjęć z folderu</h2>
        <button type="button" onClick={zamknij} aria-label="Zamknij okno importu"
          className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100">
          <X size={18} aria-hidden="true" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{tresc}</div>
      {pytanie && <div role="alert" className="shrink-0 border-t border-amber-300 bg-amber-50 px-5 py-3">
        <p className="text-sm text-amber-900">Import trwa: {zrobione} z {lista.length}. Zatrzymać go i zamknąć okno?
          Wysłane zdjęcia zostaną.</p>
        <div className="mt-2 flex justify-end gap-2">
          <Przycisk onClick={() => setPytanie(false)} autoFocus>Importuj dalej</Przycisk>
          <Przycisk onClick={() => zatrzymaj(true)}>Zatrzymaj i zamknij</Przycisk>
        </div>
      </div>}
      {(glowny || (spr && !trwa)) && <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
        {spr && !trwa && <Przycisk onClick={() => { setSpr(null); setWyniki(new Map()); }}>Wybierz inne pliki</Przycisk>}
        {glowny}
      </footer>}
    </div>
  </div>;
}
