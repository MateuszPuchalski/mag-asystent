import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { zwin } from "../tekst.js";
import { oczysc, segmentyPoEtykiecie } from "./opis-sekcje.js";

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
 */

export type RodzajIdentyfikatora = "oem" | "nr_oryg" | "katalog_obcy" | "stare_sku" | "zamiennik";
export const RODZAJE_IDENTYFIKATORA: RodzajIdentyfikatora[] =
  ["oem", "nr_oryg", "katalog_obcy", "stare_sku", "zamiennik"];
export const NAZWA_RODZAJU: Record<RodzajIdentyfikatora, string> = {
  oem: "OEM", nr_oryg: "nr oryginału", katalog_obcy: "katalog obcy", stare_sku: "stare SKU",
  /* Zdanie mówi, SKĄD numer — sekcja zamienników jest słabszym świadectwem
     niż numer producenta i ekran nie ma prawa zrównać ich podpisem (§11.3). */
  zamiennik: "z zamienników",
};

/* Etykiety Z DWUKROPKIEM — bez niego `OEM` w prozie („silnik OEM Honda")
   byłoby etykietą. Koniec sekcji rozstrzyga `KONIEC_SEKCJI` z `opis-sekcje.ts`,
   nie whitelista (decyzja 0.61.0). `katalog_obcy` parsera nie ma — to
   rezerwa dla wpisu ręcznego biura. */
const ETYKIETY: Array<{ rodzaj: RodzajIdentyfikatora; re: RegExp }> = [
  /* `OME:` to literówka z czterech opisów (`OME: 591852 // 793463 // 793493`).
     Bez tego wyjątku te numery nie trafiają do tabeli i szukanie
     po numerze ich nie znajdzie. Bez dwukropka nadal nie jest etykietą. */
  { rodzaj: "oem", re: /\bO(?:EM|ME)\s*:/gi },
  { rodzaj: "nr_oryg", re: /\b(?:nr\.?\s*oryg(?:inaln[ya]|\.)?|numery?\s+(?:cz[eę][sś]ci\s+)?oryginaln(?:y|ej)(?:\s+cz[eę][sś]ci)?)\s*:/gi },
  { rodzaj: "stare_sku", re: /\bstare\s+sku\s*:/gi },
  /* SEKCJA ZAMIENNIKÓW (0.234.0). Ta sama rodzina etykiet co w
     `zamienniki.ts` — świadomie, bo mówi o tej samej liście. Tamten parser
     czyta ją po SWOJEMU: zostawia wyłącznie tokeny będące NASZĄ kartoteką,
     a numery obcych katalogów wyrzuca. W eksporcie kartotek z 8 września
     stało w takich sekcjach 1883 numerów spoza naszej kartoteki, przy 1813
     wyczytanych ze wszystkich sekcji `OEM:` i `Nr oryg.:` razem — czyli
     połowa mostka „numer klienta → towar" leżała nieużywana.

     Bez `\b` przed `ZAM`, bo `\b` nie zadziała po myślniku w `PRO-491588-ZAM:`;
     dwukropek jest tu jedynym wymogiem, tak samo jak w `zamienniki.ts`. */
  { rodzaj: "zamiennik",
    re: /\b(?:zamienni[a-ząćęłńóśźż]*|zamienne\s+na|zast[ęe]puje|odpowiednik[a-ząćęłńóśźż]*)\s*:|ZAM\s*:/gi },
];

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

/* ── Przebudowa po imporcie ────────────────────────────────────────────── */

const kartoteki = (database: DatabaseSync) => database.prepare(
  "SELECT tw_id, symbol, opis FROM sgt_towar WHERE opis IS NOT NULL AND opis != ''").all() as
  Array<{ tw_id: number; symbol: string; opis: string }>;

/**
 * NASZ SYMBOL NIE JEST IDENTYFIKATOREM OBCYM (0.234.0).
 *
 * Sekcja zamienników miesza jedno z drugim: `Zamiennie: 15-06002 / RO1205 /
 * W28-0503`. Nasze kartoteki czyta stamtąd `zamienniki.ts` i pokazuje jako
 * zamienniki — wpisanie ich tutaj drugi raz mnożyłoby ten sam fakt w dwóch
 * tabelach, a szukanie po numerze i tak znajdzie kartotekę po symbolu.
 *
 * Filtr stoi po stronie ZAPISU, nie w parserze: parser jest czystą funkcją
 * i o kartotece nic nie wie.
 */
