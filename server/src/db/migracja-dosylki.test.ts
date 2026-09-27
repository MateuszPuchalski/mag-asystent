import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "./db.js";

/* ── Dosyłka z 0.536.0 dostaje cztery kolumny (@wydanie) ─────────────────────
   0.536.0 założył `klient_dosylka` bez `numer_at`, `archiwalna`, `doreczen`
   i `problemow`. Baza, która przeszła tamto wydanie, ma tabelę w starym
   kształcie, a `schema.sql` jej nie poprawi. Stanowisko stawia DOKŁADNIE ten
   stary kształt, bo test na świeżym schemacie przeszedłby bez migracji.

   Liczniki biorą wartość z obecnego stanu wiersza, inaczej zapisany odcisk
   `k: 1` połknąłby następne doręczenie. Drugi przebieg `migrate()` niczego
   nie rusza: licznik po starcie należy już do tickera.                      */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

/** Tabela w kształcie z 0.536.0 — bez kluczy obcych, bo test patrzy na kolumny. */
const KSZTALT_0536 = `CREATE TABLE klient_dosylka (
  sprawa_id INTEGER NOT NULL, konto INTEGER NOT NULL, zamowienie TEXT NOT NULL,
  zwrot_id INTEGER, waybill TEXT, przewoznik TEXT, zrodlo TEXT, status TEXT,
  dostarczono_at TEXT, sprawdzono_at TEXT, zalozono_at TEXT NOT NULL,
  PRIMARY KEY (sprawa_id, zamowienie))`;

function bazaZ0536() {
  const d = new DatabaseSync(":memory:");
  d.exec(KSZTALT_0536);
  d.exec(schema);
  const wstaw = d.prepare(`INSERT INTO klient_dosylka
    (sprawa_id, konto, zamowienie, status, dostarczono_at, zalozono_at)
    VALUES (?, 1, ?, ?, ?, '2026-09-27T09:30:00Z')`);
  wstaw.run(1, "z-doreczona", "DELIVERED", "2026-09-28T10:00:00Z");
  wstaw.run(1, "z-klopot", "ISSUE", null);
  wstaw.run(1, "z-w-drodze", "IN_TRANSIT", null);
  return d;
}

const wiersz = (d: DatabaseSync, zamowienie: string) => d.prepare(
  "SELECT numer_at, archiwalna, doreczen, problemow FROM klient_dosylka WHERE zamowienie = ?")
  .get(zamowienie) as { numer_at: string | null; archiwalna: number; doreczen: number; problemow: number };

test("dosyłka z 0.536.0 dostaje cztery kolumny, a liczniki biorą stan wiersza", () => {
  const d = bazaZ0536();
  migrate(d);
  assert.deepEqual({ ...wiersz(d, "z-doreczona") }, { numer_at: null, archiwalna: 0, doreczen: 1, problemow: 0 });
  assert.deepEqual({ ...wiersz(d, "z-klopot") }, { numer_at: null, archiwalna: 0, doreczen: 0, problemow: 1 });
  assert.deepEqual({ ...wiersz(d, "z-w-drodze") }, { numer_at: null, archiwalna: 0, doreczen: 0, problemow: 0 });
});

test("drugi przebieg migracji nie przelicza liczników, które prowadzi już ticker", () => {
  const d = bazaZ0536();
  migrate(d);
  d.exec("UPDATE klient_dosylka SET doreczen = 2, problemow = 3 WHERE zamowienie = 'z-doreczona'");
  migrate(d);
  assert.equal(wiersz(d, "z-doreczona").doreczen, 2);
  assert.equal(wiersz(d, "z-doreczona").problemow, 3);
});

test("zapisany odcisk z 0.536.0 schodzi do nowej sumy, żeby następny kłopot obudził sprawę", () => {
  /* 0.536.0 liczył `q` jako wiersze z kłopotem TERAZ. Agent potwierdził dwa
     kłopoty, potem jedna paczka ruszyła dalej: zapisane `q: 2`, a nowa suma
     przejść wynosi 1. Bez przycięcia następny kłopot dałby 2 — nie więcej
     niż 2 — i sprawa by nie wstała. Pozostałe klucze odcisku zostają. */
  const d = bazaZ0536();
  const odcisk = JSON.stringify({ m: "2026-09-27T08:00:00Z", z: 3, k: 1, q: 2 });
  d.prepare(`INSERT INTO klient_prowadzenie (id, login, krok, krok_do, znane_json, zmieniono_at, zmieniono_przez,
      przed_zakonczeniem_znane_json)
    VALUES (1, 'kl', 'Dosłać', '2026-10-01T06:00:00Z', ?, '2026-09-27T09:00:00Z', 'Ala', ?)`).run(odcisk, odcisk);
  d.prepare("INSERT INTO klient_prowadzenie (id, login, krok, krok_do, znane_json, zmieniono_at, zmieniono_przez) "
    + "VALUES (2, 'inny', 'x', '2026-10-01T06:00:00Z', '{\"m\":null,\"z\":0}', '2026-09-27T09:00:00Z', 'Ala')").run();
  migrate(d);
  const w = d.prepare("SELECT znane_json AS z, przed_zakonczeniem_znane_json AS p FROM klient_prowadzenie WHERE id = ?");
  const pierwsza = w.get(1) as { z: string; p: string };
  assert.deepEqual(JSON.parse(pierwsza.z), { m: "2026-09-27T08:00:00Z", z: 3, k: 1, q: 1 });
  assert.deepEqual(JSON.parse(pierwsza.p), { m: "2026-09-27T08:00:00Z", z: 3, k: 1, q: 1 });
  assert.deepEqual(JSON.parse((w.get(2) as { z: string }).z), { m: null, z: 0 },
    "odcisk bez kluczy dosyłki zostaje bez nich — brak klucza nie budzi");
});
