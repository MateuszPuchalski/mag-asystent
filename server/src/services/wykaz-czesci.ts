import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { zwin } from "../tekst.js";
import { logEvent } from "./events.js";
import { czlowiekZBiura, kluczModelu, wTransakcji, zaproponujZastosowanie, type RodzajDowodu } from "./wiedza.js";
import { numeryZKomorki, tabelaZTresci, type TrescImportu } from "./odsylacze-dostawcow.js";
import { sprawdzWarunki, zdanieWarunkow, type WarunkiZastosowania } from "./warunki-zastosowania.js";
import { MIN_CYFR, MIN_ZNAKOW } from "./zamiennosc-oem.js";

/**
 * Wykaz części producenta (IPL): „ten model maszyny składa się z części
 * o tych numerach OEM" — jako propozycje zastosowań.
 *
 * ── PO CO ─────────────────────────────────────────────────────────────────
 * Warstwa „część → maszyna" jest prawie pusta: sekcję „Modele:" ma 39
 * kartotek na 3415. Opisy jej nie wypełnią. Wykaz części producenta mówi
 * dokładnie to, czego brakuje, z dowodem producenta i często z zakresem
 * numerów seryjnych. Numery OEM kartotek już znamy — z opisów i z odsyłaczy
 * dostawców — więc wiersz wykazu da się przyłożyć do naszej kartoteki.
 *
 * ── PROPOZYCJE, NIE WPISY ─────────────────────────────────────────────────
 * Wykaz jest pewny. Niepewne jest OGNIWO „numer OEM → nasza kartoteka":
 * numer bywa wpisany w opis zamiennika, który pasuje tylko częściowo, albo
 * trafia w dwie kartoteki naraz. To ogniwo sprawdza człowiek w kolejce, ze
 * zdjęciem części obok — dlatego wykaz rodzi propozycje, jak każde inne
 * źródło wiedzy.
 *
 * ── ŹRÓDŁO `reczne`, NIE NOWA WARTOŚĆ ─────────────────────────────────────
 * Lista źródeł propozycji stoi w CHECK tabeli `zastosowanie`, a jej
 * rozszerzenie to przebudowa tabeli z czterema kluczami obcymi (blizna
 * 0.135.0, przebudowa 0.264.0). Plik wybiera, mapuje i zapisuje człowiek
 * z biura, więc `reczne` mówi prawdę. Pochodzenie z wykazu niesie
 * `import_id` i treść dowodu z nazwą wykazu.
 *
 * ── PODGLĄD NICZEGO NIE ZAPISUJE ──────────────────────────────────────────
 * Nawet modelu maszyny: podgląd szuka go po kluczu, a `upewnijModel` woła
 * dopiero zapis. Model z podglądu, który zostałby w bazie po „Wróć",
 * zaśmiecałby podpowiedzi w każdym formularzu wiedzy.
 */

/** Kolumna pliku albo jedna wartość dla całego pliku (wykaz jednej maszyny nie ma kolumny „model"). */
export type PoleWykazu = { kolumna: number } | { tekst: string } | null;

export interface MapowanieWykazu {
  marka: PoleWykazu;
  model: PoleWykazu;
  wariant: PoleWykazu;
  /** Kolumny z numerami OEM części; komórka może nieść kilka. */
  numery: number[];
  rokOd: number | null;
  rokDo: number | null;
  seryjnyOd: number | null;
  seryjnyDo: number | null;
  /** Wykaz maszyny czy silnika — zastosowanie do silnika karmi szczebel „przez silnik". */
  rodzaj: "maszyna" | "silnik";
}

export type DowodWykazu = Extract<RodzajDowodu, "producent" | "katalog_dostawcy">;

export interface ZadanieWykazu {
  /** Nazwa wykazu — trafia do treści dowodu: „IPL STIHL MS 250, wyd. 2024". */
  zrodlo: string;
  link?: string | null;
  plik?: string | null;
  /** Producent maszyny czy katalog dostawcy (np. tabela Oregon „łańcuch do pilarki"). */
  rodzajDowodu?: DowodWykazu;
  tresc: TrescImportu;
  mapowanie?: MapowanieWykazu | null;
}

export interface ParaWykazu {
  symbol: string; nazwa: string; maszyna: string; numery: string[]; warunki: string | null;
}

