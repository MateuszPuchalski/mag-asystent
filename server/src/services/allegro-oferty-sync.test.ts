import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { brakujaceOferty, uzupelnijOferty } from "./allegro-oferty-sync.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";

/* Kształt oferty wzięty ze schematów `OffersSearchResultDto`, `OfferListingDto`
   i `ExternalId` w `docs/allegro/swagger.yaml`. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','k')").run();
  d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (1,'w-1','hemnryk')`).run();
  return d as unknown as Db;
}

function wiadomosc(d: Db, id: number, ofertaId: string | null, at = "2026-09-02T14:42:58Z") {
  d.prepare(`INSERT INTO message
    (id,conversation_id,channel_account_id,external_message_id,direction,body,sent_at,
     related_object_type,related_object_id)
    VALUES (?,1,1,?, 'incoming','nabyłem kosiarkę Stiga, nóż 43cm będzie pasował?',?,?,?)`).run(
    id, `m-${id}`, at, ofertaId ? "OFFER" : null, ofertaId);
}

const oferta = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: "NÓŻ DO KOSIARKI STIGA 43cm 46S CASTELGARDEN NG464",
  sellingMode: { format: "BUY_NOW", price: { amount: "48.90", currency: "PLN" } },
  external: { id: "NOZ-STIGA-43" },
  publication: { status: "ACTIVE" },
  ...extra,
});

test("do pobrania trafia numer oferty z wiadomości, bez snapshotu", () => {
  const d = stanowisko();
  wiadomosc(d, 1, "12096815384");
  assert.deepEqual(brakujaceOferty(d, 20), ["12096815384"]);
});

test("wiadomość bez oferty niczego nie zgłasza", () => {
  const d = stanowisko();
  wiadomosc(d, 1, null);
  assert.deepEqual(brakujaceOferty(d, 20), []);
});

test("ten sam numer w dwóch wiadomościach to JEDNO pobranie", () => {
  const d = stanowisko();
  wiadomosc(d, 1, "12096815384");
  wiadomosc(d, 2, "12096815384", "2026-09-02T15:00:00Z");
  assert.deepEqual(brakujaceOferty(d, 20), ["12096815384"]);
});

test("przebieg zapisuje tytuł, cenę w groszach, SKU i status", async () => {
  const d = stanowisko();
  wiadomosc(d, 1, "12096815384");
  const ile = await uzupelnijOferty({
    database: d, accountId: "k", apiUrl: "https://api",
    now: () => new Date("2026-09-02T15:00:00Z"),
    query: async () => ({ offers: [oferta("12096815384")], count: 1, totalCount: 1 }),
  });
  assert.equal(ile, 1);
  const w = d.prepare("SELECT * FROM offer_snapshot").get() as Record<string, unknown>;
  assert.equal(w.external_id, "12096815384");
  assert.match(String(w.nazwa), /NÓŻ DO KOSIARKI STIGA 43cm/);
  assert.equal(w.cena_grosze, 4890);
  assert.equal(w.waluta, "PLN");
  assert.equal(w.sku, "NOZ-STIGA-43");
  assert.equal(w.status, "ACTIVE");
});

test("PARTIA idzie JEDNYM żądaniem: `offer.id` powtórzone dla każdego numeru", async () => {
  const d = stanowisko();
  wiadomosc(d, 1, "12096815384");
  wiadomosc(d, 2, "17235726715", "2026-09-02T15:10:00Z");
  const adresy: string[] = [];
  await uzupelnijOferty({
    database: d, accountId: "k", apiUrl: "https://api",
    now: () => new Date("2026-09-02T15:20:00Z"),
    query: async (url) => {
      adresy.push(url);
      return { offers: [oferta("12096815384"), oferta("17235726715", { name: "Szarpak" })] };
    },
  });
  assert.equal(adresy.length, 1);
  assert.match(adresy[0], /offer\.id=17235726715/);
  assert.match(adresy[0], /offer\.id=12096815384/);
  /* `limit` musi objąć całą partię: domyślne dwadzieścia obcięłoby większą
     partię w połowie i część ofert została bez tytułu bez słowa w logu. */
  assert.match(adresy[0], /limit=2/);
  assert.equal((d.prepare("SELECT COUNT(*) c FROM offer_snapshot").get() as { c: number }).c, 2);
});

