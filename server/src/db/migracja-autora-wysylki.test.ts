import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "./db.js";

/* ── Autor wysyłki w sprawie nie blokuje kasowania konta ─────────────────────
   Czat pokazuje przy naszym dymku imię z `reklamacja_outbox.created_by`.
   Klucz był `NOT NULL` bez reguły kasowania, więc konto, które choć raz
   odpisało, nie dawało się skasować. Stanowisko odtwarza tamten kształt
   i puszcza `migrate()` drugi raz, tą samą drogą co baza właściciela. */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

const STARY_KSZTALT = `
  CREATE TABLE reklamacja_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reklamacja_id INTEGER NOT NULL REFERENCES reklamacja_klienta(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL UNIQUE,
    body TEXT NOT NULL,
    typ TEXT NOT NULL DEFAULT 'REGULAR' CHECK (typ IN
      ('REGULAR','RETURN_REQUIRED_SELLER_LABEL','RETURN_REQUIRED_CUSTOM',
       'RETURN_NOT_REQUIRED','END_REQUEST')),
    expected_wersja INTEGER NOT NULL,
    expected_last_message_id INTEGER REFERENCES reklamacja_wiadomosc(id) ON DELETE SET NULL,
    status TEXT NOT NULL
      CHECK (status IN ('sending','sent','send_uncertain','send_failed')),
    external_message_id TEXT,
    blad TEXT,
    created_by INTEGER NOT NULL REFERENCES app_user(user_id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_reklamacja_outbox_sprawa
    ON reklamacja_outbox(reklamacja_id, id);`;

function staraBaza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.exec("DROP TABLE reklamacja_outbox");
  d.exec(STARY_KSZTALT);
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','A. Lewandowska','biuro')").run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const sprawa = Number(d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,
    otwarto_at,synced_at) VALUES (?,'i-1','2026-09-06T10:00:00Z','2026-09-07T10:00:00Z')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO reklamacja_outbox(reklamacja_id,idempotency_key,body,expected_wersja,
    status,external_message_id,created_by,created_at)
    VALUES (?,'rkl-1','Proszę o zdjęcie.',1,'sent','m-1',1,'2026-09-07T12:00:00.000Z')`).run(sprawa);
  return { d, sprawa };
}

const kluczAutora = (d: DatabaseSync) =>
  (d.prepare("PRAGMA foreign_key_list(reklamacja_outbox)").all() as
    Array<{ from: string; on_delete: string }>).find((k) => k.from === "created_by");

test("stara skrzynka dostaje SET NULL na autorze i zachowuje każdą próbę", () => {
  const { d, sprawa } = staraBaza();
  assert.equal(kluczAutora(d)?.on_delete, "NO ACTION", "stanowisko odtwarza stary kształt");

  migrate(d);
  assert.equal(kluczAutora(d)?.on_delete, "SET NULL");
  assert.deepEqual({ ...d.prepare(`SELECT reklamacja_id, idempotency_key, status,
      external_message_id, created_by, created_at FROM reklamacja_outbox`).get() }, {
    reklamacja_id: sprawa, idempotency_key: "rkl-1", status: "sent",
    external_message_id: "m-1", created_by: 1, created_at: "2026-09-07T12:00:00.000Z",
  });
  assert.ok(d.prepare("SELECT 1 FROM sqlite_master WHERE name='ix_reklamacja_outbox_sprawa'").get(),
    "indeks sprawy wraca razem z tabelą");
});

test("po migracji konto daje się skasować, a próba traci tylko imię", () => {
  const { d } = staraBaza();
  assert.throws(() => d.prepare("DELETE FROM app_user WHERE user_id=1").run(),
    /FOREIGN KEY/, "przed migracją kasowanie konta stoi na kluczu");

  migrate(d);
  d.prepare("DELETE FROM app_user WHERE user_id=1").run();
  assert.deepEqual({ ...d.prepare("SELECT status, created_by FROM reklamacja_outbox").get() },
    { status: "sent", created_by: null });
});

test("osierocony autor nie zatrzymuje startu — dostaje NULL jak po kasowaniu", () => {
  const { d } = staraBaza();
  d.exec("PRAGMA foreign_keys = OFF");
  d.prepare("UPDATE reklamacja_outbox SET created_by=99").run();
  d.exec("PRAGMA foreign_keys = ON");

  migrate(d);
  assert.equal((d.prepare("SELECT created_by FROM reklamacja_outbox").get() as
    { created_by: number | null }).created_by, null);
});

test("druga migracja nie przebudowuje tabeli od nowa", () => {
  const { d } = staraBaza();
  migrate(d);
  /* Przebudowa zakłada tabelę obok starej, więc dostaje inną stronę korzenia.
     Ta sama strona po drugim przebiegu znaczy, że przebudowy nie było. */
  const korzen = () => (d.prepare(
    "SELECT rootpage FROM sqlite_master WHERE type='table' AND name='reklamacja_outbox'").get() as
    { rootpage: number }).rootpage;
  const przed = korzen();
  migrate(d);
  assert.equal(korzen(), przed);
  assert.equal(Number((d.prepare("SELECT COUNT(*) n FROM reklamacja_outbox").get() as
    { n: number }).n), 1);
});