export interface RaportWykazu {
  naglowki: string[];
  probka: string[][];
  mapowanie: MapowanieWykazu | null;
  zgadniete: boolean;
  wierszy: number;
  /** Wiersze, z których wyszła choć jedna para część → maszyna. */
  dopasowanych: number;
  bezMaszyny: number;
  bezNumerow: number;
  bledneWarunki: { liczba: number; przyklady: string[] };
  /** Numery OEM, których nie ma przy żadnej kartotece — „czego nie mamy". */
  bezKartoteki: { liczba: number; przyklady: string[] };
  maszyn: { nowych: number; znanych: number };
  par: { nowych: number; znanych: number; znanychInneWarunki: number };
  /** Nowe pary — to one trafią do kolejki. */
  przyklady: ParaWykazu[];
  /** Pary, które już stoją, ale wykaz daje im inne warunki — do „Popraw warunki". */
  inneWarunki: ParaWykazu[];
  zapisano: { importId: number; propozycji: number } | null;
}

export interface ImportWykazu {
  id: number; zrodlo: string; link: string | null; plik: string | null; rodzaj: "maszyna" | "silnik";
  wierszy: number; par: number; propozycji: number;
  /** Ile propozycji z tego wykazu wciąż czeka, a ile już rozstrzygnięto. */
  czeka: number; zatwierdzonych: number;
  stan: "aktywny" | "wycofany"; zaimportowal: string; at: string;
  wycofal: string | null; wycofanoAt: string | null;
}

const PROBKA = 5;
const PRZYKLADOW = 20;
const RODZAJE_NUMERU = ["oem", "nr_oryg"] as const;

const oczysc = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const bezOgonkow = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");

/* ── Mapowanie ─────────────────────────────────────────────────────────── */

/**
 * Zgadnięte po nagłówkach — podpowiedź, którą ekran pokazuje w listach
 * wyboru. „Numer" w wykazie to prawie zawsze numer części producenta, ale
 * „Nr" bywa numerem pozycji na rysunku; dlatego słowo „poz" wyklucza.
 */
export function zgadnijMapowanie(naglowki: string[]): MapowanieWykazu | null {
  const h = naglowki.map(bezOgonkow);
  const znajdz = (re: RegExp, bez?: RegExp) => h.findIndex((x) => re.test(x) && !(bez && bez.test(x)));
  const kol = (i: number): PoleWykazu => (i >= 0 ? { kolumna: i } : null);
  const opt = (i: number) => (i >= 0 ? i : null);
  const SERYJNY = /seryj|s\/?n|serial/;
  const numery = h.map((x, i) => /oem|numer czesci|nr czesci|part ?n|part number|nr katalog|numer katalog|orygin|^numer$|^nr$/.test(x)
    && !/poz|pos\b|ilosc|qty/.test(x) ? i : -1).filter((i) => i >= 0);
  const model = znajdz(/^model|maszyn|urzadzen|machine|^typ\b/);
  if (numery.length === 0) return null;
  return {
    marka: kol(znajdz(/marka|producent|brand|manufacturer/)), model: kol(model),
    wariant: kol(znajdz(/wariant|wersja|variant|version/)), numery: numery.filter((i) => i !== model),
    rokOd: opt(znajdz(/rok od|od roku|rocznik od|year from/, SERYJNY)),
    rokDo: opt(znajdz(/rok do|do roku|rocznik do|year to/, SERYJNY)),
    seryjnyOd: opt(znajdz(/(seryj|s\/?n|serial).*(od|from)|(od|from).*(seryj|s\/?n|serial)/)),
    seryjnyDo: opt(znajdz(/(seryj|s\/?n|serial).*(do|to)\b|(do|to)\b.*(seryj|s\/?n|serial)/)),
    rodzaj: "maszyna",
  };
}

