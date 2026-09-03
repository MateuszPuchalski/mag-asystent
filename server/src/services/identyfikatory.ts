import type { DatabaseSync } from "node:sqlite";
import { db, ftsDostepne, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { zwin } from "../tekst.js";
import { oczysc, segmentyPoEtykiecie } from "./opis-sekcje.js";
import {
  czlowiekZBiura, WiedzaConflict, zaproponujZastosowanie, type DaneModelu, type Zastosowanie,
} from "./wiedza.js";

/**
 * Identyfikatory części z opisów kartotek (§11.2, etap E3).
 *
 * Parser zamienników od 0.61.0 czyta te same opisy i WYRZUCA wszystko, co nie
 * jest naszym symbolem: z 2304 tokenów sekcji zamienników 478 trafiało
 * w kartotekę, reszta to numery OEM i katalogi obcych producentów. Ten plik
 * zatrzymuje je w `towar_identyfikator`, żeby numer z pytania klienta
 * prowadził do towaru W DRUGĄ STRONĘ: numer → kartoteka. Przy odczycie byłby
 * to skan 2255 opisów regexem na każde pytanie, stąd tabela pochodna
 * przebudowywana po imporcie (`po-imporcie.ts`).
 *
 * Sekcje `Modele:` idą osobno, do `model_z_opisu`: decyzją właściciela
 * automat nie zgaduje marki z `FS450` ani `236; 240` — model wskazuje
 * człowiek i dopiero wtedy powstaje propozycja zastosowania.
 */

export type RodzajIdentyfikatora = "oem" | "nr_oryg" | "katalog_obcy" | "stare_sku";
export const RODZAJE_IDENTYFIKATORA: RodzajIdentyfikatora[] = ["oem", "nr_oryg", "katalog_obcy", "stare_sku"];
export const NAZWA_RODZAJU: Record<RodzajIdentyfikatora, string> = {
  oem: "OEM", nr_oryg: "nr oryginału", katalog_obcy: "katalog obcy", stare_sku: "stare SKU",
};

/* Etykiety Z DWUKROPKIEM — bez niego `OEM` w prozie („silnik OEM Honda")
   byłoby etykietą. Koniec sekcji rozstrzyga `KONIEC_SEKCJI` z `opis-sekcje.ts`,
   nie whitelista (decyzja 0.61.0). `katalog_obcy` parsera nie ma — to
   rezerwa dla wpisu ręcznego biura. */
const ETYKIETY: Array<{ rodzaj: RodzajIdentyfikatora; re: RegExp }> = [
  { rodzaj: "oem", re: /\bOEM\s*:/gi },
  { rodzaj: "nr_oryg", re: /\b(?:nr\.?\s*oryg(?:inaln[ya]|\.)?|numery?\s+(?:cz[eę][sś]ci\s+)?oryginaln(?:y|ej)(?:\s+cz[eę][sś]ci)?)\s*:/gi },
  { rodzaj: "stare_sku", re: /\bstare\s+sku\s*:/gi },
];
const MODELE = /\bmodel[e]?\s*:/gi;

/** Zapora na patologiczny opis — jak `LIMIT_KANDYDATOW` w zamiennikach. */
const LIMIT_NA_OPIS = 40;

/**
 * Cyfry ze spacjami to JEDEN numer, gdy każda grupa ma ≤ 3 cyfry
 * (`532 16 56-30`, `14 083 26-S` — zapis Husqvarny). `84001990 259291` to
 * dwa numery: grupy po 8 i 6 cyfr. Bez tej reguły tabela zapełniłaby się
 * śmieciami typu `19`, a bez wyjątku dla dużych grup sklejałaby listy.
 */
const JEDEN_NUMER_ZE_SPACJAMI = /^(?:\d{1,3} )+\d{1,3}(?:-[A-Za-z0-9]+)?$/;

function kawalkiSekcji(sekcja: string): string[] {
  /* `//`, przecinek, średnik zawsze dzielą. Pojedynczy `/` dzieli tylko między
     dwoma „długimi" członami (`2505002 / AM108356`); `81001145/0` zostaje
     jednym numerem, bo sufiks `/0` to część zapisu GGP. */
  return sekcja
    .split(/\s*\/\/\s*|\s*[,;|\\]\s*/)
    .flatMap((k) => k.split(/(?<=[A-Za-z0-9]{3})\s*\/\s*(?=[A-Za-z0-9]{3})/));
}

function tokenyIdentyfikatorow(sekcja: string): string[] {
  const out: string[] = [];
  for (const surowy of kawalkiSekcji(sekcja)) {
    const k = surowy.trim().replace(/\s+/g, " ");
    if (!k) continue;
    if (JEDEN_NUMER_ZE_SPACJAMI.test(k)) { out.push(k); continue; }
    for (const t of k.split(" ")) if (/\d/.test(t)) out.push(t);
  }
  return out;
}

export interface IdentyfikatorZOpisu { rodzaj: RodzajIdentyfikatora; wartosc: string }

/** Identyfikatory z opisu jednej kartoteki. Czysta funkcja, bez bazy. */
export function identyfikatoryZOpisu(desc: string, wlasnySymbol: string): IdentyfikatorZOpisu[] {
  const wlasny = zwin(wlasnySymbol);
  const widziane = new Set<string>();
  const out: IdentyfikatorZOpisu[] = [];
  for (const { rodzaj, re } of ETYKIETY) {
    for (const sekcja of segmentyPoEtykiecie(desc, re)) {
      for (const surowy of tokenyIdentyfikatorow(sekcja)) {
        const wartosc = oczysc(surowy);
        const norm = zwin(wartosc);
        /* ≥ 4 znaki i ≥ 2 cyfry: `021`, `S`, `x2` to nie numery katalogowe.
           Własny symbol odpada — opis bywa autoreferencyjny. */
        if (wartosc.length < 4 || (wartosc.match(/\d/g) ?? []).length < 2) continue;
        if (!norm || norm === wlasny || widziane.has(norm)) continue;
        widziane.add(norm);
        out.push({ rodzaj, wartosc });
        if (out.length >= LIMIT_NA_OPIS) return out;
      }
    }
  }
  return out;
}

/** Surowe sekcje `Modele:` — jedna sekcja = jedna decyzja człowieka. */
export function modeleZOpisu(desc: string): string[] {
  return segmentyPoEtykiecie(desc, MODELE)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length > 0)
    .map((s) => s.slice(0, 200));
}

