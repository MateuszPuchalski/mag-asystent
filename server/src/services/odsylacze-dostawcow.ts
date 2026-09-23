import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { zwin } from "../tekst.js";
import { logEvent } from "./events.js";
import { czlowiekZBiura, wTransakcji } from "./wiedza.js";
import { parsujCsv, wykryjSeparator } from "./zbiorki.js";
import { kandydaciZamiennosci } from "./zamiennosc-oem.js";

/**
 * Import odsyłaczy od dostawców: plik „nasz symbol ↔ numery oryginału".
 *
 * ── PO CO ─────────────────────────────────────────────────────────────────
 * Numery OEM stały dotąd tylko w opisach kartotek, wpisywane ręcznie latami.
 * Dostawcy części (Kramp, Stens, Rotary, Oregon i nasi krajowi) prowadzą to
 * samo w tabelach — setki wierszy, które wpisywaliśmy po jednym. Import
 * kładzie je do `towar_identyfikator` jako źródło `dostawca`, a stamtąd
 * działają wszędzie, gdzie działa numer z opisu: szukanie po numerze klienta,
 * szczebel OEM w doborze i węzeł zamienności przez wspólny numer oryginału.
 *
 * ── KSZTAŁT PLIKU NIE JEST ZNANY Z GÓRY ───────────────────────────────────
 * Każdy dostawca ma inne kolumny. Dlatego plik przychodzi z MAPOWANIEM:
 * która kolumna to symbol (albo EAN), a które niosą numery. Nagłówki
 * zgadujemy, człowiek poprawia. Kartotekę wskazuje nasz symbol albo EAN —
 * numer DOSTAWCY nie ma u nas pola (`tw_DostSymbol` w Subiekcie nie jest
 * zweryfikowane), więc wiersz bez naszego symbolu idzie do listy „bez
 * kartoteki", a nie do zgadywania.
 *
 * ── PODGLĄD I ZAPIS TO JEDEN RACHUNEK ─────────────────────────────────────
 * Wzór `lokalizacje-masowe.ts`: podgląd liczy raport, zapis liczy go jeszcze
 * raz i dopiero wtedy stosuje. Podgląd mówi też, ile NOWYCH par ze wspólnym
 * numerem oryginału da plik — liczy to w punkcie zapisu, który cofa.
 *
 * ── NOWY PLIK ZASTĘPUJE STARY ─────────────────────────────────────────────
 * Wiersze dostawcy giną przed wstawieniem nowych. Cennik z marca nie ma
 * prawa żyć obok cennika z września, gdy ten drugi numer wycofał. Numery
 * z opisu, ręczne i z ofert import omija (`INSERT OR IGNORE`): są starsze
 * i mają podpis człowieka.
 */

export type RodzajNumerow = "oem" | "katalog_obcy";

export interface Mapowanie {
  /** Indeks kolumny z NASZYM symbolem kartoteki. */
  symbol: number | null;
  /** Indeks kolumny z EAN — gdy symbolu brak albo nie trafia. */
  ean: number | null;
  /** Kolumny z numerami; komórka może nieść kilka. */
  numery: number[];
  /** Numery oryginału (OEM) czy katalogów obcych — węzłem zamienności jest tylko OEM. */
  rodzaj: RodzajNumerow;
}

export interface TrescImportu { csv?: string; tabela?: string[][] }

export interface ZadanieImportu {
  dostawca: string;
  plik?: string | null;
  tresc: TrescImportu;
  mapowanie?: Mapowanie | null;
}

export interface RaportImportu {
  naglowki: string[];
  /** Pierwsze wiersze danych — żeby człowiek zobaczył, co jest w kolumnach. */
  probka: string[][];
  mapowanie: Mapowanie | null;
  /** Mapowanie z nagłówków, nie od człowieka — ekran każe je sprawdzić. */
  zgadniete: boolean;
  wierszy: number;
  dopasowanych: number;
  kartotek: number;
  bezKartoteki: { liczba: number; przyklady: string[] };
  niejednoznaczne: { liczba: number; przyklady: string[] };
  bezNumerow: number;
  numerow: { nowych: number; znanych: number };
  /** Wiersze tego dostawcy, które zapis zastąpi. */
  zastapi: number;
  /** O ile zmieni się kolejka „Wspólny numer oryginału". */
  noweKandydaty: number;
  przyklady: Array<{ symbol: string; nazwa: string; numery: string[] }>;
  zapisano: { importId: number; numerow: number } | null;
}

