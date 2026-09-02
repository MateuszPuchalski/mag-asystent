import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Dobór przeżywa własną migrację (etap E1) ────────────────────────────────
   Ta sama mina, która wybuchła przy sprawie w 0.161.0: `migrate()` kasuje
   przy każdym starcie nakładki po starej implementacji, a wśród nich
   `dopasowanie`. Tabela nazwana tak, jak podpowiada §11, powstałaby ze
   `schema.sql` i znikała sekundę później — bez błędu, bez wyjątku.

   Stąd `dobor_rozmowy`. Ten plik pilnuje obu połów umowy naraz: nowa nazwa
   przeżywa, spalona nadal znika.                                             */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function poMigracji() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.exec(`INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a');
    INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,'w-1');`);
  return d;
}

const istnieje = (d: DatabaseSync, tabela: string) =>
  Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela));

test("dobór przeżywa kasatę nakładek, a spalona nazwa nadal znika", () => {
  const d = poMigracji();
  assert.equal(istnieje(d, "dobor_rozmowy"), true, "dobor_rozmowy musi przeżyć migrate()");
  /* Druga połowa umowy: zieleni nie kupuje się wykreśleniem nazwy z listy
     dropów. Baza klienta ma `dopasowanie` stracić. */
  assert.equal(istnieje(d, "dopasowanie"), false, "dopasowanie to nazwa spalona");
  d.close();
});

test("status spoza §7 odbija się o CHECK — lista jest zamknięta dokumentem", () => {
  const d = poMigracji();
  assert.throws(() => d.prepare(
    "INSERT INTO dobor_rozmowy(conversation_id,status) VALUES (1,'in_progress')").run(), /CHECK/);
  /* Wszystkie dziewięć wartości z §7 wchodzą — także te bez nadawcy w E:
     `extracting_data` odrzuca SERWIS, nie baza, bo nada je Copilot (F). */
  for (const status of ["not_started", "extracting_data", "missing_information", "searching",
    "candidates_found", "requires_expert", "confirmed", "rejected", "not_applicable"]) {
    d.prepare("DELETE FROM dobor_rozmowy").run();
    d.prepare("INSERT INTO dobor_rozmowy(conversation_id,status) VALUES (1,?)").run(status);
  }
  d.close();
});

test("droga wyboru spoza §11.2 odbija się o CHECK", () => {
  const d = poMigracji();
  assert.throws(() => d.prepare(
    "INSERT INTO dobor_rozmowy(conversation_id,wybrany_droga) VALUES (1,'zgadywanie')").run(), /CHECK/);
  d.close();
});

test("drugi dobór tej samej rozmowy odbija się o klucz", () => {
  /* Jedna rozmowa = jeden dobór. Reguła stoi w KSZTAŁCIE tabeli, nie
     w dyscyplinie serwisu — jak `sprawa_klienta_rozmowa`. */
  const d = poMigracji();
  d.prepare("INSERT INTO dobor_rozmowy(conversation_id) VALUES (1)").run();
  assert.throws(() => d.prepare("INSERT INTO dobor_rozmowy(conversation_id) VALUES (1)").run(),
    /UNIQUE|PRIMARY/);
  d.close();
});

test("skasowanie rozmowy zabiera dobór, ale nie ma klucza do sgt_towar", () => {
  const d = poMigracji();
  d.prepare(`INSERT INTO dobor_rozmowy(conversation_id,wybrany_tw_id,wybrany_symbol)
    VALUES (1,999999,'NIE-MA-TAKIEJ')`).run();
  /* Read-model Subiekta jest odtwarzany przy każdym imporcie (blizna 0.154.0):
     wybór wskazujący na `tw_id`, którego chwilowo nie ma, MUSI się zapisać. */
  assert.equal((d.prepare("SELECT count(*) n FROM dobor_rozmowy").get() as { n: number }).n, 1);
  d.prepare("DELETE FROM conversation WHERE id=1").run();
  assert.equal((d.prepare("SELECT count(*) n FROM dobor_rozmowy").get() as { n: number }).n, 0);
  d.close();
});
