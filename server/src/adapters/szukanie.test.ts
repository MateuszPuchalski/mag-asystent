import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Kolejność wyników wyszukiwania ──────────────────────────────────────────
   POWSTAŁO PO ZGŁOSZENIU z magazynu. Z ~3600 kartotek aktywnych jest ~1000,
   więc dwie trzecie trafień to kartoteki martwe: zerowy stan w obu magazynach.
   Sortowanie po samym symbolu wypychało je na górę alfabetem i magazynier
   przewijał listę, żeby dojść do pozycji, którą w ogóle można podać klientowi.

   Trafność zostaje kryterium PIERWSZYM — te testy pilnują, że stan magazynowy
   jej nie wywraca, tylko rozstrzyga wewnątrz niej.                            */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-szuk-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";

let db: typeof import("../db/db.js").db;
let subiekt: import("./subiekt.js").SubiektAdapter;

before(async () => {
  ({ db } = await import("../db/db.js"));
  const { SeededSubiektAdapter } = await import("./subiekt.seeded.js");
  subiekt = new SeededSubiektAdapter();
});

/** Towar z zadanym stanem na hali i w przyjęciach. */
function towar(id: number, sym: string, nazwa: string, mag: number, mgp = 0, ean = ""): void {
  const d = db();
  d.prepare(
    "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (?,?,?,?,'')"
  ).run(id, sym, nazwa, ean);
  d.prepare("INSERT OR REPLACE INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,1,?,0)").run(id, mag);
  d.prepare("INSERT OR REPLACE INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,2,?,0)").run(id, mgp);
}

beforeEach(() => {
  db().prepare("DELETE FROM sgt_stan").run();
  db().prepare("DELETE FROM sgt_towar").run();
});

const symbole = (q: string) => subiekt.search(q, 20).map((r) => r.sym);

test("towar ze stanem wyprzedza martwą kartotekę o wcześniejszym symbolu", () => {
  // alfabetycznie AAA-1 wygrywa; magazynowo nie ma go wcale
  towar(1, "AAA-1", "Kosa spalinowa", 0);
  towar(2, "ZZZ-9", "Kosa spalinowa", 12);
  assert.deepEqual(symbole("Kosa"), ["ZZZ-9", "AAA-1"]);
});

test("większy stan idzie przed mniejszym", () => {
  towar(1, "K-1", "Kosa", 2);
  towar(2, "K-2", "Kosa", 40);
  towar(3, "K-3", "Kosa", 15);
  assert.deepEqual(symbole("Kosa"), ["K-2", "K-3", "K-1"]);
});

test("stan liczy się ŁĄCZNIE z halą i przyjęciami", () => {
  // towar na MGP jeszcze nie leży na półce, ale JEST w firmie — pomijanie go
  // kazałoby magazynierowi szukać dalej mimo pełnej palety w przyjęciach
  towar(1, "K-1", "Kosa", 5, 0);
  towar(2, "K-2", "Kosa", 0, 30);
  assert.deepEqual(symbole("Kosa"), ["K-2", "K-1"]);
});

test("TRAFNOŚĆ nadal wygrywa ze stanem", () => {
  /* Wpisany symbol ma wygrać z przypadkowym trafieniem w nazwie, choćby tamto
     miało pełny magazyn — inaczej szukanie po symbolu przestałoby działać. */
  towar(1, "KOSA-77", "Element dowolny", 0);
  towar(2, "INNY-1", "Kosa spalinowa", 999);
  assert.deepEqual(symbole("KOSA"), ["KOSA-77", "INNY-1"]);
});

test("przy równym stanie kolejność jest powtarzalna — po symbolu", () => {
  towar(1, "K-9", "Kosa", 7);
  towar(2, "K-1", "Kosa", 7);
  assert.deepEqual(symbole("Kosa"), ["K-1", "K-9"]);
});

test("kartoteka bez wiersza stanu liczy się jako zero, nie wypada z wyników", () => {
  // LEFT JOIN: brak wiersza w sgt_stan to stan zerowy, a nie brak towaru
  db()
    .prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (5,'BRAK-1','Kosa','','')")
    .run();
  towar(1, "MA-1", "Kosa", 3);
  assert.deepEqual(symbole("Kosa"), ["MA-1", "BRAK-1"]);
});
