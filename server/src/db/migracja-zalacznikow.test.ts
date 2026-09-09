import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* Załączniki wiadomości sprzed przyrostu „zdjęcia w rozmowach": tabela bez
   klucza naturalnego (synchronizator wstawiał bez ograniczenia), a lądowisko
   `allegro_inbox_message.surowe_json` trzyma listy, których model kanoniczny
   nigdy nie dostał — wchodziły wyłącznie z NOWĄ wiadomością. Migracja ma
   rozplątać duplikaty PRZED indeksem (inaczej start się wywraca) i dosypać
   brakujące wiersze z lądowiska, idempotentnie.                            */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function bazaZDanymi() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')").run().lastInsertRowid);
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject,status,updated_at)
    VALUES (?,'t-1','x','open','2026-09-01T10:00:00Z')`).run(konto).lastInsertRowid);
  const wiad = (ext: string) => Number(d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,sent_at) VALUES (?,?,?,'incoming','treść','2026-09-01T10:00:00Z')`).run(rozmowa, konto, ext).lastInsertRowid);
  const m1 = wiad("m-1");
  const m2 = wiad("m-2");
  /* Duplikaty z czasów bez klucza: ten sam plik trzy razy przy m-1. */
  for (const st of ["NEW", "SAFE", "SAFE"]) {
    d.prepare("INSERT INTO message_attachment(message_id,file_name,mime_type,url,status) VALUES (?,?,?,?,?)")
      .run(m1, "a.jpg", "image/jpeg", "https://u/1", st);
  }
  /* Lądowisko: m-2 ma załączniki w JSON-ie, a w modelu kanonicznym żadnego. */
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,last_message_at,interlocutor_login,surowe_json,synced_at)
    VALUES ('t-1',0,'2026-09-01T10:00:00Z','anon','{}','2026-09-01T10:00:00Z')`).run();
  const laduj = (id: string, json: string) => d.prepare(`INSERT INTO allegro_inbox_message
    (id,thread_id,author_login,author_is_interlocutor,text,surowe_json) VALUES (?,'t-1','anon',1,'x',?)`).run(id, json);
  laduj("m-1", JSON.stringify({ id: "m-1", attachments: [{ fileName: "a.jpg", status: "SAFE", url: "https://u/1" }] }));
  laduj("m-2", JSON.stringify({ id: "m-2", attachments: [
    { fileName: "usterka.jpeg", mimeType: "image/jpeg", status: "SAFE", url: "https://u/2" },
    { fileName: "paragon.pdf", status: "EXPIRED" },
  ] }));
  return { d, m1, m2 };
}

const zalaczniki = (d: DatabaseSync) => (d.prepare(
  "SELECT message_id, file_name, status, url FROM message_attachment ORDER BY message_id, file_name").all() as
  Array<Record<string, unknown>>).map((r) => ({ ...r }));

test("duplikaty rozplątane przed indeksem, lądowisko dosypane, drugi start nic nie zmienia", () => {
  const { d, m1, m2 } = bazaZDanymi();
  migrate(d);
  assert.deepEqual(zalaczniki(d), [
    { message_id: m1, file_name: "a.jpg", status: "NEW", url: "https://u/1" },
    { message_id: m2, file_name: "paragon.pdf", status: "EXPIRED", url: null },
    { message_id: m2, file_name: "usterka.jpeg", status: "SAFE", url: "https://u/2" },
  ]);
  /* Najniższe `id` zostaje — na nim wiszą ETagi w przeglądarkach biura.
     Status `NEW` z tego wiersza poprawi dociąg synchronizacji, nie migracja:
     m-1 MA już załącznik, więc dosypka go nie dotyka. */
  const indeksy = (d.prepare("PRAGMA index_list(message_attachment)").all() as Array<{ name: string; unique: number }>);
  assert.ok(indeksy.some((i) => i.name === "ux_message_attachment_nazwa" && i.unique === 1));

  const przed = zalaczniki(d);
  migrate(d);
  assert.deepEqual(zalaczniki(d), przed, "migracja jest idempotentna");

  /* Indeks trzyma: upsert po kluczu zamiast drugiego wiersza. */
  d.prepare(`INSERT INTO message_attachment(message_id,file_name,mime_type,url,status) VALUES (?,?,?,?,?)
    ON CONFLICT(message_id, file_name) DO UPDATE SET status=excluded.status`).run(m1, "a.jpg", null, "https://u/1", "SAFE");
  assert.equal(zalaczniki(d).filter((z) => z.message_id === m1).length, 1);
  assert.equal(zalaczniki(d)[0]!.status, "SAFE");
});

test("świeża baza: indeks jest, dosypka bez lądowiska milczy", () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  assert.ok((d.prepare("PRAGMA index_list(message_attachment)").all() as Array<{ name: string }>)
    .some((i) => i.name === "ux_message_attachment_nazwa"));
  assert.equal((d.prepare("SELECT count(*) n FROM message_attachment").get() as { n: number }).n, 0);
});