function sprawdzMapowanie(m: MapowanieWykazu, kolumn: number): MapowanieWykazu {
  const w = (i: number | null) => i === null || (Number.isInteger(i) && i >= 0 && i < kolumn);
  const pole = (p: PoleWykazu, co: string): PoleWykazu => {
    if (p === null || p === undefined) return null;
    if ("kolumna" in p) {
      if (!w(p.kolumna)) throw new Error("Mapowanie wskazuje kolumnę, której w pliku nie ma");
      return { kolumna: p.kolumna };
    }
    const t = oczysc(p.tekst);
    if (!t) return null;
    if (t.length > 80) throw new Error(`${co}: najwyżej 80 znaków`);
    return { tekst: t };
  };
  if (!Array.isArray(m.numery) || !m.numery.every((i) => w(i) && i !== null)) {
    throw new Error("Mapowanie wskazuje kolumnę, której w pliku nie ma");
  }
  for (const i of [m.rokOd, m.rokDo, m.seryjnyOd, m.seryjnyDo]) {
    if (!w(i ?? null)) throw new Error("Mapowanie wskazuje kolumnę, której w pliku nie ma");
  }
  if (m.numery.length === 0) throw new Error("Wskaż co najmniej jedną kolumnę z numerami części");
  if (m.rodzaj !== "maszyna" && m.rodzaj !== "silnik") throw new Error("Wykaz dotyczy maszyny albo silnika");
  const marka = pole(m.marka, "Marka"); const model = pole(m.model, "Model");
  if (!marka) throw new Error("Wskaż kolumnę marki albo wpisz markę dla całego pliku");
  if (!model) throw new Error("Wskaż kolumnę modelu albo wpisz model dla całego pliku");
  const zajete = [marka, model].flatMap((p) => (p && "kolumna" in p ? [p.kolumna] : []));
  if (m.numery.some((i) => zajete.includes(i))) throw new Error("Kolumna marki albo modelu nie może być kolumną numerów");
  const zakresy = [m.rokOd, m.rokDo, m.seryjnyOd, m.seryjnyDo].filter((i) => i !== null && i !== undefined);
  if (m.numery.some((i) => zakresy.includes(i))) throw new Error("Kolumna roku albo numeru seryjnego nie może być kolumną numerów części");
  return {
    marka, model, wariant: pole(m.wariant, "Wariant"), numery: [...new Set(m.numery)],
    rokOd: m.rokOd ?? null, rokDo: m.rokDo ?? null, seryjnyOd: m.seryjnyOd ?? null, seryjnyDo: m.seryjnyDo ?? null,
    rodzaj: m.rodzaj,
  };
}

const wartosc = (p: PoleWykazu, w: string[]) => (p === null ? "" : "kolumna" in p ? oczysc(w[p.kolumna]) : p.tekst);
const komorka = (i: number | null, w: string[]) => (i === null ? null : oczysc(w[i]) || null);

/* ── Rachunek ──────────────────────────────────────────────────────────── */

interface Para {
  twId: number; symbol: string; nazwa: string;
  model: { rodzaj: "maszyna" | "silnik"; marka: string; nazwa: string; wariant: string | null };
  etykieta: string; numery: string[]; warunki: WarunkiZastosowania;
}
interface Plan { nowe: Para[]; raport: Omit<RaportWykazu, "zapisano"> }

