import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../db/db.js";
import { pochodnePuste, poImporcie } from "./po-imporcie.js";

/* Hak po imporcie: trzy przebudowy, każda w osobnym try/catch, jeden wpis
   audytu z czasem. Pęknięta jedna nie ma prawa zostawić panelu bez reszty. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function baza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,opis) VALUES (14,'FTC272','Podkładka','OEM: 41307131600 Modele: FS200 FS250')").run();
  return d;
}

test("po imporcie powstają identyfikatory, modele z opisów i indeks, z jednym wpisem audytu", () => {
  const d = baza();
  assert.equal(pochodnePuste(d), true);
  poImporcie(d);
  assert.equal(pochodnePuste(d), false);
  assert.equal((d.prepare("SELECT count(*) n FROM towar_identyfikator").get() as { n: number }).n, 1);
  assert.equal((d.prepare("SELECT count(*) n FROM model_z_opisu").get() as { n: number }).n, 1);
  assert.equal((d.prepare("SELECT count(*) n FROM towar_fts").get() as { n: number }).n, 1);
  const z = d.prepare("SELECT payload FROM events WHERE type='read_model_po_imporcie'").all() as Array<{ payload: string }>;
  assert.equal(z.length, 1);
  const p = JSON.parse(z[0].payload) as { identyfikatory: { identyfikatorow: number }; ms: number };
  assert.equal(p.identyfikatory.identyfikatorow, 1);
  assert.ok(typeof p.ms === "number");
  d.close();
});

test("wyjątek jednej przebudowy nie blokuje pozostałych", () => {
  const d = baza();
  /* Bez tabeli identyfikatorów parser pada — modele i FTS mają powstać mimo to. */
  d.exec("DROP TABLE towar_identyfikator");
  poImporcie(d);
  assert.equal((d.prepare("SELECT count(*) n FROM model_z_opisu").get() as { n: number }).n, 1);
  assert.equal((d.prepare("SELECT count(*) n FROM towar_fts").get() as { n: number }).n, 1);
  const p = JSON.parse((d.prepare("SELECT payload FROM events WHERE type='read_model_po_imporcie'").get() as { payload: string }).payload) as
    { identyfikatory: { blad?: string } };
  assert.match(p.identyfikatory.blad ?? "", /no such table/);
  d.close();
});
