import React, { useEffect, useRef, useState } from "react";
import { ScanSearch, X } from "lucide-react";
import { BrakPolaczenia, Konflikt, OdmowaPodgladu, PrzerwaAllegro } from "../api/klient";
import {
  pobierzZdjecieOferty, pobierzZdjecieTowaru, useBudujIndeks, useDopasujOferty, useImportGotowych, useStanIndeksu,
  zbierzZeZdjeciem, type DrogaDopasowania, type ListaZeZdjeciem, type PostepIndeksu, type PozycjaOferty, type PozycjaZeZdjeciem,
  type ZapisanieZdjecia,
} from "../api/zdjecia";
import { useOkno } from "../nawigacja/fokus";
import { useZdjecie, useZdjecieOferty } from "../towar/useZdjecie";
import { Blad, Przycisk, PrzyciskKopiuj, ile } from "../ui";
import { ocenZdjecie, pngZrodla, wczytajPlik, zlozGotowy } from "./obraz";
import { WSPOLBIEZNOSC, poKolei } from "./import";
import { MAKS_BOKU_GOTOWEGO } from "./obrobka";
import { lepszeOd, odNajgorszych, podProgiem, type Ocena } from "./ostrosc";
import { Nazwy, Wiersz } from "./ImportZFolderu";

/* ── NIEWYRAŹNE ZDJĘCIA KARTOTEK ZASTĄPIONE ZDJĘCIAMI Z ALLEGRO ────────────
   Część kartotek ma zdjęcie małe albo rozmyte, a nasza oferta tego towaru
   ma lepsze. Okno mierzy zdjęcia w przeglądarce, układa je od najgorszych
   i zamienia zaznaczone na zdjęcie z oferty.

   Zamiana nie kasuje niczego: zdjęcie z oferty staje się GŁÓWNYM, a stare
   zostaje w Subiekcie jako dodatkowe. Pomyłkę da się więc cofnąć ręcznie,
   a decyzja właściciela brzmi: nic nie kasujemy.

   Ekran liczy za agenta (ergonomia, punkt 5). Sam zbiera towary, dopasowuje
   oferty, mierzy i zaznacza te pod progiem. Agent tylko odznacza zdjęcia,
   które do kartoteki nie pasują (punkt 6). Przed wysyłką okno mierzy też
   zdjęcie oferty i pomija zamianę, która niczego by nie poprawiła.

   Otwarcie okna tylko czyta stan indeksu ofert. Indeks, dopasowanie i pomiar
   ruszają z przycisku, bo pytanie Allegro kosztuje limit i zapisuje bazę. */

/** Ile zdjęć mierzymy naraz. Trzy, jak wspólna kolejka obrazów: więcej zagłodziłoby kolektory. */
const POMIAR_NARAZ = 3;

/** Domyślne progi listy. Bok jak na Allegro, ostrość z pomiaru zdjęć kartotek. */
const PROG_BOKU = 400;
const PROG_OSTROSCI = 100;

/** Towar ze zdjęciem i ofertą, której zdjęcie może je zastąpić. */
interface Kandydat {
  twId: number; symbol: string; towar: string; ofertaId: string; ofertaNazwa: string;
  po: DrogaDopasowania | null;
}

/** Pomiar zdjęcia z Subiekta: ocena albo powód, dla którego nie wyszedł. */
type Pomiar = { ocena: Ocena } | { blad: string };

interface Sprawdzenie {
  kandydaci: Kandydat[];
  bezOferty: string[];
  bezZdjeciaOferty: string[];
  czeka: string[];
  /** Symbol kilku kartotek albo kod producenta w kilku towarach: zgadywanie dałoby zdjęcie złemu towarowi. */
  niejednoznaczne: string[];
  przerwane: { sprawdzono: number; wszystkich: number } | null;
  blad: string;
  uwaga: string;
}

type Wynik =
  | { stan: "zamienione"; wSubiekcie: boolean; po: Ocena }
  | { stan: "pominiete" | "blad"; powod: string };

type Postep =
  | PostepIndeksu
  | { faza: "zbieram"; z: number; razem: number | null }
  | { faza: "pytam"; z: number; ile: number }
  | { faza: "przerwa"; koniec: number }
  | { faza: "mierze"; z: number; ile: number };

const NIE_LEPSZE = "zdjęcie z Allegro nie jest lepsze";

