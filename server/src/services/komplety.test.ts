import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { skladPozycji } from "./komplety.js";
import { dolozDoKosza, zdejmijZKosza } from "./kosze-zwrotow.js";

/* ── Komplet rozbity na paragonie (0.328.0) ─────────────────────────────────
   Zgłoszenie właściciela: oferta sprzedaje się jako komplet, a na magazynie
   leży osobno; do koszyka mają iść kartoteki Z PARAGONU, bo tam komplet jest
   rozbity na wiersze. Reguła, zapisana dosłownie: „kartotekę tak, z paragonu,
   ale ilość bierze ze zwrotu".

   Sześć rzeczy warte testu, bo każda kładzie towar na złej półce albo podnosi
   stan o sztuki, których nikt nie oddał:

   1. ILOŚĆ ZE ZWROTU, nie z paragonu. Paragon niesie całe zamówienie.
   2. KOMPLET ROZBIJA SIĘ na wiersze dokumentu.
   3. CUDZA OFERTA ZABIERA SWOJE — reszta należy do kompletu.
   4. DWIE OFERTY BEZ KARTOTEKI: automat MILCZY, zamiast zgadywać.
   5. NA JEDEN KOMPLET, nie na zamówienie: dwa kupione, jeden zwracany.
   6. ZAPAMIĘTANY SKŁAD rozstrzyga przy następnym zwrocie.                   */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  return d as unknown as Db;
}

function biuro(d: Db) {
  const id = Number(d.prepare("INSERT INTO app_user(name,role) VALUES ('Ala','biuro')")
    .run().lastInsertRowid);
  return { id, name: "Ala" };
}

function towar(d: Db, twId: number) {
  d.prepare("INSERT OR IGNORE INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
    .run(twId, `SYM-${twId}`, `Towar ${twId}`);
}

/** Paragon z rozbitymi pozycjami — tak wystawia go Subiekt. */
function paragon(d: Db, dokId: number, linie: Array<[number, number]>) {
  d.prepare(`INSERT INTO sgt_faktura(dok_id,typ,nr_pelny,data_wyst)
    VALUES (?,'PA',?, '2026-09-01')`).run(dokId, `PA ${dokId}/2026`);
  for (const [twId, ilosc] of linie) {
    towar(d, twId);
    d.prepare("INSERT INTO sgt_faktura_pozycja(dok_id,tw_id,ilosc) VALUES (?,?,?)")
      .run(dokId, twId, ilosc);
  }
  return dokId;
}

/** Zamówienie z ofertami — po nim odejmuje się to, co NIE jest kompletem. */
function zamowienie(d: Db, oferty: Array<{ offerId: string; ilosc: number }>) {
  const id = Number(d.prepare(`INSERT INTO zamowienie_klienta
    (channel_account_id,external_id,status,dostawa_grosze,suma_grosze,waluta,synced_at)
    VALUES (1,'ord-1','READY_FOR_PROCESSING',0,10000,'PLN','2026-09-01T08:00:00Z')`)
    .run().lastInsertRowid);
  for (const o of oferty) {
    d.prepare(`INSERT INTO zamowienie_klienta_pozycja
      (zamowienie_id,external_id,offer_id,nazwa,ilosc,cena_grosze,waluta)
      VALUES (?,?,?,?,?,5000,'PLN')`)
      .run(id, `li-${o.offerId}`, o.offerId, `Oferta ${o.offerId}`, o.ilosc);
  }
  return id;
}

function mapuj(d: Db, offerId: string, twId: number) {
  towar(d, twId);
  d.prepare(`INSERT INTO oferta_kartoteka
    (channel_account_id,offer_id,tw_id,tw_symbol,wskazano_at,wskazano_przez)
    VALUES (1,?,?,?, '2026-09-01T08:00:00Z','Ala')`).run(offerId, twId, `SYM-${twId}`);
}

/** Zwrot z pozycjami; `twId` null = oferta bez kartoteki, czyli komplet. */
function zwrot(d: Db, dokId: number | null,
  pozycje: Array<{ offerId: string; twId: number | null; ilosc: number; zwrocona?: number }>) {
  const id = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,order_id,created_at,synced_at,faktura_dok_id)
    VALUES (1,'zw-1','ord-1','2026-09-02T08:00:00Z','2026-09-02T08:00:00Z',?)`)
    .run(dokId).lastInsertRowid);
  const poz = pozycje.map((p, i) => {
    if (p.twId != null) towar(d, p.twId);
    return Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
      (zwrot_id,klucz,offer_id,nazwa,ilosc,ilosc_zwrocona,cena_grosze,waluta,tw_id)
      VALUES (?,?,?,?,?,?,5000,'PLN',?)`)
      .run(id, `k${i}`, p.offerId, `Pozycja ${i}`, p.ilosc, p.zwrocona ?? null, p.twId)
      .lastInsertRowid);
  });
  return { id, poz };
}

