import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "./db.js";

/* ── Stemple `datetime('now')` wracają do ISO (@wydanie) ──────────────────────
   Sześć zapisów w reklamacjach i dyskusjach wołało `datetime('now')`. Wartość
   ze spacją i bez strefy leży więc w bazie obok ISO z `T…Z`. Migracja chodzi
   przy KAŻDYM starcie, więc stanowisko wkłada stary kształt po pierwszej
   migracji i puszcza `migrate()` drugi raz. To ta sama droga, którą przejdzie
   baza właściciela.                                                         */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','A. Lewandowska','biuro')").run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const sprawa = (ext: string, stempel: string | null) => Number(d.prepare(
    `INSERT INTO reklamacja_klienta
       (channel_account_id,external_id,prowadzi_at,zakonczenie_at,zwrot_towaru_at,otwarto_at,synced_at)
     VALUES (?,?,?,?,?,'2026-09-01T08:00:00Z','2026-09-11T09:00:00Z')`)
    .run(konto, ext, stempel, stempel, stempel).lastInsertRowid);
  const wysylka = (reklamacjaId: number, klucz: string, stempel: string | null) => Number(d.prepare(
    `INSERT INTO reklamacja_outbox
       (reklamacja_id,idempotency_key,body,expected_wersja,status,created_by,finished_at)
     VALUES (?,?,'treść',1,'sent',1,?)`).run(reklamacjaId, klucz, stempel).lastInsertRowid);
  return { d, sprawa, wysylka };
}

const stemple = (d: DatabaseSync, id: number) => ({ ...(d.prepare(
  "SELECT prowadzi_at, zakonczenie_at, zwrot_towaru_at FROM reklamacja_klienta WHERE id=?")
  .get(id) as Record<string, unknown>) });
const koniec = (d: DatabaseSync, id: number) => (d.prepare(
  "SELECT finished_at AS t FROM reklamacja_outbox WHERE id=?").get(id) as { t: string | null }).t;

test("wartość w kształcie `datetime()` staje się ISO z tą samą chwilą w UTC", () => {
  const { d, sprawa, wysylka } = stanowisko();
  const id = sprawa("i-1", "2026-09-25 08:00:00");
  const o = wysylka(id, "k-1", "2026-09-25 08:00:00");

  migrate(d);
  const iso = "2026-09-25T08:00:00.000Z";
  assert.deepEqual(stemple(d, id), { prowadzi_at: iso, zakonczenie_at: iso, zwrot_towaru_at: iso });
  assert.equal(koniec(d, o), iso);
});

test("ISO, NULL i obcy tekst zostają nietknięte, a drugi przebieg niczego nie zmienia", () => {
  const { d, sprawa, wysylka } = stanowisko();
  const iso = sprawa("i-1", "2026-09-25T08:00:00.000Z");
  const pusta = sprawa("i-2", null);
  /* Kalendarz takiej daty nie zna, więc `strftime` dałoby NULL. Lepiej
     zostawić ją jak jest, niż zgubić stempel. */
  const niemozliwa = sprawa("i-3", "2026-13-45 99:99:99");
  const krotka = sprawa("i-4", "2026-09-25");
  const o = wysylka(iso, "k-1", "2026-09-25T08:00:00Z");

  migrate(d);
  migrate(d);
  assert.equal(stemple(d, iso).prowadzi_at, "2026-09-25T08:00:00.000Z");
  assert.equal(stemple(d, pusta).prowadzi_at, null);
  assert.equal(stemple(d, niemozliwa).prowadzi_at, "2026-13-45 99:99:99");
  assert.equal(stemple(d, krotka).prowadzi_at, "2026-09-25");
  assert.equal(koniec(d, o), "2026-09-25T08:00:00Z", "ISO bez milisekund też zostaje, jak przyszło");
});
