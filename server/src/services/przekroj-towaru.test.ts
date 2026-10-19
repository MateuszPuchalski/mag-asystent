import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { przekrojTowaru } from "./przekroj-towaru.js";

/* ── Przekrój towaru ───────────────────────────────────────────────────────
   Pilnujemy: oferty towaru to pamięć człowieka i sygnatura równa symbolowi;
   otwarte sprawy i zwroty są otwarte naprawdę; sprzedaż liczy się z FS i PA
   kopii Subiekta, nie z zamówień Allegro; faktura do paragonu nie podwaja
   sztuk; okno nie sięga dalej niż kopia; odczyt niczego nie zapisuje. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const TERAZ = Date.parse("2026-09-25T12:00:00Z");
const DZIEN = 86_400_000;
const dniTemu = (n: number) => new Date(TERAZ - n * DZIEN).toISOString().slice(0, 10);

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
  /* Dokument kopii Subiekta z pozycjami `[tw_id, ilość]`. `koryguje` to
     `dok_DoDokId` — na korekcie dokument korygowany, na fakturze do paragonu
     ten paragon. */
  const dokument = (dokId: number, typ: string, data: string, pozycje: Array<[number, number]>,
    koryguje: number | null = null) => {
    d.prepare(`INSERT INTO sgt_faktura(dok_id,typ,nr_pelny,koryguje_dok_id,data_wyst) VALUES (?,?,?,?,?)`)
      .run(dokId, typ, `${typ} ${dokId}/2026`, koryguje, data);
    for (const [tw, ilosc] of pozycje) {
      d.prepare("INSERT INTO sgt_faktura_pozycja(dok_id,tw_id,ilosc) VALUES (?,?,?)").run(dokId, tw, ilosc);
    }
  };
  return { d, k, zamowienie, dokument };
}

test("oferty z pamięci i z sygnatury; obce oferty nie należą do towaru", () => {
  const { d } = stanowisko();
  const p = przekrojTowaru(501, d, TERAZ);
  assert.deepEqual(p.oferty.map((o) => o.ofertaId).sort(), ["of-pamiec", "of-sku"]);
});

test("sprzedaż z FS i PA tego towaru w oknie; korekta, inny towar i dokument sprzed okna nie liczą", () => {
  const { d, dokument } = stanowisko();
  dokument(601, "FS", dniTemu(15), [[501, 2]]);
  dokument(602, "PA", dniTemu(55), [[501, 3], [502, 9]]);
  dokument(603, "PA", dniTemu(10), [[502, 4]]);
  /* Poza oknem dziewięćdziesięciu dni, choć kopia mogłaby go jeszcze nieść. */
  dokument(604, "PA", dniTemu(95), [[501, 5]]);
  /* Kopia nie bierze pozycji korekt, ale gdyby je wzięła, zwrot liczyłby się
     tu drugi raz — zwroty mają własny licznik. */
  dokument(605, "KFS", dniTemu(5), [[501, 1]], 601);
  dokument(606, "ZW", dniTemu(5), [[501, 1]], 602);
  const p = przekrojTowaru(501, d, TERAZ, 180);
  assert.equal(p.okno.dni, 90);
  assert.equal(p.okno.sprzedanych, 5);
  assert.equal(p.okno.udzialZwrotow, 0);
});

test("zamówienia Allegro nie liczą się do sprzedaży; oferta niepowiązana nie ma znaczenia", () => {
  const { d, zamowienie, dokument } = stanowisko();
  zamowienie("of-pamiec", 3);
  zamowienie("of-obca", 7);
  assert.equal(przekrojTowaru(501, d, TERAZ).okno.sprzedanych, 0,
    "sprzedaż bez dokumentu w Subiekcie to zero, nie liczba z Allegro");

  /* Towar bez żadnej oferty sprzedaje się w sklepie stacjonarnym — Subiekt
     to wie, a Allegro nie. */
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (777,'X-1','Samotny')").run();
  dokument(701, "PA", dniTemu(3), [[777, 6]]);
  const p = przekrojTowaru(777, d, TERAZ);
  assert.deepEqual(p.oferty, []);
  assert.equal(p.okno.sprzedanych, 6);
});

test("faktura do paragonu nie liczy tych samych sztuk drugi raz", () => {
  const { d, dokument } = stanowisko();
  dokument(800, "PA", dniTemu(20), [[501, 2]]);
  dokument(801, "FS", dniTemu(18), [[501, 2]], 800);
  assert.equal(przekrojTowaru(501, d, TERAZ).okno.sprzedanych, 2, "FS wskazuje paragon z kopii");

  /* Odnośnik w drugą stronę opisuje tę samą parę, a nie drugą sprzedaż. */
  dokument(810, "FS", dniTemu(12), [[501, 1]]);
  dokument(811, "PA", dniTemu(14), [[501, 1]], 810);
  assert.equal(przekrojTowaru(501, d, TERAZ).okno.sprzedanych, 3, "PA wskazuje fakturę z kopii");

  /* Paragon spoza kopii: drugiego egzemplarza nie ma, więc faktura się liczy. */
  dokument(820, "FS", dniTemu(4), [[501, 4]], 999_999);
  assert.equal(przekrojTowaru(501, d, TERAZ).okno.sprzedanych, 7);
});

