import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ftsDostepne, migrate } from "./db.js";

/* ── Identyfikatory, modele z opisów i FTS (etap E3) ─────────────────────────
   Ta sama umowa co przy doborze i wiedzy: nowe nazwy przeżywają `migrate()`,
   spalone nadal znikają. Do tego dwie rzeczy, które E3 wnosi jako pierwsze:
   tabela pochodna bez klucza obcego do read-modelu (import ją wycina i musi
   dać się odbudować) oraz tabela WIRTUALNA zakładana w migracji, nie
   w schemacie — bo bez FTS5 start ma przejść, a nie paść.                  */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function poMigracji() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.exec(`INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a');
    INSERT INTO app_user(login,name,role) VALUES ('ala','Ala','biuro');
    INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez) VALUES ('maszyna','NAC','LS','maszyna|nacls','Ala');`);
  return d;
}

const istnieje = (d: DatabaseSync, tabela: string) =>
  Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela));

test("tabele E3 przeżywają kasatę nakładek, spalone nadal znikają, FTS stoi", () => {
  const d = poMigracji();
  for (const t of ["towar_identyfikator", "model_z_opisu", "towar_fts"]) {
    assert.equal(istnieje(d, t), true, `${t} musi przeżyć migrate()`);
  }
  assert.equal(istnieje(d, "dopasowanie"), false);
  assert.equal(ftsDostepne(), true, "ten Node ma FTS5 — flaga ma to mówić");
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
  assert.throws(() => wstaw("ean", "opis", "1"), /CHECK/);
  assert.throws(() => wstaw("oem", "copilot", "2"), /CHECK/);
  d.close();
});

test("model z opisu: CHECK stanu, UNIQUE po tekście, kasacja zastosowania zeruje odnośnik", () => {
  const d = poMigracji();
  d.prepare(`INSERT INTO zastosowanie(tw_id,tw_symbol,model_id,polaryzacja,zrodlo_propozycji,zaproponowal)
    VALUES (1,'X',1,'pasuje','opis','Ala')`).run();
  d.prepare(`INSERT INTO model_z_opisu(tw_id,tw_symbol,tekst,tekst_norm,stan,zastosowanie_id)
    VALUES (1,'X','FS200 FS250','fs200fs250','przerobiony',1)`).run();
  assert.throws(() => d.prepare(
    "INSERT INTO model_z_opisu(tw_id,tw_symbol,tekst,tekst_norm) VALUES (1,'X','FS200  FS250','fs200fs250')").run(), /UNIQUE/);
  assert.throws(() => d.prepare(
    "INSERT INTO model_z_opisu(tw_id,tw_symbol,tekst,tekst_norm,stan) VALUES (2,'Y','a','a','czeka')").run(), /CHECK/);
  d.prepare("DELETE FROM zastosowanie WHERE id=1").run();
  assert.equal((d.prepare("SELECT zastosowanie_id z FROM model_z_opisu").get() as { z: unknown }).z, null);
  d.close();
});

test("FTS przyjmuje wiersz z rowid = tw_id, a `ł` NIE zdejmuje sam — normalizuje `zloz()`", () => {
  const d = poMigracji();
  d.prepare("INSERT INTO towar_fts(rowid,symbol,nazwa,opis) VALUES (14,'ftc272','podkladka mala zew. przekladni katowej','oem: 41307131600 modele: fs200 fs250')").run();
  const szukaj = (q: string) => (d.prepare("SELECT rowid FROM towar_fts WHERE towar_fts MATCH ? ORDER BY bm25(towar_fts)")
    .all(q) as Array<{ rowid: number }>).map((x) => x.rowid);
  assert.deepEqual(szukaj('"podkladka" "przekladni"'), [14]);
  /* `remove_diacritics 2` rozkłada tylko litery ze znakiem składanym; `ł` jest
     osobną literą i zostaje. Dlatego treść I zapytanie idą przez `zloz()`
     z `tekst.ts` — jedna prawda normalizacji, tak jak przy wyszukiwarce. */
  assert.deepEqual(szukaj('"podkładka"'), [], "bez zloz() ogonek nie trafia — to jest powód, dla którego zapytanie też normalizujemy");
  d.prepare("INSERT INTO towar_fts(towar_fts) VALUES ('delete-all')").run();
  assert.deepEqual(szukaj("ftc272"), []);
  d.close();
});
