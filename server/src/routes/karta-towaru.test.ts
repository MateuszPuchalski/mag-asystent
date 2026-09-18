import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── GET /api/products/:twId — sekcja „w dostawie" ───────────────────────────
   Serwis liczy dobrze (`services/dostawy-towaru.test.ts`), ale kolektor rysuje
   to, co przyjdzie TRASĄ. Ten plik pilnuje odcinka między jednym a drugim:
   pole ma faktycznie wyjechać z `/api/products/:id`, a nie zostać w serwisie.

   Bez tego testu pominięcie `wDostawie` w `buildProductCard` nie miałoby
   objawu — karta wróciłaby poprawna, tylko bez odpowiedzi na pytanie, dla
   którego ta sekcja powstała.                                                 */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-karta-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let token: string;

interface WDostawie {
  dokId: number;
  nrPelny: string;
  ilosc: number;
  status: string | null;
}

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

const wczoraj = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

beforeEach(() => {
  const d = db();
  for (const t of ["delivery_line", "delivery", "sgt_pozycja", "sgt_dokument", "sgt_cena", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1,'W32-0203','Kosa spalinowa','5901234567890','A01-02-03')"
  ).run();

  const u = createUser("Jan Testowy", "magazynier");
  token = "tok-karta";
  const teraz = new Date().toISOString();
  d.prepare(
    "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
  ).run(token, u.userId, "test-device", teraz, teraz);
});

interface CenaPoziomu {
  poziom: number;
  nazwa: string;
  nettoGrosze: number | null;
  bruttoGrosze: number | null;
  waluta: string;
}

const karta = async () => {
  const r = await app.inject({ url: "/api/products/1", headers: { "x-session": token } });
  assert.equal(r.statusCode, 200);
  return r.json() as { wDostawie: WDostawie[]; ceny: CenaPoziomu[] };
};

test("bez dostaw karta niesie pustą listę, nie brak pola", async () => {
  // `undefined` przeszłoby przez kolektor tak samo cicho jak `[]`, ale kontrakt
  // ma być jeden: pole jest zawsze, a puste znaczy „wszystko rozłożone"
  assert.deepEqual((await karta()).wDostawie, []);
});

test("nierozłożona dostawa dojeżdża trasą na kartę", async () => {
  const d = db();
  d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (500,'FZ','FZ 60/MAG/07/2026',?,1,'Dostawca sp. z o.o.',0)`
  ).run(wczoraj);
  d.prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (500,1,6)").run();

  const w = (await karta()).wDostawie;
  assert.equal(w.length, 1);
  assert.equal(w[0].nrPelny, "FZ 60/MAG/07/2026");
  assert.equal(w[0].ilosc, 6);
  assert.equal(w[0].status, null);
});

test("po odłożeniu całości sekcja znika z karty", async () => {
  const d = db();
  d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (501,'FZ','FZ 61/MAG/07/2026',?,1,'Dostawca sp. z o.o.',0)`
  ).run(wczoraj);
  d.prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (501,1,6)").run();
  const id = Number(
    d
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, status, opened_at, source_mag_id)
         VALUES (501,'FZ 61/MAG/07/2026','open',?,1)`
      )
      .run(new Date().toISOString()).lastInsertRowid
  );
  d.prepare(
    `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, ilosc_odlozona, status)
     VALUES (?,1,'W32-0203','Kosa spalinowa',6,6,'done')`
  ).run(id);

  assert.deepEqual((await karta()).wDostawie, []);
});


/* ── Ceny z kartoteki Subiekta (0.396.0) ─────────────────────────────────────
   Zgłoszenie właściciela: „nie widzę cen z Subiekta przy towarach". Ten sam
   powód, dla którego strzeżemy `wDostawie`: serwis może liczyć dobrze, a pole
   i tak zostanie po drodze. Bez tych testów pominięcie `ceny`
   w `buildProductCard` nie miałoby objawu — karta wróciłaby poprawna, tylko
   bez odpowiedzi na pytanie, po które sekcja powstała.                       */

test("bez cen karta niesie pustą listę, nie brak pola", async () => {
  /* `undefined` i `[]` wyglądają na ekranie tak samo, ale znaczą co innego
     dla kontraktu. Tak zresztą wygląda DZIŚ każdy towar na produkcji: import
     cen jeszcze nie pobiera (`tools/sonda-cen.sql`), a karta ma o tym mówić
     pustą listą, nie brakiem pola. */
  assert.deepEqual((await karta()).ceny, []);
});

test("WSZYSTKIE poziomy jadą na kartę, w kolejności Subiekta", async () => {
  /* Decyzja właściciela: wszystkie poziomy, nie jeden wybrany. Kolejność idzie
     po NUMERZE poziomu, a nie po kwocie — sortowanie po cenie przestawiałoby
     wiersze przy każdej przecenie, a agent uczy się miejsca, nie liczby.
     Wiersze wstawiamy w odwrotnej kolejności właśnie po to, żeby ten test
     mógł polec, gdyby ktoś zdjął `ORDER BY`. */
  const d = db();
  const ins = d.prepare(`INSERT INTO sgt_cena(tw_id, poziom, nazwa, netto_grosze,
    brutto_grosze, waluta) VALUES (?,?,?,?,?,?)`);
  ins.run(1, 3, "Promocyjna", 3252, 4000, "PLN");
  ins.run(1, 1, "Detaliczna", 4062, 4996, "PLN");
  ins.run(1, 2, "Hurtowa", 3577, 4400, "PLN");

  const ceny = (await karta()).ceny;
  assert.deepEqual(ceny.map((c) => c.poziom), [1, 2, 3]);
  assert.deepEqual(ceny.map((c) => c.nazwa), ["Detaliczna", "Hurtowa", "Promocyjna"]);
});

test("kwoty jadą w GROSZACH całkowitych, netto i brutto osobno", async () => {
  /* Liczba zmiennoprzecinkowa w cenie podanej klientowi to błąd, który wychodzi
     dopiero na fakturze — dlatego grosze, tak samo jak przy kwotach z Allegro.
     Netto i brutto biorą się OBA ze źródła: przeliczanie u nas wymagałoby
     stawki VAT i dokładało własny błąd zaokrąglenia. */
  db().prepare(`INSERT INTO sgt_cena(tw_id, poziom, nazwa, netto_grosze,
    brutto_grosze, waluta) VALUES (1,1,'Detaliczna',4062,4996,'PLN')`).run();

  const [c] = (await karta()).ceny;
  assert.equal(c.nettoGrosze, 4062);
  assert.equal(c.bruttoGrosze, 4996);
  assert.equal(c.waluta, "PLN");
  assert.equal(Number.isInteger(c.bruttoGrosze), true);
});

test("brak kwoty zostaje NULL-em, a nie zerem", async () => {
  /* Zero znaczyłoby „za darmo" i agent podałby je klientowi. `null` znaczy
     „baza tej kwoty nie podała" i ekran ma to pokazać jako brak. */
  db().prepare(`INSERT INTO sgt_cena(tw_id, poziom, nazwa, netto_grosze,
    brutto_grosze, waluta) VALUES (1,1,'Detaliczna',NULL,4996,'PLN')`).run();

  const [c] = (await karta()).ceny;
  assert.equal(c.nettoGrosze, null);
  assert.equal(c.bruttoGrosze, 4996);
});
