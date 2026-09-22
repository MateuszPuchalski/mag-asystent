import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../db/db.js";
import { sklasyfikujNowe } from "./klasyfikacja-auto.js";
import type { NadawcaKlasyfikacji } from "./copilot-klasyfikacja.js";
import { BladLimituCopilota } from "../adapters/copilot.js";

/* ── Takt rozpoznania każdej nowej wiadomości ────────────────────────────────
   Takt wydaje pieniądze bez kliknięcia, więc testy pilnują hamulców: okna,
   limitu przebiegu, sufitu z księgi — i tego, że awaria nie wraca w kółko. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const TERAZ = new Date("2026-09-22T12:00:00Z");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  return d;
}

function rozmowa(d: DatabaseSync, tresc: string, at: string): number {
  const id = Number(d.prepare(`INSERT INTO conversation
    (channel_account_id,external_conversation_id,subject) VALUES (1,?,'klient')`)
    .run(`w-${Math.random()}`).lastInsertRowid);
  d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,1,?,'incoming',?,?)`).run(id, `m-${Math.random()}`, tresc, at);
  return id;
}

let wolane = 0;
const nadaj: NadawcaKlasyfikacji = async () => {
  wolane++;
  return {
    surowa: {
      kategoria: "ORDER_STATUS", dodatkowe: [], akcja: "GET_SHIPMENT",
      wymagaCzlowieka: false, prosiOCzlowieka: false,
      brakDanychZamowienia: false, brakDanychProduktu: false,
      pewnosc: "wysoka", powodInne: null, uzasadnienie: "pyta o paczkę",
    },
    model: "claude-opus-5", promptWersja: "k2", ms: 50,
    zuzycie: { wej: 100, wyj: 20, cacheZapis: 0, cacheOdczyt: 0 },
  };
};

test("bierze wiadomości z okna, najstarsze pierwsze, i podpisuje się jako automat", async () => {
  const d = stanowisko();
  const stara = rozmowa(d, "sprzed okna", "2026-09-01T10:00:00Z");
  const b = rozmowa(d, "druga", "2026-09-21T10:00:00Z");
  const a = rozmowa(d, "pierwsza", "2026-09-20T10:00:00Z");
  wolane = 0;

  const w = await sklasyfikujNowe({ database: d, nadaj, naPrzebieg: 1, naGodzine: 10, oknoDni: 7,
    now: () => TERAZ });
  assert.equal(w.sklasyfikowanych, 1);
  const k = d.prepare("SELECT conversation_id, przez, przez_user_id FROM decyzja_klasyfikacji").get() as any;
  assert.equal(k.conversation_id, a, "najdłużej czekająca idzie pierwsza");
  assert.equal(k.przez, "automat");
  assert.equal(k.przez_user_id, null, "automat nie podpisuje się kontem człowieka");

  await sklasyfikujNowe({ database: d, nadaj, naPrzebieg: 10, naGodzine: 10, oknoDni: 7, now: () => TERAZ });
  const rozpoznane = (d.prepare("SELECT conversation_id FROM decyzja_klasyfikacji").all() as any[])
    .map((x) => x.conversation_id);
  assert.deepEqual(rozpoznane.sort(), [a, b].sort());
  assert.equal(rozpoznane.includes(stara), false, "okno chroni przed przerabianiem całej historii");
});

test("sufit godzinowy liczy się z księgi, razem z błędami", async () => {
  const d = stanowisko();
  rozmowa(d, "pytanie", "2026-09-22T11:00:00Z");
  for (let i = 0; i < 3; i++) {
    d.prepare(`INSERT INTO copilot_wywolanie(zadanie,model,wynik,at)
      VALUES ('klasyfikacja','',?, ?)`).run(i === 0 ? "blad" : "ok", "2026-09-22T11:30:00.000Z");
  }
  wolane = 0;
  const w = await sklasyfikujNowe({ database: d, nadaj, naPrzebieg: 5, naGodzine: 3, now: () => TERAZ });
  assert.equal(wolane, 0);
  assert.equal(w.przerwane, "sufit godzinowy wyczerpany");
  assert.ok(d.prepare("SELECT 1 FROM events WHERE type='copilot_auto_klasyfikacja_sufit'").get(),
    "takt, który stoi, ma o tym powiedzieć");
});

test("decyzja FAILED nie wraca w następnym przebiegu", async () => {
  const d = stanowisko();
  rozmowa(d, "pytanie", "2026-09-22T11:00:00Z");
  await sklasyfikujNowe({ database: d, nadaj: async () => { throw new Error("odmowa"); },
    naPrzebieg: 5, naGodzine: 10, now: () => TERAZ });
  wolane = 0;
  await sklasyfikujNowe({ database: d, nadaj, naPrzebieg: 5, naGodzine: 10, now: () => TERAZ });
  assert.equal(wolane, 0, "awaria rozmowy powtarzana co przebieg to rachunek bez końca");
});

test("limit dostawcy NIE zostawia decyzji — rozmowa wraca, gdy dostawca odpuści", async () => {
  const d = stanowisko();
  rozmowa(d, "pytanie", "2026-09-22T11:00:00Z");
  const w = await sklasyfikujNowe({ database: d,
    nadaj: async () => { throw new BladLimituCopilota("429", null); },
    naPrzebieg: 5, naGodzine: 10, now: () => TERAZ });
  assert.ok(w.przerwane);
  wolane = 0;
  await sklasyfikujNowe({ database: d, nadaj, naPrzebieg: 5, naGodzine: 10, now: () => TERAZ });
  assert.equal(wolane, 1);
});
