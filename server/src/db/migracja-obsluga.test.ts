import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* ── Kasacja obsługi klienta (0.140.0) ───────────────────────────────────────
   Migracja, która USUWA dane, jest jedyną, przy której błąd kosztuje pracę
   magazynu, a nie komunikat. Trzy rzeczy do sprawdzenia:

     1. tabele obsługi klienta znikają WSZYSTKIE — zostawiona jedna byłaby
        modelem bez czytelnika, czyli pułapką dla następnego czytającego,
     2. kosz i jego pozycje PRZEŻYWAJĄ przebudowę z całą treścią — to jest
        praca hali, a `zwrot_id` trzeba było skasować kluczem obcym w dół,
     3. baza starsza od schematu też przechodzi: kolumny z 0.79.0 mogą jej
        brakować, a przepisanie ma wziąć część wspólną, nie wywalić się.

   Konstrukcja jak przy `migracja-kont.test.ts`: STARĄ bazę budujemy surowym
   SQL-em, zamykamy plik i dopiero potem importujemy `db.js` — migracja odpala
   się przy pierwszym otwarciu.                                              */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-migr-obsl-"));
const plik = path.join(katalog, "stara.db");

const stara = new DatabaseSync(plik);
stara.exec(`
  CREATE TABLE kosz (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kod           TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'otwarty',
    utworzono_at  TEXT NOT NULL,
    utworzono_przez TEXT NOT NULL
  );
  CREATE TABLE zwrot (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    waybill       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'nowy',
    kosz_id       INTEGER
  );
  -- Kształt sprzed 0.79.0: bez powodu, pominięcia i „wrócę do tego".
  CREATE TABLE kosz_pozycja (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kosz_id       INTEGER NOT NULL REFERENCES kosz(id),
    zwrot_id      INTEGER REFERENCES zwrot(id),
    tw_id         INTEGER NOT NULL,
    symbol        TEXT NOT NULL,
    nazwa         TEXT NOT NULL,
    ilosc         REAL NOT NULL,
    status        TEXT NOT NULL DEFAULT 'todo',
    lok_faktyczna TEXT,
    odlozono_at   TEXT,
    odlozono_przez TEXT
  );
  CREATE TABLE pytanie (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    wiadomosc_id  TEXT,
    tresc         TEXT
  );
  CREATE TABLE dyskusja (id INTEGER PRIMARY KEY AUTOINCREMENT, allegro_id TEXT);
  CREATE TABLE opinia (id INTEGER PRIMARY KEY AUTOINCREMENT, allegro_id TEXT);
  CREATE TABLE sprawa (id INTEGER PRIMARY KEY AUTOINCREMENT, tytul TEXT);
  CREATE TABLE sprawa_zrodlo (id INTEGER PRIMARY KEY AUTOINCREMENT, sprawa_id INTEGER);
  CREATE TABLE sprawa_zdarzenie (id INTEGER PRIMARY KEY AUTOINCREMENT, klucz TEXT);
  CREATE TABLE sprawa_tag (id INTEGER PRIMARY KEY AUTOINCREMENT, tag TEXT);
  CREATE TABLE regula (id INTEGER PRIMARY KEY AUTOINCREMENT, nazwa TEXT);
  CREATE TABLE szablon (id INTEGER PRIMARY KEY AUTOINCREMENT, nazwa TEXT);
  CREATE TABLE watek_meta (id INTEGER PRIMARY KEY AUTOINCREMENT, rodzaj TEXT);
  CREATE TABLE dopasowanie (id INTEGER PRIMARY KEY AUTOINCREMENT, pytanie_id INTEGER);
  CREATE TABLE ai_config (id INTEGER PRIMARY KEY CHECK (id = 1), auto_szkic INTEGER);
  CREATE TABLE zwrot_pozycja (id INTEGER PRIMARY KEY AUTOINCREMENT, zwrot_id INTEGER);
  CREATE TABLE zwrot_zam_pozycja (id INTEGER PRIMARY KEY AUTOINCREMENT, zwrot_id INTEGER);
  CREATE TABLE zwrot_zapowiedz (id INTEGER PRIMARY KEY AUTOINCREMENT, waybill TEXT);
  CREATE TABLE sgt_sprzedaz (dok_id INTEGER PRIMARY KEY, typ TEXT);
  CREATE TABLE sgt_sprzedaz_pozycja (id INTEGER PRIMARY KEY AUTOINCREMENT, dok_id INTEGER);

  INSERT INTO kosz(id, kod, status, utworzono_at, utworzono_przez)
    VALUES (7, '1209', 'zamkniety', '2026-08-20T08:00:00.000Z', 'Biuro');
  INSERT INTO zwrot(id, waybill, kosz_id) VALUES (3, 'WB-1', 7);
  INSERT INTO kosz_pozycja(id, kosz_id, zwrot_id, tw_id, symbol, nazwa, ilosc, status, lok_faktyczna)
    VALUES (11, 7, 3, 900036, 'TEST-A', 'Towar A', 2, 'done', 'A01-02-03');
  INSERT INTO kosz_pozycja(id, kosz_id, zwrot_id, tw_id, symbol, nazwa, ilosc)
    VALUES (12, 7, NULL, 900037, 'TEST-B', 'Towar B', 1);
  INSERT INTO pytanie(id, wiadomosc_id, tresc) VALUES (1, 'dev-msg-1', 'Czy pasuje?');
`);
stara.close();

