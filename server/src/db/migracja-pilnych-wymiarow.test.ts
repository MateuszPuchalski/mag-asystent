import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* Pierwsza lista pilnych do zmierzenia przychodzi z migracją, bo podał ją
   właściciel razem z funkcją. Pilnujemy, że wsiewa się raz i że lista, którą
   biuro wyczyściło albo podmieniło, nie wraca przy restarcie serwera. */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function nowaBaza(): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  return d;
}

const symbole = (d: DatabaseSync) =>
  (d.prepare("SELECT symbol FROM wymiary_pilne ORDER BY rowid").all() as Array<{ symbol: string }>).map((w) => w.symbol);

test("świeża baza dostaje 20 symboli od właściciela i ślad w dzienniku", () => {
  const d = nowaBaza();
  const s = symbole(d);
  assert.equal(s.length, 20);
  assert.equal(s[0], "W37-0401");
  assert.equal(s[19], "W09-0406");
  const wpis = d.prepare("SELECT user_id, payload FROM events WHERE type = 'wymiary_pilne'").all() as
    Array<{ user_id: string; payload: string }>;
  assert.equal(wpis.length, 1);
  assert.equal(wpis[0].user_id, "migracja");
  assert.equal(JSON.parse(wpis[0].payload).po.length, 20);
});

test("drugi start niczego nie dokłada", () => {
  const d = nowaBaza();
  migrate(d);
  assert.equal(symbole(d).length, 20);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'wymiary_pilne'").get() as { n: number }).n, 1);
});

test("lista wyczyszczona przez biuro nie wraca przy restarcie", () => {
  const d = nowaBaza();
  d.exec("DELETE FROM wymiary_pilne");
  d.prepare("INSERT INTO events(type, user_id, payload) VALUES ('wymiary_pilne', 'Biuro', '{}')").run();
  migrate(d);
  assert.deepEqual(symbole(d), []);
});
