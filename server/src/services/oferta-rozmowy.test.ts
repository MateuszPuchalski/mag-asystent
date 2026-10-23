import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-oferta-rozmowy-")), "t.db");
process.env.LOG_LEVEL = "silent";

/* ── Oferta rozmowy: jedna reguła dla panelu i Copilota ──────────────────────
   Kolejność źródeł to cała treść reguły: wskazanie ręczne, numer
   z wiadomości (najpierw klienta), jedyna pozycja zamówienia. Przy kilku
   pozycjach oferty nie ma, bo automat nie zgaduje.                        */

let db: typeof import("../db/db.js").db;
let O: typeof import("./oferta-rozmowy.js");
let konto = 0;
let rozmowa = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  O = await import("./oferta-rozmowy.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["conversation_event", "message", "conversation", "channel_account"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,'w-1','temat')`).run(konto).lastInsertRowid);
});

const wiadomosc = (id: string, kierunek: string, oferta: string | null, at: string) =>
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,sent_at,
    related_object_type,related_object_id) VALUES (?,?,?,?,'treść',?,?,?)`)
    .run(rozmowa, konto, id, kierunek, at, oferta ? "OFFER" : null, oferta);

const jedna = [{ offerId: "of-zam", sku: "SYM-1" }];

test("jedyna pozycja zamówienia jest ofertą rozmowy, gdy nic jej nie bije", () => {
  wiadomosc("m-1", "incoming", null, "2026-10-01T10:00:00Z");
  assert.deepEqual(O.wybierzOferteRozmowy(rozmowa, jedna),
    { konto, ofertaId: "of-zam", zrodlo: "zamowienie" });
  assert.equal(O.wybierzOferteRozmowy(rozmowa, null), null, "bez zamówienia oferty nie ma");
  assert.equal(O.wybierzOferteRozmowy(rozmowa, [...jedna, { offerId: "of-b", sku: null }]), null,
    "przy kilku pozycjach automat nie zgaduje");
  assert.equal(O.wybierzOferteRozmowy(rozmowa, [{ offerId: null, sku: "X" }]), null);
});

test("numer z wiadomości bije pozycję, a wiadomość klienta bije naszą, choć starsza", () => {
  wiadomosc("m-1", "incoming", "of-klient", "2026-10-01T10:00:00Z");
  wiadomosc("m-2", "outgoing", "of-nasza", "2026-10-02T10:00:00Z");
  assert.equal(O.wybierzOferteRozmowy(rozmowa, jedna)?.ofertaId, "of-klient");
  assert.equal(O.wybierzOferteRozmowy(rozmowa, jedna)?.zrodlo, "wiadomosc");
});

test("wskazanie ręczne bije wiadomość i pozycję", () => {
  wiadomosc("m-1", "incoming", "of-klient", "2026-10-01T10:00:00Z");
  db().prepare(`INSERT INTO conversation_event(conversation_id,event_type,payload)
    VALUES (?,'offer_linked_manually',?)`).run(rozmowa, JSON.stringify({ ofertaId: "of-reka", autor: "ala" }));
  assert.deepEqual(O.wybierzOferteRozmowy(rozmowa, jedna), { konto, ofertaId: "of-reka", zrodlo: "reczne" });
  assert.deepEqual(O.ofertaWskazana(rozmowa), { ofertaId: "of-reka", autor: "ala" });
});

test("rozmowy, której nie ma, nie da się dopasować", () => {
  assert.throws(() => O.wybierzOferteRozmowy(999_999, jedna), /Nie znaleziono rozmowy/);
});