function planuj(database: DatabaseSync, t: string[][], m: MapowanieWykazu | null, zgadniete: boolean): Plan {
  const [naglowki, ...dane] = t;
  const raport: Plan["raport"] = {
    naglowki, probka: dane.slice(0, PROBKA), mapowanie: m, zgadniete, wierszy: dane.length, dopasowanych: 0,
    bezMaszyny: 0, bezNumerow: 0, bledneWarunki: { liczba: 0, przyklady: [] }, bezKartoteki: { liczba: 0, przyklady: [] },
    maszyn: { nowych: 0, znanych: 0 }, par: { nowych: 0, znanych: 0, znanychInneWarunki: 0 },
    przyklady: [], inneWarunki: [],
  };
  if (!m) return { nowe: [], raport };

  /* Numer → kartoteki raz na rachunek. Dwa ogniwa: numer OEM zapisany przy
     kartotece (opis, odsyłacze, ręka biura) i nasz SYMBOL równy numerowi —
     wtedy kartoteka JEST oryginałem. Numer trafiający w dwie kartoteki daje
     dwie propozycje: obie deklarują ten sam oryginał, a która naprawdę
     pasuje, rozstrzygnie człowiek przy zdjęciu. */
  const kartoteka = new Map<number, { symbol: string; nazwa: string }>();
  const poNumerze = new Map<string, Set<number>>();
  const dopisz = (norm: string, twId: number) => {
    if (!norm) return;
    const s = poNumerze.get(norm) ?? new Set<number>();
    s.add(twId); poNumerze.set(norm, s);
  };
  for (const w of database.prepare("SELECT tw_id, symbol, nazwa FROM sgt_towar").all() as
    Array<{ tw_id: number; symbol: string; nazwa: string }>) {
    kartoteka.set(Number(w.tw_id), { symbol: w.symbol, nazwa: w.nazwa });
    dopisz(zwin(w.symbol), Number(w.tw_id));
  }
  for (const w of database.prepare(`SELECT tw_id, wartosc_norm FROM towar_identyfikator
    WHERE rodzaj IN (${RODZAJE_NUMERU.map(() => "?").join(",")})`).all(...RODZAJE_NUMERU) as
    Array<{ tw_id: number; wartosc_norm: string }>) {
    if (kartoteka.has(Number(w.tw_id))) dopisz(w.wartosc_norm, Number(w.tw_id));
  }

  /* Żywe zastosowania „pasuje" — para już stoi albo czeka, więc nowej nie
     będzie (`zaproponujZastosowanie` odbije dubel). Z warunkami, żeby
     powiedzieć, gdzie wykaz mówi coś INNEGO niż baza. */
  const zywe = new Map<string, string | null>();
  for (const w of database.prepare(`SELECT z.tw_id, m.klucz, z.rok_od, z.rok_do, z.seryjny_od, z.seryjny_do, z.warunek
    FROM zastosowanie z JOIN model_urzadzenia m ON m.id=z.model_id
    WHERE z.polaryzacja='pasuje' AND z.stan IN ('propozycja','zatwierdzone')`).all() as Array<Record<string, unknown>>) {
    zywe.set(`${w.tw_id}|${w.klucz}`, zdanieWarunkow({
      rokOd: w.rok_od == null ? null : Number(w.rok_od), rokDo: w.rok_do == null ? null : Number(w.rok_do),
      seryjnyOd: w.seryjny_od == null ? null : String(w.seryjny_od),
      seryjnyDo: w.seryjny_do == null ? null : String(w.seryjny_do), warunek: w.warunek == null ? null : String(w.warunek),
    }));
  }
  const znaneModele = new Set((database.prepare("SELECT klucz FROM model_urzadzenia").all() as Array<{ klucz: string }>)
    .map((r) => r.klucz));

  const pary = new Map<string, Para>();
  const maszyny = new Set<string>();
  const brakujace = new Set<string>();
  dane.forEach((w, nr) => {
    const marka = wartosc(m.marka, w); const model = wartosc(m.model, w);
    const wariant = wartosc(m.wariant, w) || null;
    if (!marka || !model) { raport.bezMaszyny++; return; }
    /* Próg węzła zamienności (`zamiennosc-oem.ts`): krótki numer trafia
       w przypadkowe kartoteki, a tu każde trafienie to propozycja w kolejce. */
    const numery = m.numery.flatMap((i) => numeryZKomorki(w[i] ?? ""))
      .filter((n) => zwin(n).length >= MIN_ZNAKOW && (zwin(n).match(/\d/g) ?? []).length >= MIN_CYFR);
    if (numery.length === 0) { raport.bezNumerow++; return; }
    let warunki: WarunkiZastosowania;
    try {
      warunki = sprawdzWarunki({ rokOd: komorka(m.rokOd, w), rokDo: komorka(m.rokDo, w),
        seryjnyOd: komorka(m.seryjnyOd, w), seryjnyDo: komorka(m.seryjnyDo, w) });
    } catch (e) {
      /* Wiersz z zepsutym zakresem NIE wchodzi bez warunku. Wpis „pasuje"
         bez granicy, którą wykaz podawał, twierdzi więcej niż wykaz. */
      raport.bledneWarunki.liczba++;
      if (raport.bledneWarunki.przyklady.length < PRZYKLADOW) {
        raport.bledneWarunki.przyklady.push(`wiersz ${nr + 2}: ${(e as Error).message}`);
      }
      return;
    }
    const klucz = kluczModelu(m.rodzaj, marka, model, wariant);
    const etykieta = [m.rodzaj === "silnik" ? "silnik" : null, marka, model, wariant].filter(Boolean).join(" ");
    let trafil = false;
    for (const numer of numery) {
      const tw = poNumerze.get(zwin(numer));
      if (!tw) {
        if (!brakujace.has(zwin(numer))) {
          brakujace.add(zwin(numer));
          if (raport.bezKartoteki.przyklady.length < PRZYKLADOW) raport.bezKartoteki.przyklady.push(numer);
        }
        continue;
      }
      trafil = true;
      maszyny.add(klucz);
      for (const twId of tw) {
        const k = `${twId}|${klucz}`;
        const juz = pary.get(k);
        /* Ta sama część dwa razy w wykazie jednej maszyny (dwie pozycje na
           rysunku) to jedna para — dowód zbiera oba numery. Warunki bierzemy
           z pierwszego wiersza: dwa różne zakresy jednej pary to pytanie do
           człowieka, a nie coś, co import rozstrzyga sam. */
        if (juz) { if (!juz.numery.includes(numer)) juz.numery.push(numer); continue; }
        const kt = kartoteka.get(twId)!;
        pary.set(k, { twId, symbol: kt.symbol, nazwa: kt.nazwa, etykieta, numery: [numer], warunki,
          model: { rodzaj: m.rodzaj, marka, nazwa: model, wariant } });
      }
    }
    if (trafil) raport.dopasowanych++;
  });
  raport.bezKartoteki.liczba = brakujace.size;
  for (const k of maszyny) {
    if (znaneModele.has(k)) raport.maszyn.znanych++; else raport.maszyn.nowych++;
  }

  const nowe: Para[] = [];
  const naPare = (p: Para): ParaWykazu => ({ symbol: p.symbol, nazwa: p.nazwa, maszyna: p.etykieta, numery: p.numery,
    warunki: zdanieWarunkow(p.warunki) });
  for (const [k, p] of pary) {
    const klucz = k.slice(k.indexOf("|") + 1);
    if (zywe.has(`${p.twId}|${klucz}`)) {
      raport.par.znanych++;
      if (zywe.get(`${p.twId}|${klucz}`) !== zdanieWarunkow(p.warunki)) {
        raport.par.znanychInneWarunki++;
        if (raport.inneWarunki.length < PRZYKLADOW) raport.inneWarunki.push(naPare(p));
      }
      continue;
    }
    raport.par.nowych++;
    nowe.push(p);
    if (raport.przyklady.length < PRZYKLADOW) raport.przyklady.push(naPare(p));
  }
  return { nowe, raport };
}

