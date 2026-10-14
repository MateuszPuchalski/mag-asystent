import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import {
  groszeZKwoty, sprawdzZwrotPlatnosci, SprawdzenieZwrotuBlad, synchronizujZwrotyPlatnosci,
  zwrotyPlatnosciZwrotu, zwrotZOdpowiedzi,
} from "./allegro-zwroty-platnosci.js";

/* Kształt rekordu stoi na schemacie `RefundDetails` w docs/allegro/swagger.yaml.
   Te testy pilnują trzech rzeczy: czy rekord czytamy po wymaganych polach, czy
   zatrzask jest ostrożny i czy zwrot w toku dochodzi do końca. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','k')").run();
  return d as unknown as Db;
}

function zwrot(d: Db, ext: string, order: string, utworzono = "2026-09-01T08:00:00Z", extra = "") {
  return Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id, external_id, order_id, created_at, synced_at)
    VALUES (1,?,?,?,?)`).run(ext, order, utworzono, "2026-09-22T08:00:00Z" + extra).lastInsertRowid);
}

const rekord = (o: Record<string, unknown> = {}) => ({
  id: "r1", payment: { id: "pay1" }, order: { id: "ord1" }, reason: "REFUND",
  status: "SUCCESS", createdAt: "2026-09-10T10:00:00Z",
  totalValue: { amount: "59.90", currency: "PLN" },
  lineItems: [
    { id: "li1", type: "QUANTITY", quantity: 2 },
    { id: "li2", type: "AMOUNT", value: { amount: "9.90", currency: "PLN" } },
  ],
  delivery: { value: { amount: "12.00", currency: "PLN" } },
  ...o,
});

const odpowiedz = (...r: unknown[]) => ({ refunds: r, count: r.length, totalCount: r.length });

test("kwota na grosze liczy na tekście i nie zmyśla przy obcym kształcie", () => {
  assert.equal(groszeZKwoty("19.99"), 1999);
  assert.equal(groszeZKwoty("5"), 500);
  assert.equal(groszeZKwoty("0,5"), 50);
  assert.equal(groszeZKwoty("abc"), null);
  assert.equal(groszeZKwoty(undefined), null);
});

test("rekord czytamy po wymaganych polach, pozycje i dostawę po opcjonalnych", () => {
  const z = zwrotZOdpowiedzi(rekord());
  assert.ok(z);
  assert.equal(z.kwotaGrosze, 5990);
  assert.equal(z.dostawaGrosze, 1200);
  assert.deepEqual(z.pozycje, [
    { id: "li1", type: "QUANTITY", quantity: 2, kwotaGrosze: null },
    { id: "li2", type: "AMOUNT", quantity: null, kwotaGrosze: 990 },
  ]);
  assert.equal(zwrotZOdpowiedzi(rekord({ id: undefined })), null, "bez id nie ma klucza");
  assert.equal(zwrotZOdpowiedzi(rekord({ status: undefined })), null);
  assert.equal(zwrotZOdpowiedzi(rekord({ order: undefined }))?.orderId, null,
    "order nie jest wymagane w schemacie");
});

test("SUCCESS zatrzaskuje zwrot klienta i zostawia ślad ze źródłem", async () => {
  const d = stanowisko();
  const id = zwrot(d, "ret1", "ord1");
  const wynik = await synchronizujZwrotyPlatnosci(d, 1, {
    apiUrl: "https://x", query: async () => odpowiedz(rekord()),
  });
  assert.equal(wynik.zatrzasniete, 1);
  const w = d.prepare("SELECT rozliczony_allegro_at AS r FROM zwrot_klienta WHERE id=?")
    .get(id) as { r: string };
  assert.equal(w.r, "2026-09-10T10:00:00Z");
  const ev = d.prepare("SELECT payload FROM events WHERE type='zwrot_wyplata_potwierdzona'")
    .get() as { payload?: string } | undefined;
  assert.match(String(ev?.payload ?? ""), /payments\/refunds/);
});

test("zatrzask jest ostrożny: reklamacja, PARTIAL, starszy przelew i dwa zwroty nie zamykają", async () => {
  const d = stanowisko();
  zwrot(d, "a", "o-reklamacja");
  zwrot(d, "b", "o-czesc");
  zwrot(d, "c", "o-stary", "2026-09-20T08:00:00Z");
  zwrot(d, "d1", "o-dwa");
  zwrot(d, "d2", "o-dwa");
  const wynik = await synchronizujZwrotyPlatnosci(d, 1, {
    apiUrl: "https://x",
    query: async () => odpowiedz(
      rekord({ id: "r1", order: { id: "o-reklamacja" }, reason: "COMPLAINT" }),
      rekord({ id: "r2", order: { id: "o-czesc" }, status: "PARTIAL" }),
      rekord({ id: "r3", order: { id: "o-stary" }, createdAt: "2026-09-10T10:00:00Z" }),
      rekord({ id: "r4", order: { id: "o-dwa" } }),
    ),
  });
  assert.equal(wynik.zatrzasniete, 0);
  assert.equal(wynik.zapisane, 4, "lustro zapisuje wszystko, zatrzask wybiera");
});

test("zwrot w toku jest dopytywany po id, aż dojdzie do SUCCESS", async () => {
  const d = stanowisko();
  zwrot(d, "ret1", "ord1");
  const adresy: string[] = [];
  const query = async (url: string) => {
    adresy.push(url);
    return odpowiedz(rekord({ status: url.includes("&id=") ? "SUCCESS" : "IN_PROGRESS" }));
  };
  const pierwszy = await synchronizujZwrotyPlatnosci(d, 1, { apiUrl: "https://x", query },
    new Date("2026-09-10T12:00:00Z"));
  /* Lista pokazała zwrot w toku, a dopytanie po `id` w tym samym przebiegu
     zobaczyło już SUCCESS. */
  assert.ok(adresy.some((u) => u.includes("&id=r1")));
  assert.equal(pierwszy.zatrzasniete, 1);
});