/* ── Przebudowa po imporcie ────────────────────────────────────────────── */

const kartoteki = (database: DatabaseSync) => database.prepare(
  "SELECT tw_id, symbol, opis FROM sgt_towar WHERE opis IS NOT NULL AND opis != ''").all() as
  Array<{ tw_id: number; symbol: string; opis: string }>;

/**
 * Wiersze `zrodlo='opis'` giną i powstają od nowa; `reczne` przebudowa omija.
 * `INSERT OR IGNORE` po `(tw_id, rodzaj, wartosc_norm)`: gdy biuro dopisało
 * ręcznie to, co stoi w opisie, zostaje wpis ręczny — z podpisem człowieka.
 */
export function przebudujIdentyfikatory(database: DatabaseSync = db()): { kartotek: number; identyfikatorow: number; ms: number } {
  const start = Date.now();
  let kartotek = 0; let identyfikatorow = 0;
  transaction(database, () => {
    database.prepare("DELETE FROM towar_identyfikator WHERE zrodlo='opis'").run();
    const ins = database.prepare(`INSERT OR IGNORE INTO towar_identyfikator
      (tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal) VALUES (?,?,?,?,?,'opis','import')`);
    for (const t of kartoteki(database)) {
      const lista = identyfikatoryZOpisu(t.opis, t.symbol);
      if (lista.length === 0) continue;
      kartotek++;
      for (const i of lista) identyfikatorow += Number(ins.run(t.tw_id, t.symbol, i.rodzaj, i.wartosc, zwin(i.wartosc)).changes);
    }
  })();
  return { kartotek, identyfikatorow, ms: Date.now() - start };
}

/**
 * `INSERT OR IGNORE` po `(tw_id, tekst_norm)`: odrzucony i przerobiony wiersz
 * nie wraca. Wiersz `nowy`, którego sekcja zniknęła z opisu albo kartoteka
 * z read-modelu, schodzi — rozstrzygnięte zostają jako historia.
 */
