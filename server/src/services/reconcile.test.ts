import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Rekoncyliacja jest ostatnią linią obrony przed cichym błędem transakcyjnym:
   kod się kompiluje, działa, wygląda dobrze i przez trzy tygodnie rozjeżdża
   dane. Jej własny błąd byłby tym samym rodzajem awarii — raportem, który
   milczy — więc każda z czterech kontroli ma tu wiersz.                      */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-rec-")), "t.db");

let db: typeof import("../db/db.js").db;
let reconcile: typeof import("./reconcile.js").reconcile;
let reconcileCsv: typeof import("./reconcile.js").reconcileCsv;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ reconcile, reconcileCsv } = await import("./reconcile.js"));
});

const TW = 1;

function towar(lokalizacja: string) {
  db()
    .prepare(
      `INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, lokalizacja)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(tw_id) DO UPDATE SET lokalizacja = excluded.lokalizacja`
    )
    .run(TW, "W32-0203", "Wąż ogrodowy", "5901234567890", "szt", lokalizacja);
}

function zadanie(o: {
  type?: string;
  status: string;
  newValue?: string;
  dni?: number;
  docId?: number | null;
}) {
  const dni = o.dni ?? 0;
  db()
    .prepare(
      `INSERT INTO sfera_queue(type, payload, status, label, detail, tw_id, source_doc_id,
                               created_by, created_at, processed_at, error_msg)
       VALUES (?,?,?,'Lokalizacja · W32-0203','', ?, ?, 'test',
               datetime('now', ?), datetime('now', ?), 'Zapis Sfery nieudany')`
    )
    .run(
      o.type ?? "set_location",
      JSON.stringify({ twId: TW, newValue: o.newValue ?? "" }),
      o.status,
      TW,
      o.docId ?? null,
      `-${dni} days`,
      `-${dni} days`
    );
}

beforeEach(() => {
  db().prepare("DELETE FROM sfera_queue").run();
  db().prepare("DELETE FROM delivery_line").run();
  db().prepare("DELETE FROM delivery").run();
});

test("zgodny zapis nie generuje raportu", () => {
  towar("A01-02-03");
  zadanie({ status: "done", newValue: "A01-02-03" });
  const r = reconcile();
  assert.equal(r.rozjazdy.length, 0);
  assert.equal(r.sprawdzono.kartotek, 1);
});

test("Subiekt ma co innego, niż aplikacja zapisała", () => {
  // dokładnie ten cichy błąd, dla którego ta kontrola istnieje
  towar("B02-02-02");
  zadanie({ status: "done", newValue: "A01-02-03" });
  const r = reconcile();
  assert.equal(r.rozjazdy.length, 1);
  assert.equal(r.rozjazdy[0].rodzaj, "lokalizacja");
  assert.match(r.rozjazdy[0].opis, /A01-02-03/);
  assert.match(r.rozjazdy[0].opis, /B02-02-02/);
});

test("kolejność kodów nie jest rozjazdem", () => {
  // pickingową (pierwszą) pilnuje tryb A; tu liczy się zbiór adresów
  towar("B02-02-02 A01-02-03");
  zadanie({ status: "done", newValue: "A01-02-03 B02-02-02" });
  assert.equal(reconcile().rozjazdy.length, 0);
});

test("zadanie w błędzie zgłasza się dopiero po dobie", () => {
  towar("A01-02-03");
  zadanie({ status: "error", newValue: "A01-02-03" });
  assert.equal(reconcile().rozjazdy.length, 0, "świeży błąd widać na pastylce Sfery");

  db().prepare("DELETE FROM sfera_queue").run();
  zadanie({ status: "error", newValue: "A01-02-03", dni: 2 });
  const r = reconcile();
  assert.equal(r.rozjazdy[0].rodzaj, "zadanie_w_bledzie");
  assert.match(r.rozjazdy[0].opis, /Zapis Sfery nieudany/);
});

test("dokument, który nie wyszedł z bufora przez trzy dni", () => {
  towar("A01-02-03");
  zadanie({ type: "mm", status: "waiting_for_doc", dni: 1, docId: 77 });
  assert.equal(reconcile().rozjazdy.length, 0);

  db().prepare("DELETE FROM sfera_queue").run();
  zadanie({ type: "mm", status: "waiting_for_doc", dni: 5, docId: 77 });
  const r = reconcile();
  assert.equal(r.rozjazdy[0].rodzaj, "utknelo_w_buforze");
  assert.match(r.rozjazdy[0].opis, /77/);
});

test("koszyk zwrotu bez MM po dobie to utracona sprzedaż", () => {
  towar("A01-02-03");
  db()
    .prepare(
      `INSERT INTO delivery(id, sgt_dok_id, sgt_dok_numer, opened_at, source_mag_id)
       VALUES (1, 900, 'ZW 7/07/2026', datetime('now'), 3)`
    )
    .run();
  const linia = (odlozona: number, mm: number, dni: number) =>
    db()
      .prepare(
        `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok,
                                   ilosc_odlozona, status, koszyk, mm_ilosc, done_at)
         VALUES (1, ?, 'W32-0203', 'Wąż', 5, ?, 'done', '3', ?, datetime('now', ?))`
      )
      .run(TW, odlozona, mm, `-${dni} days`);

  linia(5, 5, 3); // domknięty MM-em — nie jest zaległością
  assert.equal(reconcile().rozjazdy.length, 0);

  db().prepare("DELETE FROM delivery_line").run();
  linia(5, 0, 3);
  const r = reconcile();
  assert.equal(r.rozjazdy[0].rodzaj, "koszyk_bez_mm");
  assert.match(r.rozjazdy[0].klucz, /ZW 7\/07\/2026 \/ koszyk 3/);
  assert.match(r.rozjazdy[0].opis, /5 szt/);
});

test("dostawa krajowa nigdy nie jest koszykiem bez MM", () => {
  // mm_ilosc zostaje tam zerem na zawsze — bez tego warunku raport krzyczałby
  // codziennie na każdej krajówce, czyli przestałby być czytany
  towar("A01-02-03");
  db()
    .prepare(
      `INSERT INTO delivery(id, sgt_dok_id, sgt_dok_numer, opened_at, source_mag_id)
       VALUES (2, 901, 'FZ 1/2026', datetime('now'), 1)`
    )
    .run();
  db()
    .prepare(
      `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok,
                                 ilosc_odlozona, status, koszyk, mm_ilosc, done_at)
       VALUES (2, ?, 'W32-0203', 'Wąż', 5, 5, 'done', '1', 0, datetime('now','-3 days'))`
    )
    .run(TW);
  assert.equal(reconcile().rozjazdy.length, 0);
});

test("CSV otwiera się w Excelu PL bez kreatora", () => {
  towar("B02-02-02");
  zadanie({ status: "done", newValue: "A01-02-03" });
  const csv = reconcileCsv(reconcile());
  assert.ok(csv.startsWith("﻿"), "BOM");
  assert.match(csv.replace(/^﻿/, "").split("\r\n")[0], /^rodzaj;klucz;opis;od_kiedy$/);
  assert.match(csv, /"lokalizacja"/);
});
