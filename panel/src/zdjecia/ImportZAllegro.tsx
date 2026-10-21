import React, { useEffect, useRef, useState } from "react";
import { Store, X } from "lucide-react";
import { BrakPolaczenia, Konflikt, PrzerwaAllegro } from "../api/klient";
import {
  pobierzZdjecieOferty, useDopasujOferty, useImportGotowych, zbierzBezZdjecia,
  type ListaBezZdjecia, type PozycjaBezZdjecia, type PozycjaOferty, type ZapisanieZdjecia,
} from "../api/zdjecia";
import { useOkno } from "../nawigacja/fokus";
import { useZdjecieOferty } from "../towar/useZdjecie";
import { Blad, Przycisk, PrzyciskKopiuj, ile } from "../ui";
import { pngZrodla, wczytajPlik, zlozGotowy } from "./obraz";
import { MALY_BOK, WSPOLBIEZNOSC, poKolei } from "./import";
import { Nazwy, Wiersz } from "./ImportZFolderu";

/* ── ZDJĘCIA KARTOTEK Z OFERT ALLEGRO ──────────────────────────────────────
   Towar bez zdjęcia w Subiekcie zwykle ma ofertę ze zdjęciem na Allegro.
   Okno zbiera towary bez zdjęcia, pyta serwer o ofertę każdego symbolu
   i dodaje zdjęcie główne oferty jako biały kwadrat, jak import z folderu.

   Trzy kroki, w każdym jedno główne działanie (ergonomia, punkt 2):
   sprawdzenie ofert, podsumowanie z podglądem, przebieg importu. Otwarcie
   okna nie pyta o nic, bo pytanie Allegro kosztuje limit i zapisuje
   wybór oferty na serwerze. Ekran liczy za agenta (punkt 5): towary bez
   oferty, z ofertą bez zdjęcia i z kolejką odsiewa sam, a agent tylko
   odznacza zdjęcia, które do kartoteki nie pasują (punkt 6). */

/** Jeden towar do dodania: kartoteka i oferta, z której weźmiemy zdjęcie. */
interface Kandydat { twId: number; symbol: string; towar: string; ofertaId: string; ofertaNazwa: string }

interface Sprawdzenie {
  doDodania: Kandydat[];
  bezZdjecia: string[];
  bezOferty: string[];
  czeka: string[];
  wieleKartotek: string[];
  /** Ile towarów sprawdzono, gdy przebieg stanął przed końcem. */
  przerwane: { sprawdzono: number; wszystkich: number } | null;
  /** Zdanie o tym, dlaczego pytanie Allegro stanęło. */
  blad: string;
}

type Wynik = { stan: "dodane"; wSubiekcie: boolean } | { stan: "pominiete" | "blad"; powod: string };

type Postep =
  | { faza: "zbieram"; z: number; razem: number | null }
  | { faza: "pytam"; z: number; ile: number }
  | { faza: "przerwa"; koniec: number };

const opisBledu = (e: unknown): string =>
  e instanceof BrakPolaczenia ? "Brak połączenia z serwerem. Kliknij „Ponów nieudane”, gdy wróci."
    : e instanceof Error && e.message ? e.message : "Nieznany błąd. Kliknij „Ponów nieudane”.";

const opisPrzerwy = (e: unknown): string =>
  e instanceof PrzerwaAllegro
    ? "Allegro dalej prosi o przerwę. Spróbuj za kilka minut — sprawdzone towary zostają poniżej."
    : e instanceof BrakPolaczenia ? "Brak połączenia z serwerem. Sprawdź oferty jeszcze raz, gdy wróci."
    : `${e instanceof Error && e.message ? e.message : "Allegro nie odpowiedziało."} Sprawdź oferty jeszcze raz za chwilę.`;

const zdjec = (n: number) => ile(n, "zdjęcie", "zdjęcia", "zdjęć");
const towarow = (n: number) => ile(n, "towar", "towary", "towarów");
const klucz = (s: string) => s.trim().toUpperCase();
const nazwaPozycji = (symbol: string, nazwa: string) => `${symbol} — ${nazwa}`;