/**
 * Podgląd albo zapis — jeden rachunek. Zapis wymaga człowieka z biura,
 * nazwy wykazu (idzie do dowodu każdej propozycji) i mapowania, które ekran
 * pokazał: zgadnięta kolumna zapisana trzystoma propozycjami to trzysta
 * pomyłek w kolejce.
 */
export function importujWykaz(
  z: ZadanieWykazu, zastosuj: boolean, userId: number | null, database: DatabaseSync = db(),
): RaportWykazu {
  const tabela = tabelaZTresci(z.tresc ?? {});
  const zgadniete = !z.mapowanie;
  const m = z.mapowanie ? sprawdzMapowanie(z.mapowanie, tabela[0].length) : zgadnijMapowanie(tabela[0]);
  const plan = planuj(database, tabela, m, zgadniete);
  const raport: RaportWykazu = { ...plan.raport, zapisano: null };
  if (!zastosuj) return raport;

  if (userId === null) throw new Error("Wykaz zapisuje człowiek z biura");
  const autor = czlowiekZBiura(database, userId);
  const zrodlo = oczysc(z.zrodlo);
  if (zrodlo.length < 3) throw new Error("Nazwij wykaz — nazwa trafia do dowodu każdej propozycji");
  if (zgadniete || !m) throw new Error("Potwierdź mapowanie kolumn przed zapisem");
  if (plan.nowe.length === 0) throw new Error("Wykaz nie daje żadnej nowej pary część → maszyna");
  const rodzajDowodu: DowodWykazu = z.rodzajDowodu === "katalog_dostawcy" ? "katalog_dostawcy" : "producent";
  const link = oczysc(z.link) || null;

  return wTransakcji(database, () => {
    const importId = Number(database.prepare(`INSERT INTO import_wykazu(zrodlo,link,plik,rodzaj,wierszy,par,propozycji,
      zaimportowal,user_id) VALUES (?,?,?,?,?,?,0,?,?)`)
      .run(zrodlo, link, oczysc(z.plik) || null, m.rodzaj, raport.wierszy, plan.nowe.length, autor, userId).lastInsertRowid);
    let propozycji = 0;
    for (const p of plan.nowe) {
      const numery = p.numery.join(", ");
      const zapis = zaproponujZastosowanie({
        twId: p.twId, model: p.model, polaryzacja: "pasuje", zrodlo: "reczne", warunki: p.warunki, importId,
        dowod: { rodzaj: rodzajDowodu, link,
          tresc: `${zrodlo}: ${p.etykieta} — ${p.numery.length > 1 ? "numery" : "numer"} ${numery}` },
      }, { userId, name: autor }, database);
      if (zapis) propozycji++;
    }
    database.prepare("UPDATE import_wykazu SET propozycji=? WHERE id=?").run(propozycji, importId);
    logEvent("wykaz_import", autor, null, { importId, zrodlo, plik: z.plik ?? null, wierszy: raport.wierszy,
      par: plan.nowe.length, propozycji, mapowanie: m }, userId, database);
    return { ...raport, zapisano: { importId, propozycji } };
  });
}

