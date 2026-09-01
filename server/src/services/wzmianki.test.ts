import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wzmianki-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Skrzynka wzmianek (0.159.0) ─────────────────────────────────────────────
   Wzmianka była do tego wydania zapisem bez odczytu — dokładnie tą samą blizną,
   którą komentarze dostały w 0.157.0. `conversation_mention` zapełniała się
   przy każdym komentarzu z „@", a jedyną drogą do niej było OTWARCIE tej
   właśnie rozmowy. Kto nie zgadł, w której, nie dowiadywał się nigdy.

   Testy pilnują trzech rzeczy, bo każda osobno wystarczy, żeby skrzynka
   kłamała: adresata (cudzej wzmianki nie widać), odhaczenia (osobnego dla
   każdej wzmiankowanej osoby) i reguły „zero zapisu przy patrzeniu".        */

let db: typeof import("../db/db.js").db;
let dodajKomentarz: typeof import("./conversations.js").dodajKomentarz;
let wzmiankiDlaMnie: typeof import("./wzmianki.js").wzmiankiDlaMnie;
let odhaczWzmianke: typeof import("./wzmianki.js").odhaczWzmianke;
let liczbaNowychWzmianek: typeof import("./wzmianki.js").liczbaNowychWzmianek;

let ala = 0;
let bogdan = 0;
let rozmowa = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ dodajKomentarz } = await import("./conversations.js"));
  ({ wzmiankiDlaMnie, odhaczWzmianke, liczbaNowychWzmianek } = await import("./wzmianki.js"));
});