export function przebudujModeleZOpisu(database: DatabaseSync = db()): { nowych: number; ms: number } {
  const start = Date.now();
  let nowych = 0;
  transaction(database, () => {
    database.exec("CREATE TEMP TABLE IF NOT EXISTS swieze_modele(tw_id INTEGER, tekst_norm TEXT); DELETE FROM swieze_modele");
    const ins = database.prepare(`INSERT OR IGNORE INTO model_z_opisu(tw_id,tw_symbol,tekst,tekst_norm) VALUES (?,?,?,?)`);
    const swiezy = database.prepare("INSERT INTO swieze_modele(tw_id,tekst_norm) VALUES (?,?)");
    for (const t of kartoteki(database)) {
      for (const tekst of modeleZOpisu(t.opis)) {
        const norm = zwin(tekst);
        if (!norm) continue;
        swiezy.run(t.tw_id, norm);
        nowych += Number(ins.run(t.tw_id, t.symbol, tekst, norm).changes);
      }
    }
    database.prepare(`DELETE FROM model_z_opisu WHERE stan='nowy'
      AND NOT EXISTS (SELECT 1 FROM swieze_modele s WHERE s.tw_id=model_z_opisu.tw_id AND s.tekst_norm=model_z_opisu.tekst_norm)`).run();
    database.exec("DELETE FROM swieze_modele");
  })();
  return { nowych, ms: Date.now() - start };
}

/* ── Odczyt ────────────────────────────────────────────────────────────── */

export interface WierszIdentyfikatora {
  id: number; twId: number; symbol: string; nazwa: string | null;
  rodzaj: RodzajIdentyfikatora; nazwaRodzaju: string; wartosc: string;
  zrodlo: "opis" | "reczne"; dodal: string; at: string;
}

const SELECT = `SELECT i.*, t.nazwa FROM towar_identyfikator i LEFT JOIN sgt_towar t ON t.tw_id = i.tw_id`;

const naWiersz = (w: Record<string, unknown>): WierszIdentyfikatora => ({
  id: Number(w.id), twId: Number(w.tw_id), symbol: String(w.tw_symbol),
  nazwa: w.nazwa == null ? null : String(w.nazwa),
  rodzaj: String(w.rodzaj) as RodzajIdentyfikatora,
  nazwaRodzaju: NAZWA_RODZAJU[String(w.rodzaj) as RodzajIdentyfikatora],
  wartosc: String(w.wartosc), zrodlo: String(w.zrodlo) as "opis" | "reczne",
  dodal: String(w.dodal), at: String(w.at),
});

/** Kartoteki, w których stoi ten numer — po formie zwiniętej, więc `532 16 56-30` = `5321656-30`. */
export function szukajPoIdentyfikatorze(wartosc: string, database: DatabaseSync = db()): WierszIdentyfikatora[] {
  const norm = zwin(wartosc ?? "");
  if (!norm) return [];
  return (database.prepare(`${SELECT} WHERE i.wartosc_norm=? ORDER BY i.zrodlo DESC, i.tw_symbol`)
    .all(norm) as Array<Record<string, unknown>>).map(naWiersz);
}

export function identyfikatoryTowaru(twId: number, database: DatabaseSync = db()): WierszIdentyfikatora[] {
  return (database.prepare(`${SELECT} WHERE i.tw_id=? ORDER BY i.rodzaj, i.wartosc`)
    .all(twId) as Array<Record<string, unknown>>).map(naWiersz);
}