function naImport(database: DatabaseSync, w: Record<string, unknown>): ImportWykazu {
  const stany = database.prepare(`SELECT
      SUM(CASE WHEN stan='propozycja' THEN 1 ELSE 0 END) czeka,
      SUM(CASE WHEN stan='zatwierdzone' THEN 1 ELSE 0 END) zatwierdzonych
    FROM zastosowanie WHERE import_id=?`).get(Number(w.id)) as { czeka: number | null; zatwierdzonych: number | null };
  return {
    id: Number(w.id), zrodlo: String(w.zrodlo), link: w.link == null ? null : String(w.link),
    plik: w.plik == null ? null : String(w.plik), rodzaj: String(w.rodzaj) as ImportWykazu["rodzaj"],
    wierszy: Number(w.wierszy), par: Number(w.par), propozycji: Number(w.propozycji),
    czeka: Number(stany.czeka ?? 0), zatwierdzonych: Number(stany.zatwierdzonych ?? 0),
    stan: String(w.stan) as ImportWykazu["stan"], zaimportowal: String(w.zaimportowal), at: String(w.at),
    wycofal: w.wycofal == null ? null : String(w.wycofal), wycofanoAt: w.wycofano_at == null ? null : String(w.wycofano_at),
  };
}

/** Ostatnie wykazy — najnowsze pierwsze, z tym, ile z nich wciąż czeka. */
export function historiaWykazow(database: DatabaseSync = db()): ImportWykazu[] {
  return (database.prepare("SELECT * FROM import_wykazu ORDER BY id DESC LIMIT 30").all() as
    Array<Record<string, unknown>>).map((w) => naImport(database, w));
}

/**
 * Wycofanie wykazu: propozycje, które jeszcze CZEKAJĄ, schodzą na
 * `wycofane`. Zatwierdzone zostają — rozstrzygnął je człowiek przy zdjęciu
 * części i tylko człowiek je wycofa, wpis po wpisie. Wzór
 * `wycofajPropozycjeDoboru`.
 */
export function wycofajWykaz(id: number, userId: number, database: DatabaseSync = db()): ImportWykazu {
  const autor = czlowiekZBiura(database, userId);
  return wTransakcji(database, () => {
    const w = database.prepare("SELECT * FROM import_wykazu WHERE id=?").get(id) as Record<string, unknown> | undefined;
    if (!w) throw new Error("Nie ma takiego wykazu");
    if (w.stan !== "aktywny") throw new Error("Ten wykaz jest już wycofany");
    const ids = (database.prepare("SELECT id FROM zastosowanie WHERE import_id=? AND stan='propozycja'").all(id) as
      Array<{ id: number }>).map((r) => Number(r.id));
    const powod = `wycofano wykaz #${id}`;
    const upd = database.prepare(`UPDATE zastosowanie SET stan='wycofane', rozstrzygnal=?, rozstrzygnal_user_id=?,
      rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), powod_rozstrzygniecia=? WHERE id=?`);
    for (const zid of ids) upd.run(autor, userId, powod, zid);
    database.prepare(`UPDATE import_wykazu SET stan='wycofany', wycofal=?, wycofano_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=?`).run(autor, id);
    const po = naImport(database, database.prepare("SELECT * FROM import_wykazu WHERE id=?").get(id) as Record<string, unknown>);
    logEvent("wykaz_wycofanie", autor, null, { importId: id, zrodlo: po.zrodlo, wycofanePropozycje: ids,
      zostajeZatwierdzonych: po.zatwierdzonych }, userId, database);
    return po;
  });
}
