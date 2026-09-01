import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

/* ── Status rozmowy dochodzi do istniejącej bazy (0.157.0) ───────────────────
   Baza klienta ma dziś `conversation` BEZ statusu. Ten test odtwarza dokładnie
   taki kształt: pełny schemat, a na nim jedna tabela podmieniona na starą.
   Test na świeżym `schema.sql` sprawdzałby migrację, której tam nie ma.

   Uzupełnienie ma się wykonać RAZ. Puszczone przy każdym starcie cofałoby
   decyzję operatora przy najbliższym restarcie usługi, a status ma być tym,
   co powiedział człowiek albo policzył automat.                             */

/**
 * Baza jak u klienta: pełny schemat, ale `conversation` w kształcie sprzed
 * 0.157.0. Reszta tabel musi być prawdziwa, bo `migrate()` dotyka ich
 * wszystkich — test na czterech tabelach sprawdzałby migrację, której nie ma.
 */
function bazaSprzedStatusu() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec(`
    DROP TABLE conversation;
    CREATE TABLE conversation(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_account_id INTEGER NOT NULL,
      external_conversation_id TEXT NOT NULL,
      subject TEXT,
      assigned_user_id INTEGER,
      version INTEGER NOT NULL DEFAULT 1,
      unread INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  `);
  d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','Ala','biuro')").run();
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a')").run();
  const dodaj = (ext: string, wlasciciel: number | null) => Number(d.prepare(
    `INSERT INTO conversation(channel_account_id,external_conversation_id,assigned_user_id)
     VALUES (1,?,?)`).run(ext, wlasciciel).lastInsertRowid);
  return { d, prowadzona: dodaj("w-1", 1), wolna: dodaj("w-2", null) };
}

const status = (d: DatabaseSync, id: number) => (d.prepare(
  "SELECT status FROM conversation WHERE id=?").get(id) as { status: string }).status;

test("rozmowa prowadzona dostaje `open`, reszta zostaje przy `new`", () => {
  const { d, prowadzona, wolna } = bazaSprzedStatusu();
  migrate(d);

  assert.equal(status(d, prowadzona), "open", "ktoś przy niej siedzi, więc jest w toku");
  /* Kuszące „ostatnia wiadomość wyszła od nas, więc czekamy na klienta"
     byłoby zgadywaniem: biuro odpowiadało też telefonem i w panelu Allegro. */
  assert.equal(status(d, wolna), "new");
});

test("uzupełnienie nie wraca przy kolejnym starcie", () => {
  const { d, prowadzona } = bazaSprzedStatusu();
  migrate(d);
  /* Operator odkłada rozmowę na czwartek. Restart usługi nie ma prawa tego
     cofnąć — a właśnie to zrobiłoby uzupełnienie puszczane bezwarunkowo. */
  d.prepare("UPDATE conversation SET status='snoozed', snooze_do='2026-12-24T08:00:00Z' WHERE id=?")
    .run(prowadzona);

  migrate(d);
  assert.equal(status(d, prowadzona), "snoozed");
});

test("kolumna pilnuje wartości, więc literówka nie wejdzie do bazy", () => {
  const { d, wolna } = bazaSprzedStatusu();
  migrate(d);
  assert.throws(
    () => d.prepare("UPDATE conversation SET status='zalatwione' WHERE id=?").run(wolna),
    /CHECK/,
    "lista statusów jest umową, nie sugestią");
});
