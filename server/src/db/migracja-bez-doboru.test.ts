import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Kasata doboru i bazy wiedzy ─────────────────────────────────────────────
   Decyzja właściciela: oba wychodzą w całości, razem z tabelami. Pilnujemy
   czterech rzeczy. Tabele znikają u klienta, także te powiązane kluczami
   obcymi. Kolumny Copilota schodzą, a reszta szkicu zostaje. Zdarzenia
   w dzienniku przeżywają, bo dziennik audytu nie ma retencji. Druga
   migracja niczego już nie rusza.                                          */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

const TABELE = [
  "dobor", "dobor_rozmowy", "model_urzadzenia", "zastosowanie", "dowod_zastosowania",
  "zabudowa_silnika", "alias_silnika", "pasowanie_czesci", "import_odsylaczy", "import_wykazu",
  "zamiennosc_oem", "model_z_opisu", "token_silnika", "token_silnika_kartoteka",
  "pasowanie_siec", "pasowanie_siec_silnik", "towar_fts", "wymiar_kartoteki",
];

const istnieje = (d: DatabaseSync, tabela: string) =>
  Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(tabela));
const kolumny = (d: DatabaseSync, tabela: string) =>
  (d.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>).map((c) => c.name);

/* Baza z produkcji w skrócie: pełny schemat plus stare tabele z kluczami
   obcymi w obie strony i stare kolumny szkicu z CHECK-iem. Kaskada
   `dowod_zastosowania` i RESTRICT na modelu to dokładnie to, co wywróciłoby
   kasowanie przy włączonych kluczach. */
function staraBaza(): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON");
  d.exec(schema);
  d.exec(`
    CREATE TABLE model_urzadzenia (id INTEGER PRIMARY KEY AUTOINCREMENT, nazwa TEXT NOT NULL);
    CREATE TABLE zastosowanie (id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL REFERENCES model_urzadzenia(id) ON DELETE RESTRICT);
    CREATE TABLE dowod_zastosowania (id INTEGER PRIMARY KEY AUTOINCREMENT,
      zastosowanie_id INTEGER NOT NULL REFERENCES zastosowanie(id) ON DELETE CASCADE);
    CREATE TABLE token_silnika (id INTEGER PRIMARY KEY AUTOINCREMENT,
      silnik_id INTEGER NOT NULL REFERENCES model_urzadzenia(id) ON DELETE RESTRICT);
    CREATE TABLE token_silnika_kartoteka (token_id INTEGER NOT NULL REFERENCES token_silnika(id) ON DELETE CASCADE,
      zastosowanie_id INTEGER REFERENCES zastosowanie(id) ON DELETE SET NULL);
    CREATE TABLE dobor (conversation_id INTEGER PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
      marka TEXT);
    CREATE TABLE pasowanie_siec (id INTEGER PRIMARY KEY AUTOINCREMENT, tw_id INTEGER NOT NULL);
    CREATE TABLE wymiar_kartoteki (tw_id INTEGER PRIMARY KEY);
    CREATE VIRTUAL TABLE towar_fts USING fts5(symbol, nazwa, opis, content='');
    INSERT INTO model_urzadzenia(id, nazwa) VALUES (1, 'NAC LS 46-450');
    INSERT INTO zastosowanie(id, model_id) VALUES (1, 1);
    INSERT INTO dowod_zastosowania(zastosowanie_id) VALUES (1);
    INSERT INTO token_silnika(id, silnik_id) VALUES (1, 1);
    INSERT INTO token_silnika_kartoteka(token_id, zastosowanie_id) VALUES (1, 1);
    ALTER TABLE szkic_copilota ADD COLUMN dane_doboru TEXT;
    ALTER TABLE szkic_copilota ADD COLUMN dane_ocena TEXT
      CHECK (dane_ocena IS NULL OR dane_ocena IN ('wpisane','odrzucone'));
    ALTER TABLE szkic_copilota ADD COLUMN dobor_wersja INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE szkic_copilota ADD COLUMN pasowanie_ocena TEXT
      CHECK (pasowanie_ocena IS NULL OR pasowanie_ocena IN ('zaproponowane','odrzucone'));
    ALTER TABLE szkic_copilota ADD COLUMN luki_kartoteki TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE copilot_pytanie ADD COLUMN pasowania TEXT NOT NULL DEFAULT '[]';
    INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro', 'a');
    INSERT INTO conversation(channel_account_id, external_conversation_id, subject, unread, updated_at)
      VALUES (1, 'w-1', 'Gaźnik', 0, '2026-09-01T10:00:00.000Z');
    INSERT INTO dobor(conversation_id, marka) VALUES (1, 'NAC');
    INSERT INTO szkic_copilota(conversation_id, tresc, model, at, przez, dane_ocena)
      VALUES (1, 'Dzień dobry', 'claude', '2026-09-01T10:01:00.000Z', 'Ala', 'wpisane');
    INSERT INTO conversation_event(conversation_id, event_type, payload, created_at)
      VALUES (1, 'dobor_wynik', '{"po":"czesc"}', '2026-09-01T10:02:00.000Z');
  `);
  return d;
}

test("tabele doboru i wiedzy znikają, także te spięte kluczami obcymi", () => {
  const d = staraBaza();
  migrate(d);
  for (const t of TABELE) assert.equal(istnieje(d, t), false, `${t} musi zniknąć`);
  assert.deepEqual(d.prepare("PRAGMA foreign_key_check").all(), [], "nic nie zostało bez rodzica");
  assert.equal((d.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1,
    "klucze wracają po kasacie, inaczej reszta bazy traci ochronę");
  d.close();
});

test("szkic Copilota traci kolumny doboru i pasowań, a jego treść zostaje", () => {
  const d = staraBaza();
  migrate(d);
  const szkic = kolumny(d, "szkic_copilota");
  for (const k of ["dane_doboru", "dane_ocena", "dobor_wersja", "pasowanie_ocena", "luki_kartoteki"]) {
    assert.equal(szkic.includes(k), false, `szkic_copilota.${k} musi zejść`);
  }
  assert.equal(kolumny(d, "copilot_pytanie").includes("pasowania"), false);
  assert.equal((d.prepare("SELECT tresc FROM szkic_copilota WHERE conversation_id=1").get() as
    { tresc: string }).tresc, "Dzień dobry");
  d.close();
});

test("zdarzenia doboru zostają w dzienniku rozmowy", () => {
  const d = staraBaza();
  migrate(d);
  assert.equal((d.prepare("SELECT count(*) n FROM conversation_event WHERE event_type='dobor_wynik'")
    .get() as { n: number }).n, 1);
  d.close();
});

test("druga migracja niczego nie rusza, a świeża baza nie zakłada spalonych nazw", () => {
  const d = staraBaza();
  migrate(d);
  const schemat = () => (d.prepare("SELECT group_concat(sql, ';') s FROM sqlite_master").get() as { s: string }).s;
  const po = schemat();
  migrate(d);
  assert.equal(schemat(), po);
  d.close();

  const swieza = new DatabaseSync(":memory:");
  swieza.exec(schema);
  migrate(swieza);
  for (const t of TABELE) assert.equal(istnieje(swieza, t), false, `${t} nie ma prawa powstać ze schematu`);
  swieza.close();
});
