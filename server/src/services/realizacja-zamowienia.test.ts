import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-realizacja-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Czy paczka wyjdzie dziś ─────────────────────────────────────────────────
   Testy pilnują trzech decyzji właściciela i jednej pułapki:

   1. „WYŚLEMY DZIŚ" TYLKO PRZY KOMPLECIE: opłacone, termin nadania dziś,
      towar na stanie albo już wydany dokumentem. Każdy brak zamienia
      werdykt na „nie obiecuj" z powodem.
   2. TERMIN, KTÓRY MINĄŁ, NIE DOSTAJE OBIETNICY — paczka powinna już wyjść.
   3. PO NADANIU FAKT MILCZY, bo odpowiada fakt o przesyłce.
   4. DZIEŃ LICZY ZEGAR MAGAZYNU, nie UTC: 22:30 UTC to już jutro w Polsce. */

let db: typeof import("../db/db.js").db;
let R: typeof import("./realizacja-zamowienia.js");
let S: typeof import("./allegro-zamowienia-sync.js");
let subiekt: typeof import("../context.js").subiekt;

let konto = 0;
let zamowienie = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  R = await import("./realizacja-zamowienia.js");
  S = await import("./allegro-zamowienia-sync.js");
  ({ subiekt } = await import("../context.js"));
});

beforeEach(() => {
  const d = db();
  for (const t of ["zamowienie_klienta_pozycja", "zamowienie_klienta", "sgt_faktura", "channel_account", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a')")
    .run().lastInsertRowid);
  zamowienie = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,
    status,kupiono_at,synced_at) VALUES (?,'ord-1','READY_FOR_PROCESSING','2026-10-05T07:00:00Z',
    '2026-10-05T07:00:00Z')`).run(konto).lastInsertRowid);
});

/** Wtorek 6 października 2026, 10:00 w Polsce. */
const TERAZ = new Date("2026-10-06T08:00:00Z");

const stan = (zmiany: Partial<import("./realizacja-zamowienia.js").StanRealizacji> = {}) => ({
  status: "READY_FOR_PROCESSING", realizacja: "PROCESSING", platnoscTyp: "ONLINE",
  platnoscAt: "2026-10-05T07:10:00Z", nadanieDo: "2026-10-06T15:00:00Z", nadana: false,
  dokumenty: [], braki: [], ...zmiany,
});

test("opłacone, termin nadania dziś, towar jest: szkic pisze, że wyślemy dziś", () => {
  const o = R.ocenRealizacji(stan(), TERAZ)!;
  assert.equal(o.wyslemyDzis, true);
  assert.match(o.zdanie, /termin nadania według Allegro: dziś \(2026-10-06\)/);
  assert.match(o.zdanie, /napisz, że wyślemy ją dziś/);
  assert.match(o.zdanie, /status u sprzedawcy: w realizacji/);
});

test("termin jutro: werdykt podaje termin nadania, nie obiecuje dziś", () => {
  const o = R.ocenRealizacji(stan({ nadanieDo: "2026-10-07T15:00:00Z" }), TERAZ)!;
  assert.equal(o.wyslemyDzis, false);
  assert.match(o.zdanie, /wyślemy najpóźniej 2026-10-07/);
});

test("każdy brak zamienia werdykt na „nie obiecuj” i mówi dlaczego", () => {
  const przypadki: Array<[Partial<import("./realizacja-zamowienia.js").StanRealizacji>, RegExp]> = [
    [{ status: "FILLED_IN" }, /nie obiecuj wysyłki dziś \(płatność niezakończona\)/],
    [{ nadanieDo: "2026-10-05T15:00:00Z" }, /termin nadania minął/],
    [{ nadanieDo: null }, /brak terminu nadania/],
    [{ realizacja: "SUSPENDED" }, /nie czeka na wysyłkę/],
    /* Sprzedawca oznaczył wysyłkę, a numer jeszcze nie doszedł z Allegro. */
    [{ realizacja: "SENT" }, /oznaczył paczkę jako wysłaną/],
    [{ status: "CANCELLED" }, /nie czeka na wysyłkę/],
    [{ braki: [{ nazwa: "Gaźnik", potrzeba: 2, jest: 1 }] }, /brakuje towaru na stanie/],
  ];
  for (const [zmiana, wzor] of przypadki) {
    const o = R.ocenRealizacji(stan(zmiana), TERAZ)!;
    assert.equal(o.wyslemyDzis, false, JSON.stringify(zmiana));
    assert.match(o.zdanie, wzor, JSON.stringify(zmiana));
  }
});

test("dokument sprzedaży z Subiekta wchodzi do zdania", () => {
  const o = R.ocenRealizacji(stan({
    dokumenty: [{ numer: "PA 812/2026", typ: "PA", data: "2026-10-06" }], braki: null,
  }), TERAZ)!;
  assert.equal(o.wyslemyDzis, true);
  assert.match(o.zdanie, /dokument sprzedaży w Subiekcie wystawiony 2026-10-06/);
});

test("po nadaniu fakt milczy — odpowiada fakt o przesyłce", () => {
  assert.equal(R.ocenRealizacji(stan({ nadana: true }), TERAZ), null);
});

test("dzień liczy zegar magazynu: 22:30 UTC to już następna doba w Polsce", () => {
  /* 5 października 22:30 UTC to 6 października 00:30 w Warszawie. */
  const o = R.ocenRealizacji(stan({ nadanieDo: "2026-10-05T22:30:00Z" }), TERAZ)!;
  assert.equal(o.wyslemyDzis, true);
});

test("zdanie dla modelu nie ma półpauzy — model przepisuje ją do szkicu", () => {
  for (const s of [stan(), stan({ status: "FILLED_IN" }), stan({ nadanieDo: "2026-10-01T10:00:00Z" })]) {
    assert.doesNotMatch(R.ocenRealizacji(s, TERAZ)!.zdanie, /—/);
  }
});

test("odczyt z bazy: dokument z numerem zamówienia w uwagach, bez sprawdzania stanu", () => {
  db().prepare(`INSERT INTO sgt_faktura(dok_id,typ,nr_pelny,zamowienie_z_uwag,data_wyst)
    VALUES (1,'PA','PA 812/2026','ord-1','2026-10-06')`).run();
  db().prepare(`UPDATE zamowienie_klienta SET realizacja_status='PROCESSING',
    nadanie_do='2026-10-06T15:00:00Z' WHERE id=?`).run(zamowienie);
  const s = R.stanRealizacji(zamowienie, false, subiekt, db())!;
  assert.deepEqual(s.dokumenty, [{ numer: "PA 812/2026", typ: "PA", data: "2026-10-06" }]);
  assert.equal(s.braki, null);
  assert.equal(s.realizacja, "PROCESSING");
  assert.equal(s.nadanieDo, "2026-10-06T15:00:00Z");
});

test("pozycja bez kartoteki nie jest brakiem — nie wiemy, więc nie twierdzimy", () => {
  db().prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (?,'999','Coś spoza kartoteki','NIE-MA-TAKIEGO',1,1000,'PLN')`).run(zamowienie);
  const s = R.stanRealizacji(zamowienie, false, subiekt, db())!;
  assert.equal(s.braki, null);
});

