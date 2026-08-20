import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Nadmiar w dostawie (0.64.0) ─────────────────────────────────────────────
   Ze zgłoszenia: „dodaj możliwość zatwierdzenia większej ilości niż jest na
   fakturze, idzie to do biura jako problem po zakończeniu dostawy".

   Trzy rzeczy naraz trzeba tu pilnować, bo każda psuje co innego:

   1. Nadmiar MA przejść — inaczej magazynier stoi przy palecie z towarem,
      którego nie da się odłożyć.
   2. Zgłoszenie MA powstać, i to raz — dostawa domyka się sama po ostatniej
      pozycji, a `closeIfComplete` woła się kilka razy pod rząd.
   3. Pozycja MA zostać odłożona. Status `problem` odesłałby magazyniera do
      roboty, której nie ma: towar leży na półce, a nadmiar jest sprawą biura
      wobec dostawcy.                                                          */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-nadm-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let D: typeof import("./delivery.js");
let P: typeof import("./problems.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./delivery.js");
  P = await import("./problems.js");
});

const DOK = 940;
let dostawaId = 0;

beforeEach(() => {
  for (const t of ["delivery_note", "problem", "delivery_line", "delivery", "events"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
  dostawaId = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, status, opened_at, source_mag_id)
         VALUES (?,?, 'open', ?, 1)`
      )
      .run(DOK, `FZ ${DOK}/MAG/08/2026`, new Date().toISOString()).lastInsertRowid
  );
});

/** Pozycja dostawy: 10 szt. na dokumencie, `odlozone` na półce. */
function linia(odlozone: number, status = "todo", sym = "W32-0203"): number {
  return Number(
    db()
      .prepare(
        `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok,
                                   ilosc_odlozona, status, lok_faktyczna)
         VALUES (?,?,?,?,10,?,?, 'A01-02-03')`
      )
      .run(dostawaId, 101, sym, "Kosa", odlozone, status).lastInsertRowid
  );
}

const stanLinii = (lineId: number) =>
  db().prepare("SELECT ilosc_odlozona AS qty, status FROM delivery_line WHERE id=?").get(lineId) as {
    qty: number;
    status: string;
  };

const wyjatki = () => P.listByDelivery(dostawaId);

// ── odłożenie ponad dokument ─────────────────────────────────────────────────

test("odłożenie większej ilości niż na fakturze przechodzi i domyka pozycję", () => {
  const l = linia(0);
  const r = D.putawayLine(l, "A01-02-03", "Jan z hali", { qty: 12 });
  assert.ok(!("error" in r), "nadmiar ma przejść — towar fizycznie leży na palecie");
  const stan = stanLinii(l);
  assert.equal(stan.qty, 12);
  assert.equal(stan.status, "done");
});

test("nadmiar sam w sobie NIE zgłasza niczego przed zamknięciem", () => {
  /* Magazynier dokłada sztuki w dwóch podejściach albo poprawia się korektą.
     Zgłoszenie przy pierwszym przekroczeniu byłoby reklamacją opartą na
     liczbie, która jeszcze się zmieniała. */
  const l = linia(0);
  linia(0, "todo", "INNA-POZYCJA"); // druga pozycja trzyma dostawę otwartą
  D.putawayLine(l, "A01-02-03", "Jan z hali", { qty: 12 });
  assert.equal(wyjatki().length, 0);
  assert.equal(db().prepare("SELECT status FROM delivery WHERE id=?").get(dostawaId)?.["status"], "open");
});

// ── zgłoszenie przy zamknięciu ───────────────────────────────────────────────

test("zamknięcie dostawy zakłada wyjątek na nadmiar, z obiema liczbami", () => {
  const l = linia(0);
  D.putawayLine(l, "A01-02-03", "Jan z hali", { qty: 12 }); // ostatnia pozycja → auto-domknięcie

  const w = wyjatki();
  assert.equal(w.length, 1, "dokładnie jedno zgłoszenie");
  assert.equal(w[0].typ, "qty_mismatch");
  assert.equal(w[0].qty, 12, "ilość FAKTYCZNA");
  assert.equal(w[0].qtyDok, 10, "snapshot ilości z dokumentu");
  assert.match(w[0].opis ?? "", /12/, "opis mówi, co się stało");
});

test("pozycja z nadmiarem ZOSTAJE odłożona, nie wraca do roboty", () => {
  // status `problem` odesłałby magazyniera do zadania, którego nie ma
  const l = linia(0);
  D.putawayLine(l, "A01-02-03", "Jan z hali", { qty: 12 });
  assert.equal(stanLinii(l).status, "done");
});

test("powtórne domykanie nie robi drugiego zgłoszenia", () => {
  /* `closeIfComplete` woła się po odłożeniu, z `raiseProblem` i z przycisku.
     Bez bramki na `changes` biuro dostawałoby tę samą reklamację kilka razy. */
  const l = linia(0);
  D.putawayLine(l, "A01-02-03", "Jan z hali", { qty: 12 });
  D.closeIfComplete(dostawaId, "Jan z hali");
  D.closeIfComplete(dostawaId, "Jan z hali");
  assert.equal(wyjatki().length, 1);
});

test("dostawa bez nadmiaru zamyka się bez jednego zgłoszenia", () => {
  // strażnik na zbyt szeroką regułę: równa ilość NIE jest nadmiarem
  const l = linia(0);
  D.putawayLine(l, "A01-02-03", "Jan z hali", { qty: 10 });
  assert.equal(wyjatki().length, 0);
});

test("zamknięcie przyciskiem też zgłasza nadmiar", () => {
  // dwie drogi domknięcia, jeden lej — obie muszą kończyć tak samo
  const l = linia(0);
  const druga = linia(0);
  D.putawayLine(l, "A01-02-03", "Jan z hali", { qty: 12 });
  D.putawayLine(druga, "A01-02-03", "Jan z hali", { qty: 4 }); // niepełna → wyjątek braku
  const r = D.zakonczDostawe(dostawaId, "Jan z hali");
  assert.ok(!("error" in r));
  const typy = wyjatki().map((w) => w.qty).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.deepEqual(typy, [4, 12], "brak i nadmiar, każdy ze swoją liczbą");
});

test("nadmiary() czyta, ale nie zapisuje", () => {
  const l = linia(12, "done");
  assert.deepEqual(
    D.nadmiary(dostawaId).map((n) => [n.lineId, n.qtyDoc, n.qtyDone]),
    [[l, 10, 12]]
  );
  assert.equal(wyjatki().length, 0, "sam odczyt niczego nie zakłada");
});