/** Ręczny wpis biura — z katalogu, którego nie ma w opisie. Przebudowa go omija. */
export function dodajIdentyfikator(
  twId: number, rodzaj: string, wartosc: string, userId: number, database: DatabaseSync = db(),
): WierszIdentyfikatora {
  const autor = czlowiekZBiura(database, userId);
  if (!RODZAJE_IDENTYFIKATORA.includes(rodzaj as RodzajIdentyfikatora)) throw new Error(`Nieznany rodzaj identyfikatora: ${rodzaj}`);
  const czysta = oczysc(String(wartosc ?? ""));
  const norm = zwin(czysta);
  if (czysta.length < 4 || !norm) throw new Error("Identyfikator ma co najmniej cztery znaki");
  const t = database.prepare("SELECT symbol FROM sgt_towar WHERE tw_id=?").get(twId) as { symbol: string } | undefined;
  if (!t) throw new Error("Nie ma takiej kartoteki w Subiekcie");
  const juz = database.prepare("SELECT id FROM towar_identyfikator WHERE tw_id=? AND rodzaj=? AND wartosc_norm=?")
    .get(twId, rodzaj, norm);
  if (juz) throw new WiedzaConflict("Ten identyfikator już stoi przy tej kartotece", { id: Number((juz as { id: number }).id) });
  const id = Number(database.prepare(`INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal,dodal_user_id)
    VALUES (?,?,?,?,?,'reczne',?,?)`).run(twId, t.symbol, rodzaj, czysta, norm, autor, userId).lastInsertRowid);
  logEvent("wiedza_identyfikator_dodany", autor, twId, { id, rodzaj, wartosc: czysta }, userId, database);
  return naWiersz(database.prepare(`${SELECT} WHERE i.id=?`).get(id) as Record<string, unknown>);
}

/* ── Modele z opisów do przerobienia ───────────────────────────────────── */

export interface ModelZOpisu {
  id: number; twId: number; symbol: string; nazwa: string | null; tekst: string;
  stan: "nowy" | "przerobiony" | "odrzucony"; zastosowanieId: number | null;
  rozstrzygnal: string | null; rozstrzygnietoAt: string | null; at: string;
}

const naModelZOpisu = (w: Record<string, unknown>): ModelZOpisu => ({
  id: Number(w.id), twId: Number(w.tw_id), symbol: String(w.tw_symbol),
  nazwa: w.nazwa == null ? null : String(w.nazwa), tekst: String(w.tekst),
  stan: String(w.stan) as ModelZOpisu["stan"],
  zastosowanieId: w.zastosowanie_id == null ? null : Number(w.zastosowanie_id),
  rozstrzygnal: w.rozstrzygnal == null ? null : String(w.rozstrzygnal),
  rozstrzygnietoAt: w.rozstrzygnieto_at == null ? null : String(w.rozstrzygnieto_at),
  at: String(w.at),
});

const SELECT_MODEL = `SELECT m.*, t.nazwa FROM model_z_opisu m LEFT JOIN sgt_towar t ON t.tw_id = m.tw_id`;

/** Lista do przerobienia — same `nowe`, najstarsze pierwsze. Odczyt bez zapisu. */
export function listaModeliZOpisow(database: DatabaseSync = db()): { wiersze: ModelZOpisu[]; liczba: number } {
  const liczba = (database.prepare("SELECT count(*) n FROM model_z_opisu WHERE stan='nowy'").get() as { n: number }).n;
  const wiersze = (database.prepare(`${SELECT_MODEL} WHERE m.stan='nowy' ORDER BY m.tw_symbol, m.id LIMIT 200`)
    .all() as Array<Record<string, unknown>>).map(naModelZOpisu);
  return { wiersze, liczba };
}

function zaladujNowy(database: DatabaseSync, id: number): ModelZOpisu {
  const w = database.prepare(`${SELECT_MODEL} WHERE m.id=?`).get(id) as Record<string, unknown> | undefined;
  if (!w) throw new Error("Nie znaleziono wiersza z opisu");
  const m = naModelZOpisu(w);
  if (m.stan !== "nowy") throw new WiedzaConflict(`Ten wiersz rozstrzygnął już ${m.rozstrzygnal ?? "ktoś inny"}`,
    { stan: m.stan, rozstrzygnal: m.rozstrzygnal, rozstrzygnietoAt: m.rozstrzygnietoAt });
  return m;
}

/**
 * Człowiek wskazał markę i model → propozycja zastosowania ze źródłem `opis`
 * i dowodem `decyzja_biura` (to jest decyzja biura: sekcja opisu sama w sobie
 * nie mówi, do jakiej marki należy `FS450`). Wiersz schodzi na `przerobiony`
 * w tej samej transakcji, więc drugie kliknięcie dostaje 409, nie dubel.
 */