test("odświeżenie przed szkicem: stare zamówienie pyta Allegro i zapisuje termin nadania", async () => {
  const wolane: string[] = [];
  await S.odswiezZamowienie(db(), zamowienie, {
    apiUrl: "https://api.test",
    query: async (url) => {
      wolane.push(url);
      return {
        id: "ord-1", status: "READY_FOR_PROCESSING",
        fulfillment: { status: "READY_FOR_SHIPMENT" },
        delivery: { time: { dispatch: { from: "2026-10-06T06:00:00Z", to: "2026-10-06T15:00:00Z" } } },
        lineItems: [],
      };
    },
  }, TERAZ.getTime());
  assert.equal(wolane.length, 1);
  assert.match(wolane[0]!, /\/order\/checkout-forms\/ord-1$/);
  const w = db().prepare("SELECT realizacja_status, nadanie_do, synced_at FROM zamowienie_klienta WHERE id=?")
    .get(zamowienie) as Record<string, string>;
  assert.equal(w.realizacja_status, "READY_FOR_SHIPMENT");
  assert.equal(w.nadanie_do, "2026-10-06T15:00:00Z");
  assert.equal(w.synced_at, TERAZ.toISOString());
});

test("odświeżenie milczy przy świeżym, nadanym i anulowanym zamówieniu", async () => {
  let wolan = 0;
  const deps = { apiUrl: "https://api.test", query: async () => { wolan++; return null; } };
  db().prepare("UPDATE zamowienie_klienta SET synced_at=? WHERE id=?")
    .run(new Date(TERAZ.getTime() - 60_000).toISOString(), zamowienie);
  await S.odswiezZamowienie(db(), zamowienie, deps, TERAZ.getTime());
  db().prepare("UPDATE zamowienie_klienta SET synced_at='2026-10-01T00:00:00Z', przesylka_waybill='AD-1' WHERE id=?")
    .run(zamowienie);
  await S.odswiezZamowienie(db(), zamowienie, deps, TERAZ.getTime());
  db().prepare("UPDATE zamowienie_klienta SET przesylka_waybill=NULL, status='CANCELLED' WHERE id=?")
    .run(zamowienie);
  await S.odswiezZamowienie(db(), zamowienie, deps, TERAZ.getTime());
  assert.equal(wolan, 0);
});

test("odpowiedź o INNYM zamówieniu albo odmowa Allegro zostawia zapisany stan", async () => {
  db().prepare("UPDATE zamowienie_klienta SET nadanie_do='2026-10-06T15:00:00Z' WHERE id=?").run(zamowienie);
  await S.odswiezZamowienie(db(), zamowienie, {
    apiUrl: "https://api.test", query: async () => ({ id: "ord-2", status: "CANCELLED" }),
  }, TERAZ.getTime());
  await S.odswiezZamowienie(db(), zamowienie, {
    apiUrl: "https://api.test", query: async () => { throw new Error("429"); },
  }, TERAZ.getTime());
  const w = db().prepare("SELECT status, nadanie_do FROM zamowienie_klienta WHERE id=?")
    .get(zamowienie) as Record<string, string>;
  assert.deepEqual({ ...w }, { status: "READY_FOR_PROCESSING", nadanie_do: "2026-10-06T15:00:00Z" });
});
