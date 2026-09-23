import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { logEvent } from "./events.js";
import { podzielZamienniki } from "./zamienniki.js";
import {
  czlowiekZBiura, dzien, podpisRozstrzygniecia, WiedzaConflict, wTransakcji, type Rozstrzygajacy,
} from "./wiedza.js";

/**
 * Zamienność przez wspólny numer OEM: dwie kartoteki, jeden numer oryginału.
 *
 * ── PO CO ─────────────────────────────────────────────────────────────────
 * Zamiennik stał dotąd wyłącznie w wolnym tekście opisu kartoteki. Katalogi
 * motoryzacyjne robią to inaczej: część z rynku wtórnego wskazuje numer
 * oryginału, a dwie części wskazujące ten sam numer są zamienne bez
 * wpisywania każdej pary. Numery mamy od E3 w `towar_identyfikator` — ten
 * plik robi z nich węzeł.
 *
 * ── KANDYDAT PRZY ODCZYCIE, DECYZJA W TABELI ──────────────────────────────
 * Pomiar na seedzie z 23 września 2026 (ponad trzy tysiące kartotek): numery
 * OEM i oryginalne dzieli 137 par, 78 z nich zna już opis. Z pozostałych mniej
 * więcej połowa to NIE zamienniki — nóż lewy i prawy, filtr główny i wstępny,
 * zestaw i jego nakrętka, bęben 3/8" i .325", dysze o sąsiednich numerach.
 * Dlatego automat tylko proponuje, a zamiennikiem para staje się dopiero po
 * decyzji człowieka. Kandydata nie zapisujemy: import zmienia opisy, a lista
 * liczona przy odczycie zmienia się w tej samej sekundzie.
 *
 * ── HIERARCHIA PLIKÓW ─────────────────────────────────────────────────────
 * Importuje `wiedza.ts` i `zamienniki.ts`; importują go
 * `pasowania.ts` i `kandydaci.ts`. Nigdy odwrotnie.
 */

/** Rodzaje identyfikatora, które są numerem ORYGINAŁU. Sekcja zamienników
 *  (`zamiennik`) i katalogi obce to słabsze świadectwo i węzłem nie są. */
export const RODZAJE_WEZLA = ["oem", "nr_oryg"] as const;

/**
 * Filtr śmieci. Z pomiaru: jako „OEM" wczytały się modele maszyn (`245R`,
 * `272XP`, `MS210`) i kody bez znaczenia (`0000`, `1800`, `1307`). Numer
 * oryginału ma zwykle sześć do trzynastu znaków i przewagę cyfr.
 */
export const MIN_ZNAKOW = 6;
export const MIN_CYFR = 5;

/**
 * Numer wspólny dla więcej niż tylu kartotek to rodzina, nie zamienność.
 * Z pomiaru: każda grupa czterech była błędna (noże lewe, prawe i mielące
 * pod jednym numerem, filtr główny z trzema wstępnymi).
 */
export const MAX_GRUPA = 3;

export interface KartotekaZamiennosci { twId: number; symbol: string; nazwa: string }

export interface KandydatZamiennosci {
  a: KartotekaZamiennosci;
  b: KartotekaZamiennosci;
  /** Wspólne numery w zapisie z opisu — po nich człowiek rozstrzyga. */
  numery: string[];
}

export type StanZamiennosci = "zatwierdzone" | "odrzucone" | "wycofane";

export interface Zamiennosc {
  id: number;
  a: KartotekaZamiennosci;
  b: KartotekaZamiennosci;
  stan: StanZamiennosci;
  numery: string[];
  powod: string | null;
  rozstrzygnal: string;
  rozstrzygnietoAt: string;
  wycofal: string | null;
  wycofanoAt: string | null;
  powodWycofania: string | null;
  /** Zdanie źródła dla ekranu, szkicu i sieci — panel go nie układa. */
  zdanie: string;
}

const oczysc = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};
const cyfr = (s: string) => (s.match(/\d/g) ?? []).length;
const para = (x: number, y: number): [number, number] => x < y ? [x, y] : [y, x];

function kartoteka(database: DatabaseSync, twId: number): (KartotekaZamiennosci & { opis: string }) | null {
  const w = database.prepare("SELECT tw_id, symbol, nazwa, opis FROM sgt_towar WHERE tw_id=?").get(twId) as
    { tw_id: number; symbol: string; nazwa: string; opis: string | null } | undefined;
  return w ? { twId: Number(w.tw_id), symbol: w.symbol, nazwa: w.nazwa, opis: w.opis ?? "" } : null;
}