test("snapshot świeższy niż doba nie jest pobierany drugi raz", async () => {
  const d = stanowisko();
  wiadomosc(d, 1, "12096815384");
  await uzupelnijOferty({
    database: d, accountId: "k", apiUrl: "https://api",
    now: () => new Date("2026-09-02T15:00:00Z"),
    query: async () => ({ offers: [oferta("12096815384")] }),
  });
  assert.deepEqual(brakujaceOferty(d, 20, new Date("2026-09-02T20:00:00Z")), []);
  /* Po dobie wraca do kolejki: cena bywa poprawiana, a ekran ma nie kłamać
     w nieskończoność ceną z dnia pytania. */
  assert.deepEqual(brakujaceOferty(d, 20, new Date("2026-09-04T20:00:00Z")), ["12096815384"]);
});

test("ponowny przebieg NADPISUJE snapshot, nie zakłada drugiego wiersza", async () => {
  const d = stanowisko();
  wiadomosc(d, 1, "12096815384");
  const przebieg = (nazwa: string, kiedy: string) => uzupelnijOferty({
    database: d, accountId: "k", apiUrl: "https://api", now: () => new Date(kiedy),
    query: async () => ({ offers: [oferta("12096815384", { name: nazwa })] }),
  });
  await przebieg("Nóż 43cm", "2026-09-02T15:00:00Z");
  await przebieg("Nóż 43cm — nowy tytuł", "2026-09-04T15:00:00Z");
  const w = d.prepare("SELECT COUNT(*) c FROM offer_snapshot").get() as { c: number };
  assert.equal(w.c, 1);
  assert.equal((d.prepare("SELECT nazwa FROM offer_snapshot").get() as { nazwa: string }).nazwa,
    "Nóż 43cm — nowy tytuł");
});

test("limit z Allegro PRZERYWA przebieg — dalsze żądania pogłębiłyby przerwę", async () => {
  const d = stanowisko();
  wiadomosc(d, 1, "12096815384");
  await assert.rejects(() => uzupelnijOferty({
    database: d, accountId: "k", apiUrl: "https://api",
    query: async () => { throw new BladLimituAllegro("429", 60); },
  }), BladLimituAllegro);
});

test("inny błąd Allegro NIE wywraca taktu — panel zostaje z gołym numerem", async () => {
  const d = stanowisko();
  wiadomosc(d, 1, "12096815384");
  const ile = await uzupelnijOferty({
    database: d, accountId: "k", apiUrl: "https://api",
    query: async () => { throw new BladOdpowiedziAllegro("403 brak uprawnienia", 403); },
  });
  assert.equal(ile, 0);
  assert.equal((d.prepare("SELECT COUNT(*) c FROM offer_snapshot").get() as { c: number }).c, 0);
});

test("oferta, której Allegro nie oddało, wraca do kolejki i nie psuje reszty", async () => {
  const d = stanowisko();
  wiadomosc(d, 1, "12096815384");
  wiadomosc(d, 2, "99999999999", "2026-09-02T15:10:00Z");
  const ile = await uzupelnijOferty({
    database: d, accountId: "k", apiUrl: "https://api",
    now: () => new Date("2026-09-02T15:20:00Z"),
    query: async () => ({ offers: [oferta("12096815384")] }),
  });
  assert.equal(ile, 1);
  assert.deepEqual(brakujaceOferty(d, 20, new Date("2026-09-02T15:30:00Z")), ["99999999999"]);
});
