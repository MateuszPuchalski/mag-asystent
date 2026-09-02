import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Baza wiedzy przeżywa migrację (etap E2) ─────────────────────────────────
   Ta sama umowa co przy sprawie (0.161.0) i doborze (E1): `migrate()` kasuje
   przy każdym starcie nakładki po starej implementacji — wśród nich
   `dopasowanie`. Trzy tabele wiedzy mają inne nazwy i muszą przeżyć, a spalona
   nazwa ma nadal znikać.

   Druga połowa pliku pilnuje KSZTAŁTU: listy CHECK są zamknięte dokumentem
   (§11.3, §11.4, §12), negatyw bez powodu nie istnieje, dowód idzie za
   zastosowaniem, a model z wiedzą nie znika po cichu.                        */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function poMigracji() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.exec(`INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a');
    INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,'w-1');
    INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
      VALUES ('maszyna','NAC','LS 46-450','maszyna|nacls46450','Ala');`);
  return d;
}

const istnieje = (d: DatabaseSync, tabela: string) =>
  Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela));

const ZASTOSOWANIE = `INSERT INTO zastosowanie(tw_id,tw_symbol,model_id,polaryzacja,powod_negatywny,
  stan,zrodlo_propozycji,zaproponowal) VALUES (?,?,?,?,?,?,?,?)`;

test("tabele wiedzy przeżywają kasatę nakładek, a spalona nazwa nadal znika", () => {
  const d = poMigracji();
  for (const tabela of ["model_urzadzenia", "zastosowanie", "dowod_zastosowania"]) {
    assert.equal(istnieje(d, tabela), true, `${tabela} musi przeżyć migrate()`);
  }
  assert.equal(istnieje(d, "dopasowanie"), false, "dopasowanie to nazwa spalona");
  d.close();
});

test("listy CHECK są zamknięte dokumentem — obca wartość odbija się", () => {
  const d = poMigracji();
  const wstaw = (...v: unknown[]) => d.prepare(ZASTOSOWANIE).run(...(v as Parameters<ReturnType<DatabaseSync["prepare"]>["run"]>));
  assert.throws(() => wstaw(1, "S", 1, "moze", null, "propozycja", "dobor", "Ala"), /CHECK/);
  assert.throws(() => wstaw(1, "S", 1, "nie_pasuje", "bo_tak", "propozycja", "dobor", "Ala"), /CHECK/);
  assert.throws(() => wstaw(1, "S", 1, "pasuje", null, "czeka", "dobor", "Ala"), /CHECK/);
  assert.throws(() => wstaw(1, "S", 1, "pasuje", null, "propozycja", "ai", "Ala"), /CHECK/);
  /* Wszystkie źródła z listy wchodzą — także te bez nadawcy do E3/F. */
  for (const zrodlo of ["dobor", "pomiar", "reczne", "opis", "copilot"]) {
    wstaw(1, "S", 1, "pasuje", null, "propozycja", zrodlo, "Ala");
  }
  assert.throws(() => d.prepare(`INSERT INTO dowod_zastosowania(zastosowanie_id,rodzaj,tresc,autor)
    VALUES (1,'ekspert','x','Ala')`).run(), /CHECK/, "roli eksperta nie ma — rodzaj to decyzja_biura");
  d.close();
});

test("negatyw bez powodu i pozytyw z powodem odbijają się o CHECK sprzęgający", () => {
  /* §11.4: negatywne dopasowanie jest ostrzeżeniem — a ostrzeżenie bez powodu
     nie da się sprawdzić. Pozytyw z powodem negatywnym to sprzeczność. */
  const d = poMigracji();
  const wstaw = (...v: unknown[]) => d.prepare(ZASTOSOWANIE).run(...(v as Parameters<ReturnType<DatabaseSync["prepare"]>["run"]>));
  assert.throws(() => wstaw(1, "S", 1, "nie_pasuje", null, "propozycja", "reczne", "Ala"), /CHECK/);
  assert.throws(() => wstaw(1, "S", 1, "pasuje", "niewlasciwy_rozstaw", "propozycja", "reczne", "Ala"), /CHECK/);
  wstaw(1, "S", 1, "nie_pasuje", "niewlasciwy_rozstaw", "propozycja", "reczne", "Ala");
  d.close();
});

test("jedna kosiarka = jeden wiersz modelu — pilnuje tego UNIQUE na kluczu", () => {
  const d = poMigracji();
  assert.throws(() => d.prepare(`INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
    VALUES ('maszyna','nac','ls46450','maszyna|nacls46450','Ola')`).run(), /UNIQUE/);
  d.close();
});

test("wiedza nie jest własnością rozmowy ani read-modelu, ale model z wiedzą nie znika", () => {
  const d = poMigracji();
  /* `tw_id` bez wiersza w `sgt_towar` MUSI wejść: import odtwarza read-model. */
  d.prepare(ZASTOSOWANIE).run(999999, "NIE-MA", 1, "pasuje", null, "zatwierdzone", "reczne", "Ala");
  d.prepare("UPDATE zastosowanie SET conversation_id=1").run();
  d.prepare(`INSERT INTO dowod_zastosowania(zastosowanie_id,rodzaj,tresc,autor,conversation_id)
    VALUES (1,'rozmowa','dobór w rozmowie','Ala',1)`).run();
  d.prepare("DELETE FROM conversation WHERE id=1").run();
  const z = d.prepare("SELECT conversation_id FROM zastosowanie WHERE id=1").get() as { conversation_id: number | null };
  assert.equal(z.conversation_id, null, "rozmowa znika, wiedza zostaje");
  assert.equal((d.prepare("SELECT count(*) n FROM dowod_zastosowania").get() as { n: number }).n, 1);

  assert.throws(() => d.prepare("DELETE FROM model_urzadzenia WHERE id=1").run(), /FOREIGN KEY/);

  /* Dowód idzie za zastosowaniem — kasacja zastosowania zabiera dowody. */
  d.prepare("DELETE FROM zastosowanie WHERE id=1").run();
  assert.equal((d.prepare("SELECT count(*) n FROM dowod_zastosowania").get() as { n: number }).n, 0);
  d.close();
});
