import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../db/db.js";
import {
  poprawKlasyfikacje, sklasyfikujRozmowy, type NadawcaKlasyfikacji,
} from "./copilot-klasyfikacja.js";
import { ustawReklamacyjna } from "./conversations.js";

/* ── Znacznik reklamacyjny po rozpoznaniu ────────────────────────────────────
   Pilnujemy czterech rzeczy: reklamacja dostaje znacznik sama, inna kategoria
   go nie dostaje, automat nie zdejmuje znacznika i nie wraca tam, gdzie
   człowiek już o znaczniku zdecydował.                                       */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const KTO = { id: 1, name: "A. Lewandowska" };
const AUTOMAT = { id: null, name: "automat" };

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','A. Lewandowska','biuro')").run();
  return d;
}

function rozmowa(d: DatabaseSync, tresc: string): number {
  const id = Number(d.prepare(`INSERT INTO conversation
    (channel_account_id,external_conversation_id,subject) VALUES (1,?,'zielony_ogrod')`)
    .run(`w-${Math.random()}`).lastInsertRowid);
  dopisz(d, id, tresc, "2026-09-03T08:00:00Z");
  return id;
}

function dopisz(d: DatabaseSync, rozmowaId: number, tresc: string, at: string): void {
  d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,1,?,'incoming',?,?)`).run(rozmowaId, `m-${Math.random()}`, tresc, at);
}

const nadawca = (kategoria: string, akcja = "HUMAN_REVIEW"): NadawcaKlasyfikacji => async () => ({
  surowa: {
    kategoria, dodatkowe: [], akcja, wymagaCzlowieka: false, prosiOCzlowieka: false,
    brakDanychZamowienia: false, brakDanychProduktu: false, pewnosc: "wysoka",
    powodInne: kategoria === "OTHER" ? "za_malo_tresci" : null, uzasadnienie: "",
  },
  model: "claude-opus-5", promptWersja: "k2", ms: 120,
  zuzycie: { wej: 900, wyj: 200, cacheZapis: 0, cacheOdczyt: 0 },
});

const znacznik = (d: DatabaseSync, id: number) => Number((d.prepare(
  "SELECT reklamacyjna FROM conversation WHERE id=?").get(id) as { reklamacyjna: number }).reklamacyjna);

const osZnacznika = (d: DatabaseSync, id: number) => (d.prepare(`SELECT payload FROM conversation_event
  WHERE conversation_id=? AND event_type='reklamacyjna_changed' ORDER BY id`).all(id) as
  Array<{ payload: string }>).map((w) => JSON.parse(w.payload) as { na: number; autor: string });

test("reklamacja rozpoznana przez model dostaje znacznik, ślad na osi i w dzienniku", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Składam reklamację, kosiarka nie odpala po tygodniu.");

  await sklasyfikujRozmowy(d, [id], AUTOMAT, nadawca("COMPLAINT"));

  assert.equal(znacznik(d, id), 1);
  assert.deepEqual(osZnacznika(d, id), [{ na: 1, autor: "automat" }]);
  const wpis = d.prepare("SELECT payload FROM events WHERE type='rozmowa_reklamacyjna'").get() as
    { payload: string } | undefined;
  assert.ok(wpis, "mutacja bez wpisu w dzienniku");
  assert.equal(JSON.parse(wpis.payload).zrodlo, "klasyfikacja");
});

test("inna kategoria znacznika nie stawia", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy nóż pasuje do NAC LS 46-450?");

  await sklasyfikujRozmowy(d, [id], AUTOMAT, nadawca("PRODUCT_COMPATIBILITY", "CHECK_COMPATIBILITY"));

  assert.equal(znacznik(d, id), 0);
  assert.deepEqual(osZnacznika(d, id), []);
});

test("podziękowanie po reklamacji nie zdejmuje znacznika", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Składam reklamację, kosiarka nie odpala.");
  await sklasyfikujRozmowy(d, [id], AUTOMAT, nadawca("COMPLAINT"));

  dopisz(d, id, "Dziękuję, czekam na odpowiedź.", "2026-09-03T10:00:00Z");
  await sklasyfikujRozmowy(d, [id], AUTOMAT, nadawca("OTHER", "NO_ACTION"));

  assert.equal(znacznik(d, id), 1);
  assert.equal(osZnacznika(d, id).length, 1);
});

test("znacznik zdjęty przez agenta nie wraca przy następnej reklamacji", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Składam reklamację, kosiarka nie odpala.");
  await sklasyfikujRozmowy(d, [id], AUTOMAT, nadawca("COMPLAINT"));
  ustawReklamacyjna(d, id, false, 1);

  dopisz(d, id, "To jak z tą reklamacją?", "2026-09-03T10:00:00Z");
  await sklasyfikujRozmowy(d, [id], AUTOMAT, nadawca("COMPLAINT"));

  assert.equal(znacznik(d, id), 0);
  assert.deepEqual(osZnacznika(d, id).map((z) => z.na), [1, 0]);
});

test("poprawka agenta na reklamację stawia znacznik z agentem jako autorem", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Silnik gaśnie po minucie, co robić?");
  await sklasyfikujRozmowy(d, [id], AUTOMAT, nadawca("PRODUCT_QUESTION", "GET_PRODUCT"));
  assert.equal(znacznik(d, id), 0);

  poprawKlasyfikacje(d, id, "COMPLAINT", "klient chce naprawy", KTO);

  assert.equal(znacznik(d, id), 1);
  assert.deepEqual(osZnacznika(d, id), [{ na: 1, autor: "A. Lewandowska" }]);
});
