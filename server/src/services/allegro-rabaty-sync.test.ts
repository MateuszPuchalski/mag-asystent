import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { prowizjaNaGrosze, synchronizujAllegroRabaty } from "./allegro-rabaty-sync.js";

/* ── Synchronizator wniosków o rabat (0.163.0) ───────────────────────────────
   Lustro odczytu, nie rejestr decyzji. Pilnujemy trzech rzeczy: kwoty (bo
   przyjeżdża LICZBĄ, gdy Allegro wszędzie indziej oddaje kwotę tekstem),
   idempotencji (drugi przebieg nie mnoży wierszy) i tego, że wniosek bez
   identyfikatora nie wchodzi.                                              */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','klient')")
    .run();
  return d as unknown as Db;
}

const odpowiedz = (refundClaims: unknown[]) => ({ count: refundClaims.length, refundClaims });

const WNIOSEK = {
  id: "rc-1", status: "GRANTED", type: "MANUAL", quantity: 2,
  createdAt: "2026-09-01T10:00:00Z",
  commission: { amount: 6.15, currency: "PLN" },
  lineItem: { id: "li-1", offer: { id: "of-1" } },
};

test("prowizja przyjeżdża LICZBĄ i tak też jest liczona", () => {
  /* `naGrosze` z synchronizatora zwrotów liczy na TEKŚCIE, bo tam Allegro
     oddaje kwotę stringiem. Tutaj przyjeżdża liczba i przepuszczenie jej
     tamtą drogą dałoby `NaN` albo zero — kontrakt mówi o tym wprost. */
  assert.equal(prowizjaNaGrosze(6.15), 615);
  assert.equal(prowizjaNaGrosze(0), 0);
  assert.equal(prowizjaNaGrosze(undefined), null);
  assert.equal(prowizjaNaGrosze(Number.NaN), null);
});

test("wnioski lądują w bazie z kwotą, statusem i sposobem złożenia", async () => {
  const d = stanowisko();
  await synchronizujAllegroRabaty({
    database: d, apiUrl: "https://api", accountId: "klient",
    query: async () => odpowiedz([WNIOSEK]),
  });

  const w = d.prepare("SELECT * FROM allegro_rabat").get() as Record<string, unknown>;
  assert.equal(w.external_id, "rc-1");
  assert.equal(w.line_item_id, "li-1", "identyfikator POZYCJI ZAMÓWIENIA, po nim wiąże się zwrot");
  assert.equal(w.prowizja_grosze, 615);
  assert.equal(w.status, "GRANTED");
  assert.equal(w.typ, "MANUAL", "to po tym poznamy, ile pracy zdejmuje przycisk");
});

test("drugi przebieg odświeża wiersz, a nie mnoży wniosków", async () => {
  const d = stanowisko();
  const bieg = (status: string) => synchronizujAllegroRabaty({
    database: d, apiUrl: "https://api", accountId: "klient",
    query: async () => odpowiedz([{ ...WNIOSEK, status }]),
  });

  await bieg("WAITING_FOR_PAYMENT_REFUND");
  await bieg("GRANTED");

  const wiersze = d.prepare("SELECT status FROM allegro_rabat").all() as Array<{ status: string }>;
  assert.equal(wiersze.length, 1, "lustro odczytu ma jeden wiersz na wniosek");
  assert.equal(wiersze[0].status, "GRANTED", "i pokazuje stan najświeższy");
});

test("wniosek bez identyfikatora nie wchodzi — nie ma po czym go odświeżyć", async () => {
  const d = stanowisko();
  await synchronizujAllegroRabaty({
    database: d, apiUrl: "https://api", accountId: "klient",
    query: async () => odpowiedz([{ status: "GRANTED" }, WNIOSEK]),
  });
  assert.equal((d.prepare("SELECT count(*) n FROM allegro_rabat").get() as { n: number }).n, 1);
});

test("odpowiedź bez listy nie wywraca przebiegu", async () => {
  /* Ta sama ostrożność co w sondzie: nietrafiony kształt ma dać pustkę,
     a nie zabrać ze sobą całego taktu. */
  const d = stanowisko();
  await synchronizujAllegroRabaty({
    database: d, apiUrl: "https://api", accountId: "klient",
    query: async () => ({ cos: "innego" }),
  });
  assert.equal((d.prepare("SELECT count(*) n FROM allegro_rabat").get() as { n: number }).n, 0);
});
