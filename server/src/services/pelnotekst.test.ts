import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, udawajBrakFts } from "../db/db.js";
import { przebudujFts, szukajPelnotekst, zapytanieFts } from "./pelnotekst.js";
import { config } from "../config.js";

/* ── Pełny tekst kartotek (E3) ───────────────────────────────────────────────
   Trzy rzeczy do przypilnowania: zapytanie powstaje z danych AGENTA i jest
   bezpieczne dla składni FTS; indeks daje się skasować i odbudować po
   imporcie; bez FTS5 wszystko odpowiada pustką, nie wyjątkiem.             */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function baza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
  return d;
}

test("zapytanie: ogonki przez zloz(), znaki składni nie wchodzą, pusto = null", () => {
  assert.equal(zapytanieFts("Podkładka przekładni FS120"), '"podkladka" AND "przekladni" AND "fs120"');
  assert.equal(zapytanieFts('nóż "43" OR * NOT -x'), '"noz" AND "43" AND "or" AND "not"');
  assert.equal(zapytanieFts("  - "), null);
  assert.equal(zapytanieFts("aa bb cc dd ee ff gg hh")!.split(" AND ").length, 6, "maks. sześć słów jak w wyszukiwarce");
  /* Marka i model to bonus do rankingu, nie warunek: zlepek „fs250" łapie opis bez spacji. */
  assert.equal(zapytanieFts("podkładka", ["STIHL", "FS 250"]),
    '("podkladka") OR ("podkladka" AND ("stihl" OR "fs" OR "250" OR "fs250"))');
  assert.equal(zapytanieFts("", ["STIHL", "FS 250"]), '("stihl" AND "fs" AND "250") OR ("stihl" AND "fs" AND "250" AND ("fs250"))');
  assert.equal(zapytanieFts("", ["", " "]), null);
});

test("przebudowa indeksuje całą kartotekę, bm25 stawia właściwą kartotekę pierwszą, druga przebudowa nie dubluje", () => {
  const d = baza();
  const w = przebudujFts(d)!;
  assert.ok(w.wpisow > 3000, `wpisów: ${w.wpisow}`);
  assert.ok(w.ms < 5000, `przebudowa trwała ${w.ms} ms`);
  const trafienia = szukajPelnotekst("podkładka przekładni FS120", 5, d);
  /* bm25 premiuje krótszy dokument: `W32-0402` („Podkładka mała i szeroka do
     przekładni STIHL FS120") wygrywa z `FTC272` — oba są trafne i oba mają
     być w czołówce; kolejność to podpowiedź, nie dowód. */
  assert.ok(trafienia.slice(0, 3).some((t) => t.twId === 14), "FTC272 w pierwszej trójce");
  assert.ok(trafienia.slice(0, 3).some((t) => t.twId === 1366), "W32-0402 w pierwszej trójce");
  /* Numer OEM w opisie też jest tekstem: pełny tekst go znajduje, choć gorzej niż szczebel OEM. */
  assert.ok(szukajPelnotekst("41307131600", 5, d).some((t) => t.twId === 14));
  assert.deepEqual(szukajPelnotekst("", 5, d), []);
  const drugi = przebudujFts(d)!;
  assert.equal(drugi.wpisow, w.wpisow);
  assert.equal((d.prepare("SELECT count(*) n FROM towar_fts").get() as { n: number }).n, w.wpisow, "delete-all przed wstawieniem");
  d.close();
});

test("bez FTS5 przebudowa oddaje null, a szukanie pustą listę — nie wyjątek", () => {
  const d = baza();
  udawajBrakFts(true);
  try {
    assert.equal(przebudujFts(d), null);
    assert.deepEqual(szukajPelnotekst("podkładka", 5, d), []);
  } finally { udawajBrakFts(false); }
  d.close();
});
