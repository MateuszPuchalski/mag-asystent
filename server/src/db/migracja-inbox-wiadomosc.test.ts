import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* Lądowisko skrzynki opisywało Allegro, którego nie ma: `author_role` i `read`
   to pola, których Centrum wiadomości nie przysyła w żadnej odpowiedzi.
   Wartości brały się więc nie z kanału, tylko z wyobrażenia o nim.

   Bazę sprzed migracji budujemy RĘCZNIE, w kształcie z 0.144.0.
   `CREATE TABLE IF NOT EXISTS` w schemacie nie nadpisze tej tabeli, więc
   migracja dostaje dokładnie to, co stoi u klienta. */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

const STARA_TABELA = `
  CREATE TABLE allegro_inbox_thread (
    id TEXT PRIMARY KEY,
    read INTEGER NOT NULL,
    last_message_at TEXT NOT NULL,
    interlocutor_login TEXT NOT NULL,
    surowe_json TEXT NOT NULL,
    synced_at TEXT NOT NULL
  );
  CREATE TABLE allegro_inbox_message (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES allegro_inbox_thread(id) ON DELETE CASCADE,
    author_login TEXT NOT NULL,
    author_role TEXT NOT NULL,
    text TEXT NOT NULL,
    related_object_type TEXT,
    related_object_id TEXT,
    read INTEGER NOT NULL,
    surowe_json TEXT NOT NULL
  );
`;

function bazaSprzedMigracji() {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON");
  d.exec(STARA_TABELA);
  d.prepare(`INSERT INTO allegro_inbox_thread
    (id,read,last_message_at,interlocutor_login,surowe_json,synced_at)
    VALUES ('t-1',0,'2026-08-30T12:00:00Z','anon-1','{}','2026-08-30T12:05:00Z')`).run();
  d.prepare(`INSERT INTO allegro_inbox_message
    (id,thread_id,author_login,author_role,text,related_object_type,related_object_id,read,surowe_json)
    VALUES ('m-1','t-1','anon-1','BUYER','Zanonimizowana treść.','OFFER','oferta-1',0,
    '{"surowa":"odpowiedź Allegro"}')`).run();
  d.prepare(`INSERT INTO allegro_inbox_message
    (id,thread_id,author_login,author_role,text,related_object_type,related_object_id,read,surowe_json)
    VALUES ('m-2','t-1','wertis','SELLER','Nasza odpowiedź.',NULL,NULL,1,'{}')`).run();
  return d;
}

const kolumny = (d: DatabaseSync) =>
  (d.prepare("PRAGMA table_info(allegro_inbox_message)").all() as Array<{ name: string }>)
    .map((k) => k.name);

test("migracja wymienia pola bez pokrycia w Allegro na te, które kanał przysyła", () => {
  const d = bazaSprzedMigracji();
  d.exec(schema);
  migrate(d);

  const nazwy = kolumny(d);
  for (const brak of ["author_role", "read"]) {
    assert.ok(!nazwy.includes(brak), `kolumna ${brak} nie ma źródła w odpowiedzi Allegro`);
  }
  for (const jest of ["author_is_interlocutor", "status", "created_at", "subject"]) {
    assert.ok(nazwy.includes(jest), `brakuje kolumny ${jest}`);
  }
});

test("przebudowa przepisuje wiersze, a rolę tłumaczy na rozmówcę", () => {
  /* Kasowanie tabeli byłoby tańsze, ale zabrałoby `surowe_json` — jedyny ślad
     prawdziwej odpowiedzi Allegro, gdyby jakiś wiersz jednak powstał. */
  const d = bazaSprzedMigracji();
  d.exec(schema);
  migrate(d);

  const wiersze = d.prepare(`SELECT id, author_is_interlocutor i, text, related_object_id o,
    surowe_json s FROM allegro_inbox_message ORDER BY id`).all() as
    Array<{ id: string; i: number; text: string; o: string | null; s: string }>;
  assert.deepEqual(wiersze.map((w) => ({ ...w })), [
    { id: "m-1", i: 1, text: "Zanonimizowana treść.", o: "oferta-1",
      s: '{"surowa":"odpowiedź Allegro"}' },
    { id: "m-2", i: 0, text: "Nasza odpowiedź.", o: null, s: "{}" },
  ]);
});

test("indeks po wątku wraca po przebudowie", () => {
  /* `DROP TABLE` zabiera indeksy ze sobą. Bez odtworzenia każdy odczyt wątku
     skanowałby całą skrzynkę aż do następnego otwarcia bazy. */
  const d = bazaSprzedMigracji();
  d.exec(schema);
  migrate(d);

  const indeksy = (d.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='allegro_inbox_message'")
    .all() as Array<{ name: string }>).map((i) => i.name);
  assert.ok(indeksy.includes("ix_allegro_inbox_message_thread"));
});

test("druga migracja na tej samej bazie nic nie robi", () => {
  /* API i worker startują razem przez NSSM i oba wołają `migrate()`. Drugie
     wejście ma być bezczynne, a nie przebudować tabelę jeszcze raz. */
  const d = bazaSprzedMigracji();
  d.exec(schema);
  migrate(d);
  migrate(d);

  const ile = (d.prepare("SELECT count(*) n FROM allegro_inbox_message").get() as { n: number }).n;
  assert.equal(ile, 2, "wiadomości zdublowały się przy drugiej migracji");
});

test("świeża instalacja przechodzi migrację bez przebudowy", () => {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON");
  d.exec(schema);
  migrate(d);
  migrate(d);

  assert.ok(kolumny(d).includes("author_is_interlocutor"));
});