test("zwykła pozycja bierze kartotekę z paragonu, a ILOŚĆ ze zwrotu", () => {
  /* Paragon niesie CAŁE zamówienie. Klient kupił pięć, oddaje dwie — gdyby
     ilość szła z dokumentu, na półkę wróciłoby pięć sztuk, a trzy zostałyby
     u klienta i na stanie naraz. */
  const d = stanowisko();
  const dok = paragon(d, 900, [[11, 5]]);
  zamowienie(d, [{ offerId: "of-A", ilosc: 5 }]);
  mapuj(d, "of-A", 11);
  const { poz } = zwrot(d, dok, [{ offerId: "of-A", twId: 11, ilosc: 2 }]);

  const s = skladPozycji(d, poz[0]);
  assert.equal(s.zrodlo, "paragon");
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[11, 2]]);
});

test("komplet rozbija się na wiersze paragonu", () => {
  /* Oferta jest jedna, a na magazynie leżą trzy kartoteki. Mapowanie oferty
     nie ma jak ich wskazać — klucz `oferta_kartoteka` to (konto, oferta). */
  const d = stanowisko();
  const dok = paragon(d, 901, [[21, 1], [22, 1], [23, 2]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const s = skladPozycji(d, poz[0]);
  assert.equal(s.zrodlo, "paragon");
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[21, 1], [22, 1], [23, 2]]);
});

test("cudza oferta zabiera SWOJE sztuki, reszta należy do kompletu", () => {
  /* Klient kupił komplet i osobno sekator. Bez odejmowania sekator wjechałby
     do koszyka jako część kompletu — a klient go zatrzymał. */
  const d = stanowisko();
  const dok = paragon(d, 902, [[21, 1], [22, 1], [30, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }, { offerId: "of-SEK", ilosc: 1 }]);
  mapuj(d, "of-SEK", 30);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const s = skladPozycji(d, poz[0]);
  assert.deepEqual(s.skladniki.map((x) => x.twId), [21, 22]);
});

test("ten sam towar w komplecie I osobno — odejmuje się SZTUKI, nie wiersz", () => {
  /* Sekator jest częścią kompletu i został dokupiony osobno: na paragonie
     stoi jedną pozycją na dwie sztuki. Skreślenie całego wiersza zabrałoby
     komplet jego składnika. */
  const d = stanowisko();
  const dok = paragon(d, 903, [[21, 1], [30, 2]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }, { offerId: "of-SEK", ilosc: 1 }]);
  mapuj(d, "of-SEK", 30);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const s = skladPozycji(d, poz[0]);
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[21, 1], [30, 1]]);
});

