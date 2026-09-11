import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "./db.js";

/* ── Wsteczne wypełnienie „kto prowadzi" (0.278.0) ───────────────────────────
   Do tego wydania znacznik był SAMYM IMIENIEM. Migracja dokłada tożsamość
   i próbuje ją odczytać z imienia — ale tylko wtedy, gdy imię wskazuje jedno
   konto. Dwa konta o tym samym imieniu to dokładnie ten przypadek, dla którego
   kolumna powstała, więc zgadywanie byłoby tu odwróceniem własnej decyzji.

   Wiersz bez dopasowania zostaje z NULL i naprawia go pierwsze kliknięcie.
   To jest świadoma cena: sprawa przez chwilę nie wpada do nikogo w „Moje",
   zamiast wpaść do niewłaściwej osoby.

   Backfill chodzi przy KAŻDEJ migracji, więc stanowisko odtwarza stan
   przedmigracyjny zerowaniem kolumny i puszcza `migrate()` drugi raz — to jest
   ta sama droga, którą przejdzie baza właściciela.                          */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function stanowisko(konta: Array<[number, string, string]>) {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  for (const [uid, login, imie] of konta) {
    d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (?,?,?,'biuro')")
      .run(uid, login, imie);
  }
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const dodaj = (ext: string, prowadzi: string | null) => Number(d.prepare(
    `INSERT INTO reklamacja_klienta
       (channel_account_id,external_id,prowadzi,otwarto_at,synced_at)
     VALUES (?,?,?,'2026-09-01T08:00:00Z','2026-09-11T09:00:00Z')`)
    .run(konto, ext, prowadzi).lastInsertRowid);
  return { d, dodaj };
}

/** Stan sprzed migracji: znacznik ma imię, nie ma tożsamości. */
const cofnijDoImienia = (d: DatabaseSync) =>
  d.exec("UPDATE reklamacja_klienta SET prowadzi_user_id=NULL");

const tozsamosc = (d: DatabaseSync, id: number) =>
  (d.prepare("SELECT prowadzi_user_id AS u FROM reklamacja_klienta WHERE id=?")
    .get(id) as { u: number | null }).u;

test("imię wskazujące JEDNO konto dostaje tożsamość wstecz", () => {
  const { d, dodaj } = stanowisko([[1, "ala", "A. Lewandowska"], [2, "marek", "M. Wójcik"]]);
  const id = dodaj("i-1", "A. Lewandowska");
  cofnijDoImienia(d);

  migrate(d);
  assert.equal(tozsamosc(d, id), 1);
});

test("imię wskazujące DWA konta zostaje bez tożsamości, bo zgadywanie byłoby gorsze", () => {
  const { d, dodaj } = stanowisko([
    [1, "ala", "A. Lewandowska"], [3, "ala2", "A. Lewandowska"]]);
  const id = dodaj("i-1", "A. Lewandowska");
  cofnijDoImienia(d);

  migrate(d);
  assert.equal(tozsamosc(d, id), null,
    "sprawa czeka na kliknięcie, zamiast wpaść do niewłaściwej osoby");
});

test("imię spoza listy kont i sprawa bez znacznika przechodzą bez wywrotki", () => {
  /* Konto-ślad bywa skasowane, a imię zostaje na wierszu. Migracja ma to
     przeżyć w ciszy: `migrate()` woła KAŻDY proces, więc jej wywrotka
     zatrzymałaby start całej instalacji. */
  const { d, dodaj } = stanowisko([[1, "ala", "A. Lewandowska"]]);
  const obcy = dodaj("i-1", "ktoś, kogo już nie ma");
  const niczyj = dodaj("i-2", null);
  cofnijDoImienia(d);

  migrate(d);
  assert.equal(tozsamosc(d, obcy), null);
  assert.equal(tozsamosc(d, niczyj), null);
});

test("migracja NIE rusza tożsamości, która już stoi", () => {
  /* Backfill chodzi przy każdym starcie. Gdyby nadpisywał, przeniesienie
     sprawy między imienniczkami cofałoby się przy każdym restarcie serwera. */
  const { d, dodaj } = stanowisko([
    [1, "ala", "A. Lewandowska"], [3, "ala2", "A. Lewandowska"]]);
  const id = dodaj("i-1", "A. Lewandowska");
  d.prepare("UPDATE reklamacja_klienta SET prowadzi_user_id=3 WHERE id=?").run(id);

  migrate(d);
  assert.equal(tozsamosc(d, id), 3);
});