export function przerobModelZOpisu(
  id: number, model: DaneModelu, userId: number, database: DatabaseSync = db(),
): Zastosowanie {
  const autor = czlowiekZBiura(database, userId);
  return transaction(database, () => {
    const m = zaladujNowy(database, id);
    const z = zaproponujZastosowanie({
      twId: m.twId, model, polaryzacja: "pasuje", zrodlo: "opis",
      komentarz: `Modele: ${m.tekst}`,
      dowod: { rodzaj: "decyzja_biura", tresc: `z opisu kartoteki „${m.symbol}”: Modele: ${m.tekst}` },
    }, { userId, name: autor }, database);
    if (!z) throw new WiedzaConflict("Ta para kartoteka–model już czeka w kolejce albo jest zatwierdzona", {});
    database.prepare(`UPDATE model_z_opisu SET stan='przerobiony', zastosowanie_id=?, rozstrzygnal=?, rozstrzygnal_user_id=?,
      rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(z.id, autor, userId, id);
    logEvent("wiedza_model_z_opisu_przerobiony", autor, m.twId, { id, zastosowanieId: z.id, model: z.model.etykieta }, userId, database);
    return z;
  })();
}

/** Odrzucenie = „to nie jest lista modeli". Wiersz zostaje, żeby nie wrócił po przebudowie. */
export function odrzucModelZOpisu(id: number, userId: number, database: DatabaseSync = db()): ModelZOpisu {
  const autor = czlowiekZBiura(database, userId);
  return transaction(database, () => {
    const m = zaladujNowy(database, id);
    database.prepare(`UPDATE model_z_opisu SET stan='odrzucony', rozstrzygnal=?, rozstrzygnal_user_id=?,
      rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(autor, userId, id);
    logEvent("wiedza_model_z_opisu_odrzucony", autor, m.twId, { id }, userId, database);
    return naModelZOpisu(database.prepare(`${SELECT_MODEL} WHERE m.id=?`).get(id) as Record<string, unknown>);
  })();
}

/* ── Raport pokrycia (ekran ustawień) — WYŁĄCZNIE ODCZYT ───────────────── */

export interface PokrycieWiedzy {
  kartotek: number; zOpisem: number; zIdentyfikatorem: number;
  identyfikatorow: number; identyfikatorowRecznych: number;
  modeleZOpisu: { nowych: number; przerobionych: number; odrzuconych: number };
  zastosowania: { zatwierdzonych: number; negatywnych: number; propozycji: number };
  fts: { dostepne: boolean; wpisow: number };
}

export function pokrycieWiedzy(database: DatabaseSync = db()): PokrycieWiedzy {
  const n = (sql: string) => Number((database.prepare(sql).get() as { n: number }).n);
  return {
    kartotek: n("SELECT count(*) n FROM sgt_towar"),
    zOpisem: n("SELECT count(*) n FROM sgt_towar WHERE opis IS NOT NULL AND opis != ''"),
    zIdentyfikatorem: n("SELECT count(DISTINCT tw_id) n FROM towar_identyfikator"),
    identyfikatorow: n("SELECT count(*) n FROM towar_identyfikator"),
    identyfikatorowRecznych: n("SELECT count(*) n FROM towar_identyfikator WHERE zrodlo='reczne'"),
    modeleZOpisu: {
      nowych: n("SELECT count(*) n FROM model_z_opisu WHERE stan='nowy'"),
      przerobionych: n("SELECT count(*) n FROM model_z_opisu WHERE stan='przerobiony'"),
      odrzuconych: n("SELECT count(*) n FROM model_z_opisu WHERE stan='odrzucony'"),
    },
    zastosowania: {
      zatwierdzonych: n("SELECT count(*) n FROM zastosowanie WHERE stan='zatwierdzone' AND polaryzacja='pasuje'"),
      negatywnych: n("SELECT count(*) n FROM zastosowanie WHERE stan='zatwierdzone' AND polaryzacja='nie_pasuje'"),
      propozycji: n("SELECT count(*) n FROM zastosowanie WHERE stan='propozycja'"),
    },
    fts: { dostepne: ftsDostepne(), wpisow: ftsDostepne() ? n("SELECT count(*) n FROM towar_fts") : 0 },
  };
}