test("dwie oferty bez kartoteki: automat MILCZY i mówi dlaczego", () => {
  /* Zgadnięty podział kładzie na półkę cudzy towar i podnosi stan o sztuki,
     których nikt nie oddał. Wychodzi to przy inwentaryzacji, czyli za późno. */
  const d = stanowisko();
  const dok = paragon(d, 904, [[21, 1], [22, 1], [23, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }, { offerId: "of-INNY", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const s = skladPozycji(d, poz[0]);
  assert.deepEqual(s.skladniki, []);
  assert.match(String(s.powod), /nie umiem rozdzielić/);
});

test("dwa komplety kupione, jeden zwracany — sztuki dzielą się NA KOMPLET", () => {
  const d = stanowisko();
  const dok = paragon(d, 905, [[21, 2], [23, 4]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 2 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const s = skladPozycji(d, poz[0]);
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[21, 1], [23, 2]]);
});

test("liczy się to, co WRÓCIŁO, a nie deklaracja klienta", () => {
  /* Ta sama reguła co przy kwocie (0.212.0): `ilosc_zwrocona` wypełnia biuro
     po otwarciu kartonu i ona rozstrzyga. */
  const d = stanowisko();
  const dok = paragon(d, 906, [[21, 1], [23, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 3 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 3, zwrocona: 0 }]);

  assert.deepEqual(skladPozycji(d, poz[0]).skladniki.map((x) => x.ilosc), [0, 0]);
});

test("bez wskazanego dokumentu zostaje droga sprzed tego wydania", () => {
  /* Zwrot, przy którym nikt nie wskazał paragonu, ma dalej działać: kartoteka
     z mapowania oferty, ilość ze zwrotu. */
  const d = stanowisko();
  const { poz } = zwrot(d, null, [{ offerId: "of-A", twId: 11, ilosc: 2 }]);

  const s = skladPozycji(d, poz[0]);
  assert.equal(s.zrodlo, "oferta");
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[11, 2]]);
});

test("koszyk dostaje WSZYSTKIE kartoteki kompletu, a zdjęcie zabiera wszystkie", () => {
  /* Zdjęcie jednego wiersza zostawiłoby resztę zestawu na dokumencie MM —
     towar na papierze, którego nikt nie wyjął z pudła. */
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 907, [[21, 1], [22, 1], [23, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  const koszId = dolozDoKosza(d, poz[0], kto);
  assert.notEqual(koszId, null);
  const { n } = d.prepare("SELECT COUNT(*) AS n FROM kosz_pozycja WHERE zwrot_pozycja_id=?")
    .get(poz[0]) as { n: number };
  assert.equal(n, 3);

  assert.equal(zdejmijZKosza(d, poz[0], kto), true);
  const { n: po } = d.prepare("SELECT COUNT(*) AS n FROM kosz_pozycja WHERE zwrot_pozycja_id=?")
    .get(poz[0]) as { n: number };
  assert.equal(po, 0);
});

test("skład policzony raz obowiązuje przy następnym zwrocie tej oferty", () => {
  /* Bez pamięci ten sam komplet raz wchodziłby do koszyka, a raz nie —
     zależnie od tego, co klient dokupił w tamtym zamówieniu. */
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 908, [[21, 1], [23, 2]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }]);
  const pierwszy = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);
  dolozDoKosza(d, pierwszy.poz[0], kto);

  const { n } = d.prepare("SELECT COUNT(*) AS n FROM oferta_komplet WHERE offer_id='of-KPL'")
    .get() as { n: number };
  assert.equal(n, 2, "skład ma zostać zapamiętany przy ofercie");

  /* Drugi zwrot: BEZ dokumentu i z dwiema sztukami — pamięć rozstrzyga,
     a sztuki skalują się liczbą zwracanych kompletów. */
  d.prepare("DELETE FROM zwrot_klienta_pozycja").run();
  d.prepare("DELETE FROM zwrot_klienta").run();
  const drugi = zwrot(d, null, [{ offerId: "of-KPL", twId: null, ilosc: 2 }]);
  const s = skladPozycji(d, drugi.poz[0]);
  assert.equal(s.zrodlo, "paragon");
  assert.deepEqual(s.skladniki.map((x) => [x.twId, x.ilosc]), [[21, 2], [23, 4]]);
});

test("pozycja bez składu NIE wchodzi do koszyka po cichu", () => {
  /* Cicha utrata jest tu najgorszym wyjściem: karton pojechałby na halę
     z towarem, którego nie ma na żadnym dokumencie. */
  const d = stanowisko();
  const kto = biuro(d);
  const dok = paragon(d, 909, [[21, 1], [22, 1]]);
  zamowienie(d, [{ offerId: "of-KPL", ilosc: 1 }, { offerId: "of-INNY", ilosc: 1 }]);
  const { poz } = zwrot(d, dok, [{ offerId: "of-KPL", twId: null, ilosc: 1 }]);

  assert.equal(dolozDoKosza(d, poz[0], kto), null);
  const { n } = d.prepare("SELECT COUNT(*) AS n FROM kosz_pozycja").get() as { n: number };
  assert.equal(n, 0, "nic nie wchodzi, dopóki nie wiadomo CO wchodzi");
});