const opisBledu = (e: unknown): string =>
  e instanceof BrakPolaczenia ? "Brak połączenia z serwerem. Kliknij „Ponów nieudane”, gdy wróci."
    : e instanceof Error && e.message ? e.message : "Nieznany błąd. Kliknij „Ponów nieudane”.";

const opisPrzerwy = (e: unknown): string =>
  e instanceof PrzerwaAllegro
    ? "Allegro dalej prosi o przerwę. Spróbuj za kilka minut — sprawdzone towary zostają poniżej."
    : e instanceof BrakPolaczenia ? "Brak połączenia z serwerem. Sprawdź zdjęcia jeszcze raz, gdy wróci."
    : `${e instanceof Error && e.message ? e.message : "Allegro nie odpowiedziało."} Sprawdź zdjęcia jeszcze raz za chwilę.`;

const opisIndeksu = (e: unknown): string =>
  `${e instanceof PrzerwaAllegro ? "Allegro dalej prosi o przerwę przy czytaniu naszych ofert."
    : e instanceof BrakPolaczenia ? "Brak połączenia z serwerem przy czytaniu naszych ofert."
    : e instanceof Error && e.message ? e.message : "Allegro nie oddało listy naszych ofert."} Przeczytane oferty zostają.`;

/* 404 to brak zdjęcia mimo listy, 413 — plik ponad limit serwera. Oba to
   odpowiedź o pliku, nie awaria, więc stoją jako powód, bez ponawiania. */
const opisPomiaru = (e: unknown): string =>
  e instanceof OdmowaPodgladu && e.status === 404 ? "Subiekt nie oddał zdjęcia"
    : e instanceof BrakPolaczenia ? "brak połączenia z serwerem"
    : e instanceof Error && e.message ? e.message : "nie udało się zmierzyć";

const LICZBA = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });
const opisDrogi = (po: DrogaDopasowania | null) =>
  po === "kod_producenta" ? "kod producenta" : po === "sygnatura" ? "sygnatura" : "—";
/** Kod producenta to słabszy dowód niż sygnatura, a zamiana zmienia zdjęcie główne. Taki towar zaznacza agent. */
const poKodzie = (k: Kandydat) => k.po === "kod_producenta";
const opisOceny = (o: Ocena) =>
  `bok ${o.bok} px · ostrość ${o.ostrosc === null ? "nie da się ocenić" : LICZBA.format(o.ostrosc)}`;
const krotko = (o: Ocena) => `${o.bok} px / ${o.ostrosc === null ? "—" : LICZBA.format(o.ostrosc)}`;

const zdjec = (n: number) => ile(n, "zdjęcie", "zdjęcia", "zdjęć");
const towarow = (n: number) => ile(n, "towar", "towary", "towarów");
const klucz = (s: string) => s.trim().toUpperCase();
const nazwaPozycji = (symbol: string, nazwa: string) => `${symbol} — ${nazwa}`;

/** Czy ramka jest w kadrze listy. Miniatury zamawiamy dopiero wtedy, bo setki naraz zajęłyby kolejkę obrazów. */
function useWKadrze(): [React.RefObject<HTMLDivElement | null>, boolean] {
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
  return [ramka, widac];
}

function Ramka({ ramka, url, widac, alt }: {
  ramka: React.RefObject<HTMLDivElement | null>; url: string | null | undefined; widac: boolean; alt: string;
}) {
  return <div ref={ramka} className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded border border-slate-200 bg-white">
    {url ? <img src={url} alt={alt} loading="lazy" className="h-full w-full object-contain" />
      : url === null && widac ? <span className="text-podpis text-slate-600">brak</span> : null}
  </div>;
}

function MiniaturaKartoteki({ twId, symbol }: { twId: number; symbol: string }) {
  const [ramka, widac] = useWKadrze();
  return <Ramka ramka={ramka} widac={widac} url={useZdjecie(widac ? twId : null)} alt={`Zdjęcie w Subiekcie: ${symbol}`} />;
}

function MiniaturaOferty({ ofertaId, nazwa }: { ofertaId: string; nazwa: string }) {
  const [ramka, widac] = useWKadrze();
  return <Ramka ramka={ramka} widac={widac} url={useZdjecieOferty(widac ? ofertaId : null)} alt={`Zdjęcie oferty: ${nazwa}`} />;
}