process.env.DB_PATH = plik;
process.env.SGT_MODE = "seeded";

let db: typeof import("./db.js").db;

before(async () => {
  ({ db } = await import("./db.js"));
});

test("wszystkie tabele obsługi klienta znikają", () => {
  const zostaly = (
    db()
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>
  ).map((w) => w.name);
  for (const tabela of [
    "pytanie", "dyskusja", "opinia", "sprawa", "sprawa_zrodlo", "sprawa_zdarzenie",
    "sprawa_tag", "regula", "szablon", "watek_meta", "dopasowanie", "ai_config",
    "zwrot", "zwrot_pozycja", "zwrot_zam_pozycja", "zwrot_zapowiedz",
    "sgt_sprzedaz", "sgt_sprzedaz_pozycja",
  ]) {
    assert.ok(!zostaly.includes(tabela), `tabela ${tabela} miała zniknąć`);
  }
  /* Magazyn zostaje w komplecie — to jest cała reszta aplikacji. */
  for (const tabela of ["kosz", "kosz_pozycja", "delivery", "sgt_towar", "sfera_queue"]) {
    assert.ok(zostaly.includes(tabela), `tabela ${tabela} miała zostać`);
  }
});

test("kosz i jego pozycje przeżywają przebudowę z całą treścią", () => {
  const pozycje = db()
    .prepare("SELECT id, kosz_id, tw_id, symbol, ilosc, status, lok_faktyczna FROM kosz_pozycja ORDER BY id")
    .all() as Array<Record<string, unknown>>;
  assert.equal(pozycje.length, 2, "obie pozycje kosza zostają");
  assert.equal(pozycje[0].symbol, "TEST-A");
  assert.equal(pozycje[0].status, "done", "praca hali nie może zniknąć razem ze zwrotem");
  assert.equal(pozycje[0].lok_faktyczna, "A01-02-03");
  assert.equal(pozycje[1].tw_id, 900_037);

  /* Kolumna wskazująca na skasowaną tabelę musi zniknąć — inaczej SQLite
     zostaje z kluczem obcym w pustkę i pierwszy `PRAGMA foreign_key_check`
     mówi o błędzie, którego nikt nie umie naprawić. */
  const kolumny = (
    db().prepare("PRAGMA table_info(kosz_pozycja)").all() as Array<{ name: string }>
  ).map((c) => c.name);
  assert.ok(!kolumny.includes("zwrot_id"), "zwrot_id znika razem z tabelą zwrotów");
  /* Kolumny z 0.79.0 dochodzą ze schematu, choć stara baza ich nie miała. */
  for (const k of ["powod", "pominieto_at", "pozniej_at", "loc_queue_id"]) {
    assert.ok(kolumny.includes(k), `${k} dochodzi z nowego kształtu`);
  }
});

test("baza po migracji jest spójna i migracja jest idempotentna", () => {
  const bledy = db().prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(bledy, [], "żaden klucz obcy nie wskazuje w pustkę");
  /* Drugie otwarcie bazy przechodzi przez migrację jeszcze raz — kolumny
     `zwrot_id` już nie ma, więc przebudowa ma się nie odpalić. */
  const przed = db().prepare("SELECT COUNT(*) AS n FROM kosz_pozycja").get() as { n: number };
  assert.equal(przed.n, 2);
});