export interface ImportOdsylaczy {
  id: number; dostawca: string; plik: string | null; wierszy: number; dopasowanych: number; numerow: number;
  stan: "aktywny" | "zastapiony" | "wycofany"; zaimportowal: string; at: string;
  wycofal: string | null; wycofanoAt: string | null;
}

/** Zapora na pomyłkowo wybrany plik — eksport całej bazy to nie tabela odsyłaczy. */
export const LIMIT_WIERSZY = 20_000;
const PROBKA = 5;
const PRZYKLADOW = 20;

const oczysc = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const bezOgonkow = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");
const cyfr = (s: string) => (s.match(/\d/g) ?? []).length;

/* ── Rozbiór ───────────────────────────────────────────────────────────── */

/** Tabela z treści: CSV z wykrytym separatorem albo gotowe wiersze z `.xlsx`. */
export function tabelaZTresci(t: TrescImportu): string[][] {
  const surowa = typeof t.csv === "string" && t.csv.trim() !== ""
    ? parsujCsv(t.csv, wykryjSeparator(t.csv))
    : Array.isArray(t.tabela) ? t.tabela : null;
  if (!surowa) throw new Error("Brak pliku — wgraj CSV albo arkusz .xlsx");
  const tabela = surowa.map((w) => (Array.isArray(w) ? w : []).map(oczysc))
    .filter((w) => w.some((k) => k !== ""));
  if (tabela.length < 2) throw new Error("Plik nie ma wierszy danych pod nagłówkiem");
  if (tabela.length - 1 > LIMIT_WIERSZY) {
    throw new Error(`Plik ma ${tabela.length - 1} wierszy — to więcej niż ${LIMIT_WIERSZY}; podziel go`);
  }
  return tabela;
}

/**
 * Zgadnięte mapowanie po nagłówkach. Tylko podpowiedź: ekran pokazuje je
 * z listami wyboru, bo „Numer" w jednym cenniku to symbol, w innym — OEM.
 */
export function zgadnijMapowanie(naglowki: string[]): Mapowanie | null {
  const h = naglowki.map(bezOgonkow);
  const znajdz = (re: RegExp) => h.findIndex((x) => re.test(x));
  const numery = h.map((x, i) => /oem|orygin|oryg\b|original|cross|referenc|odsylacz|zamienn/.test(x) ? i : -1)
    .filter((i) => i >= 0);
  let symbol = znajdz(/symbol|indeks|index|\bsku\b|kod towaru|kod produktu|nr kat|numer katalog/);
  if (numery.includes(symbol)) symbol = -1;
  const ean = znajdz(/\bean\b|kod kreskowy|gtin|barcode/);
  if (numery.length === 0 || (symbol < 0 && ean < 0)) return null;
  /* Kolumna „zamienniki" bez słowa o oryginale to numery innych katalogów —
     słabsze świadectwo, które węzłem zamienności nie jest. */
  const tylkoZamienniki = numery.every((i) => /zamienn|cross|referenc/.test(h[i]) && !/oem|oryg|original/.test(h[i]));
  return { symbol: symbol >= 0 ? symbol : null, ean: ean >= 0 ? ean : null, numery,
    rodzaj: tylkoZamienniki ? "katalog_obcy" : "oem" };
}

/**
 * Numery z jednej komórki.
 *
 * Kawałki dzieli przecinek, średnik, pionowa kreska, nowa linia i ukośnik
 * między dwoma długimi członami — reguła `identyfikatory.ts`. SPACJA to
 * osobny problem: STIHL pisze `1130 400 1300`, Husqvarna `532 16 56-30`,
 * a lista bywa rozdzielona samą spacją (`499486S 806232`). Reguła: słowa
 * bez cyfr (marka) odpadają; gdy każde z pozostałych ma najwyżej pięć
 * znaków, to jeden numer; gdy któreś jest dłuższe — lista osobnych numerów.
 * Na końcu filtr opisu kartoteki: co najmniej cztery znaki i dwie cyfry.
 */
