import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* Dosypka `message.related_order_id` z lądowiska (0.165.0).

   Do 0.164.0 synchronizator wyrzucał gałąź `relatesTo.order`, a wiadomości
   nie wjeżdżają drugi raz (`INSERT … DO NOTHING`). Numer został jednak
   w `allegro_inbox_message.surowe_json` i stamtąd ma wrócić — raz, bez
   nadpisywania tego, co już stoi, i bez zatrzymywania startu. */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function bazaPoStarymSynchronizatorze() {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,surowe_json,synced_at)
    VALUES ('t-1',1,'{}','2026-09-01T12:05:00Z')`).run();
  d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,updated_at)
    VALUES (1,'t-1','2026-09-01T12:00:00Z')`).run();

  const landowisko = d.prepare(`INSERT INTO allegro_inbox_message
    (id,thread_id,author_login,author_is_interlocutor,text,surowe_json)
    VALUES (?,'t-1','anon-1',1,'Zanonimizowana treść.',?)`);
  const model = d.prepare(`INSERT INTO message(conversation_id,channel_account_id,
    external_message_id,direction,body,related_order_id,sent_at)
    VALUES (1,1,?,'incoming','Zanonimizowana treść.',?,'2026-09-01T12:00:00Z')`);

  /* m-1: numer tylko w lądowisku — TO ma się dosypać. */
  landowisko.run("m-1", JSON.stringify({ relatesTo: { order: { id: "zam-1" }, offer: null } }));
  model.run("m-1", null);
  /* m-2: bez gałęzi `order` — ma zostać przy NULL, nie przy pustym tekście. */
  landowisko.run("m-2", JSON.stringify({ relatesTo: { order: null, offer: { id: "o-2" } } }));
  model.run("m-2", null);
  /* m-3: numer już stoi (wjechał nowym synchronizatorem) — nie nadpisujemy. */
  landowisko.run("m-3", JSON.stringify({ relatesTo: { order: { id: "inny" } } }));
  model.run("m-3", "zam-3");
  /* m-4: wiadomość spoza lądowiska (np. wysłana z panelu) — nie ma skąd dosypać. */
  model.run("m-4", null);
  return d;
}

const numery = (d: DatabaseSync) => (d.prepare(
  "SELECT external_message_id x, related_order_id z FROM message ORDER BY id").all() as
  Array<{ x: string; z: string | null }>).map((w) => ({ ...w }));

test("numer zamówienia wraca z lądowiska tam, gdzie go brakuje, i tylko tam", () => {
  const d = bazaPoStarymSynchronizatorze();
  migrate(d);
  assert.deepEqual(numery(d), [
    { x: "m-1", z: "zam-1" },
    { x: "m-2", z: null },
    { x: "m-3", z: "zam-3" },
    { x: "m-4", z: null },
  ]);
});

test("druga migracja niczego nie zmienia", () => {
  /* API i worker wołają `migrate()` równolegle przy starcie. */
  const d = bazaPoStarymSynchronizatorze();
  migrate(d);
  const po = numery(d);
  migrate(d);
  assert.deepEqual(numery(d), po);
});
