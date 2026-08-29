import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* ── Migracja: piąte źródło w CHECK-ach (0.135.0) ────────────────────────────
   SQLite nie umie zmienić CHECK-a w miejscu, więc tabelę trzeba przebudować.
   Test stawia bazę ZE STARYM ograniczeniem — takim, jaką ma produkcja sprzed
   tej wersji — i sprawdza trzy rzeczy: opinia da się zapisać, dane przeżyły
   przebudowę, a drugi przebieg niczego nie psuje.                            */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-migr-op-"));

/** Baza w kształcie sprzed 0.135.0: CHECK bez `opinia`. */
function bazaStara(plik: string): void {
  const d = new DatabaseSync(plik);
  d.exec(`
    -- Tabela sprawa w pełnym kształcie sprzed 0.135.0: schema.sql zakłada
    -- tabele przez IF NOT EXISTS, ale indeksy na ich kolumnach zawsze.
    CREATE TABLE sprawa (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      kupujacy_id    TEXT,
      kupujacy_login TEXT,
      order_id       TEXT,
      prowadzi       TEXT,
      prowadzi_at    TEXT,
      utworzono_at   TEXT NOT NULL,
      zamknieto_at   TEXT
    );
    CREATE TABLE sprawa_zrodlo (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      sprawa_id   INTEGER NOT NULL REFERENCES sprawa(id),
      rodzaj      TEXT NOT NULL CHECK (rodzaj IN ('pytanie','zwrot','dyskusja','reklamacja')),
      lokalny_id  INTEGER NOT NULL,
      allegro_id  TEXT,
      wiazanie    TEXT NOT NULL DEFAULT 'auto',
      dodano_at   TEXT NOT NULL,
      UNIQUE (rodzaj, lokalny_id)
    );
    CREATE TABLE sprawa_zdarzenie (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      rodzaj      TEXT NOT NULL CHECK (rodzaj IN ('pytanie','zwrot','dyskusja','reklamacja')),
      lokalny_id  INTEGER NOT NULL,
      typ         TEXT NOT NULL,
      kto         TEXT NOT NULL CHECK (kto IN ('klient','my','allegro')),
      autor       TEXT,
      szczegol    TEXT,
      kiedy_at    TEXT NOT NULL,
      zapisano_at TEXT NOT NULL,
      klucz       TEXT NOT NULL UNIQUE
    );
    INSERT INTO sprawa(utworzono_at) VALUES ('2026-08-01T08:00:00Z');
    INSERT INTO sprawa_zrodlo(sprawa_id, rodzaj, lokalny_id, wiazanie, dodano_at)
      VALUES (1, 'zwrot', 7, 'reczne', '2026-08-01T08:00:00Z');
    INSERT INTO sprawa_zdarzenie(rodzaj, lokalny_id, typ, kto, kiedy_at, zapisano_at, klucz)
      VALUES ('zwrot', 7, 'zalozona', 'klient', '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z', 'zwrot:7:zalozona:');
  `);
  d.close();
}

test("stary CHECK odmawia opinii, a po migracji przyjmuje ją bez utraty danych", async () => {
  const plik = path.join(katalog, "t.db");
  bazaStara(plik);

  /* Dowód, że migracja jest w ogóle potrzebna: przed nią zapis odmawia. */
  const przed = new DatabaseSync(plik);
  assert.throws(
    () =>
      przed
        .prepare(
          `INSERT INTO sprawa_zrodlo(sprawa_id, rodzaj, lokalny_id, wiazanie, dodano_at)
           VALUES (1, 'opinia', 5, 'auto', '2026-08-02T08:00:00Z')`
        )
        .run(),
    /CHECK/i
  );
  przed.close();

  process.env.DB_PATH = plik;
  process.env.SGT_MODE = "seeded";
  const { db } = await import("./db.js");
  const d = db(); // migracje chodzą przy pierwszym otwarciu

  d.prepare(
    `INSERT INTO sprawa_zrodlo(sprawa_id, rodzaj, lokalny_id, wiazanie, dodano_at)
     VALUES (1, 'opinia', 5, 'auto', '2026-08-02T08:00:00Z')`
  ).run();
  d.prepare(
    `INSERT INTO sprawa_zdarzenie(rodzaj, lokalny_id, typ, kto, kiedy_at, zapisano_at, klucz)
     VALUES ('opinia', 5, 'zalozona', 'klient', '2026-08-02T08:00:00Z', '2026-08-02T08:00:00Z', 'opinia:5:zalozona:')`
  ).run();

  /* Dane sprzed przebudowy przeżyły — razem z ręcznym wiązaniem, którego
     utrata rozkleiłaby sprawy scalone ręką człowieka. */
  const zrodla = d
    .prepare("SELECT rodzaj, lokalny_id, wiazanie FROM sprawa_zrodlo ORDER BY id")
    .all() as Array<{ rodzaj: string; lokalny_id: number; wiazanie: string }>;
  assert.deepEqual(
    zrodla.map((z) => `${z.rodzaj}:${z.lokalny_id}:${z.wiazanie}`),
    ["zwrot:7:reczne", "opinia:5:auto"]
  );
  assert.equal(
    (d.prepare("SELECT COUNT(*) AS n FROM sprawa_zdarzenie").get() as { n: number }).n,
    2
  );

  /* UNIQUE przeżył przebudowę — bez niego jedno źródło trafiłoby do dwóch
     spraw, czyli runąłby cały model nakładki. */
  assert.throws(
    () =>
      d
        .prepare(
          `INSERT INTO sprawa_zrodlo(sprawa_id, rodzaj, lokalny_id, wiazanie, dodano_at)
           VALUES (1, 'opinia', 5, 'auto', '2026-08-03T08:00:00Z')`
        )
        .run(),
    /UNIQUE/i
  );

  /* Indeks odtworzony po przebudowie — inaczej kolejka spraw schodziłaby
     pełnym skanem przy każdym odczycie. */
  const indeksy = (
    d.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
      name: string;
    }>
  ).map((i) => i.name);
  assert.ok(indeksy.includes("ix_sprawa_zrodlo"));
  assert.ok(indeksy.includes("ix_sprawa_zdarzenie"));
});
