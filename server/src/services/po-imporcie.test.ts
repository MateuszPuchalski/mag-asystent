import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../db/db.js";
import { pochodnePuste, poImporcie } from "./po-imporcie.js";

/* Hak po imporcie: przebudowa w try/catch i jeden wpis audytu z czasem.
   Pęknięty parser nie ma prawa wywrócić importu, który już się udał. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function baza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,opis) VALUES (14,'FTC272','Podkładka','OEM: 41307131600 Modele: FS200 FS250')").run();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,opis) VALUES (15,'18-11010','Linka napędu Castel Garden 81000668/1 1170x1480','')").run();
  return d;
}

test("po imporcie powstają identyfikatory, z jednym wpisem audytu", () => {
  const d = baza();
  assert.equal(pochodnePuste(d), true);
  poImporcie(d);
  assert.equal(pochodnePuste(d), false);
  assert.equal((d.prepare("SELECT count(*) n FROM towar_identyfikator").get() as { n: number }).n, 1);
  const z = d.prepare("SELECT payload FROM events WHERE type='read_model_po_imporcie'").all() as Array<{ payload: string }>;
  assert.equal(z.length, 1);
  const p = JSON.parse(z[0].payload) as { identyfikatory: { identyfikatorow: number }; ms: number };
  assert.equal(p.identyfikatory.identyfikatorow, 1);
  assert.ok(typeof p.ms === "number");
  d.close();
});

test("pochodne zakładają się raz — drugi start ich nie przebudowuje", () => {
  const d = baza();
  poImporcie(d);
  assert.equal(pochodnePuste(d), false);
  d.prepare("DELETE FROM towar_identyfikator").run();
  assert.equal(pochodnePuste(d), true, "pusta tabela identyfikatorów przy niepustym read-modelu");
  d.close();
});

test("wyjątek przebudowy nie wywraca importu, a trafia do audytu", () => {
  const d = baza();
  /* Bez tabeli identyfikatorów parser pada — hak ma to zapisać, nie rzucić. */
  d.exec("DROP TABLE towar_identyfikator");
  assert.doesNotThrow(() => poImporcie(d));
  const p = JSON.parse((d.prepare("SELECT payload FROM events WHERE type='read_model_po_imporcie'").get() as { payload: string }).payload) as
    { identyfikatory: { blad?: string } };
  assert.match(p.identyfikatory.blad ?? "", /no such table/);
  d.close();
});