test("lista zwrotów płatności zwrotu łączy po zamówieniu, a bez zamówienia po płatności", () => {
  const d = stanowisko();
  const id = zwrot(d, "ret1", "ord1");
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id, external_id, platnosc_id, synced_at)
    VALUES (1,'ord1','pay1','2026-09-22T08:00:00Z')`).run();
  d.prepare(`INSERT INTO zwrot_platnosci(channel_account_id, refund_id, payment_id, order_id, status,
      utworzono_at, sprawdzono_at) VALUES (1,'bez-zam','pay1',NULL,'SUCCESS','2026-09-10T00:00:00Z','x')`).run();
  d.prepare(`INSERT INTO zwrot_platnosci(channel_account_id, refund_id, payment_id, order_id, status,
      utworzono_at, sprawdzono_at) VALUES (1,'obca','pay9','inne','SUCCESS','2026-09-10T00:00:00Z','x')`).run();
  assert.deepEqual(zwrotyPlatnosciZwrotu(d, id).map((z) => z.refundId), ["bez-zam"]);
});

test("pozycje zwrotu płatności dostają nazwę z pozycji zamówienia o tym samym id", () => {
  const d = stanowisko();
  const id = zwrot(d, "ret1", "ord1");
  const m = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id, external_id, synced_at)
    VALUES (1,'ord1','2026-09-22T08:00:00Z')`).run().lastInsertRowid);
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id, external_id, nazwa, ilosc, cena_grosze, waluta)
    VALUES (?,?,?,?,?,?)`).run(m, "li1", "Sekator Gardena", 2, 2995, "PLN");
  d.prepare(`INSERT INTO zwrot_platnosci(channel_account_id, refund_id, order_id, status, utworzono_at,
      pozycje_json, sprawdzono_at) VALUES (1,'r1','ord1','SUCCESS','2026-09-10T00:00:00Z',?, 'x')`)
    .run(JSON.stringify([
      { id: "li1", type: "QUANTITY", quantity: 2, kwotaGrosze: null },
      { id: "obca", type: "AMOUNT", quantity: null, kwotaGrosze: 100 },
    ]));
  const [z] = zwrotyPlatnosciZwrotu(d, id);
  assert.deepEqual(z.pozycje.map((x) => x.nazwa), ["Sekator Gardena", null]);
});

const biuro = { id: 1, name: "Ewa" };

test("sprawdzenie na żądanie pyta o zamówienie, zapisuje wynik i zatrzaskuje zwrot", async () => {
  const d = stanowisko();
  const id = zwrot(d, "ret1", "ord1");
  const adresy: string[] = [];
  const wynik = await sprawdzZwrotPlatnosci(d, id, biuro, {
    apiUrl: "https://x", query: async (u) => { adresy.push(u); return odpowiedz(rekord()); },
  });
  assert.equal(wynik.znaleziono, 1);
  assert.equal(wynik.wyplacone, true);
  assert.equal(wynik.platnosci[0].kwotaGrosze, 5990);
  assert.deepEqual(adresy, ["https://x/payments/refunds?limit=100&offset=0&order.id=ord1"]);
  const ev = d.prepare("SELECT payload FROM events WHERE type='zwrot_platnosci_sprawdzone'")
    .get() as { payload: string };
  assert.match(ev.payload, /"znaleziono":1/);
});

test("sprawdzenie bez odpowiedzi od Allegro to wynik, nie błąd — i pyta jeszcze o płatność", async () => {
  const d = stanowisko();
  const id = zwrot(d, "ret1", "ord1");
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id, external_id, platnosc_id, synced_at)
    VALUES (1,'ord1','pay1','2026-09-22T08:00:00Z')`).run();
  const adresy: string[] = [];
  const wynik = await sprawdzZwrotPlatnosci(d, id, biuro, {
    apiUrl: "https://x", query: async (u) => { adresy.push(u); return odpowiedz(); },
  });
  assert.equal(wynik.znaleziono, 0);
  assert.equal(wynik.wyplacone, false, "brak rekordu nie zatrzaskuje");
  assert.equal(adresy.length, 2);
  assert.match(adresy[1], /payment\.id=pay1/);
});

