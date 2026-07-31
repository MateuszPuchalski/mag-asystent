import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Który WIERSZ faktury reprezentuje linia robocza ─────────────────────────
   Biuro trzyma opis różnic przy POZYCJI faktury, nie w jej nagłówku. Żeby
   WERTIS mógł tam kiedykolwiek zapisać, musi wiedzieć, o który wiersz chodzi.

   Trudność jest w tym, że `openDelivery` AGREGUJE ten sam towar z kilku
   wierszy w jedną linię — bo magazynier ma przed sobą jedną paletę i ma ją
   zobaczyć raz. Jedna linia potrafi więc reprezentować DWIE pozycje faktury,
   a pojedynczy identyfikator na linii byłby po prostu nieprawdą.

   Te testy pilnują obu połówek naraz: że agregacja została nietknięta ORAZ że
   nic z niej nie ginie.                                                       */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-poz-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let openDelivery: typeof import("./delivery.js").openDelivery;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ openDelivery } = await import("./delivery.js"));
});

const TOWAR_A = 11;
const TOWAR_B = 12;
const DOK = 500;

const dzis = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  const d = db();
  for (const t of ["delivery_line", "delivery", "sgt_pozycja", "sgt_dokument", "sgt_towar"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const insTowar = d.prepare(
    `INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, opis, lokalizacja)
     VALUES (?,?,?,'','szt.','','A-01-1')`
  );
  insTowar.run(TOWAR_A, "SYM-A", "Towar A");
  insTowar.run(TOWAR_B, "SYM-B", "Towar B");
  d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (?, 'FZ', 'FZ 500/MAG/07/2026', ?, 1, 'Dostawca sp. z o.o.', 0)`
  ).run(DOK, dzis());
});

/** Pozycja faktury; `obId = null` udaje bazę bez kolumny klucza pozycji. */
function pozycja(twId: number, ilosc: number, obId: number | null) {
  db()
    .prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc, ob_id) VALUES (?,?,?,?)")
    .run(DOK, twId, ilosc, obId);
}

/** Linie robocze otwartej dostawy, po towarze. */
function linie() {
  const id = openDelivery(DOK, "tester");
  return db()
    .prepare("SELECT tw_id, ilosc_dok, sgt_pozycje FROM delivery_line WHERE delivery_id = ? ORDER BY tw_id")
    .all(id) as Array<{ tw_id: number; ilosc_dok: number; sgt_pozycje: string | null }>;
}

test("ten sam towar w dwóch wierszach: JEDNA linia, DWA identyfikatory", () => {
  // To jest cały powód istnienia kolumny `sgt_pozycje`. W Subiekcie taki
  // duplikat jest normalny — dwie ceny albo dwie partie.
  pozycja(TOWAR_A, 4, 901);
  pozycja(TOWAR_A, 3, 902);

  const l = linie();
  assert.equal(l.length, 1, "agregacja po towarze została zepsuta");
  assert.equal(l[0].ilosc_dok, 7, "suma z obu wierszy się nie zgadza");
  assert.deepEqual(JSON.parse(l[0].sgt_pozycje!), [901, 902]);
});

test("identyfikatory idą ROSNĄCO, niezależnie od kolejności w dokumencie", () => {
  // „Pierwsza pozycja tego towaru" musi być pojęciem rozstrzygalnym — będzie
  // potrzebne przy wyborze komórki zapisu.
  pozycja(TOWAR_A, 1, 950);
  pozycja(TOWAR_A, 1, 903);

  assert.deepEqual(JSON.parse(linie()[0].sgt_pozycje!), [903, 950]);
});

test("różne towary dostają własne listy, bez przemieszania", () => {
  pozycja(TOWAR_A, 5, 910);
  pozycja(TOWAR_B, 6, 911);
  pozycja(TOWAR_A, 2, 912);

  const l = linie();
  assert.equal(l.length, 2);
  assert.deepEqual(JSON.parse(l[0].sgt_pozycje!), [910, 912]);
  assert.deepEqual(JSON.parse(l[1].sgt_pozycje!), [911]);
  assert.equal(l[0].ilosc_dok, 7);
  assert.equal(l[1].ilosc_dok, 6);
});

test("baza bez kolumny klucza pozycji: NULL, a nie lista zer", () => {
  // Import degraduje `ob_id` do NULL, gdy kolumny nie ma. Lista [0,0] byłaby
  // gorsza od pustki: wyglądałaby na prawdziwe identyfikatory i skierowałaby
  // przyszły zapis w nieistniejący wiersz faktury.
  pozycja(TOWAR_A, 4, null);
  pozycja(TOWAR_A, 3, null);

  const l = linie();
  assert.equal(l.length, 1);
  assert.equal(l[0].ilosc_dok, 7, "brak identyfikatora nie może psuć ilości");
  assert.equal(l[0].sgt_pozycje, null);
});

test("część pozycji bez identyfikatora — zapisujemy te, które są", () => {
  // Stan przejściowy: import po zmianie konfiguracji. Wyrzucenie całej listy
  // przez jeden brak byłoby stratą wiedzy, którą mamy.
  pozycja(TOWAR_A, 4, null);
  pozycja(TOWAR_A, 3, 920);

  assert.deepEqual(JSON.parse(linie()[0].sgt_pozycje!), [920]);
});