/**
 * Symbol → kartoteka, wczytane RAZ na wywołanie. `null` = symbol zdublowany
 * w Subiekcie — taki nie ma prawa wskazać cudzej części, jak w `kartotekaPoSku`.
 *
 * Dlaczego nie `kartotekaPoSku` na każdy token: zapytanie z `TRIM(symbol)`
 * przegląda cały indeks (0,27 ms), parser opisu pyta kilkadziesiąt razy na
 * opis, a kolejka seeda liczyła się przez to 350 ms — przy odświeżaniu co 30 s.
 */
function slownikSymboli(database: DatabaseSync): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const w of database.prepare("SELECT tw_id, symbol FROM sgt_towar").all() as Array<{ tw_id: number; symbol: string }>) {
    const k = w.symbol.trim().toUpperCase();
    m.set(k, m.has(k) ? null : Number(w.tw_id));
  }
  return m;
}

type Pamiec = { slownik: Map<string, number | null>; zOpisu: Map<number, Set<number>> };
const nowaPamiec = (database: DatabaseSync): Pamiec => ({ slownik: slownikSymboli(database), zOpisu: new Map() });

/** Kartoteki, które opis TEJ kartoteki wymienia jako zamienniki. */
function zOpisu(p: Pamiec, x: KartotekaZamiennosci & { opis: string }): Set<number> {
  const juz = p.zOpisu.get(x.twId);
  if (juz) return juz;
  const wynik = new Set<number>();
  if (x.opis !== "") {
    for (const s of podzielZamienniki(x.opis, x.symbol, (q) => p.slownik.has(q.trim().toUpperCase())).znane) {
      const tw = p.slownik.get(s.trim().toUpperCase());
      if (tw != null) wynik.add(tw);
    }
  }
  p.zOpisu.set(x.twId, wynik);
  return wynik;
}

/** Czy opis JEDNEJ z kartotek już wymienia drugą — wtedy para nie jest nowa. */
function znaneZOpisu(p: Pamiec, a: KartotekaZamiennosci & { opis: string }, b: KartotekaZamiennosci & { opis: string }): boolean {
  return zOpisu(p, a).has(b.twId) || zOpisu(p, b).has(a.twId);
}

/**
 * Wspólne numery węzła, pogrupowane po parze kartotek. Filtr śmieci i próg
 * grupy stoją tu, a nie w kandydatach — decyzja przez trasę przechodzi przez
 * ten sam sprawdzian co lista na ekranie.
 */
function wspolneNumery(database: DatabaseSync, tylko?: [number, number]): Map<string, string[]> {
  const rodzaje = RODZAJE_WEZLA.map(() => "?").join(",");
  const grupy = database.prepare(`SELECT wartosc_norm, MIN(wartosc) AS wartosc, group_concat(DISTINCT tw_id) AS tw
      FROM towar_identyfikator WHERE rodzaj IN (${rodzaje}) AND length(wartosc_norm) >= ?
      GROUP BY wartosc_norm HAVING count(DISTINCT tw_id) BETWEEN 2 AND ?
      ORDER BY wartosc_norm`)
    .all(...RODZAJE_WEZLA, MIN_ZNAKOW, MAX_GRUPA) as Array<{ wartosc_norm: string; wartosc: string; tw: string }>;
  const pary = new Map<string, string[]>();
  for (const g of grupy) {
    if (cyfr(g.wartosc_norm) < MIN_CYFR) continue;
    const tw = [...new Set(g.tw.split(",").map(Number))].sort((x, y) => x - y);
    for (let i = 0; i < tw.length; i++) {
      for (let j = i + 1; j < tw.length; j++) {
        if (tylko && (tw[i] !== tylko[0] || tw[j] !== tylko[1])) continue;
        const k = `${tw[i]}~${tw[j]}`;
        pary.set(k, [...(pary.get(k) ?? []), g.wartosc]);
      }
    }
  }
  return pary;
}

const SELECT = `SELECT z.*, a.nazwa AS a_nazwa, b.nazwa AS b_nazwa FROM zamiennosc_oem z
  LEFT JOIN sgt_towar a ON a.tw_id = z.tw_a LEFT JOIN sgt_towar b ON b.tw_id = z.tw_b`;

