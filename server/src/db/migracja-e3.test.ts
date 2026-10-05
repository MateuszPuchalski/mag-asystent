import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Identyfikatory z opisów (etap E3) ──────────────────────────────────────
   Nowe nazwy przeżywają `migrate()`, spalone nadal znikają. Tabela jest
   pochodna i nie ma klucza obcego do read-modelu, bo import go wycina,
   a identyfikatory muszą dać się odbudować.                                */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function poMigracji() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.exec(`INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a');
    INSERT INTO app_user(login,name,role) VALUES ('ala','Ala','biuro');`);
  return d;
}

const istnieje = (d: DatabaseSync, tabela: string) =>
  Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela));

test("identyfikatory przeżywają kasatę nakładek, spalone nadal znikają", () => {
  const d = poMigracji();
  assert.equal(istnieje(d, "towar_identyfikator"), true, "towar_identyfikator musi przeżyć migrate()");
  assert.equal(istnieje(d, "dopasowanie"), false);
  d.close();
});

test("identyfikator: CHECK rodzaju i źródła, UNIQUE po zwiniętej wartości, brak FK do sgt_towar", () => {
  const d = poMigracji();
  const wstaw = (rodzaj: string, zrodlo: string, norm = "5321656-30") => d.prepare(
    `INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal)
     VALUES (999999,'X',?,'532 16 56-30',?,?,'Ala')`).run(rodzaj, norm, zrodlo);
  /* `tw_id` bez wiersza w `sgt_towar` MUSI wejść — read-model bywa chwilowo pusty. */
  wstaw("oem", "opis");
  assert.throws(() => wstaw("oem", "reczne"), /UNIQUE/);
  wstaw("nr_oryg", "reczne");
  /* Piąty rodzaj (0.234.0) — numery z sekcji „Zamiennik:". */
  wstaw("zamiennik", "opis", "3");
  assert.throws(() => wstaw("ean", "opis", "1"), /CHECK/);
  assert.throws(() => wstaw("oem", "copilot", "2"), /CHECK/);
  d.close();
});

test("baza sprzed 0.234.0 dostaje piąty rodzaj identyfikatora, nie tracąc wierszy", () => {
  /* SQLite nie rozszerza CHECK w miejscu, więc migracja PRZEPISUJE tabelę.
     Wiersz ręczny musi ją przeżyć: przebudowa po imporcie kasuje wyłącznie
     `zrodlo='opis'`, więc skasowany tutaj nie wróciłby już nigdy. */
  const d = new DatabaseSync(":memory:");
  /* Pełny schemat, a POTEM tabela cofnięta do dawnego kształtu: migracje
     wołane przez `migrate()` zakładają obecność sąsiednich tabel, a ta jedna
     ma być stara. */
  d.exec(schema);
  d.exec("DROP TABLE towar_identyfikator");
  d.exec(`CREATE TABLE towar_identyfikator (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tw_id INTEGER NOT NULL, tw_symbol TEXT NOT NULL,
    rodzaj TEXT NOT NULL CHECK (rodzaj IN ('oem','nr_oryg','katalog_obcy','stare_sku')),
    wartosc TEXT NOT NULL, wartosc_norm TEXT NOT NULL,
    zrodlo TEXT NOT NULL CHECK (zrodlo IN ('opis','reczne')),
    dodal TEXT NOT NULL, dodal_user_id INTEGER,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (tw_id, rodzaj, wartosc_norm));`);
  d.prepare(`INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal)
    VALUES (7,'W07-1301','katalog_obcy','HQ-12345','hq12345','reczne','Ala')`).run();
  assert.throws(() => d.prepare(`INSERT INTO towar_identyfikator
    (tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal)
    VALUES (7,'W07-1301','zamiennik','76-041','76041','opis','import')`).run(), /CHECK/);

  migrate(d);

  d.prepare(`INSERT INTO towar_identyfikator
    (tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal)
    VALUES (7,'W07-1301','zamiennik','76-041','76041','opis','import')`).run();
  const reczny = d.prepare(
    "SELECT dodal, zrodlo FROM towar_identyfikator WHERE wartosc_norm='hq12345'").get() as
    { dodal: string; zrodlo: string } | undefined;
  assert.equal(reczny?.dodal, "Ala", "wpis biura przeżywa przebudowę tabeli");
  assert.equal(reczny?.zrodlo, "reczne");
  /* Indeksy wracają razem z tabelą — bez nich szukanie po numerze schodzi
     do skanu przy każdym pytaniu klienta. */
  const indeksy = (d.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='towar_identyfikator'")
    .all() as Array<{ name: string }>).map((i) => i.name);
  assert.ok(indeksy.includes("ix_towar_identyfikator_norm"), `indeksy: ${indeksy.join(", ")}`);
  assert.ok(indeksy.includes("ix_towar_identyfikator_tw"), `indeksy: ${indeksy.join(", ")}`);
  d.close();
});
