import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* Awaria z 1 września 2026: po restarcie usług API padało w pętli na
   `FOREIGN KEY constraint failed`. Przyczyną było `zadanie_terenowe.tw_id`
   wskazujące na `sgt_towar(tw_id)` bez `ON DELETE`, przy imporcie, który
   kasuje cały read-model Subiekta. Jedno zadanie ze wskazanym towarem
   wywracało `DELETE FROM sgt_towar`, a że import biegnie przed nasłuchem —
   kładło całe API.

   Bazę sprzed migracji budujemy RĘCZNIE, w kształcie z 0.141.0: zadania już
   są, ale nie znają jeszcze rozmów. `CREATE TABLE IF NOT EXISTS` w schemacie
   nie nadpisze tej tabeli, więc migracja dostaje dokładnie to, co stoi
   u klienta. */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

const STARA_TABELA = `
  CREATE TABLE sgt_towar (
    tw_id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, nazwa TEXT NOT NULL,
    ean TEXT, unit TEXT, opis TEXT, lokalizacja TEXT
  );
  CREATE TABLE zadanie_terenowe (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rodzaj TEXT NOT NULL CHECK (rodzaj IN ('pomiar','zdjecie','weryfikacja','inne')),
    tytul TEXT NOT NULL,
    instrukcja TEXT NOT NULL,
    tw_id INTEGER REFERENCES sgt_towar(tw_id),
    zrodlo TEXT NOT NULL DEFAULT 'reczne',
    zrodlo_ref TEXT,
    priorytet TEXT NOT NULL DEFAULT 'normalny' CHECK (priorytet IN ('normalny','pilny')),
    status TEXT NOT NULL DEFAULT 'nowe' CHECK (status IN ('nowe','w_toku','wykonane','anulowane')),
    utworzono_at TEXT NOT NULL, utworzono_przez TEXT NOT NULL,
    utworzono_user_id INTEGER,
    przypisano_at TEXT, przypisano_przez TEXT, przypisano_user_id INTEGER,
    wynik TEXT, wykonano_at TEXT, wykonano_przez TEXT, wykonano_user_id INTEGER,
    anulowano_at TEXT, anulowano_przez TEXT
  );
`;

function bazaSprzedMigracji() {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON");
  d.exec(STARA_TABELA);
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
    .run(40312, "SZR-148/82", "Szarpak rozrusznika 148 mm");
  d.prepare(`INSERT INTO zadanie_terenowe(rodzaj,tytul,instrukcja,tw_id,zrodlo,priorytet,
    status,utworzono_at,utworzono_przez,wynik,wykonano_przez)
    VALUES ('pomiar','Zmierz rozstaw otworów','Od środka do środka, w mm.',40312,
    'skrzynka','pilny','wykonane','2026-09-01T08:12:00.000Z','A. Lewandowska',
    'Rozstaw 148 mm.','M. Kowal')`).run();
  return d;
}

/** To, co robi importer read-modelu przy każdym odświeżeniu z Subiekta. */
const przebudujReadModel = (d: DatabaseSync) => d.prepare("DELETE FROM sgt_towar").run();

test("baza sprzed migracji ODTWARZA awarię — inaczej test niczego nie dowodzi", () => {
  const d = bazaSprzedMigracji();
  assert.throws(() => przebudujReadModel(d), /FOREIGN KEY constraint failed/);
});

test("po migracji import read-modelu przechodzi, a zadanie zostaje", () => {
  const d = bazaSprzedMigracji();
  d.exec(schema);
  migrate(d);

  przebudujReadModel(d);

  const z = d.prepare(`SELECT tytul, instrukcja, tw_id, wynik, wykonano_przez, priorytet, status
    FROM zadanie_terenowe`).get() as Record<string, unknown>;
  /* Powiązanie znika, bo towar zniknął — ale zadanie niesie własny opis
     i wynik z hali, więc nadal mówi, o co chodziło. */
  assert.equal(z.tw_id, null);
  assert.equal(z.tytul, "Zmierz rozstaw otworów");
  assert.equal(z.wynik, "Rozstaw 148 mm.");
  assert.equal(z.wykonano_przez, "M. Kowal");
  assert.equal(z.priorytet, "pilny");
  assert.equal(z.status, "wykonane");
});

test("migracja dokłada kolumny rozmowy PRZED przebudową, więc ich nie gubi", () => {
  /* Kolejność w `migrate()` ma znaczenie: przebudowa kopiuje kolumny po
     nazwach, więc musi widzieć tabelę już uzupełnioną o `conversation_id`
     i `message_id`. Odwrotna kolejność kasowałaby powiązanie zadania
     z rozmową przy każdej aktualizacji ze starszej bazy. */
  const d = bazaSprzedMigracji();
  d.exec(schema);
  migrate(d);

  const kolumny = (d.prepare("PRAGMA table_info(zadanie_terenowe)").all() as Array<{ name: string }>)
    .map((k) => k.name);
  assert.ok(kolumny.includes("conversation_id"));
  assert.ok(kolumny.includes("message_id"));
});

test("klucz obcy niesie SET NULL, a indeksy wracają po przebudowie", () => {
  const d = bazaSprzedMigracji();
  d.exec(schema);
  migrate(d);

  const klucz = (d.prepare("PRAGMA foreign_key_list(zadanie_terenowe)").all() as
    Array<{ table: string; on_delete: string }>).find((k) => k.table === "sgt_towar");
  assert.equal(klucz?.on_delete, "SET NULL");

  /* `DROP TABLE` zabiera indeksy ze sobą. Bez odtworzenia kolejka zadań na
     kolektorze skanowałaby całą tabelę aż do następnego otwarcia bazy. */
  const indeksy = (d.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='zadanie_terenowe'")
    .all() as Array<{ name: string }>).map((i) => i.name);
  for (const nazwa of ["ix_zadanie_terenowe_status", "ix_zadanie_terenowe_przypisane",
    "ix_zadanie_terenowe_towar"]) {
    assert.ok(indeksy.includes(nazwa), `brakuje indeksu ${nazwa}`);
  }
});

test("druga migracja na tej samej bazie nic nie robi", () => {
  /* API i worker startują razem przez NSSM i oba wołają `migrate()`. Drugie
     wejście ma być bezczynne, a nie przebudować tabelę jeszcze raz. */
  const d = bazaSprzedMigracji();
  d.exec(schema);
  migrate(d);
  const idPrzed = (d.prepare("SELECT id FROM zadanie_terenowe").get() as { id: number }).id;

  migrate(d);

  const po = d.prepare("SELECT id, tytul FROM zadanie_terenowe").all() as Array<{ id: number }>;
  assert.equal(po.length, 1, "zadanie zdublowało się przy drugiej migracji");
  assert.equal(po[0].id, idPrzed, "identyfikator zadania się zmienił");
});

test("baza już naprawiona przechodzi migrację bez przebudowy", () => {
  /* Świeża instalacja dostaje `ON DELETE SET NULL` wprost ze `schema.sql`,
     więc migracja nie ma tam czego robić. */
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON");
  d.exec(schema);
  migrate(d);
  migrate(d);

  const klucz = (d.prepare("PRAGMA foreign_key_list(zadanie_terenowe)").all() as
    Array<{ table: string; on_delete: string }>).find((k) => k.table === "sgt_towar");
  assert.equal(klucz?.on_delete, "SET NULL");
});