function naZamiennosc(w: Record<string, unknown>): Zamiennosc {
  const a = { twId: Number(w.tw_a), symbol: String(w.tw_a_symbol), nazwa: String(w.a_nazwa ?? w.tw_a_symbol) };
  const b = { twId: Number(w.tw_b), symbol: String(w.tw_b_symbol), nazwa: String(w.b_nazwa ?? w.tw_b_symbol) };
  const numery = JSON.parse(String(w.numery)) as string[];
  const stan = String(w.stan) as StanZamiennosci;
  const kto = `${String(w.rozstrzygnal)}, ${dzien(String(w.rozstrzygnieto_at))}`;
  const wspolne = `${numery.length > 1 ? "wspólne numery oryginału" : "wspólny numer oryginału"} ${numery.join(", ")}`;
  const zdanie = stan === "odrzucone"
    ? `${a.symbol} i ${b.symbol} NIE są zamienne mimo ${numery.length > 1 ? "wspólnych numerów" : "wspólnego numeru"} ${numery.join(", ")}: ${String(w.powod)} — ${kto}`
    : `${a.symbol} i ${b.symbol} są zamienne: ${wspolne} — zatwierdził ${kto}`;
  return {
    id: Number(w.id), a, b, stan, numery, powod: w.powod == null ? null : String(w.powod),
    rozstrzygnal: String(w.rozstrzygnal), rozstrzygnietoAt: String(w.rozstrzygnieto_at),
    wycofal: w.wycofal == null ? null : String(w.wycofal),
    wycofanoAt: w.wycofano_at == null ? null : String(w.wycofano_at),
    powodWycofania: w.powod_wycofania == null ? null : String(w.powod_wycofania),
    zdanie,
  };
}

export function zamiennosc(id: number, database: DatabaseSync = db()): Zamiennosc | null {
  const w = database.prepare(`${SELECT} WHERE z.id=?`).get(id) as Record<string, unknown> | undefined;
  return w ? naZamiennosc(w) : null;
}

function zywaDecyzja(database: DatabaseSync, a: number, b: number): Zamiennosc | null {
  const w = database.prepare(`${SELECT} WHERE z.tw_a=? AND z.tw_b=? AND z.stan IN ('zatwierdzone','odrzucone')`)
    .get(a, b) as Record<string, unknown> | undefined;
  return w ? naZamiennosc(w) : null;
}

/**
 * Kolejka kandydatów: pary ze wspólnym numerem oryginału, bez żywej decyzji
 * i bez tych, które opis już zna. Najwięcej wspólnych numerów pierwsze —
 * W09-1307 i 76-080 dzielą cztery numery i to jest prawie pewne, a nakrętka
 * dzieli z zestawem jeden.
 */
export function kandydaciZamiennosci(database: DatabaseSync = db()): { kandydaci: KandydatZamiennosci[]; liczba: number } {
  const decyzje = new Set((database.prepare(
    "SELECT tw_a, tw_b FROM zamiennosc_oem WHERE stan IN ('zatwierdzone','odrzucone')").all() as
    Array<{ tw_a: number; tw_b: number }>).map((d) => `${d.tw_a}~${d.tw_b}`));
  const kandydaci: KandydatZamiennosci[] = [];
  const pamiec = nowaPamiec(database);
  for (const [k, numery] of wspolneNumery(database)) {
    if (decyzje.has(k)) continue;
    const [x, y] = k.split("~").map(Number);
    const a = kartoteka(database, x); const b = kartoteka(database, y);
    if (!a || !b || znaneZOpisu(pamiec, a, b)) continue;
    kandydaci.push({ a: { twId: a.twId, symbol: a.symbol, nazwa: a.nazwa },
      b: { twId: b.twId, symbol: b.symbol, nazwa: b.nazwa }, numery });
  }
  kandydaci.sort((p, q) => q.numery.length - p.numery.length || p.a.symbol.localeCompare(q.a.symbol, "pl"));
  return { kandydaci, liczba: kandydaci.length };
}

/**
 * Zatwierdzone zamienniki kartoteki przez wspólny numer. Symetrycznie: para
 * nie ma kierunku, więc kartoteka widzi drugą stronę bez względu na kolejność.
 */
export function zamiennicyOem(twId: number, database: DatabaseSync = db()): Array<{
  kartoteka: KartotekaZamiennosci; zamiennosc: Zamiennosc;
}> {
  return (database.prepare(`${SELECT} WHERE (z.tw_a=? OR z.tw_b=?) AND z.stan='zatwierdzone' ORDER BY z.id`)
    .all(twId, twId) as Array<Record<string, unknown>>).map(naZamiennosc)
    .map((z) => ({ kartoteka: z.a.twId === twId ? z.b : z.a, zamiennosc: z }));
}

