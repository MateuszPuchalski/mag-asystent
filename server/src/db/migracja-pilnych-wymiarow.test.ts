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

test("świeża baza dostaje 20 symboli od właściciela, bez wpisu w dzienniku", () => {
  const d = nowaBaza();
  const s = symbole(d);
  assert.equal(s.length, 20);
  assert.equal(s[0], "W37-0401");
  assert.equal(s[19], "W09-0406");
  /* Dziennik liczą testy wielu ekranów; ziarno pamięta własna tabela. */
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n, 0);
});

test("drugi start niczego nie dokłada", () => {
  const d = nowaBaza();
  migrate(d);
  assert.equal(symbole(d).length, 20);
});

test("lista wyczyszczona przez biuro nie wraca przy restarcie", () => {
  const d = nowaBaza();
  d.exec("DELETE FROM wymiary_pilne");
  migrate(d);
  assert.deepEqual(symbole(d), []);
});

test("lista ustawiona przez biuro przed aktualizacją zostaje swoja", () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.prepare("INSERT INTO wymiary_pilne(symbol, dodano_at) VALUES ('A-01', '2026-11-01T00:00:00Z')").run();
  migrate(d);
  assert.deepEqual(symbole(d), ["A-01"]);
});
