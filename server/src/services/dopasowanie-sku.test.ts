import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { dopasujPoSku, skuPozycji } from "./dopasowanie-sku.js";

/* Mostek oferta → kartoteka jest jedyną drogą do zdjęcia, ale nie ma prawa
   zgadywać: złe dopasowanie wysyła na halę zadanie o cudzym towarze. Te
   testy pilnują, że automat MILCZY wszędzie tam, gdzie nie jest pewny. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  for (const [id, sym] of [[10, "SEK-NAC-46"], [11, "ZRA-01"], [12, "DUBEL"], [13, "dubel"]] as const) {
    d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(id, sym, `Towar ${sym}`);
  }
  return d as unknown as Db;
}

test("SKU trafiające w jeden symbol daje propozycję ze źródłem", () => {
  const w = dopasujPoSku(stanowisko(), "SEK-NAC-46");
  assert.equal(w.pewnosc, "sku");
  assert.equal(w.twId, 10);
  assert.equal(w.symbol, "SEK-NAC-46");
  assert.match(w.zrodlo, /SKU oferty/, "§11.3 żąda widocznego źródła, nie samej wartości");
});

test("wielkość liter i spacje nie decydują o dopasowaniu", () => {
  /* Pole `external.id` w Allegro wypełnia człowiek, a firma pisze symbole
     raz wielkimi, raz małymi literami. */
  assert.equal(dopasujPoSku(stanowisko(), "  sek-nac-46 ").twId, 10);
});

test("SKU bez trafienia zostaje brakiem — nie szukamy po nazwie", () => {
  /* Furtka na literówki prowadzi do CUDZEJ kartoteki. `routes/products.ts`
     wyłącza ją w ścieżce skanu z dokładnie tego powodu. */
  const w = dopasujPoSku(stanowisko(), "NIE-MA-TAKIEGO");
  assert.equal(w.pewnosc, "brak");
  assert.equal(w.twId, null);
  assert.match(w.zrodlo, /nie ma/);
});

test("dwa trafienia to nie powód do wybrania pierwszego", () => {
  /* Symbol miał być unikalny. Skoro nie jest, rozstrzyga człowiek — a ekran
     ma powiedzieć dlaczego. */
  const w = dopasujPoSku(stanowisko(), "dubel");
  assert.equal(w.pewnosc, "niejednoznaczne");
  assert.equal(w.twId, null);
  assert.match(w.zrodlo, /więcej niż jedną/);
});

test("puste SKU nie pyta bazy i nie udaje wyniku", () => {
  const d = stanowisko();
  for (const v of [null, undefined, "", "   "]) {
    const w = dopasujPoSku(d, v);
    assert.equal(w.pewnosc, "brak", `„${String(v)}" ma dać brak`);
    assert.equal(w.twId, null);
  }
});

test("SKU pozycji zwrotu bierze się z zamówienia, bo zwrot go nie niesie", () => {
  const d = stanowisko();
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,synced_at)
    VALUES (1,'ord-1','2026-09-01T10:00:00Z')`).run();
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja
    (zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (1,'111','Sekator','SEK-NAC-46',1,8999,'PLN')`).run();

  assert.equal(skuPozycji(d, 1, "ord-1", "111"), "SEK-NAC-46");
  assert.equal(skuPozycji(d, 1, "ord-1", "999"), null, "inna oferta w tym zamówieniu");
  assert.equal(skuPozycji(d, 1, "ord-brak", "111"), null, "zamówienia jeszcze nie pobrano");
  assert.equal(skuPozycji(d, 2, "ord-1", "111"), null, "cudze konto kanału nie oddaje SKU");
  assert.equal(skuPozycji(d, 1, null, "111"), null);
  assert.equal(skuPozycji(d, 1, "ord-1", null), null);
});

test("dopasowanie NICZEGO nie zapisuje", () => {
  /* Zero zapisu przy patrzeniu: propozycja liczy się przy odczycie, a do
     bazy trafia dopiero potwierdzenie człowieka. */
  const d = stanowisko();
  const licz = () => (d.prepare(
    "SELECT (SELECT COUNT(*) FROM events) + (SELECT COUNT(*) FROM sgt_towar) n").get() as { n: number }).n;
  const przed = licz();
  dopasujPoSku(d, "SEK-NAC-46");
  dopasujPoSku(d, "NIE-MA");
  assert.equal(licz(), przed);
});