export function numeryZKomorki(komorka: string): string[] {
  const out: string[] = [];
  const widziane = new Set<string>();
  const dodaj = (s: string) => {
    const w = s.trim();
    const n = zwin(w);
    if (w.length < 4 || cyfr(w) < 2 || !n || widziane.has(n)) return;
    widziane.add(n);
    out.push(w);
  };
  const kawalki = String(komorka ?? "")
    .split(/\s*[,;|\n\r\\]\s*/)
    .flatMap((k) => k.split(/(?<=[A-Za-z0-9]{3})\s*\/\s*(?=[A-Za-z0-9]{3})/));
  for (const k of kawalki) {
    const slowa = k.trim().split(/\s+/).filter((s) => /\d/.test(s));
    if (slowa.length === 0) continue;
    if (slowa.every((s) => s.length <= 5)) dodaj(slowa.join(" "));
    else for (const s of slowa) dodaj(s);
  }
  return out;
}

function sprawdzMapowanie(m: Mapowanie, kolumn: number): Mapowanie {
  const w = (i: number | null) => i === null || (Number.isInteger(i) && i >= 0 && i < kolumn);
  if (!w(m.symbol) || !w(m.ean) || !Array.isArray(m.numery) || !m.numery.every((i) => w(i))) {
    throw new Error("Mapowanie wskazuje kolumnę, której w pliku nie ma");
  }
  if (m.symbol === null && m.ean === null) throw new Error("Wskaż kolumnę z naszym symbolem albo z EAN");
  if (m.numery.length === 0) throw new Error("Wskaż co najmniej jedną kolumnę z numerami");
  if (m.numery.some((i) => i === m.symbol || i === m.ean)) {
    throw new Error("Kolumna symbolu albo EAN nie może być jednocześnie kolumną numerów");
  }
  if (m.rodzaj !== "oem" && m.rodzaj !== "katalog_obcy") throw new Error("Rodzaj numerów to oem albo katalog_obcy");
  return { symbol: m.symbol, ean: m.ean, numery: [...new Set(m.numery)], rodzaj: m.rodzaj };
}

/* ── Rachunek ──────────────────────────────────────────────────────────── */

interface Plan {
  wiersze: Array<{ twId: number; symbol: string; wartosc: string; norm: string; rodzaj: RodzajNumerow }>;
  raport: Omit<RaportImportu, "noweKandydaty" | "zapisano" | "zastapi">;
}

function planuj(database: DatabaseSync, dostawca: string, t: string[][], m: Mapowanie | null, zgadniete: boolean): Plan {
  const [naglowki, ...dane] = t;
  const pusty = { liczba: 0, przyklady: [] as string[] };
  const raport: Plan["raport"] = {
    naglowki, probka: dane.slice(0, PROBKA), mapowanie: m, zgadniete, wierszy: dane.length, dopasowanych: 0,
    kartotek: 0, bezKartoteki: { ...pusty, przyklady: [] }, niejednoznaczne: { ...pusty, przyklady: [] },
    bezNumerow: 0, numerow: { nowych: 0, znanych: 0 }, przyklady: [],
  };
  if (!m) return { wiersze: [], raport };

  /* Symbol → kartoteka i EAN → kartoteka raz na rachunek; `null` = zdublowany,
     a zdublowany nie ma prawa wskazać cudzej części (`kartotekaPoSku`). */
  const poSymbolu = new Map<string, { twId: number; symbol: string; nazwa: string } | null>();
  const poEan = new Map<string, { twId: number; symbol: string; nazwa: string } | null>();
  for (const w of database.prepare("SELECT tw_id, symbol, nazwa, ean FROM sgt_towar").all() as
    Array<{ tw_id: number; symbol: string; nazwa: string; ean: string | null }>) {
    const k = { twId: Number(w.tw_id), symbol: w.symbol, nazwa: w.nazwa };
    const s = w.symbol.trim().toUpperCase();
    poSymbolu.set(s, poSymbolu.has(s) ? null : k);
    const e = (w.ean ?? "").replace(/\D/g, "");
    if (e.length >= 8) poEan.set(e, poEan.has(e) ? null : k);
  }
  /* Istniejące wiersze SPOZA tego dostawcy — tylko one są „znane" po zapisie,
     bo własne wiersze dostawcy import zastąpi. */
  const znane = new Set((database.prepare(`SELECT tw_id, rodzaj, wartosc_norm FROM towar_identyfikator
    WHERE NOT (zrodlo='dostawca' AND dostawca = ? COLLATE NOCASE)`).all(dostawca) as
    Array<{ tw_id: number; rodzaj: string; wartosc_norm: string }>).map((r) => `${r.tw_id}|${r.rodzaj}|${r.wartosc_norm}`));

  const wiersze: Plan["wiersze"] = [];
  const klucze = new Set<string>();
  const kartoteki = new Set<number>();
  const przyklady = new Map<number, { symbol: string; nazwa: string; numery: string[] }>();
  for (const w of dane) {
    const sym = m.symbol !== null ? w[m.symbol] ?? "" : "";
    const ean = m.ean !== null ? (w[m.ean] ?? "").replace(/\D/g, "") : "";
    const zSymbolu = sym ? poSymbolu.get(sym.toUpperCase()) : undefined;
    const zEan = ean ? poEan.get(ean) : undefined;
    const k = zSymbolu ?? zEan;
    const opisWiersza = sym || ean || "(pusty)";
    if (!k) {
      const lista = zSymbolu === null || zEan === null ? raport.niejednoznaczne : raport.bezKartoteki;
      lista.liczba++;
      if (lista.przyklady.length < PRZYKLADOW) lista.przyklady.push(opisWiersza);
      continue;
    }
    const numery = m.numery.flatMap((i) => numeryZKomorki(w[i] ?? ""))
      .filter((n) => zwin(n) !== zwin(k.symbol));
    if (numery.length === 0) { raport.bezNumerow++; continue; }
    raport.dopasowanych++;
    kartoteki.add(k.twId);
    for (const wartosc of numery) {
      const norm = zwin(wartosc);
      const klucz = `${k.twId}|${m.rodzaj}|${norm}`;
      if (klucze.has(klucz)) continue;
      klucze.add(klucz);
      if (znane.has(klucz)) { raport.numerow.znanych++; continue; }
      raport.numerow.nowych++;
      wiersze.push({ twId: k.twId, symbol: k.symbol, wartosc, norm, rodzaj: m.rodzaj });
      const p = przyklady.get(k.twId) ?? { symbol: k.symbol, nazwa: k.nazwa, numery: [] };
      p.numery.push(wartosc);
      przyklady.set(k.twId, p);
    }
  }
  raport.kartotek = kartoteki.size;
  raport.przyklady = [...przyklady.values()].slice(0, PRZYKLADOW);
  return { wiersze, raport };
}

