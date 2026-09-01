import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* Bazę sprzed modelu rozmów budujemy ręcznie. Najważniejszy wiersz testu
   istnieje zanim nowy schema.sql i migracja dostaną szansę go zobaczyć. */
const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-migr-rozmowy-"));
const plik = path.join(katalog, "stara.db");
const stara = new DatabaseSync(plik);
stara.exec(`
  CREATE TABLE zadanie_terenowe (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opis TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    wynik TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
  INSERT INTO zadanie_terenowe(id, opis, status, wynik, created_at)
  VALUES (17, 'Sprawdź paczkę', 'open', NULL, '2026-08-30T10:00:00.000Z');
`);
stara.close();

process.env.DB_PATH = plik;
process.env.SGT_MODE = "seeded";

let db: typeof import("./db.js").db;
let zapiszWiadomosc: typeof import("../services/conversations.js").zapiszWiadomosc;
let zapiszWynikZadania: typeof import("../services/conversations.js").zapiszWynikZadania;

before(async () => {
  ({ db } = await import("./db.js"));
  ({ zapiszWiadomosc, zapiszWynikZadania } = await import("../services/conversations.js"));
});

function zalozRozmowe(): { konto: number; rozmowa: number } {
  const d = db();
  const konto = Number(d.prepare(`
    INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro', 'seller-a')
  `).run().lastInsertRowid);
  const rozmowa = Number(d.prepare(`
    INSERT INTO conversation(channel_account_id, external_conversation_id)
    VALUES (?, 'thread-1')
  `).run(konto).lastInsertRowid);
  return { konto, rozmowa };
}

test("migracja zachowuje stare zadanie i zostawia nowe powiązania jako NULL", () => {
  const zadanie = db().prepare(`
    SELECT id, opis, status, conversation_id, message_id FROM zadanie_terenowe WHERE id = 17
  `).get() as Record<string, unknown>;
  assert.deepEqual({ ...zadanie }, {
    id: 17,
    opis: "Sprawdź paczkę",
    status: "open",
    conversation_id: null,
    message_id: null,
  });
});

test("zewnętrzny identyfikator rozmowy jest unikalny w obrębie konta", () => {
  const { konto } = zalozRozmowe();
  assert.throws(() => db().prepare(`
    INSERT INTO conversation(channel_account_id, external_conversation_id)
    VALUES (?, 'thread-1')
  `).run(konto), /UNIQUE/);

  const drugieKonto = Number(db().prepare(`
    INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro', 'seller-b')
  `).run().lastInsertRowid);
  assert.doesNotThrow(() => db().prepare(`
    INSERT INTO conversation(channel_account_id, external_conversation_id)
    VALUES (?, 'thread-1')
  `).run(drugieKonto));
});

test("drugi przebieg synchronizacji nie kopiuje wiadomości", () => {
  const rozmowa = db().prepare(
    "SELECT id, channel_account_id FROM conversation ORDER BY id LIMIT 1",
  ).get() as { id: number; channel_account_id: number };
  const dane = {
    conversationId: rozmowa.id,
    channelAccountId: rozmowa.channel_account_id,
    externalMessageId: "message-42",
    direction: "incoming" as const,
    body: "Czy paczka już wyszła?",
    sentAt: "2026-08-31T08:00:00.000Z",
  };
  assert.ok(zapiszWiadomosc(dane));
  assert.equal(zapiszWiadomosc(dane), null);
  assert.equal((db().prepare("SELECT count(*) n FROM message").get() as { n: number }).n, 1);
});

test("wynik zadania trafia do zdarzenia, a treść wiadomości nie zmienia się", () => {
  const wiadomosc = db().prepare("SELECT id, conversation_id, body FROM message").get() as {
    id: number; conversation_id: number; body: string;
  };
  const zadanieId = Number(db().prepare(`
    INSERT INTO zadanie_terenowe(opis, conversation_id, message_id, created_at)
    VALUES ('Sprawdź na hali', ?, ?, '2026-08-31T09:00:00.000Z')
  `).run(wiadomosc.conversation_id, wiadomosc.id).lastInsertRowid);

  zapiszWynikZadania(zadanieId, "Paczka jest gotowa");
  const zdarzenie = db().prepare(`
    SELECT event_type, message_id, payload FROM conversation_event WHERE conversation_id = ?
  `).get(wiadomosc.conversation_id) as { event_type: string; message_id: null; payload: string };
  assert.equal(zdarzenie.event_type, "field_task_result");
  assert.equal(zdarzenie.message_id, null);
  assert.deepEqual(JSON.parse(zdarzenie.payload), { taskId: zadanieId, result: "Paczka jest gotowa" });
  assert.equal((db().prepare("SELECT body FROM message WHERE id = ?").get(wiadomosc.id) as { body: string }).body, wiadomosc.body);
});

test("klucze obce blokują osierocone rekordy", () => {
  assert.throws(() => db().prepare(`
    INSERT INTO message(conversation_id, channel_account_id, external_message_id, direction, body, sent_at)
    VALUES (99999, 99999, 'orphan', 'incoming', 'x', '2026-08-31T08:00:00Z')
  `).run(), /FOREIGN KEY/);
  assert.deepEqual(db().prepare("PRAGMA foreign_key_check").all(), []);
});