beforeEach(() => {
  const d = db();
  for (const t of ["conversation_mention", "conversation_comment", "message", "conversation",
    "channel_account", "events", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();

  ala = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  bogdan = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('bogdan','B. Nowak','biuro')")
    .run().lastInsertRowid);
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,
    subject) VALUES (?,'w-1','zielony_ogrod')`).run(konto).lastInsertRowid);
});

test("wzmianka dociera do wskazanej osoby, a nie do wszystkich z biura", () => {
  dodajKomentarz(rozmowa, ala, "@Bogdan zerkniesz na ten szarpak?", [bogdan]);

  const jego = wzmiankiDlaMnie(bogdan);
  assert.equal(jego.length, 1);
  assert.equal(jego[0].autor, "A. Lewandowska");
  assert.equal(jego[0].klient, "zielony_ogrod");
  assert.equal(jego[0].conversationId, rozmowa);
  assert.equal(jego[0].odhaczona, false);

  /* Autorka nie wzmiankowała siebie, więc jej skrzynka zostaje pusta.
     Wzmianka „do wszystkich" byłaby powiadomieniem, nie wzmianką. */
  assert.deepEqual(wzmiankiDlaMnie(ala), []);
});

test("odhaczenie działa na PARĘ komentarz–osoba, nie na cały komentarz", () => {
  /* Dwie osoby wzmiankowane w jednym zdaniu mają z nim dwie różne sprawy.
     Odhaczenie wspólne kasowałoby cudzą robotę jednym kliknięciem. */
  const k = dodajKomentarz(rozmowa, ala, "@Bogdan @Ala kto to bierze?", [bogdan, ala]);

  odhaczWzmianke(k.id, bogdan);

  assert.equal(wzmiankiDlaMnie(bogdan)[0].odhaczona, true);
  assert.equal(wzmiankiDlaMnie(ala)[0].odhaczona, false);
  assert.equal(liczbaNowychWzmianek(bogdan), 0);
  assert.equal(liczbaNowychWzmianek(ala), 1);
});

test("cudzej wzmianki nie da się odhaczyć", () => {
  const k = dodajKomentarz(rozmowa, ala, "@Bogdan pilne", [bogdan]);
  assert.throws(() => odhaczWzmianke(k.id, ala), /Nie znaleziono wzmianki/);
  assert.equal(liczbaNowychWzmianek(bogdan), 1, "cudza próba nie ma prawa nic ruszyć");
});

test("odhaczenie zostawia ślad w dzienniku, a patrzenie nie zostawia nic", () => {
  const k = dodajKomentarz(rozmowa, ala, "@Bogdan zerknij", [bogdan]);
  const d = db();
  const przed = (d.prepare("SELECT count(*) n FROM events").get() as { n: number }).n;

  wzmiankiDlaMnie(bogdan);
  liczbaNowychWzmianek(bogdan);
  assert.equal((d.prepare("SELECT count(*) n FROM events").get() as { n: number }).n, przed,
    "odczyt skrzynki wzmianek dopisał zdarzenie");

  odhaczWzmianke(k.id, bogdan);
  const typy = (d.prepare("SELECT type FROM events WHERE type LIKE 'wzmianka%'")
    .all() as Array<{ type: string }>).map((w) => w.type);
  assert.deepEqual(typy, ["wzmianka_odhaczona"]);
});

test("powtórne odhaczenie nie przestawia godziny załatwienia", () => {
  /* Data odhaczenia mówi, KIEDY ktoś się tym zajął. Nadpisana drugim
     kliknięciem przestaje o tym mówić, a przy okazji dokłada drugi wpis
     do dziennika o zdarzeniu, którego nie było. */
  const k = dodajKomentarz(rozmowa, ala, "@Bogdan zerknij", [bogdan]);
  odhaczWzmianke(k.id, bogdan, new Date("2026-09-01T08:00:00.000Z"));
  odhaczWzmianke(k.id, bogdan, new Date("2026-09-01T12:00:00.000Z"));

  const w = db().prepare("SELECT seen_at FROM conversation_mention WHERE comment_id=? AND user_id=?")
    .get(k.id, bogdan) as { seen_at: string };
  assert.equal(w.seen_at, "2026-09-01T08:00:00.000Z");
  assert.equal((db().prepare("SELECT count(*) n FROM events WHERE type='wzmianka_odhaczona'")
    .get() as { n: number }).n, 1);
});

test("lista idzie od najnowszej i niesie fragment komentarza", () => {
  /* Fragment jest po to, żeby agent wiedział, czy sprawa jest jego, ZANIM
     otworzy rozmowę. Sama nazwa klienta tego nie mówi. */
  const stara = dodajKomentarz(rozmowa, ala, "@Bogdan pierwsza sprawa", [bogdan]);
  db().prepare("UPDATE conversation_comment SET created_at='2026-08-30T08:00:00.000Z' WHERE id=?")
    .run(stara.id);
  dodajKomentarz(rozmowa, ala, "@Bogdan druga sprawa", [bogdan]);

  const lista = wzmiankiDlaMnie(bogdan);
  assert.deepEqual(lista.map((w) => w.fragment), ["@Bogdan druga sprawa", "@Bogdan pierwsza sprawa"]);
});

test("nieodhaczone da się wybrać osobno, bo to one są robotą do zrobienia", () => {
  const k = dodajKomentarz(rozmowa, ala, "@Bogdan raz", [bogdan]);
  dodajKomentarz(rozmowa, ala, "@Bogdan dwa", [bogdan]);
  odhaczWzmianke(k.id, bogdan);

  assert.equal(wzmiankiDlaMnie(bogdan).length, 2, "domyślnie widać całą historię");
  assert.deepEqual(wzmiankiDlaMnie(bogdan, { tylkoNowe: true }).map((w) => w.fragment),
    ["@Bogdan dwa"]);
});

test("skasowany komentarz zabiera swoją wzmiankę, nie zostawia sieroty", () => {
  const k = dodajKomentarz(rozmowa, ala, "@Bogdan zerknij", [bogdan]);
  db().prepare("DELETE FROM conversation_comment WHERE id=?").run(k.id);
  assert.deepEqual(wzmiankiDlaMnie(bogdan), []);
});