function wstaw(database: DatabaseSync, dostawca: string, plan: Plan, autor: string, userId: number | null,
  importId: number | null): number {
  database.prepare("DELETE FROM towar_identyfikator WHERE zrodlo='dostawca' AND dostawca = ? COLLATE NOCASE").run(dostawca);
  const ins = database.prepare(`INSERT OR IGNORE INTO towar_identyfikator
    (tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal,dodal_user_id,dostawca,import_id)
    VALUES (?,?,?,?,?,'dostawca',?,?,?,?)`);
  let n = 0;
  for (const w of plan.wiersze) n += Number(ins.run(w.twId, w.symbol, w.rodzaj, w.wartosc, w.norm, autor, userId, dostawca, importId).changes);
  return n;
}

/**
 * Podgląd albo zapis. Bez mapowania od człowieka używa zgadniętego — i mówi
 * to w raporcie. Zapis wymaga mapowania jawnie potwierdzonego przez ekran:
 * zgadnięta kolumna wpisana setkami do bazy to pomyłka na setki wierszy.
 */
export function importujOdsylacze(
  z: ZadanieImportu, zastosuj: boolean, userId: number | null, database: DatabaseSync = db(),
): RaportImportu {
  const dostawca = oczysc(z.dostawca);
  const tabela = tabelaZTresci(z.tresc ?? {});
  const zgadniete = !z.mapowanie;
  const m = z.mapowanie ? sprawdzMapowanie(z.mapowanie, tabela[0].length) : zgadnijMapowanie(tabela[0]);
  const plan = planuj(database, dostawca, tabela, m, zgadniete);
  const zastapi = (database.prepare(`SELECT count(*) n FROM towar_identyfikator
    WHERE zrodlo='dostawca' AND dostawca = ? COLLATE NOCASE`).get(dostawca) as { n: number }).n;

  /* Nowi kandydaci na zamienność: ten sam zapis w punkcie zapisu, który cofamy.
     SAVEPOINT, nie BEGIN — działa także wewnątrz cudzej transakcji. */
  const przed = kandydaciZamiennosci(database).liczba;
  let po = przed;
  if (m && plan.wiersze.length + zastapi > 0) {
    database.exec("SAVEPOINT symulacja_odsylaczy");
    try {
      wstaw(database, dostawca, plan, "symulacja", null, null);
      po = kandydaciZamiennosci(database).liczba;
    } finally {
      database.exec("ROLLBACK TO symulacja_odsylaczy");
      database.exec("RELEASE symulacja_odsylaczy");
    }
  }
  const raport: RaportImportu = { ...plan.raport, zastapi, noweKandydaty: po - przed, zapisano: null };
  if (!zastosuj) return raport;

  if (userId === null) throw new Error("Import zapisuje człowiek z biura");
  const autor = czlowiekZBiura(database, userId);
  if (dostawca.length < 2) throw new Error("Podaj nazwę dostawcy — po niej nowy plik zastąpi stary");
  if (zgadniete) throw new Error("Potwierdź mapowanie kolumn przed zapisem");
  if (raport.dopasowanych === 0) throw new Error("Żaden wiersz nie trafił w kartotekę — nie ma czego zapisać");

  return wTransakcji(database, () => {
    database.prepare(`UPDATE import_odsylaczy SET stan='zastapiony' WHERE dostawca = ? COLLATE NOCASE AND stan='aktywny'`)
      .run(dostawca);
    const importId = Number(database.prepare(`INSERT INTO import_odsylaczy(dostawca,plik,wierszy,dopasowanych,numerow,
      zaimportowal,user_id) VALUES (?,?,?,?,?,?,?)`)
      .run(dostawca, oczysc(z.plik) || null, raport.wierszy, raport.dopasowanych, 0, autor, userId).lastInsertRowid);
    const numerow = wstaw(database, dostawca, plan, autor, userId, importId);
    database.prepare("UPDATE import_odsylaczy SET numerow=? WHERE id=?").run(numerow, importId);
    logEvent("odsylacze_import", autor, null, { importId, dostawca, plik: z.plik ?? null, wierszy: raport.wierszy,
      dopasowanych: raport.dopasowanych, numerow, zastapiono: zastapi, mapowanie: m }, userId, database);
    return { ...raport, zapisano: { importId, numerow } };
  });
}