test("krótsza kopia skraca okno: sprzedaż, zwroty i reklamacje liczą się w tym samym", () => {
  const { d, k, dokument } = stanowisko();
  dokument(901, "PA", dniTemu(10), [[501, 4]]);
  dokument(902, "PA", dniTemu(40), [[501, 6]]);
  const zwrot = (ref: string, dni: number) => {
    const at = new Date(TERAZ - dni * DZIEN).toISOString();
    const z = Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,order_id,
      created_at,synced_at) VALUES (?,?,?,'o-0',?,?)`).run(k, `z-${ref}`, ref, at, at).lastInsertRowid);
    d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,klucz,nazwa,ilosc,cena_grosze,waluta,tw_id)
      VALUES (?,?,'Nóż',1,4500,'PLN',501)`).run(z, `k-${ref}`);
  };
  zwrot("Z-blisko", 5);
  zwrot("Z-daleko", 40);
  const sprawa = (ext: string, dni: number) => d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,
    external_id,reference_number,order_id,offer_id,typ,temat,status_allegro,otwarto_at,synced_at)
    VALUES (?,?,?,'o-0','of-pamiec','CLAIM','Pęka',NULL,?,'2026-09-16')`)
    .run(k, ext, ext, new Date(TERAZ - dni * DZIEN).toISOString());
  sprawa("r-blisko", 6);
  sprawa("r-daleko", 40);

  const p = przekrojTowaru(501, d, TERAZ, 30);
  assert.equal(p.okno.dni, 30, "okno nie obiecuje dni, których kopia nie niesie");
  assert.equal(p.okno.sprzedanych, 4);
  assert.equal(p.okno.zwroconych, 1);
  assert.equal(p.okno.reklamacji, 1);
  assert.equal(p.okno.udzialZwrotow, 0.25);

  const pelne = przekrojTowaru(501, d, TERAZ);
  assert.equal(pelne.okno.dni, 90, "domyślna kopia sięga pełnego okna przekroju");
  assert.equal(pelne.okno.sprzedanych, 10);
  assert.equal(pelne.okno.zwroconych, 2);
  assert.equal(pelne.okno.reklamacji, 2);
});

test("otwarte zwroty i sprawy tego towaru; zamknięte odpadają; udział zwrotów", () => {
  const { d, k, dokument } = stanowisko();
  dokument(1001, "PA", "2026-09-10", [[501, 4]]);
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

test("sygnatura wiąże regułą kartotekaOferty: spacja tak, oferta przepięta i dubel symbolu nie", () => {
  /* Przekrój i licznik „ten towar" w reklamacji czytają `ofertyKartoteki`,
     więc przekrój ma znać dokładnie te oferty, które sprawa przypisuje
     towarowi. Wielkość liter pilnuje `reklamacje.test.ts` — ten symbol ma
     same cyfry. */
  const { d, k } = stanowisko();
  const oferta = (ext: string, sku: string) => d.prepare(`INSERT INTO offer_snapshot
    (channel_account_id,external_id,nazwa,sku,synced_at) VALUES (?,?,'Nóż',?,'2026-09-01')`).run(k, ext, sku);
  oferta("of-spacja", "14-25001 ");
  /* Sygnatura trafia w 501, ale człowiek wskazał 777 — oferta jest tamta. */
  oferta("of-przepieta", "14-25001");
  d.prepare(`INSERT INTO oferta_kartoteka(channel_account_id,offer_id,tw_id,tw_symbol,wskazano_at,wskazano_przez)
    VALUES (?,'of-przepieta',777,'X-1','2026-09-01','Ola')`).run(k);
  assert.deepEqual(przekrojTowaru(501, d, TERAZ).oferty.map((o) => o.ofertaId).sort(),
    ["of-pamiec", "of-sku", "of-spacja"]);

  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (502,' 14-25001','Drugi nóż')").run();
  assert.deepEqual(przekrojTowaru(501, d, TERAZ).oferty.map((o) => o.ofertaId), ["of-pamiec"],
    "wskazanie człowieka zostaje, sygnatura pod dwiema kartotekami nie wiąże");
});

test("towar bez ofert i bez sprzedaży: udział milczy zamiast dzielić przez zero", () => {
  const { d } = stanowisko();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (777,'X-1','Samotny')").run();
  const p = przekrojTowaru(777, d, TERAZ);
  assert.deepEqual(p.oferty, []);
  assert.equal(p.okno.udzialZwrotow, null);
});
