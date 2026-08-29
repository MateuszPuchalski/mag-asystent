import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/* ── Encja sprawy — migracja (0.128.0) ───────────────────────────────────────
   Dwie rzeczy gonią stare bazy: kolumna `pytanie.kupujacy_id` dosypywana
   Z MASKI loginu i istnienie tabel sprawa/sprawa_zrodlo. Dosypka musi być
   wąska: prawdziwy login nie jest identyfikatorem, więc dostaje NULL, nie
   zgadywankę. Konstrukcja jak w migracja-encje.test.ts.                      */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-sprawa-"));
const plik = path.join(katalog, "stara.db");

const schemat = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql"),
  "utf8"
);
const stara = new DatabaseSync(plik);
stara.exec(schemat);
/* Kolumna świeżo weszła do CREATE — symulujemy bazę sprzed 0.128.0,
   zdejmując ją, żeby migracja miała co dosypać. */
stara.exec("ALTER TABLE pytanie DROP COLUMN kupujacy_id");
stara.exec(`
  INSERT INTO pytanie (zrodlo, thread_id, wiadomosc_id, kupujacy_login, tresc, otrzymano_at, status, utworzono_at, utworzono_przez) VALUES
    ('allegro', 't1', 'w1', 'client:44300444', 'gdzie paczka?', '2026-08-01', 'nowe', '2026-08-01', 'sync'),
    ('allegro', 't2', 'w2', 'jan_wraca', 'czy pasuje?', '2026-08-01', 'nowe', '2026-08-01', 'sync'),
    ('wklejka', NULL, NULL, NULL, 'ze screenshota', '2026-08-01', 'nowe', '2026-08-01', 'anna');
`);
stara.close();

process.env.DB_PATH = plik;
process.env.SGT_MODE = "seeded";

let db: typeof import("./db.js").db;

before(async () => {
  ({ db } = await import("./db.js"));
});

test("kupujacy_id dosypuje się z maski; prawdziwy login i wklejka dostają NULL", () => {
  const rzedy = db()
    .prepare("SELECT thread_id, kupujacy_id FROM pytanie ORDER BY id")
    .all() as Array<{ thread_id: string | null; kupujacy_id: string | null }>;
  assert.equal(rzedy[0].kupujacy_id, "44300444", "maska client:NNN oddaje NNN");
  assert.equal(rzedy[1].kupujacy_id, null, "prawdziwy login to nie identyfikator");
  assert.equal(rzedy[2].kupujacy_id, null, "wklejka nie ma rozmówcy");
});

test("tabele sprawa i sprawa_zrodlo istnieją z kluczem unikalności źródła", () => {
  const d = db();
  const kolumny = (d.prepare("PRAGMA table_info(sprawa)").all() as Array<{ name: string }>).map(
    (k) => k.name
  );
  for (const k of ["kupujacy_id", "kupujacy_login", "order_id", "prowadzi", "zamknieto_at"]) {
    assert.ok(kolumny.includes(k), `sprawa.${k}`);
  }
  d.prepare("INSERT INTO sprawa (utworzono_at) VALUES ('2026-08-01')").run();
  d.prepare(
    "INSERT INTO sprawa_zrodlo (sprawa_id, rodzaj, lokalny_id, dodano_at) VALUES (1,'pytanie',1,'2026-08-01')"
  ).run();
  assert.throws(
    () =>
      d
        .prepare(
          "INSERT INTO sprawa_zrodlo (sprawa_id, rodzaj, lokalny_id, dodano_at) VALUES (1,'pytanie',1,'2026-08-01')"
        )
        .run(),
    /UNIQUE/,
    "źródło należy do dokładnie jednej sprawy"
  );
});