/** Żywe decyzje kartoteki — zatwierdzone i odrzucone — dla „Sprawdź kartotekę". */
export function zamiennosciTowaru(twId: number, database: DatabaseSync = db()): Zamiennosc[] {
  return (database.prepare(`${SELECT} WHERE (z.tw_a=? OR z.tw_b=?) AND z.stan IN ('zatwierdzone','odrzucone')
    ORDER BY z.stan DESC, z.id`).all(twId, twId) as Array<Record<string, unknown>>).map(naZamiennosc);
}

/* ── Mutacje ───────────────────────────────────────────────────────────── */

/**
 * Decyzja o parze. Wyłącznie o parze, która JEST dziś kandydatem: trasa nie
 * jest furtką do dopisania dowolnego zamiennika bez wspólnego numeru.
 * Odrzucenie wymaga powodu — bez niego za rok nikt nie odróżni „sprawdzone,
 * nie pasuje" od „ktoś kliknął".
 */
export function rozstrzygnijZamiennosc(
  twA: number, twB: number, decyzja: "zatwierdz" | "odrzuc", powod: string | null | undefined,
  kto: Rozstrzygajacy, database: DatabaseSync = db(),
): Zamiennosc {
  const { name: autor, userId } = podpisRozstrzygniecia(database, kto);
  if (decyzja !== "zatwierdz" && decyzja !== "odrzuc") throw new Error("Decyzja to zatwierdz albo odrzuc");
  if (!Number.isInteger(twA) || !Number.isInteger(twB) || twA === twB) throw new Error("Para to dwie różne kartoteki");
  const uzasadnienie = oczysc(powod);
  if (decyzja === "odrzuc" && !uzasadnienie) {
    throw new Error("Odrzucenie wymaga powodu — „lewy i prawy” mówi więcej niż samo „nie”");
  }
  const [a, b] = para(twA, twB);
  return wTransakcji(database, () => {
    const juz = zywaDecyzja(database, a, b);
    if (juz) {
      throw new WiedzaConflict(`O tej parze zdecydował już ${juz.rozstrzygnal}`,
        { stan: juz.stan, rozstrzygnal: juz.rozstrzygnal, rozstrzygnietoAt: juz.rozstrzygnietoAt });
    }
    const numery = wspolneNumery(database, [a, b]).get(`${a}~${b}`);
    if (!numery) throw new Error("Te kartoteki nie mają dziś wspólnego numeru oryginału — nie ma o czym decydować");
    const ka = kartoteka(database, a); const kb = kartoteka(database, b);
    if (!ka || !kb) throw new Error("Nie ma takiej kartoteki w Subiekcie");
    const id = Number(database.prepare(`INSERT INTO zamiennosc_oem(tw_a,tw_a_symbol,tw_b,tw_b_symbol,stan,numery,
      powod,rozstrzygnal,rozstrzygnal_user_id) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(a, ka.symbol, b, kb.symbol, decyzja === "zatwierdz" ? "zatwierdzone" : "odrzucone",
        JSON.stringify(numery), uzasadnienie, autor, userId).lastInsertRowid);
    const z = zamiennosc(id, database)!;
    logEvent("zamiennosc_oem_rozstrzygniecie", autor, a, { decyzja, zamiennosc: z }, userId, database);
    return z;
  });
}

/**
 * Wycofanie decyzji — para wraca do kolejki kandydatów, jeśli dalej dzieli
 * numer. Wycofanie ODRZUCENIA wymaga powodu: to zdjęcie ostrzeżenia, reguła
 * §14.2 jak przy negatywnym pasowaniu. Zatwierdzenie schodzi bez powodu.
 */
export function wycofajZamiennosc(
  id: number, powod: string | null | undefined, userId: number, database: DatabaseSync = db(),
): Zamiennosc {
  const autor = czlowiekZBiura(database, userId);
  const uzasadnienie = oczysc(powod);
  return wTransakcji(database, () => {
    const z = zamiennosc(id, database);
    if (!z) throw new Error("Nie znaleziono decyzji o zamienności");
    if (z.stan === "wycofane") throw new Error("Ta decyzja jest już wycofana");
    if (z.stan === "odrzucone" && !uzasadnienie) {
      throw new Error("Odrzucenie wycofuje się wyłącznie z powodem — to ostrzeżenie, nie brak danych");
    }
    database.prepare(`UPDATE zamiennosc_oem SET stan='wycofane', wycofal=?, wycofal_user_id=?,
      wycofano_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), powod_wycofania=? WHERE id=?`)
      .run(autor, userId, uzasadnienie, id);
    const po = zamiennosc(id, database)!;
    logEvent("zamiennosc_oem_wycofanie", autor, po.a.twId, { powod: uzasadnienie, zamiennosc: po }, userId, database);
    return po;
  });
}