/**
 * Miniatura oferty z naszej trasy (sesja w nagłówku, więc przez hak, nie
 * `<img src>`). Zamawiana dopiero w kadrze listy: kilkaset miniatur naraz
 * zajęłoby wspólną kolejkę obrazów na minuty.
 */
function Miniatura({ ofertaId, nazwa }: { ofertaId: string; nazwa: string }) {
  const ramka = useRef<HTMLDivElement>(null);
  const [widac, setWidac] = useState(false);
  useEffect(() => {
    if (widac || !ramka.current) return;
    if (typeof IntersectionObserver === "undefined") { setWidac(true); return; }
    const obs = new IntersectionObserver((w) => { if (w.some((x) => x.isIntersecting)) setWidac(true); },
      { rootMargin: "200px 0px" });
    obs.observe(ramka.current);
    return () => obs.disconnect();
  }, [widac]);
  const url = useZdjecieOferty(widac ? ofertaId : null);
  return <div ref={ramka} className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded border border-slate-200 bg-white">
    {url ? <img src={url} alt={`Zdjęcie oferty: ${nazwa}`} loading="lazy" className="h-full w-full object-contain" />
      : url === null && widac ? <span className="text-podpis text-slate-600">brak</span> : null}
  </div>;
}

export function ImportZAllegro({ onZamknij }: { onZamknij: () => void }) {
  const dopasuj = useDopasujOferty();
  const { wyslij, zakoncz } = useImportGotowych();
  const [postep, setPostep] = useState<Postep | null>(null);
  const [blad, setBlad] = useState("");
  const [wylaczone, setWylaczone] = useState<string | null>(null);
  const [spr, setSpr] = useState<Sprawdzenie | null>(null);
  const [odznaczone, setOdznaczone] = useState<ReadonlySet<number>>(() => new Set());
  const [lista, setLista] = useState<readonly Kandydat[]>([]);
  const [wyniki, setWyniki] = useState<ReadonlyMap<number, Wynik>>(() => new Map());
  const [male, setMale] = useState<ReadonlySet<number>>(() => new Set());
  const [biezace, setBiezace] = useState<readonly string[]>([]);
  const [trwa, setTrwa] = useState(false);
  const [zatrzymuje, setZatrzymuje] = useState(false);
  const [pytanie, setPytanie] = useState(false);
  const [teraz, setTeraz] = useState(() => Date.now());

  /* Refy, bo pętle żyją dłużej niż jeden render i czytają stan „teraz”. */
  const stop = useRef(false);
  const trwaRef = useRef(false);
  const zamknijPo = useRef(false);
  const zywy = useRef(true);
  const przerwij = useRef<(() => void) | null>(null);
  const koniec = useRef(zakoncz);
  koniec.current = zakoncz;
  const zamknijRef = useRef(onZamknij);
  zamknijRef.current = onZamknij;

  useEffect(() => {
    /* Ustawiane i tu, bo `StrictMode` odmontowuje efekt na próbę. */
    zywy.current = true;
    return () => { zywy.current = false; stop.current = true; przerwij.current?.(); };
  }, []);

  /* Odliczanie przerwy co sekundę, tylko gdy przerwa trwa. */
  const wPrzerwie = postep?.faza === "przerwa";
  useEffect(() => {
    if (!wPrzerwie) return;
    setTeraz(Date.now());
    const t = setInterval(() => setTeraz(Date.now()), 1000);
    return () => clearInterval(t);
  }, [wPrzerwie]);

  /* Zamknięcie w trakcie importu pyta, zamiast gubić postęp po cichu.
     Sprawdzanie ofert niczego nie dodaje, więc zamyka się od razu. */
  const zamknij = () => {
    if (trwaRef.current) { setPytanie(true); return; }
    onZamknij();
  };
  const okno = useOkno<HTMLDivElement>({ onZamknij: zamknij });

  /** Przerwa przed ponowieniem paczki; `false`, gdy agent zatrzymał w trakcie. */
  const czekaj = (ms: number) => new Promise<boolean>((gotowe) => {
    if (zywy.current) setPostep({ faza: "przerwa", koniec: Date.now() + ms });
    const t = setTimeout(() => { przerwij.current = null; gotowe(!stop.current); }, ms);
    przerwij.current = () => { clearTimeout(t); przerwij.current = null; gotowe(false); };
  });

  async function sprawdz() {
    stop.current = false;
    setZatrzymuje(false);
    setBlad(""); setWylaczone(null); setSpr(null); setWyniki(new Map()); setOdznaczone(new Set());
    setPostep({ faza: "zbieram", z: 0, razem: null });
    let towary: ListaBezZdjecia | null;
    try {
      towary = await zbierzBezZdjecia((z, razem) => {
        if (zywy.current) setPostep({ faza: "zbieram", z, razem });
      }, () => stop.current);
    } catch (e) {
      if (!zywy.current) return;
      setPostep(null);
      setBlad(`${opisBledu(e)} Nic nie zostało dodane.`);
      return;
    }
    if (!zywy.current) return;
    if (!towary) { setPostep(null); setZatrzymuje(false); return; }
    if (!towary.wlaczone) {
      setPostep(null);
      setWylaczone(towary.powod ?? "Dodawanie zdjęć jest w tej instalacji wyłączone.");
      return;
    }

    /* Towar z kolejką nie idzie do Allegro: drugie zdjęcie serwer i tak
       odrzuci. Symbol kilku kartotek też nie, bo zgadywanie dałoby zdjęcie
       złemu towarowi. */
    const czeka: string[] = [];
    const wgSymbolu = new Map<string, PozycjaBezZdjecia[]>();
    for (const t of towary.pozycje) {
      if (t.oczekuje) { czeka.push(nazwaPozycji(t.symbol, t.nazwa)); continue; }
      const k = klucz(t.symbol);
      wgSymbolu.set(k, [...(wgSymbolu.get(k) ?? []), t]);
    }
    const wieleKartotek: string[] = [];
    const bezOferty: string[] = [];
    const doPytania = new Map<string, PozycjaBezZdjecia>();
    for (const [k, l] of wgSymbolu) {
      if (!k) bezOferty.push(...l.map((t) => nazwaPozycji(t.symbol, t.nazwa)));
      else if (l.length > 1) wieleKartotek.push(...l.map((t) => nazwaPozycji(t.symbol, t.nazwa)));
      else doPytania.set(k, l[0]);
    }

    const symbole = [...doPytania.values()].map((t) => t.symbol.trim());
    const p = await dopasuj(symbole, {
      postep: (z, ile) => { if (zywy.current) setPostep({ faza: "pytam", z, ile }); },
      czekaj,
      stop: () => stop.current,
    });
    if (!zywy.current) return;
    setPostep(null); setZatrzymuje(false);
    if (p.wylaczone) { setWylaczone(p.wylaczone); return; }

    const odpowiedzi = new Map<string, PozycjaOferty>(p.pozycje.map((x) => [klucz(x.symbol), x]));
    const doDodania: Kandydat[] = [];
    const bezZdjecia: string[] = [];
    for (const [k, t] of doPytania) {
      const o = odpowiedzi.get(k);
      /* Symbol, o który nie zdążyliśmy zapytać, nie jest „bez oferty”. */
      if (!o) continue;
      if (!o.oferta) bezOferty.push(nazwaPozycji(t.symbol, t.nazwa));
      else if (!o.oferta.zdjecie) bezZdjecia.push(nazwaPozycji(t.symbol, t.nazwa));
      else doDodania.push({ twId: t.twId, symbol: t.symbol, towar: t.nazwa, ofertaId: o.oferta.id, ofertaNazwa: o.oferta.nazwa });
    }
    const niepelne = p.zatrzymane || p.blad !== undefined;
    setSpr({
      doDodania, bezZdjecia, bezOferty, czeka, wieleKartotek,
      przerwane: niepelne ? { sprawdzono: p.pozycje.length, wszystkich: symbole.length } : null,
      blad: p.blad !== undefined ? opisPrzerwy(p.blad) : "",
    });
  }

  async function importuj(doWyslania: readonly Kandydat[]) {
    stop.current = false;
    zamknijPo.current = false;
    trwaRef.current = true;
    setTrwa(true); setZatrzymuje(false); setPytanie(false);
    const zapisz = (twId: number, w: Wynik) => {
      if (zywy.current) setWyniki((m) => new Map(m).set(twId, w));
    };
    await poKolei(doWyslania, WSPOLBIEZNOSC, async (k) => {
      if (zywy.current) setBiezace((b) => [...b, k.symbol]);
      try {
        const z = await wczytajPlik(await pobierzZdjecieOferty(k.ofertaId));
        /* Małe zdjęcie tylko liczymy: małe jest lepsze niż żadne. */
        if (Math.max(z.szer, z.wys) < MALY_BOK && zywy.current) setMale((s) => new Set(s).add(k.twId));
        const g = await zlozGotowy(pngZrodla(z), "image/png");
        const w: ZapisanieZdjecia = await wyslij({
          twId: k.twId, gotowy: g.base64, plik: `oferta ${k.ofertaId}`, zrodlo: "allegro",
        });
        zapisz(k.twId, { stan: "dodane", wSubiekcie: w.wSubiekcie });
      } catch (e) {
        /* 409: zdjęcie już czeka albo funkcję wyłączono — pominięcie, nie błąd. */
        zapisz(k.twId, e instanceof Konflikt
          ? { stan: "pominiete", powod: e.message }
          : { stan: "blad", powod: opisBledu(e) });
      } finally {
        if (zywy.current) setBiezace((b) => b.filter((s) => s !== k.symbol));
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
    przerwij.current?.();
    setZatrzymuje(true);
    setPytanie(false);
  };

  const wybrane = (spr?.doDodania ?? []).filter((k) => !odznaczone.has(k.twId));
  const zrobione = lista.filter((k) => wyniki.has(k.twId)).length;
  const policz = (stan: Wynik["stan"]) => [...wyniki.values()].filter((w) => w.stan === stan).length;
  const dodane = policz("dodane");
  const pominiete = policz("pominiete");
  const bledy = lista.filter((k) => wyniki.get(k.twId)?.stan === "blad");
  const niewyslane = lista.filter((k) => !wyniki.has(k.twId));
  const doPonowienia = [...bledy, ...niewyslane];
  const poImporcie = wyniki.size > 0 && !trwa;
  const tylkoWWertis = [...wyniki.values()].some((w) => w.stan === "dodane" && !w.wSubiekcie);
  const dodaneLista = lista.flatMap((k) => {
    const w = wyniki.get(k.twId);
    return w?.stan === "dodane" ? [{ k, wSubiekcie: w.wSubiekcie }] : [];
  });
  const gdzie = (wSubiekcie: boolean) => (wSubiekcie ? "kolejka do Subiekta" : "tylko WERTIS");
  /* Tabulatory, bo wklejone do Excela same rozkładają się na kolumny. */
  const tsvDodanych = ["Symbol\tTowar\tOferta\tNazwa oferty\tGdzie", ...dodaneLista.map(({ k, wSubiekcie }) =>
    [k.symbol, k.towar, k.ofertaId, k.ofertaNazwa, gdzie(wSubiekcie)].map((x) => x.replace(/\s+/g, " ")).join("\t"))].join("\n");
  const malych = lista.filter((k) => male.has(k.twId) && wyniki.get(k.twId)?.stan === "dodane").length;

  const przelacz = (twId: number) => setOdznaczone((s) => {
    const n = new Set(s);
    if (n.has(twId)) n.delete(twId); else n.add(twId);
    return n;
  });

  let tresc: React.ReactNode;
  if (postep) {
    const zdanie = postep.faza === "zbieram"
      ? (postep.razem === null ? "Zbieram towary bez zdjęcia…" : `Zbieram towary bez zdjęcia: ${postep.z} z ${postep.razem}…`)
      : postep.faza === "pytam" ? `Pytam Allegro: ${postep.z} z ${postep.ile}…`
      : `Allegro prosi o przerwę. Pytam znowu za ${Math.max(0, Math.ceil((postep.koniec - teraz) / 1000))} s.`;
    tresc = <p role="status" className="text-sm text-slate-700">
      {zatrzymuje ? "Zatrzymuję sprawdzanie…" : zdanie}</p>;
  } else if (wylaczone) {
    tresc = <Blad>{wylaczone}</Blad>;
  } else if (!spr) {
    /* Krok 1: wyjaśnienie i jeden przycisk na dole. Nic jeszcze nie pytamy. */
    tresc = <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
      <Store size={38} className="text-slate-500" aria-hidden="true" />
      <p className="text-tresc font-semibold text-slate-800">Zdjęcia kartotek z Twoich ofert na Allegro</p>
      <p className="text-sm text-slate-700">Sprawdzę każdy towar bez zdjęcia. Gdy ma ofertę o tym samym
        symbolu, pokażę jej zdjęcie główne. Nic nie dodam, zanim nie klikniesz „Dodaj”.</p>
      <p className="text-sm text-slate-600">Tła nie usuwamy. Zdjęcie idzie jako biały kwadrat.</p>
      <Blad>{blad}</Blad>
    </div>;
  } else if (!trwa && !poImporcie) {
    /* Krok 2: liczby, potem podgląd do odznaczenia. Jedna decyzja to przycisk na dole. */
    tresc = <div className="flex flex-col gap-3">
      {spr.blad && <Blad>{spr.blad}</Blad>}
      {spr.przerwane && <p className="text-sm text-slate-700">
        Sprawdzono {spr.przerwane.sprawdzono} z {towarow(spr.przerwane.wszystkich)}. Reszty nie liczę poniżej.</p>}
      <ul className="divide-y divide-slate-100">
        <Wiersz etykieta="Oferta ze zdjęciem — do dodania" liczba={spr.doDodania.length} />
        <Wiersz etykieta="Oferta bez zdjęcia" liczba={spr.bezZdjecia.length}><Nazwy nazwy={spr.bezZdjecia} /></Wiersz>
        <Wiersz etykieta="Bez oferty Allegro" liczba={spr.bezOferty.length}><Nazwy nazwy={spr.bezOferty} /></Wiersz>
        <Wiersz etykieta="Zdjęcie już czeka w kolejce" liczba={spr.czeka.length}><Nazwy nazwy={spr.czeka} /></Wiersz>
        {spr.wieleKartotek.length > 0 && <Wiersz etykieta="Kilka kartotek z tym symbolem — dodaj ręcznie w edytorze"
          liczba={spr.wieleKartotek.length}><Nazwy nazwy={spr.wieleKartotek} /></Wiersz>}
      </ul>
      {spr.doDodania.length > 0 && <section aria-labelledby="allegro-podglad">
        <h3 id="allegro-podglad" className="text-sm font-semibold text-slate-800">
          Zdjęcia do dodania · odznacz te, które nie pasują</h3>
        <ul className="mt-1 max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {spr.doDodania.map((k) => <li key={k.twId}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
              <input type="checkbox" checked={!odznaczone.has(k.twId)} onChange={() => przelacz(k.twId)}
                aria-label={`Dodaj zdjęcie do ${k.symbol}`} className="h-4 w-4 shrink-0" />
              <Miniatura ofertaId={k.ofertaId} nazwa={k.ofertaNazwa} />
              <span className="flex min-w-0 flex-col text-sm">
                <span className="font-mono text-slate-800">{k.symbol}</span>
                <span className="line-clamp-2 text-slate-900">{k.towar}</span>
                <span className="truncate text-slate-600">Oferta: {k.ofertaNazwa}</span>
              </span>
            </label>
          </li>)}
        </ul>
      </section>}
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
      {poImporcie && malych > 0 && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        {zdjec(malych)} ma poniżej {MALY_BOK} px. Poszły bez powiększania, więc na Allegro mogą
        wyglądać słabo. Lepsze zdjęcie podmienisz później w edytorze.</p>}
      {dodaneLista.length > 0 && <details open className="text-sm text-slate-700">
        {/* Rozwinięte od razu: to odpowiedź na pytanie „co poszło do której kartoteki”. */}
        <summary className="cursor-pointer text-slate-600">Dodane zdjęcia: {dodaneLista.length}</summary>
        <div className="mt-1 flex justify-end">
          <PrzyciskKopiuj tekst={tsvDodanych}>Kopiuj listę do arkusza</PrzyciskKopiuj>
        </div>
        <div className="mt-1 max-h-64 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-slate-600">
              <tr><th scope="col" className="py-1 pr-2 font-semibold">Symbol</th>
                <th scope="col" className="py-1 pr-2 font-semibold">Towar</th>
                <th scope="col" className="py-1 pr-2 font-semibold">Oferta</th>
                <th scope="col" className="py-1 font-semibold">Gdzie</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dodaneLista.map(({ k, wSubiekcie }) => <tr key={k.twId}>
                <td className="py-1 pr-2 font-mono whitespace-nowrap">{k.symbol}</td>
                <td className="py-1 pr-2 text-slate-900">{k.towar}</td>
                <td className="py-1 pr-2 text-slate-700">{k.ofertaNazwa} <span className="font-mono">({k.ofertaId})</span></td>
                <td className="py-1 whitespace-nowrap text-slate-700">{gdzie(wSubiekcie)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </details>}
      {pominiete > 0 && <details className="text-sm text-slate-700">
        <summary className="cursor-pointer text-slate-600">Pominięte: {pominiete}</summary>
        <ul className="mt-1 max-h-40 overflow-y-auto">
          {lista.map((k) => { const w = wyniki.get(k.twId);
            return w?.stan === "pominiete" && <li key={k.twId}><span className="font-mono">{k.symbol}</span> — {w.powod}</li>; })}
        </ul></details>}
      {bledy.length > 0 && <div>
        <p className="text-sm font-semibold text-red-700">Błędy: {bledy.length}</p>
        <ul className="mt-1 max-h-48 overflow-y-auto text-sm text-slate-800">
          {bledy.map((k) => { const w = wyniki.get(k.twId);
            return <li key={k.twId} className="py-0.5">
              <span className="font-mono">{k.symbol}</span> (oferta {k.ofertaId}) — {w && w.stan === "blad" ? w.powod : ""}</li>; })}
        </ul>
        {!trwa && <p className="mt-1 text-sm text-slate-600">
          Zdjęcie, które dalej nie przechodzi, dodaj ręcznie w edytorze obok.</p>}
      </div>}
    </div>;
  }

  /* Jedno główne działanie na krok — przycisk na dole okna zmienia się z krokiem. */
  let glowny: React.ReactNode = null;
  if (postep) {
    glowny = <Przycisk onClick={() => zatrzymaj(false)} disabled={zatrzymuje}>
      {zatrzymuje ? "Zatrzymuję…" : "Zatrzymaj"}</Przycisk>;
  } else if (wylaczone) {
    glowny = null;
  } else if (!spr) {
    glowny = <Przycisk wariant="glowny" onClick={() => void sprawdz()}>Sprawdź oferty</Przycisk>;
  } else if (!trwa && !poImporcie) {
    glowny = <Przycisk wariant="glowny" disabled={wybrane.length === 0}
      onClick={() => { setLista(wybrane); void importuj(wybrane); }}>
      {wybrane.length ? `Dodaj ${zdjec(wybrane.length)}` : "Nie ma czego dodać"}</Przycisk>;
  } else if (trwa) {
    glowny = <Przycisk onClick={() => zatrzymaj(false)} disabled={zatrzymuje}>
      {zatrzymuje ? "Zatrzymuję…" : "Zatrzymaj"}</Przycisk>;
  } else if (poImporcie && doPonowienia.length > 0) {
    glowny = <Przycisk wariant="glowny" onClick={() => void importuj(doPonowienia)}>
      {niewyslane.length ? `Dokończ: ${zdjec(doPonowienia.length)}` : `Ponów nieudane (${bledy.length})`}</Przycisk>;
  } else if (poImporcie) {
    glowny = <Przycisk wariant="glowny" onClick={onZamknij}>Zamknij</Przycisk>;
  }
  const odNowa = spr && !trwa && !postep;

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={zamknij}>
    <div role="dialog" {...okno} aria-labelledby="allegro-tytul" onClick={(e) => e.stopPropagation()}
      className="card flex max-h-full w-full max-w-2xl flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <h2 id="allegro-tytul" className="text-naglowek font-bold text-slate-900">Zdjęcia z ofert Allegro</h2>
        <button type="button" onClick={zamknij} aria-label="Zamknij okno zdjęć z ofert"
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
      {(glowny || odNowa) && <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
        {odNowa && <Przycisk onClick={() => { setSpr(null); setWyniki(new Map()); setLista([]); setMale(new Set()); }}>
          Sprawdź od nowa</Przycisk>}
        {glowny}
      </footer>}
    </div>
  </div>;
}
