import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Znacznik autoodpowiedzi wstecz (0.227.0) ────────────────────────────────
   Kolumna `message.auto_odpowiedz` doszła po tym, jak w bazie leżały już
   tysiące wiadomości. Bez backfillu stare rozmowy zostałyby z zerem, czyli
   z tą samą usterką, którą to wydanie naprawia: odbicie „Dziękujemy za
   kontakt" dalej liczyłoby się jako nasza odpowiedź.

   Bazę sprzed migracji budujemy RĘCZNIE, w kształcie bez tej kolumny —
   `CREATE TABLE IF NOT EXISTS` w schemacie nie nadpisze tabeli, więc migracja
   dostaje dokładnie to, co stoi u klienta.                                  */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

const ODBICIE = "Dziękujemy za kontakt\n\nTa wiadomość jest generowana automatycznie.";

const STARA_TABELA = `
  CREATE TABLE channel_account (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    external_account_id TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(channel, external_account_id)
  );
  CREATE TABLE conversation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_account_id INTEGER NOT NULL REFERENCES channel_account(id),
    external_conversation_id TEXT NOT NULL,
    subject TEXT,
    assigned_user_id INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    unread INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    status TEXT NOT NULL DEFAULT 'new',
    snoozed_until TEXT,
    priorytet TEXT NOT NULL DEFAULT 'normalny',
    UNIQUE(channel_account_id, external_conversation_id)
  );
  -- Kształt sprzed 0.227.0: BEZ kolumny auto_odpowiedz.
  CREATE TABLE message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    channel_account_id INTEGER NOT NULL REFERENCES channel_account(id),
    external_message_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    body TEXT NOT NULL,
    related_object_type TEXT,
    related_object_id TEXT,
    related_order_id TEXT,
    sent_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(channel_account_id, external_message_id)
  );
`;

function bazaSprzedMigracji() {
  const d = new DatabaseSync(":memory:");
  d.exec(STARA_TABELA);
  d.exec(schema);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a')").run();
  d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (1,'w-1','Temat')`).run();
  const pisz = (ext: string, dir: string, body: string) =>
    d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
      direction,body,sent_at) VALUES (1,1,?,?,?,'2026-09-01T10:00:00.000Z')`).run(ext, dir, body);
  pisz("m-1", "incoming", "Czy pasuje?");
  pisz("m-2", "outgoing", ODBICIE);
  pisz("m-3", "outgoing", "Pasuje, wysyłamy jutro.");
  /* Klient CYTUJĄCY nasze potwierdzenie — jego list jest pytaniem. */
  pisz("m-4", "incoming", `Dopytuję.\n\n> ${ODBICIE}`);
  return d;
}

test("migracja oznacza stare odbicia, a odpowiedzi i cytaty zostawia", () => {
  const d = bazaSprzedMigracji();
  migrate(d);

  const flagi = (d.prepare(
    "SELECT external_message_id e, auto_odpowiedz a FROM message ORDER BY id").all() as
    Array<{ e: string; a: number }>).map((m) => `${m.e}=${m.a}`);
  assert.deepEqual(flagi, ["m-1=0", "m-2=1", "m-3=0", "m-4=0"]);
});

test("drugi przebieg niczego nie przepisuje", () => {
  /* `migrate()` woła KAŻDY proces przy starcie, a NSSM startuje je razem.
     Migracja przepisująca całą tabelę wiadomości przy każdym starcie byłaby
     kosztem rosnącym z historią skrzynki. */
  const d = bazaSprzedMigracji();
  migrate(d);
  const przed = d.prepare("SELECT count(*) n FROM message WHERE auto_odpowiedz=1")
    .get() as { n: number };

  migrate(d);
  assert.deepEqual(d.prepare("SELECT count(*) n FROM message WHERE auto_odpowiedz=1")
    .get(), przed);
});
