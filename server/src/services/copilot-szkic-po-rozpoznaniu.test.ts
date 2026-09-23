import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-szkic-po-rozp-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Szkic zaraz po rozpoznaniu (23 września 2026) ───────────────────────────
   Pilnujemy: rozpoznanie, które każe coś zrobić, daje szkic podpisany przez
   automat i czekający na agenta; drugi przebieg nie płaci drugi raz; poprawka
   kategorii (nowa decyzja) układa szkic od nowa; „nic do zrobienia" i awaria
   szkicu nie dają; sufit godzinowy trzyma koszt. Nadawca jest atrapą. */

let db: typeof import("../db/db.js").db;
let P: typeof import("./copilot-szkic-po-rozpoznaniu.js");
let poprawKlasyfikacje: typeof import("./copilot-klasyfikacja.js").poprawKlasyfikacje;
let subiekt: typeof import("../context.js").subiekt;
let konto = 0;
let biuro = 0;
let wywolan = 0;
let ostatniaKategoriaWFaktach = "";

const nadaj: import("./copilot-szkic.js").NadawcaSzkicu = async (_watek, fakty) => {
  wywolan++;
  ostatniaKategoriaWFaktach = /Rozpoznanie bieżącej prośby[^:]*: ([A-Z_]+)/.exec(String(fakty))?.[1] ?? "";
  return {
    tresc: "Dzień dobry, paczka jest w drodze.", uzyteFakty: [], zastrzezenia: [],
    daneDoboru: null, pasowanie: null, twierdzenia: [], odczytZeZdjec: [],
    model: "atrapa", ms: 5, zuzycie: { wej: 10, wyj: 5, cacheZapis: 0, cacheOdczyt: 0 },
  };
};

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ subiekt } = await import("../context.js"));
  ({ poprawKlasyfikacje } = await import("./copilot-klasyfikacja.js"));
  P = await import("./copilot-szkic-po-rozpoznaniu.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["szkic_copilota", "copilot_wywolanie", "decyzja_klasyfikacji", "dobor_rozmowy",
    "conversation_event", "message", "conversation", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('b','Ola','biuro')").run().lastInsertRowid);
  wywolan = 0;
});

/** Rozmowa z pytaniem klienta i aktywną decyzją klasyfikatora. */
function rozpoznana(kategoria: string, akcja: string, zrodlo = "MODEL"): number {
  const d = db();
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id)
    VALUES (?,?)`).run(konto, `w-${Math.random()}`).lastInsertRowid);
  const m = Number(d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,sent_at) VALUES (?,?,?,'incoming','Gdzie jest moja paczka?',?)`)
    .run(r, konto, `m-${Math.random()}`, new Date().toISOString()).lastInsertRowid);
  d.prepare(`INSERT INTO decyzja_klasyfikacji(conversation_id,message_id,wersja,aktywna,zrodlo,status,
    kategoria,akcja,wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,taksonomia_wersja,
    polityka_wersja,at,przez) VALUES (?,?,1,1,?,'SUCCESS',?,?,0,0,0,'v2','p1',?,'automat')`)
    .run(r, m, zrodlo, kategoria, akcja, new Date().toISOString());
  return r;
}

const biegnij = (ids: number[], naGodzine = 30) =>
  P.szkicujPoRozpoznaniu(ids, { database: db(), nadaj, subiekt, naGodzine });

test("rozpoznanie daje szkic automatu, czekający na agenta — nic nie idzie do klienta", async () => {
  const r = rozpoznana("ORDER_STATUS", "GET_SHIPMENT");
  const w = await biegnij([r]);
  assert.equal(w.ulozonych, 1);
  const s = db().prepare("SELECT przez, przez_user_id, ocena, decyzja_id FROM szkic_copilota WHERE conversation_id=?")
    .get(r) as { przez: string; przez_user_id: number | null; ocena: string | null; decyzja_id: number };
  assert.equal(s.przez, "automat");
  assert.equal(s.przez_user_id, null);
  assert.equal(s.ocena, null, "czeka na zatwierdzenie agenta");
  assert.ok(s.decyzja_id > 0, "szkic pamięta decyzję, pod którą powstał");
  assert.equal(ostatniaKategoriaWFaktach, "ORDER_STATUS");
  const wyslanych = db().prepare("SELECT count(*) n FROM message WHERE direction='outgoing'").get() as { n: number };
  assert.equal(wyslanych.n, 0);
});

test("drugi przebieg na tej samej decyzji nie płaci drugi raz", async () => {
  const r = rozpoznana("ORDER_STATUS", "GET_SHIPMENT");
  await biegnij([r]);
  assert.equal((await biegnij([r])).ulozonych, 0);
  assert.equal(wywolan, 1);
});

test("poprawka kategorii to nowa decyzja — szkic układa się od nowa pod kategorię człowieka", async () => {
  const r = rozpoznana("ORDER_STATUS", "GET_SHIPMENT");
  await biegnij([r]);
  poprawKlasyfikacje(db(), r, "INVOICE", null, { id: biuro, name: "Ola" });
  assert.deepEqual(P.czekajaNaSzkic(db(), [r]), [r]);
  assert.equal((await biegnij([r])).ulozonych, 1);
  assert.equal(ostatniaKategoriaWFaktach, "INVOICE");
  assert.equal(wywolan, 2);
});

test("„nic do zrobienia” i rozpoznanie zastępcze nie dają szkicu", async () => {
  const a = rozpoznana("OTHER", "NO_ACTION");
  const b = rozpoznana("ORDER_STATUS", "GET_SHIPMENT", "FALLBACK");
  assert.equal((await biegnij([a, b])).ulozonych, 0);
  assert.equal(wywolan, 0);
});

test("sufit godzinowy trzyma koszt i zostawia ślad w dzienniku", async () => {
  const r = rozpoznana("ORDER_STATUS", "GET_SHIPMENT");
  db().prepare(`INSERT INTO copilot_wywolanie(zadanie,model,wynik,at) VALUES ('szkic','atrapa','ok',?)`).run(new Date().toISOString());
  const w = await biegnij([r], 1);
  assert.equal(w.przerwane, "sufit godzinowy wyczerpany");
  assert.equal(wywolan, 0);
  assert.ok(db().prepare("SELECT 1 FROM events WHERE type='copilot_szkic_po_rozpoznaniu'").get());
});

test("zlecenie w tle idzie po kolei i nie układa tej samej rozmowy dwa razy", async () => {
  const r = rozpoznana("ORDER_STATUS", "GET_SHIPMENT");
  const [a, b] = await Promise.all([
    P.zlecSzkicPoRozpoznaniu([r], { database: db(), nadaj, subiekt, naGodzine: 30 }),
    P.zlecSzkicPoRozpoznaniu([r], { database: db(), nadaj, subiekt, naGodzine: 30 }),
  ]);
  assert.equal(a?.ulozonych, 1);
  assert.equal(b?.ulozonych, 0);
  assert.equal(wywolan, 1);
});
