import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { zgodnoscOferty } from "./zgodnosc-oferty.js";

/* Lista „Pasuje do" idzie na ekran taka, jaką oddało Allegro. Pusta albo
   zepsuta lista to brak listy, nie błąd otwarcia rozmowy. */

function baza(pasujeDo: string | null): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE offer_snapshot (channel_account_id INTEGER, external_id TEXT, pasuje_do_json TEXT)");
  d.prepare("INSERT INTO offer_snapshot VALUES (1, '777', ?)").run(pasujeDo);
  return d;
}

test("lista z oferty wraca w kolejności Allegro", () => {
  const z = zgodnoscOferty(baza(JSON.stringify(["Hecht 1803S", "Stiga 460"])), 1, "777");
  assert.deepEqual(z, { lista: ["Hecht 1803S", "Stiga 460"] });
});

test("brak oferty, pusta lista albo zepsuty JSON to brak listy", () => {
  assert.equal(zgodnoscOferty(baza(null), 1, "777"), null);
  assert.equal(zgodnoscOferty(baza("[]"), 1, "777"), null);
  assert.equal(zgodnoscOferty(baza("{zepsute"), 1, "777"), null);
  assert.equal(zgodnoscOferty(baza("[\"x\"]"), 1, "inna"), null);
});