export function naszeSymbole(database: DatabaseSync): Set<string> {
  return new Set((database.prepare("SELECT symbol FROM sgt_towar").all() as
    Array<{ symbol: string }>).map((t) => zwin(t.symbol)));
}

/**
 * Wiersze `zrodlo='opis'` giną i powstają od nowa; `reczne` przebudowa omija.
 * `INSERT OR IGNORE` po `(tw_id, rodzaj, wartosc_norm)`: gdy biuro dopisało
 * ręcznie to, co stoi w opisie, zostaje wpis ręczny — z podpisem człowieka.
 *
 * Od 0.264.0 omija także `zrodlo='oferta'`, a od importu odsyłaczy
 * `zrodlo='dostawca'` — i to bez żadnej poprawki tutaj:
 * `DELETE` był zawężony do `'opis'` od początku. Zdanie stoi w komentarzu,
 * bo zdanie wyżej wymienia dwa źródła i wygląda na wyczerpujące — a numeru
 * z oferty ta funkcja nie umiałaby odtworzyć: czyta opisy KARTOTEK.
 */
export function przebudujIdentyfikatory(database: DatabaseSync = db()): { kartotek: number; identyfikatorow: number; ms: number } {
  const start = Date.now();
  let kartotek = 0; let identyfikatorow = 0;
  transaction(database, () => {
    database.prepare("DELETE FROM towar_identyfikator WHERE zrodlo='opis'").run();
    const nasze = naszeSymbole(database);
    const ins = database.prepare(`INSERT OR IGNORE INTO towar_identyfikator
      (tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal) VALUES (?,?,?,?,?,'opis','import')`);
    for (const t of kartoteki(database)) {
      const lista = identyfikatoryZOpisu(t.opis, t.symbol)
        .filter((i) => i.rodzaj !== "zamiennik" || !nasze.has(zwin(i.wartosc)));
      if (lista.length === 0) continue;
      kartotek++;
      for (const i of lista) identyfikatorow += Number(ins.run(t.tw_id, t.symbol, i.rodzaj, i.wartosc, zwin(i.wartosc)).changes);
    }
  })();
  return { kartotek, identyfikatorow, ms: Date.now() - start };
}

/* ── Odczyt ────────────────────────────────────────────────────────────── */

/** Skąd wziął się wiersz. `oferta` i `dostawca` dopisywała baza wiedzy, której
 *  już nie ma. Ich wiersze zostają, bo szukanie po numerze dalej je znajduje. */
export type ZrodloIdentyfikatora = "opis" | "reczne" | "oferta" | "dostawca";

export interface WierszIdentyfikatora {
  id: number; twId: number; symbol: string; nazwa: string | null;
  rodzaj: RodzajIdentyfikatora; nazwaRodzaju: string; wartosc: string;
  zrodlo: ZrodloIdentyfikatora; dodal: string; at: string;
  /** Z KTÓREJ oferty; NULL dla `opis` i `reczne`. Bez tego „skąd to się wzięło" nie ma odpowiedzi. */
  ofertaId: string | null;
  /** Od KOGO — nazwa dostawcy z importu odsyłaczy; NULL poza `zrodlo='dostawca'`. */
  dostawca: string | null;
}

const SELECT = `SELECT i.*, t.nazwa FROM towar_identyfikator i LEFT JOIN sgt_towar t ON t.tw_id = i.tw_id`;

const naWiersz = (w: Record<string, unknown>): WierszIdentyfikatora => ({
  id: Number(w.id), twId: Number(w.tw_id), symbol: String(w.tw_symbol),
  nazwa: w.nazwa == null ? null : String(w.nazwa),
  rodzaj: String(w.rodzaj) as RodzajIdentyfikatora,
  nazwaRodzaju: NAZWA_RODZAJU[String(w.rodzaj) as RodzajIdentyfikatora],
  wartosc: String(w.wartosc), zrodlo: String(w.zrodlo) as ZrodloIdentyfikatora,
  dodal: String(w.dodal), at: String(w.at),
  ofertaId: w.oferta_id == null ? null : String(w.oferta_id),
  dostawca: w.dostawca == null ? null : String(w.dostawca),
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
