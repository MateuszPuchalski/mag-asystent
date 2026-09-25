import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-towar-znany-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── „Szukamy" przy zwrocie znanego towaru (@wydanie) ────────────────────────
   Zgłoszenie właściciela: nagłówek rozmowy o zwrot noża 14-25001 mówił
   „Szukamy". Automat szkicu wpisał dane doboru i przy okazji podniósł status.
   Testy pilnują czterech granic:
   1. reguła „towar znany" zgadza się z bramką panelu (`skrzynka/kokpit.ts`);
   2. automat przy znanym towarze wpisuje dane, ale statusu nie rusza;
   3. porządek wsteczny zdejmuje wyłącznie start automatu, nigdy decyzji
      człowieka ani wybranego kandydata;
   4. drugi bieg porządku nie ma czego ruszyć.                               */

let db: typeof import("../db/db.js").db;
let D: typeof import("./dobor.js");
let T: typeof import("./towar-znany.js");

let konto = 0;
let rozmowa = 0;
let biuro = 0;
const AUTOMAT = { automat: "szkic" };

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./dobor.js");
  T = await import("./towar-znany.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dobor_rozmowy", "conversation_event", "zamowienie_klienta_pozycja", "zamowienie_klienta",
    "message", "conversation", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-t')").run().lastInsertRowid);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,'w-t','zwrot noża')`).run(konto).lastInsertRowid);
});

/** Wiadomość klienta pod zamówieniem, opcjonalnie też pod ofertą. */
function wiadomosc(numer: string | null, oferta: string | null): void {
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
      related_order_id,related_object_type,related_object_id,sent_at)
    VALUES (?,?,?,'incoming','zwracam nóż',?,?,?,'2026-09-25T08:05:00Z')`)
    .run(rozmowa, konto, `m-${numer}-${oferta}`, numer, oferta ? "OFFER" : null, oferta);
}

function zamowienie(numer: string, oferty: Array<string | null>): void {
  const d = db();
  const id = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,kupujacy_login,
      kupiono_at,suma_grosze,waluta,synced_at) VALUES (?,?,'kupujacy','2026-09-22T13:17:00Z',5549,'PLN','2026-09-22')`)
    .run(konto, numer).lastInsertRowid);
  for (const o of oferty) {
    d.prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,nazwa,offer_id,ilosc,cena_grosze,waluta)
      VALUES (?,'Nóż do kosiarki MTD',?,1,4500,'PLN')`).run(id, o);
  }
}

const status = () => D.doborRozmowy(rozmowa).status;
const wersja = () => D.doborRozmowy(rozmowa).wersja;

test("towar znany: jedyna pozycja, oferta z wiadomości wśród pozycji — tak; obca oferta, brak zamówienia — nie", () => {
  wiadomosc("z1", null);
  assert.equal(T.towarZnanyZZamowienia(rozmowa), false, "zamówienie jeszcze niepobrane to „nie wiemy”");
  zamowienie("z1", ["10805901490"]);
  assert.equal(T.towarZnanyZZamowienia(rozmowa), true, "jedyna pozycja");

  wiadomosc(null, "999");
  assert.equal(T.towarZnanyZZamowienia(rozmowa), false, "oferta spoza zamówienia — klient pyta o inny towar");

  db().prepare("DELETE FROM message").run();
  db().prepare("DELETE FROM zamowienie_klienta_pozycja").run();
  db().prepare("DELETE FROM zamowienie_klienta").run();
  zamowienie("z2", ["111", "222"]);
  wiadomosc("z2", null);
  assert.equal(T.towarZnanyZZamowienia(rozmowa), false, "kilka pozycji bez oferty — nie wiadomo, o którą");
  wiadomosc(null, "222");
  assert.equal(T.towarZnanyZZamowienia(rozmowa), true, "oferta rozmowy jest jedną z pozycji");
});

test("automat przy znanym towarze wpisuje dane, ale nie zaczyna szukania", () => {
  wiadomosc("z1", null);
  zamowienie("z1", ["10805901490"]);
  const d = D.zapiszDane(rozmowa, { nazwaCzesci: "nóż" }, wersja(), AUTOMAT, db(),
    { bezStartu: T.towarZnanyZZamowienia(rozmowa) });
  assert.equal(d.dane.nazwaCzesci, "nóż", "dane zostają — przydają się pytaniu o pasowanie");
  assert.equal(status(), "not_started");
});

test("bez znanego towaru automat zaczyna szukanie jak dotąd", () => {
  D.zapiszDane(rozmowa, { nazwaCzesci: "nóż" }, wersja(), AUTOMAT, db(),
    { bezStartu: T.towarZnanyZZamowienia(rozmowa) });
  assert.equal(status(), "searching");
});

test("porządek wsteczny zdejmuje „Szukamy” automatu i zostawia ślad; drugi bieg nie ma czego ruszyć", () => {
  wiadomosc("z1", null);
  zamowienie("z1", ["10805901490"]);
  /* Stan sprzed poprawki: automat podniósł status bez bramki. */
  D.zapiszDane(rozmowa, { nazwaCzesci: "nóż" }, wersja(), AUTOMAT);
  assert.equal(status(), "searching");

  assert.equal(T.uporzadkujStartyAutomatu(), 1);
  assert.equal(status(), "not_started");
  const slad = db().prepare(`SELECT payload FROM conversation_event
      WHERE conversation_id=? AND event_type='dobor_status_changed' ORDER BY id DESC LIMIT 1`).get(rozmowa) as
    { payload: string };
  assert.deepEqual(JSON.parse(slad.payload), {
    przed: "searching", po: "not_started", autor: "automat (porządek znanych towarów)" });
  const dziennik = db().prepare(`SELECT COUNT(*) AS n FROM events WHERE type='dobor_status'`).get() as { n: number };
  assert.equal(dziennik.n, 2, "start automatu i jego cofnięcie — oba w dzienniku");

  assert.equal(T.uporzadkujStartyAutomatu(), 0, "drugi bieg");
});

test("porządek nie cofa decyzji człowieka ani doboru z wybranym kandydatem", () => {
  wiadomosc("z1", null);
  zamowienie("z1", ["10805901490"]);
  D.zapiszDane(rozmowa, { nazwaCzesci: "nóż" }, wersja(), AUTOMAT);
  /* Człowiek świadomie ustawił status później — jego zdarzenie jest nowsze. */
  D.ustawStatusDoboru(rozmowa, "searching", null, biuro);
  D.ustawStatusDoboru(rozmowa, "missing_information", "tabliczka", biuro);
  D.ustawStatusDoboru(rozmowa, "searching", null, biuro);
  assert.equal(T.uporzadkujStartyAutomatu(), 0);
  assert.equal(status(), "searching");

  /* Człowiek poprawił dane: `updated_by` jest jego, więc dobór jest jego. */
  db().prepare("DELETE FROM dobor_rozmowy").run();
  db().prepare("DELETE FROM conversation_event").run();
  const d = D.zapiszDane(rozmowa, { nazwaCzesci: "nóż" }, wersja(), AUTOMAT);
  D.zapiszDane(rozmowa, { marka: "MTD" }, d.wersja, biuro);
  assert.equal(T.uporzadkujStartyAutomatu(), 0);
  assert.equal(status(), "searching");
});
