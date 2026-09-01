import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* Bazę sprzed modelu rozmów budujemy ręcznie, w kształcie z 0.141.0: tabela
   zadań już istnieje, ale nie wie nic o rozmowach. Najważniejszy wiersz testu
   powstaje ZANIM nowy schema.sql i migracja dostaną szansę go zobaczyć — to
   jedyny sposób, żeby sprawdzić, co migracja robi z zastanymi danymi. */
const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-migr-rozmowy-"));
const plik = path.join(katalog, "stara.db");
const stara = new DatabaseSync(plik);
stara.exec(`
  CREATE TABLE zadanie_terenowe (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rodzaj TEXT NOT NULL,
    tytul TEXT NOT NULL,
    instrukcja TEXT NOT NULL,
    tw_id INTEGER,
    zrodlo TEXT NOT NULL DEFAULT 'reczne',
    zrodlo_ref TEXT,
    priorytet TEXT NOT NULL DEFAULT 'normalny',
    status TEXT NOT NULL DEFAULT 'nowe',
    utworzono_at TEXT NOT NULL, utworzono_przez TEXT NOT NULL,
    utworzono_user_id INTEGER,
    przypisano_at TEXT, przypisano_przez TEXT, przypisano_user_id INTEGER,
    wynik TEXT, wykonano_at TEXT, wykonano_przez TEXT, wykonano_user_id INTEGER,
    anulowano_at TEXT, anulowano_przez TEXT
  );
  INSERT INTO zadanie_terenowe(id, rodzaj, tytul, instrukcja, utworzono_at, utworzono_przez)
  VALUES (17, 'weryfikacja', 'Sprawdź paczkę', 'Zobacz, czy paczka wyszła',
          '2026-08-30T10:00:00.000Z', 'Biuro');
`);
stara.close();

process.env.DB_PATH = plik;
process.env.SGT_MODE = "seeded";

let db: typeof import("./db.js").db;
let zapiszWiadomosc: typeof import("../services/conversations.js").zapiszWiadomosc;
let wykonajZadanie: typeof import("../services/zadania-terenowe.js").wykonajZadanie;
let wezZadanie: typeof import("../services/zadania-terenowe.js").wezZadanie;

before(async () => {
  ({ db } = await import("./db.js"));
  ({ zapiszWiadomosc } = await import("../services/conversations.js"));
  ({ wykonajZadanie, wezZadanie } = await import("../services/zadania-terenowe.js"));
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

/* Magazynier musi istnieć, bo wynik zapisuje tylko ten, kto zadanie przejął. */
function magazynier(): { id: number; name: string } {
  const id = Number(db().prepare(
    "INSERT INTO app_user(login, name, role) VALUES ('halina', 'Halina', 'magazynier')",
  ).run().lastInsertRowid);
  return { id, name: "Halina" };
}

test("migracja zachowuje stare zadanie i zostawia nowe powiązania jako NULL", () => {
  const zadanie = db().prepare(`
    SELECT id, tytul, status, conversation_id, message_id FROM zadanie_terenowe WHERE id = 17
  `).get() as Record<string, unknown>;
  assert.deepEqual({ ...zadanie }, {
    id: 17,
    tytul: "Sprawdź paczkę",
    status: "nowe",
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
  const osoba = magazynier();
  const zadanieId = Number(db().prepare(`
    INSERT INTO zadanie_terenowe(rodzaj, tytul, instrukcja, utworzono_at, utworzono_przez,
                                 conversation_id, message_id)
    VALUES ('weryfikacja', 'Sprawdź na hali', 'Zobacz, czy paczka jest spakowana',
            '2026-08-31T09:00:00.000Z', 'Biuro', ?, ?)
  `).run(wiadomosc.conversation_id, wiadomosc.id).lastInsertRowid);

  wezZadanie(zadanieId, osoba);
  wykonajZadanie(zadanieId, "Paczka jest gotowa", osoba);

  const zdarzenie = db().prepare(`
    SELECT event_type, message_id, payload FROM conversation_event WHERE conversation_id = ?
  `).get(wiadomosc.conversation_id) as { event_type: string; message_id: null; payload: string };
  assert.equal(zdarzenie.event_type, "field_task_result");
  assert.equal(zdarzenie.message_id, null);
  assert.deepEqual(JSON.parse(zdarzenie.payload), { taskId: zadanieId, result: "Paczka jest gotowa" });
  assert.equal((db().prepare("SELECT body FROM message WHERE id = ?").get(wiadomosc.id) as { body: string }).body, wiadomosc.body);
});

/* Bramka własności zostaje bramką także wtedy, gdy zadanie wisi na rozmowie —
   inaczej oś rozmowy dostawałaby zdarzenie od kogoś, kto zadania nie przejął. */
test("wynik zadania z rozmowy zapisze tylko ten, kto je przejął", () => {
  const { rozmowa } = (() => {
    const konto = Number(db().prepare(
      "INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro', 'seller-c')",
    ).run().lastInsertRowid);
    return { rozmowa: Number(db().prepare(
      "INSERT INTO conversation(channel_account_id, external_conversation_id) VALUES (?, 'thread-9')",
    ).run(konto).lastInsertRowid) };
  })();
  const zadanieId = Number(db().prepare(`
    INSERT INTO zadanie_terenowe(rodzaj, tytul, instrukcja, utworzono_at, utworzono_przez, conversation_id)
    VALUES ('pomiar', 'Zmierz rozstaw', 'Od środka do środka', '2026-08-31T11:00:00.000Z', 'Biuro', ?)
  `).run(rozmowa).lastInsertRowid);
  const obcy = { id: 999, name: "Ktoś inny" };

  assert.throws(() => wykonajZadanie(zadanieId, "48 mm", obcy), /przejęte przez Ciebie/);
  assert.equal(
    (db().prepare("SELECT count(*) n FROM conversation_event WHERE conversation_id = ?")
      .get(rozmowa) as { n: number }).n,
    0,
  );
});

test("klucze obce blokują osierocone rekordy", () => {
  assert.throws(() => db().prepare(`
    INSERT INTO message(conversation_id, channel_account_id, external_message_id, direction, body, sent_at)
    VALUES (99999, 99999, 'orphan', 'incoming', 'x', '2026-08-31T08:00:00Z')
  `).run(), /FOREIGN KEY/);
  assert.deepEqual(db().prepare("PRAGMA foreign_key_check").all(), []);
});