/** Pole progu: liczba całkowita od zera. Pusty albo zły wpis nie zmienia progu, żeby lista nie skakała przy pisaniu. */
function PoleProgu({ etykieta, wartosc, onZmien }: { etykieta: string; wartosc: number; onZmien: (n: number) => void }) {
  const [tekst, setTekst] = useState(String(wartosc));
  return <input type="number" min={0} step={1} inputMode="numeric" aria-label={etykieta} value={tekst}
    onChange={(e) => {
      setTekst(e.target.value);
      const n = Number(e.target.value);
      if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= 0) onZmien(n);
    }}
    className="field w-20 tabular-nums" />;
}

export function NiewyrazneZAllegro({ onZamknij }: { onZamknij: () => void }) {
  const dopasuj = useDopasujOferty();
  const budujIndeks = useBudujIndeks();
  const stanIndeksu = useStanIndeksu();
  const { wyslij, zakoncz } = useImportGotowych();
  const [postep, setPostep] = useState<Postep | null>(null);
  const [blad, setBlad] = useState("");
  const [wylaczone, setWylaczone] = useState<string | null>(null);
  const [indeksStanal, setIndeksStanal] = useState<string | null>(null);
  const [spr, setSpr] = useState<Sprawdzenie | null>(null);
  const [pomiary, setPomiary] = useState<ReadonlyMap<number, Pomiar>>(() => new Map());
  const [progBoku, setProgBoku] = useState(PROG_BOKU);
  const [progOstrosci, setProgOstrosci] = useState(PROG_OSTROSCI);
  /** Wybór agenta ponad domyślny; bez wpisu zaznaczenie wynika z progu. */
  const [wybor, setWybor] = useState<ReadonlyMap<number, boolean>>(() => new Map());
  const [lista, setLista] = useState<readonly Kandydat[]>([]);
  const [wyniki, setWyniki] = useState<ReadonlyMap<number, Wynik>>(() => new Map());
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

  const wPrzerwie = postep?.faza === "przerwa";
  useEffect(() => {
    if (!wPrzerwie) return;
    setTeraz(Date.now());
    const t = setInterval(() => setTeraz(Date.now()), 1000);
    return () => clearInterval(t);
  }, [wPrzerwie]);

  /* Zamknięcie w trakcie zamiany pyta. Sprawdzanie i pomiar niczego nie
     zapisują, więc zamykają się od razu. */
  const zamknij = () => {
    if (trwaRef.current) { setPytanie(true); return; }
    onZamknij();
  };
  const okno = useOkno<HTMLDivElement>({ onZamknij: zamknij });

  const czekaj = (ms: number) => new Promise<boolean>((gotowe) => {
    if (zywy.current) setPostep({ faza: "przerwa", koniec: Date.now() + ms });
    const t = setTimeout(() => { przerwij.current = null; gotowe(!stop.current); }, ms);
    przerwij.current = () => { clearTimeout(t); przerwij.current = null; gotowe(false); };
  });

  async function sprawdz() {
    stop.current = false;
    setZatrzymuje(false);
    setBlad(""); setWylaczone(null); setSpr(null); setPomiary(new Map()); setWybor(new Map());
    setWyniki(new Map()); setLista([]); setIndeksStanal(null);
    setPostep({ faza: "lista", z: 0, razem: null });
    await stanIndeksu.refetch();
    if (!zywy.current) return;
    const ix = await budujIndeks({
      postep: (p) => { if (zywy.current) setPostep(p); },
      czekaj,
      stop: () => stop.current,
    });
    if (!zywy.current) return;
    if (ix.zatrzymane || (ix.blad !== undefined && !(ix.blad instanceof Konflikt))) {
      setPostep(null); setZatrzymuje(false);
      setIndeksStanal(ix.zatrzymane ? "Zatrzymano czytanie naszych ofert. Przeczytane oferty zostają." : opisIndeksu(ix.blad));
      return;
    }
    await dopasujWszystko(ix.nieodczytane
      ? `Kodów producenta z ${ile(ix.nieodczytane, "oferty", "ofert", "ofert")} nie udało się teraz odczytać. Następne sprawdzenie spróbuje znowu.`
      : "");
  }

  async function dopasujWszystko(uwaga: string) {
    stop.current = false;
    setZatrzymuje(false);
    setIndeksStanal(null);
    setPostep({ faza: "zbieram", z: 0, razem: null });
    let towary: ListaZeZdjeciem | null;
    try {
      towary = await zbierzZeZdjeciem((z, razem) => {
        if (zywy.current) setPostep({ faza: "zbieram", z, razem });
      }, () => stop.current);
    } catch (e) {
      if (!zywy.current) return;
      setPostep(null);
      setBlad(`${opisBledu(e)} Nic nie zostało zamienione.`);
      return;
    }
    if (!zywy.current) return;
    if (!towary) { setPostep(null); setZatrzymuje(false); return; }
    if (!towary.wlaczone) {
      setPostep(null);
      setWylaczone(towary.powod ?? "Zdjęcia kartotek są w tej instalacji wyłączone.");
      return;
    }

    /* Towar z kolejką nie idzie dalej: drugie zdjęcie serwer i tak odrzuci.
       Symbol kilku kartotek też nie, bo zgadywanie dałoby zdjęcie złemu towarowi. */
    const czeka: string[] = [];
    const niejednoznaczne: string[] = [];
    const bezOferty: string[] = [];
    const wgSymbolu = new Map<string, PozycjaZeZdjeciem[]>();
    for (const t of towary.pozycje) {
      if (t.oczekuje) { czeka.push(nazwaPozycji(t.symbol, t.nazwa)); continue; }
      const k = klucz(t.symbol);
      wgSymbolu.set(k, [...(wgSymbolu.get(k) ?? []), t]);
    }
    const doPytania = new Map<string, PozycjaZeZdjeciem>();
    for (const [k, l] of wgSymbolu) {
      if (!k) bezOferty.push(...l.map((t) => nazwaPozycji(t.symbol, t.nazwa)));
      else if (l.length > 1) niejednoznaczne.push(...l.map((t) => nazwaPozycji(t.symbol, t.nazwa)));
      else doPytania.set(k, l[0]);
    }

    const symbole = [...doPytania.values()].map((t) => t.symbol.trim());
    const p = await dopasuj(symbole, {
      postep: (z, ile) => { if (zywy.current) setPostep({ faza: "pytam", z, ile }); },
      czekaj,
      stop: () => stop.current,
    });
    if (!zywy.current) return;
    if (p.wylaczone) { setPostep(null); setZatrzymuje(false); setWylaczone(p.wylaczone); return; }

    const odpowiedzi = new Map<string, PozycjaOferty>(p.pozycje.map((x) => [klucz(x.symbol), x]));
    const kandydaci: Kandydat[] = [];
    const bezZdjeciaOferty: string[] = [];
    for (const [k, t] of doPytania) {
      const o = odpowiedzi.get(k);
      /* Symbol, o który nie zdążyliśmy zapytać, nie jest „bez oferty”. */
      if (!o) continue;
      if (!o.oferta) (o.niejednoznaczny ? niejednoznaczne : bezOferty).push(nazwaPozycji(t.symbol, t.nazwa));
      else if (!o.oferta.zdjecie) bezZdjeciaOferty.push(nazwaPozycji(t.symbol, t.nazwa));
      else kandydaci.push({ twId: t.twId, symbol: t.symbol, towar: t.nazwa, ofertaId: o.oferta.id, ofertaNazwa: o.oferta.nazwa,
        po: o.po ?? null });
    }
    const niepelne = p.zatrzymane || p.blad !== undefined;
    setSpr({
      kandydaci, bezOferty, bezZdjeciaOferty, czeka, niejednoznaczne, uwaga,
      przerwane: niepelne ? { sprawdzono: p.pozycje.length, wszystkich: symbole.length } : null,
      blad: p.blad !== undefined ? opisPrzerwy(p.blad) : "",
    });
    /* Zatrzymane dopasowanie nie rusza pomiaru: agent kazał przestać. */
    if (p.zatrzymane) { setPostep(null); setZatrzymuje(false); return; }
    await zmierz(kandydaci);
  }

  /** Pomiar zdjęć z Subiekta. Sam odczyt; zatrzymany zostawia zmierzone na liście. */
  async function zmierz(doPomiaru: readonly Kandydat[]) {
    stop.current = false;
    setZatrzymuje(false);
    let z = 0;
    setPostep({ faza: "mierze", z, ile: doPomiaru.length });
    await poKolei(doPomiaru, POMIAR_NARAZ, async (k) => {
      let w: Pomiar;
      try {
        w = { ocena: ocenZdjecie(await wczytajPlik(await pobierzZdjecieTowaru(k.twId))) };
      } catch (e) {
        w = { blad: opisPomiaru(e) };
      }
      z++;
      if (!zywy.current) return;
      setPomiary((m) => new Map(m).set(k.twId, w));
      setPostep({ faza: "mierze", z, ile: doPomiaru.length });
    }, () => stop.current || !zywy.current);
    if (!zywy.current) return;
    setPostep(null); setZatrzymuje(false);
  }

  async function zamien(doWyslania: readonly Kandydat[]) {
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
        const przed = ocena(k.twId);
        const z = await wczytajPlik(await pobierzZdjecieOferty(k.ofertaId));
        const po = ocenZdjecie(z);
        /* Do Subiekta idzie kwadrat najwyżej 800 px, więc większy bok oferty
           ponad ten limit niczego nie poprawia. Porównujemy to, co tam trafi. */
        if (przed && !lepszeOd(przed, { ...po, bok: Math.min(po.bok, MAKS_BOKU_GOTOWEGO) })) {
          zapisz(k.twId, { stan: "pominiete", powod: NIE_LEPSZE });
          return;
        }
        const g = await zlozGotowy(pngZrodla(z), "image/png");
        const w: ZapisanieZdjecia = await wyslij({
          twId: k.twId, gotowy: g.base64, plik: `oferta ${k.ofertaId}`, zrodlo: "allegro", zamien: true,
        });
        zapisz(k.twId, { stan: "zamienione", wSubiekcie: w.wSubiekcie, po });
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

  const ocena = (twId: number): Ocena | null => {
    const p = pomiary.get(twId);
    return p && "ocena" in p ? p.ocena : null;
  };
  const kandydaci = spr?.kandydaci ?? [];
  const zmierzone = kandydaci.flatMap((k) => { const o = ocena(k.twId); return o ? [{ k, o }] : []; })
    .sort((a, b) => odNajgorszych(a.o, b.o));
  const nieZmierzone = kandydaci.flatMap((k) => {
    const p = pomiary.get(k.twId);
    return p && "blad" in p ? [{ k, powod: p.blad }] : [];
  });
  const doPomiaru = kandydaci.filter((k) => !pomiary.has(k.twId));
  const pod = (o: Ocena) => podProgiem(o, progBoku, progOstrosci);
  const zaznaczony = (k: Kandydat, o: Ocena) => wybor.get(k.twId) ?? (pod(o) && !poKodzie(k));
  const niewyraznych = zmierzone.filter(({ o }) => pod(o)).length;
  const kodemPod = zmierzone.filter(({ k, o }) => pod(o) && poKodzie(k)).length;
  const wybrane = zmierzone.filter(({ k, o }) => zaznaczony(k, o)).map(({ k }) => k);

  const zrobione = lista.filter((k) => wyniki.has(k.twId)).length;
  const policz = (stan: Wynik["stan"]) => [...wyniki.values()].filter((w) => w.stan === stan).length;
  const zamienione = policz("zamienione");
  const pominiete = policz("pominiete");
  const bledy = lista.filter((k) => wyniki.get(k.twId)?.stan === "blad");
  const niewyslane = lista.filter((k) => !wyniki.has(k.twId));
  const doPonowienia = [...bledy, ...niewyslane];
  const poZamianie = wyniki.size > 0 && !trwa;
  const tylkoWWertis = [...wyniki.values()].some((w) => w.stan === "zamienione" && !w.wSubiekcie);
  const zamienioneLista = lista.flatMap((k) => {
    const w = wyniki.get(k.twId);
    const przed = ocena(k.twId);
    return w?.stan === "zamienione" && przed ? [{ k, przed, po: w.po, wSubiekcie: w.wSubiekcie }] : [];
  });
  const gdzie = (wSubiekcie: boolean) => (wSubiekcie ? "kolejka do Subiekta" : "tylko WERTIS");
  /* Tabulatory, bo wklejone do Excela same rozkładają się na kolumny. */
  const tsv = ["Symbol\tTowar\tOferta\tNazwa oferty\tDopasowanie\tPrzed\tPo\tGdzie", ...zamienioneLista.map(({ k, przed, po, wSubiekcie }) =>
    [k.symbol, k.towar, k.ofertaId, k.ofertaNazwa, opisDrogi(k.po), krotko(przed), krotko(po), gdzie(wSubiekcie)]
      .map((x) => x.replace(/\s+/g, " ")).join("\t"))].join("\n");

  const przelacz = (k: Kandydat, o: Ocena) => setWybor((m) => new Map(m).set(k.twId, !zaznaczony(k, o)));

  let tresc: React.ReactNode;
  if (postep) {
    const zdanie = postep.faza === "lista"
      ? (postep.razem === null ? "Odświeżam listę naszych ofert…" : `Odświeżam listę naszych ofert: ${postep.z} z ${postep.razem}…`)
      : postep.faza === "kody"
      ? (postep.zostalo === null ? "Czytam kody producenta…"
        : `Czytam kody producenta: pobrano ${postep.pobrano}, zostało ${postep.zostalo}…`)
      : postep.faza === "zbieram"
      ? (postep.razem === null ? "Zbieram towary ze zdjęciem…" : `Zbieram towary ze zdjęciem: ${postep.z} z ${postep.razem}…`)
      : postep.faza === "pytam" ? `Pytam Allegro: ${postep.z} z ${postep.ile}…`
      : postep.faza === "mierze" ? `Mierzę zdjęcia w Subiekcie: ${postep.z} z ${postep.ile}…`
      : `Allegro prosi o przerwę. Pytam znowu za ${Math.max(0, Math.ceil((postep.koniec - teraz) / 1000))} s.`;
    tresc = <div className="flex flex-col gap-2">
      {postep.faza === "mierze" && <div role="progressbar" aria-label="Postęp pomiaru" aria-valuemin={0}
        aria-valuemax={postep.ile} aria-valuenow={postep.z} aria-valuetext={`${postep.z} z ${postep.ile}`}
        className="h-2 overflow-hidden rounded bg-slate-200">
        <div className="h-full bg-slate-700" style={{ width: `${postep.ile ? Math.round((postep.z / postep.ile) * 100) : 0}%` }} />
      </div>}
      <p role="status" className="text-sm text-slate-700">{zatrzymuje ? "Zatrzymuję…" : zdanie}</p>
    </div>;
  } else if (wylaczone) {
    tresc = <Blad>{wylaczone}</Blad>;
  } else if (indeksStanal) {
    tresc = <div className="flex flex-col gap-2">
      <p role="status" className="text-sm text-slate-800">{indeksStanal}</p>
      <p className="text-sm text-slate-700">Możesz dopasować towary z tym, co już znamy. Resztę kodów
        dokończy następne „Sprawdź zdjęcia”.</p>
    </div>;
  } else if (!spr) {
    tresc = <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
      <ScanSearch size={38} className="text-slate-500" aria-hidden="true" />
      <p className="text-tresc font-semibold text-slate-800">Niewyraźne zdjęcia kartotek</p>
      <p className="text-sm text-slate-700">Zmierzę zdjęcie każdego towaru, który ma ofertę ze zdjęciem.
        Pokażę je od najgorszych, obok zdjęcia z oferty. Nic nie zamienię, zanim nie klikniesz „Zamień”.</p>
      <p className="text-sm text-slate-600">Stare zdjęcie zostaje w Subiekcie jako dodatkowe. Nowe idzie jako biały kwadrat.</p>
      {stanIndeksu.data && <p className="text-sm text-slate-700">
        Znamy {ile(stanIndeksu.data.ofert, "naszą ofertę", "nasze oferty", "naszych ofert")}.</p>}
      <Blad>{blad}</Blad>
    </div>;
  } else if (!trwa && !poZamianie) {
    tresc = <div className="flex flex-col gap-3">
      {spr.blad && <Blad>{spr.blad}</Blad>}
      {spr.uwaga && <p className="text-sm text-slate-700">{spr.uwaga}</p>}
      {spr.przerwane && <p className="text-sm text-slate-700">
        Sprawdzono {spr.przerwane.sprawdzono} z {towarow(spr.przerwane.wszystkich)}. Reszty nie liczę poniżej.</p>}
      <ul className="divide-y divide-slate-100">
        <Wiersz etykieta="Oferta ze zdjęciem — zmierzone" liczba={zmierzone.length}>
          {doPomiaru.length > 0 && <p className="text-sm text-slate-600">niezmierzone: {doPomiaru.length}</p>}
        </Wiersz>
        <Wiersz etykieta="Nie udało się zmierzyć" liczba={nieZmierzone.length}>
          <Nazwy nazwy={nieZmierzone.map(({ k, powod }) => `${k.symbol} — ${powod}`)} /></Wiersz>
        <Wiersz etykieta="Oferta bez zdjęcia" liczba={spr.bezZdjeciaOferty.length}><Nazwy nazwy={spr.bezZdjeciaOferty} /></Wiersz>
        <Wiersz etykieta="Bez oferty Allegro" liczba={spr.bezOferty.length}><Nazwy nazwy={spr.bezOferty} /></Wiersz>
        <Wiersz etykieta="Zdjęcie już czeka w kolejce" liczba={spr.czeka.length}><Nazwy nazwy={spr.czeka} /></Wiersz>
        {spr.niejednoznaczne.length > 0 && <Wiersz etykieta="Kilka kartotek albo kilka towarów — popraw ręcznie"
          liczba={spr.niejednoznaczne.length}><Nazwy nazwy={spr.niejednoznaczne} /></Wiersz>}
      </ul>
      {zmierzone.length > 0 && <section aria-labelledby="niewyrazne-lista" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700">
          <span>Niewyraźne to bok poniżej</span>
          <PoleProgu etykieta="Próg boku w pikselach" wartosc={progBoku} onZmien={setProgBoku} />
          <span>px lub ostrość poniżej</span>
          <PoleProgu etykieta="Próg ostrości" wartosc={progOstrosci} onZmien={setProgOstrosci} />
        </div>
        <h3 id="niewyrazne-lista" className="text-sm font-semibold text-slate-800">
          Niewyraźnych: {niewyraznych} z {zmierzone.length} zmierzonych · odznacz te, których oferta nie pasuje</h3>
        {kodemPod > 0 && <p className="text-sm text-slate-700">
          Dopasowane po kodzie producenta nie są zaznaczane same: {kodemPod}</p>}
        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {zmierzone.map(({ k, o }) => <li key={k.twId}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
              <input type="checkbox" checked={zaznaczony(k, o)} onChange={() => przelacz(k, o)}
                aria-label={`Zamień zdjęcie ${k.symbol}`} className="h-4 w-4 shrink-0" />
              <MiniaturaKartoteki twId={k.twId} symbol={k.symbol} />
              <MiniaturaOferty ofertaId={k.ofertaId} nazwa={k.ofertaNazwa} />
              <span className="flex min-w-0 flex-col text-sm">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-slate-800">{k.symbol}</span>
                  {poKodzie(k) && <span className="rounded border border-slate-300 px-1 text-podpis text-slate-700">
                    kod producenta</span>}
                </span>
                <span className="line-clamp-2 text-slate-900">{k.towar}</span>
                <span className={pod(o) ? "font-semibold text-slate-800" : "text-slate-600"}>{opisOceny(o)}</span>
              </span>
            </label>
          </li>)}
        </ul>
      </section>}
    </div>;
  } else {
    const procent = lista.length ? Math.round((zrobione / lista.length) * 100) : 0;
    tresc = <div className="flex flex-col gap-3">
      <div role="progressbar" aria-label="Postęp zamiany" aria-valuemin={0} aria-valuemax={lista.length}
        aria-valuenow={zrobione} aria-valuetext={`${zrobione} z ${lista.length}`}
        className="h-2 overflow-hidden rounded bg-slate-200">
        <div className="h-full bg-slate-700" style={{ width: `${procent}%` }} />
      </div>
      <p className="text-sm font-semibold text-slate-900">{zrobione} z {lista.length}
        {trwa && biezace.length > 0 && <span className="font-normal text-slate-700">
          {" · "}teraz <span className="font-mono">{biezace.join(", ")}</span></span>}</p>
      {zatrzymuje && trwa && <p role="status" className="text-sm text-slate-700">
        Kończę bieżące zdjęcia, nowych nie zaczynam…</p>}
      {poZamianie && <p role="status" className="text-sm text-slate-800">
        Zamieniono {zamienione}, pominięto {pominiete}, błędy {bledy.length}
        {niewyslane.length > 0 ? `, nie wysłano ${niewyslane.length}` : ""}.
        {tylkoWWertis ? " Ta instalacja nie wysyła zdjęć do Subiekta, więc zostały w WERTIS." : ""}</p>}
      {zamienioneLista.length > 0 && <details open className="text-sm text-slate-700">
        {/* Rozwinięte od razu: to odpowiedź na pytanie „co zmieniło się w której kartotece”. */}
        <summary className="cursor-pointer text-slate-600">Zamienione zdjęcia: {zamienioneLista.length}</summary>
        <div className="mt-1 flex justify-end">
          <PrzyciskKopiuj tekst={tsv}>Kopiuj listę do arkusza</PrzyciskKopiuj>
        </div>
        <div className="mt-1 max-h-64 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-slate-600">
              <tr><th scope="col" className="py-1 pr-2 font-semibold">Symbol</th>
                <th scope="col" className="py-1 pr-2 font-semibold">Towar</th>
                <th scope="col" className="py-1 pr-2 font-semibold">Oferta</th>
                <th scope="col" className="py-1 pr-2 font-semibold">Dopasowanie</th>
                <th scope="col" className="py-1 pr-2 font-semibold">Przed</th>
                <th scope="col" className="py-1 pr-2 font-semibold">Po</th>
                <th scope="col" className="py-1 font-semibold">Gdzie</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {zamienioneLista.map(({ k, przed, po, wSubiekcie }) => <tr key={k.twId}>
                <td className="py-1 pr-2 font-mono whitespace-nowrap">{k.symbol}</td>
                <td className="py-1 pr-2 text-slate-900">{k.towar}</td>
                <td className="py-1 pr-2 text-slate-700">{k.ofertaNazwa} <span className="font-mono">({k.ofertaId})</span></td>
                <td className="py-1 pr-2 whitespace-nowrap text-slate-700">{opisDrogi(k.po)}</td>
                <td className="py-1 pr-2 whitespace-nowrap tabular-nums text-slate-700">{krotko(przed)}</td>
                <td className="py-1 pr-2 whitespace-nowrap tabular-nums text-slate-700">{krotko(po)}</td>
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
          Zdjęcie, które dalej nie przechodzi, podmień ręcznie w Subiekcie.</p>}
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
  } else if (indeksStanal) {
    glowny = <Przycisk wariant="glowny" onClick={() => void dopasujWszystko("")}>Dopasuj z tym, co jest</Przycisk>;
  } else if (!spr) {
    glowny = <Przycisk wariant="glowny" onClick={() => void sprawdz()}>Sprawdź zdjęcia</Przycisk>;
  } else if (!trwa && !poZamianie) {
    glowny = <Przycisk wariant="glowny" disabled={wybrane.length === 0}
      onClick={() => { setLista(wybrane); void zamien(wybrane); }}>
      {wybrane.length ? `Zamień ${zdjec(wybrane.length)}` : "Nie ma czego zamienić"}</Przycisk>;
  } else if (trwa) {
    glowny = <Przycisk onClick={() => zatrzymaj(false)} disabled={zatrzymuje}>
      {zatrzymuje ? "Zatrzymuję…" : "Zatrzymaj"}</Przycisk>;
  } else if (poZamianie && doPonowienia.length > 0) {
    glowny = <Przycisk wariant="glowny" onClick={() => void zamien(doPonowienia)}>
      {niewyslane.length ? `Dokończ: ${zdjec(doPonowienia.length)}` : `Ponów nieudane (${bledy.length})`}</Przycisk>;
  } else if (poZamianie) {
    glowny = <Przycisk wariant="glowny" onClick={onZamknij}>Zamknij</Przycisk>;
  }
  const naLiscie = spr && !trwa && !postep && !poZamianie;
  const odNowa = spr && !trwa && !postep;

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={zamknij}>
    <div role="dialog" {...okno} aria-labelledby="niewyrazne-tytul" onClick={(e) => e.stopPropagation()}
      className="card flex max-h-full w-full max-w-3xl flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <h2 id="niewyrazne-tytul" className="text-naglowek font-bold text-slate-900">Niewyraźne zdjęcia z ofert Allegro</h2>
        <button type="button" onClick={zamknij} aria-label="Zamknij okno niewyraźnych zdjęć"
          className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100">
          <X size={18} aria-hidden="true" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{tresc}</div>
      {pytanie && <div role="alert" className="shrink-0 border-t border-amber-300 bg-amber-50 px-5 py-3">
        <p className="text-sm text-amber-900">Zamiana trwa: {zrobione} z {lista.length}. Zatrzymać ją i zamknąć okno?
          Wysłane zdjęcia zostaną.</p>
        <div className="mt-2 flex justify-end gap-2">
          <Przycisk onClick={() => setPytanie(false)} autoFocus>Zamieniaj dalej</Przycisk>
          <Przycisk onClick={() => zatrzymaj(true)}>Zatrzymaj i zamknij</Przycisk>
        </div>
      </div>}
      {(glowny || odNowa) && <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
        {odNowa && <Przycisk onClick={() => {
          setSpr(null); setWyniki(new Map()); setLista([]); setPomiary(new Map()); setWybor(new Map());
        }}>Sprawdź od nowa</Przycisk>}
        {naLiscie && doPomiaru.length > 0 && <Przycisk onClick={() => void zmierz(doPomiaru)}>
          Dokończ pomiar ({doPomiaru.length})</Przycisk>}
        {glowny}
      </footer>}
    </div>
  </div>;
}
