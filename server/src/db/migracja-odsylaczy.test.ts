import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Źródło identyfikatora `dostawca`: trzecia przebudowa tabeli ────────────
   Import odsyłaczy dokłada `dostawca` do CHECK-a na `towar_identyfikator.zrodlo`
   i dwie kolumny. SQLite nie rozszerza CHECK-a w miejscu, więc tabela idzie
   przez przepisanie. Pilnujemy trzech rzeczy: każdy wiersz przeżywa z `id`
   (wpis biura i numer z oferty nie mają z czego wrócić), nowe źródło da się
   zapisać, a druga migracja niczego już nie rusza.                         */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

/* Kształt z produkcji między 0.264.0 a importem odsyłaczy — co do kolumny. */
const STARA = `CREATE TABLE towar_identyfikator (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tw_id           INTEGER NOT NULL,
  tw_symbol       TEXT NOT NULL,
  rodzaj          TEXT NOT NULL CHECK (rodzaj IN ('oem','nr_oryg','katalog_obcy','stare_sku','zamiennik')),
  wartosc         TEXT NOT NULL,
  wartosc_norm    TEXT NOT NULL,
  zrodlo          TEXT NOT NULL CHECK (zrodlo IN ('opis','reczne','oferta')),
  dodal           TEXT NOT NULL,
  dodal_user_id   INTEGER REFERENCES app_user(user_id),
  oferta_id       TEXT,
  at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tw_id, rodzaj, wartosc_norm)
)`;

function staraBaza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec("DROP TABLE towar_identyfikator");
  d.exec(STARA);
  d.exec(`INSERT INTO towar_identyfikator(id,tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal,oferta_id) VALUES
    (5,7,'20-05006','oem','195945','195945','opis','import',NULL),
    (9,7,'20-05006','katalog_obcy','RO12378','ro12378','reczne','Ala',NULL),
    (12,7,'20-05006','oem','698083','698083','oferta','oferta','14023867457')`);
  return d;
}
const sqlTabeli = (d: DatabaseSync) =>
  (d.prepare("SELECT sql FROM sqlite_master WHERE name='towar_identyfikator'").get() as { sql: string }).sql;

test("każdy wiersz przeżywa przebudowę z `id`, źródłem i numerem oferty", () => {
  const d = staraBaza();
  migrate(d);
  assert.match(sqlTabeli(d), /'dostawca'/);
  const w = d.prepare("SELECT id, zrodlo, oferta_id, dostawca, import_id FROM towar_identyfikator ORDER BY id").all();
  assert.deepEqual(w.map((r) => ({ ...r })), [
    { id: 5, zrodlo: "opis", oferta_id: null, dostawca: null, import_id: null },
    { id: 9, zrodlo: "reczne", oferta_id: null, dostawca: null, import_id: null },
    { id: 12, zrodlo: "oferta", oferta_id: "14023867457", dostawca: null, import_id: null },
  ]);
});

test("po migracji da się zapisać numer od dostawcy, a obce źródło dalej odbija CHECK", () => {
  const d = staraBaza();
  migrate(d);
  d.exec(`INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal,dostawca,import_id)
    VALUES (7,'20-05006','oem','532 19 59-45','5321959-45','dostawca','Ala','Kramp',1)`);
  assert.throws(() => d.exec(`INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal)
    VALUES (7,'20-05006','oem','111111','111111','zgadywanka','Ala')`), /CHECK/);
  const indeksy = (d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='towar_identyfikator'").all() as
    Array<{ name: string }>).map((i) => i.name);
  assert.ok(indeksy.includes("ix_towar_identyfikator_norm") && indeksy.includes("ix_towar_identyfikator_tw"),
    "przebudowa odtwarza indeksy — bez nich szukanie po numerze to skan tabeli");
});

test("druga migracja niczego nie rusza, a świeża baza ze schematu jest od razu w docelowym kształcie", () => {
  const d = staraBaza();
  migrate(d);
  const po = sqlTabeli(d);
  migrate(d);
  assert.equal(sqlTabeli(d), po);
  const swieza = new DatabaseSync(":memory:");
  swieza.exec(schema);
  migrate(swieza);
  assert.match(sqlTabeli(swieza), /'dostawca'/);
  assert.ok(swieza.prepare("SELECT 1 FROM sqlite_master WHERE name='import_odsylaczy'").get(), "historia importów stoi");
});
