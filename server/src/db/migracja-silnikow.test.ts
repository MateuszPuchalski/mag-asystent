import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Zabudowa silnika przeżywa migrację ──────────────────────────────────────
   Nowa tabela ma przeżyć kasatę nakładek, a spalone nazwy dalej znikać.   */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function bazaPoSchemacie() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec(`INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a');
    INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,'w-1');
    INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,'w-2');`);
  return d;
}

const istnieje = (d: DatabaseSync, tabela: string) =>
  Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela));

test("zabudowa_silnika przeżywa kasatę nakładek, a spalona nazwa nadal znika", () => {
  const d = bazaPoSchemacie();
  migrate(d);
  assert.equal(istnieje(d, "zabudowa_silnika"), true);
  assert.equal(istnieje(d, "dopasowanie"), false, "dopasowanie to nazwa spalona");
  d.close();
});

test("listy CHECK zabudowy są zamknięte dokumentem, a maszyna nie bywa własnym silnikiem", () => {
  const d = bazaPoSchemacie();
  migrate(d);
  d.exec(`INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
      VALUES ('maszyna','NAC','LS 46-450','maszyna|nacls46450','Ala');
    INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
      VALUES ('silnik','Briggs','450E','silnik|briggs450e','Ala');`);
  const wstaw = (maszyna: number, silnik: number, stan: string, zrodlo: string, dowod: string) =>
    d.prepare(`INSERT INTO zabudowa_silnika(maszyna_id,silnik_id,stan,zrodlo_propozycji,
      rodzaj_dowodu,dowod_tresc,zaproponowal) VALUES (?,?,?,?,?,'karta','Ala')`)
      .run(maszyna, silnik, stan, zrodlo, dowod);

  assert.throws(() => wstaw(1, 2, "czeka", "reczne", "producent"), /CHECK/);
  assert.throws(() => wstaw(1, 2, "propozycja", "ai", "producent"), /CHECK/);
  assert.throws(() => wstaw(1, 2, "propozycja", "reczne", "przeczucie"), /CHECK/);
  assert.throws(() => wstaw(1, 1, "propozycja", "reczne", "producent"), /CHECK/, "maszyna nie jest swoim silnikiem");
  /* Wszystkie wartości z list wchodzą — także `copilot`, który nadawcy nie ma. */
  for (const zrodlo of ["reczne", "dobor", "copilot"]) wstaw(1, 2, "propozycja", zrodlo, "producent");
  for (const dowod of ["producent", "katalog_dostawcy", "pomiar_wlasny", "decyzja_biura",
    "sprzedaz_weryfikacja", "rozmowa"]) wstaw(1, 2, "propozycja", "reczne", dowod);
  d.close();
});

test("model z zabudową nie znika po cichu — ON DELETE RESTRICT", () => {
  const d = bazaPoSchemacie();
  migrate(d);
  d.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
      VALUES ('maszyna','NAC','LS 46-450','maszyna|nacls46450','Ala');
    INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
      VALUES ('silnik','Briggs','450E','silnik|briggs450e','Ala');
    INSERT INTO zabudowa_silnika(maszyna_id,silnik_id,zrodlo_propozycji,rodzaj_dowodu,dowod_tresc,zaproponowal)
      VALUES (1,2,'reczne','producent','karta','Ala');`);
  assert.throws(() => d.prepare("DELETE FROM model_urzadzenia WHERE id=2").run(), /FOREIGN KEY/);
  d.close();
});
