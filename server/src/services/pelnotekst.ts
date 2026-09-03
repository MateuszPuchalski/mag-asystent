import type { DatabaseSync } from "node:sqlite";
import { db, ftsDostepne, transaction } from "../db/db.js";
import { zloz } from "../tekst.js";

/**
 * Pełny tekst kartotek (§11.2, etap E3) — indeks FTS5 `towar_fts`.
 *
 * Wyszukiwarka (`szukajDokladnie`) czyta symbol, nazwę i EAN; kolumna `opis`
 * była do E3 nieprzeszukiwalna. Indeks jest contentless z `rowid = tw_id`,
 * odbudowywany po imporcie — patrz `db/db.ts` przy `tabelaFts`.
 *
 * BLIZNA „SZARPAKA": stara wyszukiwarka brała najdłuższe słowa z wiadomości
 * klienta i wygrywały „zdemontowanym" i „Pozdrawiam". Tu zapytanie pochodzi
 * WYŁĄCZNIE z danych wpisanych przez agenta, a ranking robi bm25 — nie
 * długość słowa. Trafienie po treści to podpowiedź, nigdy dowód (§11.2).
 */

const MAX_SLOW = 6;

/**
 * Zapytanie MATCH z frazy agenta: `zloz()` (jedna prawda normalizacji z
 * `tekst.ts`, bo `ł` nie ma rozkładu Unicode i `remove_diacritics` go nie
 * zdejmie), same `[a-z0-9]`, każde słowo w cudzysłowie — więc znaki
 * składni FTS (`*`, `-`, `NOT`) nie mają jak wejść. `null` = nie ma o co pytać.
 */
export function zapytanieFts(q: string, opcjonalne: string[] = []): string | null {
  const slowaZ = (t: string) => zloz(String(t ?? "").slice(0, 200)).split(/[^a-z0-9]+/).filter((s) => s.length >= 2);
  let wymagane = slowaZ(q).slice(0, MAX_SLOW);
  /* Marka i model wpisane obok nazwy części PODNOSZĄ trafienie, ale go nie
     warunkują: „FS 250" w danych to w opisach „FS250", „FS 250" albo nic.
     Stąd obok słów idzie ich zlepek, a całość jako alternatywa — bm25 liczy
     każdą trafioną frazę, więc kartoteka z marką wygrywa z tą bez niej. */
  const slowaOpc: string[] = [];
  const zlepki: string[] = [];
  for (const pole of opcjonalne) {
    const slowa = slowaZ(pole);
    slowaOpc.push(...slowa);
    if (slowa.length > 1) zlepki.push(slowa.join(""));
  }
  /* Bez nazwy części pytamy o samą maszynę: jej słowa stają się wymagane,
     zlepki („fs250") zostają bonusem. */
  if (!wymagane.length) wymagane = slowaOpc.slice(0, MAX_SLOW);
  if (!wymagane.length) return null;
  /* Jawne AND: w nawiasie FTS5 nie przyjmuje niejawnego „a b" (błąd składni). */
  const baza = wymagane.map((s) => `"${s}"`).join(" AND ");
  const bonus = [...new Set([...slowaOpc, ...zlepki])].filter((s) => !wymagane.includes(s)).slice(0, MAX_SLOW);
  return bonus.length ? `(${baza}) OR (${baza} AND (${bonus.map((s) => `"${s}"`).join(" OR ")}))` : baza;
}

/** Cały indeks od nowa: `delete-all` + wiersz na kartotekę. `null`, gdy FTS5 nie ma. */
export function przebudujFts(database: DatabaseSync = db()): { wpisow: number; ms: number } | null {
  if (!ftsDostepne()) return null;
  const start = Date.now();
  let wpisow = 0;
  transaction(database, () => {
    database.prepare("INSERT INTO towar_fts(towar_fts) VALUES ('delete-all')").run();
    const ins = database.prepare("INSERT INTO towar_fts(rowid,symbol,nazwa,opis) VALUES (?,?,?,?)");
    for (const t of database.prepare("SELECT tw_id, symbol, nazwa, opis FROM sgt_towar").all() as
      Array<{ tw_id: number; symbol: string; nazwa: string; opis: string | null }>) {
      ins.run(t.tw_id, zloz(t.symbol), zloz(t.nazwa), zloz(t.opis ?? ""));
      wpisow++;
    }
  })();
  return { wpisow, ms: Date.now() - start };
}

/** Najlepsze trafienia bm25 (mniejsza wartość = lepsze). Pusto bez FTS albo bez słów. */
export function szukajPelnotekst(q: string, limit: number, database: DatabaseSync = db(),
  opcjonalne: string[] = []): Array<{ twId: number; ranga: number }> {
  if (!ftsDostepne()) return [];
  const zapytanie = zapytanieFts(q, opcjonalne);
  if (!zapytanie) return [];
  return (database.prepare(`SELECT rowid AS twId, bm25(towar_fts) AS ranga FROM towar_fts
    WHERE towar_fts MATCH ? ORDER BY ranga LIMIT ?`).all(zapytanie, limit) as Array<{ twId: number; ranga: number }>)
    .map((r) => ({ twId: Number(r.twId), ranga: Number(r.ranga) }));
}