test("rekord bez order łączy się z zamówieniem po płatności już przy zapisie", async () => {
  const d = stanowisko();
  const id = zwrot(d, "ret1", "ord1");
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id, external_id, platnosc_id, synced_at)
    VALUES (1,'ord1','pay1','2026-09-22T08:00:00Z')`).run();
  const wynik = await sprawdzZwrotPlatnosci(d, id, biuro, {
    apiUrl: "https://x",
    query: async (u) => u.includes("payment.id") ? odpowiedz(rekord({ order: undefined })) : odpowiedz(),
  });
  assert.equal(wynik.wyplacone, true);
  const p = d.prepare("SELECT order_id FROM zwrot_platnosci").get() as { order_id: string };
  assert.equal(p.order_id, "ord1");
});

test("zatrzask łączy po płatności także rekord zapisany, zanim znaliśmy zamówienie", async () => {
  const d = stanowisko();
  const id = zwrot(d, "ret1", "ord1");
  d.prepare(`INSERT INTO zwrot_platnosci(channel_account_id, refund_id, payment_id, order_id, status, reason,
      utworzono_at, sprawdzono_at) VALUES (1,'r1','pay1',NULL,'SUCCESS','REFUND','2026-09-10T10:00:00Z','x')`).run();
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id, external_id, platnosc_id, synced_at)
    VALUES (1,'ord1','pay1','2026-09-22T08:00:00Z')`).run();
  const wynik = await synchronizujZwrotyPlatnosci(d, 1, { apiUrl: "https://x", query: async () => odpowiedz() });
  assert.equal(wynik.zatrzasniete, 1);
  const w = d.prepare("SELECT rozliczony_allegro_at AS r FROM zwrot_klienta WHERE id=?").get(id) as { r: string };
  assert.equal(w.r, "2026-09-10T10:00:00Z");
});

test("sprawdzenie odmawia przy paczce nieodebranej i zwrocie bez zamówienia", async () => {
  const d = stanowisko();
  const nieodebrana = zwrot(d, "nieodebrana:1", "ord1");
  const bez = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id, external_id, order_id, created_at, synced_at) VALUES (1,'x',NULL,'2026-09-01T08:00:00Z','s')`)
    .run().lastInsertRowid);
  const deps = { apiUrl: "https://x", query: async () => { throw new Error("nie wolno pytać"); } };
  await assert.rejects(sprawdzZwrotPlatnosci(d, nieodebrana, biuro, deps), SprawdzenieZwrotuBlad);
  await assert.rejects(sprawdzZwrotPlatnosci(d, bez, biuro, deps), SprawdzenieZwrotuBlad);
});
