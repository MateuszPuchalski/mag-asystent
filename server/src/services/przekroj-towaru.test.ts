import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { przekrojTowaru } from "./przekroj-towaru.js";

/* ── Przekrój towaru (0.502.0) ─────────────────────────────────────────────
   Pilnujemy: oferty towaru to pamięć człowieka i sygnatura równa symbolowi;
   otwarte sprawy i zwroty są otwarte naprawdę; udział zwrotów liczy się
   z ofert powiązanych i milczy bez sprzedaży; odczyt niczego nie zapisuje. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const TERAZ = Date.parse("2026-09-25T12:00:00Z");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const k = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')").run().lastInsertRowid);
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (501,'14-25001','Nóż do kosiarki')").run();
  d.prepare(`INSERT INTO oferta_kartoteka(channel_account_id,offer_id,tw_id,tw_symbol,wskazano_at,wskazano_przez)
    VALUES (?,'of-pamiec',501,'14-25001','2026-09-01','Ala')`).run(k);
  d.prepare("INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at) VALUES (?,'of-sku','Nóż MTD','14-25001','2026-09-01')").run(k);
  d.prepare("INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at) VALUES (?,'of-obca','Inny','99-1','2026-09-01')").run(k);
  let n = 0;
  const zamowienie = (oferta: string, ilosc: number, status: string | null = null) => {
    const z = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,kupujacy_login,kupiono_at,
      suma_grosze,waluta,synced_at,status) VALUES (?,?,'k','2026-09-10T08:00:00Z',100,'PLN','2026-09-10',?)`)
      .run(k, `o-${n++}`, status).lastInsertRowid);
    d.prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,nazwa,offer_id,ilosc,cena_grosze,waluta)
      VALUES (?,'Nóż',?,?,4500,'PLN')`).run(z, oferta, ilosc);
  };
  return { d, k, zamowienie };
}

test("oferty z pamięci i z sygnatury; sprzedaż bez anulowanych i bez obcych ofert", () => {
  const { d, zamowienie } = stanowisko();
  zamowienie("of-pamiec", 3);
  zamowienie("of-sku", 1);
  zamowienie("of-sku", 5, "CANCELLED");
  zamowienie("of-obca", 7);
  const p = przekrojTowaru(501, d, TERAZ);
  assert.deepEqual(p.oferty.map((o) => o.ofertaId).sort(), ["of-pamiec", "of-sku"]);
  assert.equal(p.okno.sprzedanych, 4);
  assert.equal(p.okno.udzialZwrotow, 0);
});

test("otwarte zwroty i sprawy tego towaru; zamknięte odpadają; udział zwrotów", () => {
  const { d, k, zamowienie } = stanowisko();
  zamowienie("of-pamiec", 4);
  const zwrot = (ref: string, zamkniety: string | null) => {
    const z = Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,order_id,
      created_at,synced_at,zamkniety_at) VALUES (?,?,?,'o-0','2026-09-15T08:00:00Z','2026-09-15',?)`)
      .run(k, `z-${ref}`, ref, zamkniety).lastInsertRowid);
    d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,klucz,nazwa,ilosc,cena_grosze,waluta,tw_id)
      VALUES (?,?,'Nóż',1,4500,'PLN',501)`).run(z, `k-${ref}`);
  };
  zwrot("Z-1", null);
  zwrot("Z-2", "2026-09-20T08:00:00Z");
  d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,reference_number,order_id,offer_id,typ,
    temat,status_allegro,otwarto_at,synced_at) VALUES (?,'r1','7/2026','o-0','of-pamiec','CLAIM','Pęka',NULL,
    '2026-09-16T08:00:00Z','2026-09-16')`).run(k);
  const zapisy = () => (d.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  const przed = zapisy();
  const p = przekrojTowaru(501, d, TERAZ);
  assert.equal(zapisy(), przed, "odczyt niczego nie zapisuje");
  assert.deepEqual(p.otwarteZwroty.map((z) => z.numer), ["Z-1"]);
  assert.deepEqual(p.otwarteSprawy.map((s) => s.numer), ["7/2026"]);
  assert.equal(p.okno.zwroconych, 2);
  assert.equal(p.okno.reklamacji, 1);
  assert.equal(p.okno.udzialZwrotow, 0.5);
});

test("towar bez ofert i bez sprzedaży: udział milczy zamiast dzielić przez zero", () => {
  const { d } = stanowisko();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (777,'X-1','Samotny')").run();
  const p = przekrojTowaru(777, d, TERAZ);
  assert.deepEqual(p.oferty, []);
  assert.equal(p.okno.udzialZwrotow, null);
});