const naImport = (w: Record<string, unknown>): ImportOdsylaczy => ({
  id: Number(w.id), dostawca: String(w.dostawca), plik: w.plik == null ? null : String(w.plik),
  wierszy: Number(w.wierszy), dopasowanych: Number(w.dopasowanych), numerow: Number(w.numerow),
  stan: String(w.stan) as ImportOdsylaczy["stan"], zaimportowal: String(w.zaimportowal), at: String(w.at),
  wycofal: w.wycofal == null ? null : String(w.wycofal), wycofanoAt: w.wycofano_at == null ? null : String(w.wycofano_at),
});

/** Ostatnie importy — najnowsze pierwsze. */
export function historiaImportow(database: DatabaseSync = db()): ImportOdsylaczy[] {
  return (database.prepare("SELECT * FROM import_odsylaczy ORDER BY id DESC LIMIT 30").all() as
    Array<Record<string, unknown>>).map(naImport);
}

/**
 * Wycofanie AKTYWNEGO importu w całości: jego wiersze giną, historia zostaje.
 * Zastąpionego nie wycofuje się — jego wiersze zniknęły już przy następnym
 * pliku, a przywracanie starego cennika to wgranie go jeszcze raz.
 */
export function wycofajImport(id: number, userId: number, database: DatabaseSync = db()): ImportOdsylaczy {
  const autor = czlowiekZBiura(database, userId);
  return wTransakcji(database, () => {
    const w = database.prepare("SELECT * FROM import_odsylaczy WHERE id=?").get(id) as Record<string, unknown> | undefined;
    if (!w) throw new Error("Nie ma takiego importu");
    if (w.stan !== "aktywny") throw new Error("Wycofać można tylko aktywny import — ten został już zastąpiony albo wycofany");
    const usunieto = Number(database.prepare("DELETE FROM towar_identyfikator WHERE zrodlo='dostawca' AND import_id=?").run(id).changes);
    database.prepare(`UPDATE import_odsylaczy SET stan='wycofany', wycofal=?, wycofano_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=?`).run(autor, id);
    const po = naImport(database.prepare("SELECT * FROM import_odsylaczy WHERE id=?").get(id) as Record<string, unknown>);
    logEvent("odsylacze_wycofanie", autor, null, { importId: id, dostawca: po.dostawca, usunieto }, userId, database);
    return po;
  });
}
